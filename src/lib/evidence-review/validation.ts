/**
 * Validation and deterministic guards for the Evidence Review boundary.
 *
 * Four layers, in the order they run:
 *
 *   1. `validateReviewRequest`  — is this a well-formed review request? (400)
 *   2. `deterministicGuard`     — a verdict that needs no model, because it
 *                                 follows from the request alone: a source type
 *                                 the requirement does not accept, content too
 *                                 thin to review, a prompt-injection attempt, or
 *                                 a self-declared AUTO_VERIFIED claim.
 *   3. `validateReviewAgainstSchema` — Layer 1: structural validation of the
 *                                 verdict against
 *                                 `schemas/evidence-review.v0.schema.json`.
 *   4. `validateReviewResult`   — Layer 2: semantic rules R1–R6 on the model's
 *                                 verdict, including the proof-boundary ceiling.
 *
 * The Schema and the semantic layer deliberately overlap, exactly as they do for
 * contract validation: the Schema blocks structural violations cheaply, and the
 * semantic layer re-checks what a Schema cannot express so a hand-built verdict
 * still gets correct results.
 *
 * The proof-boundary rules are the point of this module. A reviewer reads
 * pasted text; it cannot execute anything, so it can never certify that "the
 * platform really ran this check". Pasted terminal output is LOG_INSPECTED at
 * most, a pasted file is ARTIFACT_INSPECTED at most, and a sentence saying the
 * tests passed is USER_REPORTED. Upgrading that boundary is treated as an
 * invalid verdict rather than silently accepted, so it can never be laundered
 * into the ledger.
 */
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import reviewSchemaJson from "../../../schemas/evidence-review.v0.schema.json";
import { EvidenceSourceType } from "@/lib/contracts";

import {
  DECISIONS,
  CONTENT_MAX_LENGTH,
  EvidenceReview,
  EvidenceReviewRequest,
  FINDINGS,
  HINT_MAX_LENGTH,
  MAX_SUGGESTED_EVIDENCE,
  RATIONALE_MAX_LENGTH,
  SOURCE_TYPES,
  SuggestedEvidence,
} from "./types";

/** Ascending proof strength. Index is the rank; higher proves more. */
export const PROOF_BOUNDARY_ORDER: readonly EvidenceSourceType[] = [
  "USER_REPORTED",
  "ARTIFACT_INSPECTED",
  "LOG_INSPECTED",
  "AUTO_VERIFIED",
];

/** Content shorter than this cannot be reviewed meaningfully. */
export const MIN_MEANINGFUL_CONTENT = 8;

const reviewAjv = new Ajv2020({ allErrors: true, strict: false });
addFormats(reviewAjv);
const reviewSchemaValidate = reviewAjv.compile(reviewSchemaJson);

export const PROOF_BOUNDARY_TEXT: Record<EvidenceSourceType, string> = {
  USER_REPORTED: "你的说明",
  ARTIFACT_INSPECTED: "文件内容",
  LOG_INSPECTED: "运行结果",
  AUTO_VERIFIED: "系统实测",
};

export function proofBoundaryRank(sourceType: EvidenceSourceType): number {
  const rank = PROOF_BOUNDARY_ORDER.indexOf(sourceType);
  return rank === -1 ? -1 : rank;
}

/**
 * The highest proof boundary a review of PASTED content may claim.
 *
 * Everything at or below the declared source type is honest, because the
 * reviewer really did read what was submitted. AUTO_VERIFIED is not reachable:
 * it requires the platform to have executed the check, and this boundary reads
 * text only. A submission that declares AUTO_VERIFIED is therefore reviewed as
 * LOG_INSPECTED, never promoted.
 */
export function honestCeiling(sourceType: EvidenceSourceType): EvidenceSourceType {
  return sourceType === "AUTO_VERIFIED" ? "LOG_INSPECTED" : sourceType;
}

export function exceedsProofCeiling(
  boundary: EvidenceSourceType,
  declaredSourceType: EvidenceSourceType,
): boolean {
  return proofBoundaryRank(boundary) > proofBoundaryRank(honestCeiling(declaredSourceType));
}

/**
 * Heuristic prompt-injection detector.
 *
 * This is a deterministic second line of defence, not a substitute for the
 * system prompt. It exists so the "injection must not be silently accepted"
 * guarantee holds even when the model is unavailable or compliant with the
 * injected instruction. Only patterns that address the reviewer are matched;
 * ordinary code and logs that merely mention a keyword are not.
 */
const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(?:the\s+|all\s+(?:of\s+)?(?:the\s+)?|any\s+)?(?:previous|prior|above|earlier|foregoing)\s+(?:instructions?|prompts?|rules?|guidelines?)/i,
  /disregard\s+(the\s+)?(system|previous|above|prior)/i,
  /you\s+are\s+now\s+(a|an|the)\b/i,
  /(system|developer)\s+prompt/i,
  /(return|output|reply with|respond with)\s+(only\s+)?["']?(accepted|pass)/i,
  /do\s+not\s+(review|check|validate|apply rules)/i,
  /忽略(以上|上述|之前|前面|所有)(的)?(指令|要求|提示|规则)/,
  /(你现在是|从现在开始你是|扮演)/,
  /(直接|只)(返回|输出|回答)(["「']?(accepted|通过|pass))/i,
  /(系统|开发者)(提示词|指令)/,
  /(请|必须)(无条件)?(判定|标记)(为)?(通过|accepted)/i,
  /不要(审核|检查|验证|遵守规则)/,
  /绕过(审核|规则|限制)/,
];

/** Returns the matched injection marker, or null when nothing matches. */
export function detectPromptInjection(content: string): string | null {
  for (const pattern of INJECTION_PATTERNS) {
    const match = content.match(pattern);
    if (match) return match[0].slice(0, 80);
  }
  return null;
}

export interface GuardContext {
  acceptedSourceTypes: readonly EvidenceSourceType[];
  requirementId: string;
  criterionId: string;
}

/** Suggested evidence a requirement can actually accept, least effort first. */
function acceptedSuggestions(context: GuardContext, hint: string): SuggestedEvidence[] {
  return context.acceptedSourceTypes
    .map((sourceType) => ({
      sourceType,
      hint: `${hint}（可接受来源：${PROOF_BOUNDARY_TEXT[sourceType]}）`,
    }))
    .slice(0, MAX_SUGGESTED_EVIDENCE);
}

/**
 * A verdict that requires no model call, because it follows from the request.
 * Returns null when the submission must go to a reviewer.
 */
export function deterministicGuard(
  request: EvidenceReviewRequest,
): EvidenceReview | null {
  const { submission, requirement, criterion } = request;
  const context: GuardContext = {
    acceptedSourceTypes: requirement.acceptedSourceTypes,
    requirementId: requirement.id,
    criterionId: criterion.id,
  };

  // G1 — the requirement does not accept this source type. This is the §7 rule
  // that unrelated or wrongly-sourced evidence cannot move a criterion; the
  // verdict is decided here so it cannot depend on the model.
  if (!requirement.acceptedSourceTypes.includes(submission.sourceType)) {
    const accepted = requirement.acceptedSourceTypes
      .map((source) => PROOF_BOUNDARY_TEXT[source])
      .join(" / ");
    return {
      decision: "REJECTED",
      finding: "INCONCLUSIVE",
      rationale:
        `${criterion.id} / ${requirement.id} 不接受「${PROOF_BOUNDARY_TEXT[submission.sourceType]}」类型的证据` +
        `（可接受：${accepted}）。这条证据不能改变验收状态，请换一种来源再提交。`,
      proofBoundary: honestCeiling(submission.sourceType),
      suggestedNextEvidence: acceptedSuggestions(context, `改用 ${requirement.id} 接受的来源`),
    };
  }

  const content = submission.content.trim();

  // G2 — too thin to review. "测试通过了" is a claim, not evidence.
  if (content.length < MIN_MEANINGFUL_CONTENT) {
    return {
      decision: "INCONCLUSIVE",
      finding: "INCONCLUSIVE",
      rationale:
        "提交内容过短，无法审核出具体结论。请粘贴能直接观察的片段：命令与输出、关键代码、或状态说明。",
      proofBoundary: honestCeiling(submission.sourceType),
      suggestedNextEvidence: acceptedSuggestions(context, `补充 ${requirement.id} 需要的实际内容`),
    };
  }

  // G3 — the content tries to instruct the reviewer.
  const marker = detectPromptInjection(content);
  if (marker !== null) {
    return {
      decision: "REJECTED",
      finding: "INCONCLUSIVE",
      rationale:
        `提交内容包含试图指示审核器的文本（匹配：${marker}）。审核只依据可观察的证据，` +
        "不接受对审核结论的要求。请删除这段文本后重新提交。",
      proofBoundary: honestCeiling(submission.sourceType),
      suggestedNextEvidence: acceptedSuggestions(context, "删除指令性文本后重新提交"),
    };
  }

  // G4 — a claim of platform execution. The platform did not run anything, and
  // no amount of pasted text can establish that it did.
  if (submission.sourceType === "AUTO_VERIFIED") {
    return {
      decision: "INCONCLUSIVE",
      finding: "INCONCLUSIVE",
      rationale:
        "「平台执行」需要平台真实运行检查才能成立，粘贴的文本最高只能作为「运行日志」。" +
        "如果你确实手工跑过，请选择「运行日志」重新提交；平台的自动验证属于后续版本。",
      proofBoundary: "LOG_INSPECTED",
      suggestedNextEvidence: requirement.acceptedSourceTypes.includes("LOG_INSPECTED")
        ? [{ sourceType: "LOG_INSPECTED", hint: "把运行命令与完整输出作为日志提交" }]
        : acceptedSuggestions(context, "改用手工可提供的来源"),
    };
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSourceType(value: unknown): value is EvidenceSourceType {
  return typeof value === "string" && SOURCE_TYPES.includes(value as EvidenceSourceType);
}

function isMember(allowed: readonly string[], value: unknown): value is string {
  return typeof value === "string" && allowed.includes(value);
}

function boundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.trim().length >= min && value.length <= max;
}

export type RequestValidation =
  | { ok: true; request: EvidenceReviewRequest }
  | { ok: false; message: string };

const BAD_REQUEST_MESSAGE = "证据审核请求格式不正确，请检查验收项、证据要求与提交内容。";

/**
 * Validates the request body. Every failure is the client's fault (400), so the
 * caller never has to guess whether a rejection was a server defect.
 */
export function validateReviewRequest(body: unknown): RequestValidation {
  if (!isRecord(body)) return { ok: false, message: BAD_REQUEST_MESSAGE };
  if (body.schemaVersion !== "evidence-review.v0") {
    return { ok: false, message: BAD_REQUEST_MESSAGE };
  }

  const criterion = body.criterion;
  if (
    !isRecord(criterion) ||
    !boundedString(criterion.id, 1, 100) ||
    !boundedString(criterion.description, 1, 1000) ||
    typeof criterion.required !== "boolean"
  ) {
    return { ok: false, message: BAD_REQUEST_MESSAGE };
  }

  const requirement = body.requirement;
  if (!isRecord(requirement) || !boundedString(requirement.id, 1, 100)) {
    return { ok: false, message: BAD_REQUEST_MESSAGE };
  }
  if (!boundedString(requirement.description, 1, 1000)) {
    return { ok: false, message: BAD_REQUEST_MESSAGE };
  }
  const accepted = requirement.acceptedSourceTypes;
  if (
    !Array.isArray(accepted) ||
    accepted.length === 0 ||
    !accepted.every(isSourceType)
  ) {
    return { ok: false, message: BAD_REQUEST_MESSAGE };
  }
  if (
    typeof requirement.minimumCount !== "number" ||
    !Number.isInteger(requirement.minimumCount) ||
    requirement.minimumCount < 1
  ) {
    return { ok: false, message: BAD_REQUEST_MESSAGE };
  }

  const submission = body.submission;
  if (!isRecord(submission) || !isSourceType(submission.sourceType)) {
    return { ok: false, message: BAD_REQUEST_MESSAGE };
  }
  if (!boundedString(submission.sourceName, 1, 200)) {
    return { ok: false, message: BAD_REQUEST_MESSAGE };
  }
  if (!boundedString(submission.content, 1, CONTENT_MAX_LENGTH)) {
    return { ok: false, message: BAD_REQUEST_MESSAGE };
  }

  const deliverable = body.deliverable;
  if (
    deliverable !== undefined &&
    (!isRecord(deliverable) ||
      !boundedString(deliverable.id, 1, 100) ||
      !boundedString(deliverable.description, 1, 1000))
  ) {
    return { ok: false, message: BAD_REQUEST_MESSAGE };
  }

  return {
    ok: true,
    request: {
      schemaVersion: "evidence-review.v0",
      criterion: {
        id: criterion.id.trim(),
        description: criterion.description.trim(),
        required: criterion.required,
      },
      requirement: {
        id: requirement.id.trim(),
        description: requirement.description.trim(),
        acceptedSourceTypes: accepted as EvidenceSourceType[],
        minimumCount: requirement.minimumCount,
      },
      ...(deliverable && isRecord(deliverable)
        ? {
            deliverable: {
              id: (deliverable.id as string).trim(),
              description: (deliverable.description as string).trim(),
            },
          }
        : {}),
      submission: {
        sourceType: submission.sourceType,
        sourceName: submission.sourceName.trim(),
        content: submission.content.trim(),
      },
    },
  };
}

export type ResultValidation =
  | { outcome: "REVIEW"; review: EvidenceReview; warnings: string[] }
  | { outcome: "INVALID_OUTPUT"; diagnostics: string[] };

/**
 * Layer 1: structural validation of a verdict against the canonical schema.
 * Returns null when the document is structurally valid.
 */
export function validateReviewAgainstSchema(doc: unknown): string[] | null {
  if (reviewSchemaValidate(doc)) return null;
  const diagnostics = (reviewSchemaValidate.errors ?? []).map(
    (error) => `SCHEMA ${error.instancePath || "/"}: ${error.message ?? "violation"}`,
  );
  return diagnostics.length > 0 ? diagnostics : ["SCHEMA /: invalid verdict"];
}

function validateSuggestions(value: unknown, diagnostics: string[]): SuggestedEvidence[] {
  if (!Array.isArray(value)) {
    diagnostics.push("R1 suggestedNextEvidence must be an array");
    return [];
  }
  if (value.length > MAX_SUGGESTED_EVIDENCE) {
    diagnostics.push(
      `R1 suggestedNextEvidence must have at most ${MAX_SUGGESTED_EVIDENCE} entries, got ${value.length}`,
    );
    return [];
  }
  const suggestions: SuggestedEvidence[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item) || !isSourceType(item.sourceType)) {
      diagnostics.push(`R1 suggestedNextEvidence[${index}].sourceType is not a known source type`);
      continue;
    }
    if (!boundedString(item.hint, 1, HINT_MAX_LENGTH)) {
      diagnostics.push(`R1 suggestedNextEvidence[${index}].hint must be 1..${HINT_MAX_LENGTH} characters`);
      continue;
    }
    suggestions.push({ sourceType: item.sourceType, hint: item.hint.trim() });
  }
  return suggestions;
}

/**
 * Semantic rules on a reviewer's verdict.
 *
 * The structural checks below repeat the Schema on purpose (defence in depth),
 * so a hand-built verdict that skipped Layer 1 is still rejected.
 *
 * R1 shape and bounds; R2 the proof boundary may not exceed the honest ceiling
 * of the declared source type; R3 REJECTED cannot simultaneously assert PASS or
 * FAIL; R4 a non-accepted verdict must suggest what to submit instead
 * (warning); R5 the rationale must be substantial (warning).
 */
export function validateReviewResult(
  doc: unknown,
  request: EvidenceReviewRequest,
): ResultValidation {
  if (!isRecord(doc)) {
    return { outcome: "INVALID_OUTPUT", diagnostics: ["R1 verdict must be a JSON object"] };
  }

  // Layer 1 — structural validation against schemas/evidence-review.v0.schema.json.
  const schemaDiagnostics = validateReviewAgainstSchema(doc);
  if (schemaDiagnostics !== null) {
    return { outcome: "INVALID_OUTPUT", diagnostics: schemaDiagnostics };
  }

  const diagnostics: string[] = [];
  const warnings: string[] = [];

  const decision = doc.decision;
  if (!isMember(DECISIONS, decision)) {
    diagnostics.push(`R1 decision must be one of ${DECISIONS.join(", ")}`);
  }
  const finding = doc.finding;
  if (!isMember(FINDINGS, finding)) {
    diagnostics.push(`R1 finding must be one of ${FINDINGS.join(", ")}`);
  }
  const boundary = doc.proofBoundary;
  if (typeof boundary !== "string" || !isSourceType(boundary)) {
    diagnostics.push(`R1 proofBoundary must be one of ${SOURCE_TYPES.join(", ")}`);
  }
  if (!boundedString(doc.rationale, 1, RATIONALE_MAX_LENGTH)) {
    diagnostics.push(`R1 rationale must be 1..${RATIONALE_MAX_LENGTH} characters`);
  } else if (doc.rationale.trim().length < 12) {
    warnings.push("R5 rationale is too short to explain the verdict");
  }
  const suggested = validateSuggestions(doc.suggestedNextEvidence, diagnostics);

  if (diagnostics.length > 0) return { outcome: "INVALID_OUTPUT", diagnostics };

  const review: EvidenceReview = {
    decision: decision as EvidenceReview["decision"],
    finding: finding as EvidenceReview["finding"],
    rationale: (doc.rationale as string).trim(),
    proofBoundary: boundary as EvidenceSourceType,
    suggestedNextEvidence: suggested,
  };

  // R2 — the boundary ceiling. This is the rule the whole boundary exists for:
  // a reviewer reading pasted text must not certify that the platform ran it.
  if (exceedsProofCeiling(review.proofBoundary, request.submission.sourceType)) {
    diagnostics.push(
      `R2 proofBoundary ${review.proofBoundary} exceeds what a review of ` +
        `${request.submission.sourceType} content can establish ` +
        `(ceiling ${honestCeiling(request.submission.sourceType)})`,
    );
  }

  // R3 — rejecting the evidence while asserting it passed or failed. If the
  // content really shows a verdict, the evidence is admissible; if it is not
  // admissible, it cannot assert one.
  if (review.decision === "REJECTED" && review.finding !== "INCONCLUSIVE") {
    diagnostics.push(
      `R3 decision REJECTED cannot carry finding ${review.finding}; ` +
        "use ACCEPTED when the content shows something, or INCONCLUSIVE when it does not",
    );
  }

  if (diagnostics.length > 0) return { outcome: "INVALID_OUTPUT", diagnostics };

  // R4 — a verdict that does not accept the evidence should say what to submit.
  if (review.decision !== "ACCEPTED" && review.suggestedNextEvidence.length === 0) {
    warnings.push("R4 a non-accepted verdict should suggest the next evidence to submit");
  }

  return { outcome: "REVIEW", review, warnings };
}

/** Compact diagnostics text for repair prompts and logs. */
export function formatReviewDiagnostics(diagnostics: string[], maxChars = 1200): string {
  let output = diagnostics.map((item) => `- ${item}`).join("\n");
  if (output.length > maxChars) output = output.slice(0, maxChars);
  return output;
}

/**
 * Browser-side wrapper around `POST /api/evidence/review`.
 *
 * Kept out of the route and out of the component for the same reason the ledger
 * rules are kept out of the components: the interesting behaviour — how a
 * failed review is described to the user, and the fact that a failure never
 * produces a verdict — is pure logic and should be unit-testable with no
 * browser and no server.
 *
 * This module is deliberately dependency-free. It must NOT import
 * `./validation`, which pulls in Ajv and the JSON schema: that is server-side
 * machinery, and shipping a validator to the browser to re-check an answer the
 * server already validated would be both a bundle-size and a trust mistake.
 * The light structural check below exists only so a proxy or a crash page
 * cannot hand `undefined` to React.
 */
import { AcceptanceCriterion } from "@/lib/contracts";

import {
  DECISIONS,
  EvidenceReview,
  EvidenceReviewRequest,
  FINDINGS,
  REVIEW_SCHEMA_VERSION,
  ReviewSubmission,
  SOURCE_TYPES,
  SuggestedEvidence,
} from "./types";

export type ReviewerKind = "MOCK" | "AI";

/** The successful body of the review endpoint. */
export interface SubmittedReview {
  review: EvidenceReview;
  reviewer: ReviewerKind;
  promptVersion: string;
  generation: "MOCK" | "AI";
}

/** What the route returns when it refuses or fails. */
interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

export class ReviewRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ReviewRequestError";
  }
}

type AcceptanceRequirement = AcceptanceCriterion["evidenceRequirements"][number];

/**
 * Assembles the wire request from the contract's own vocabulary.
 *
 * Only the fields the reviewer needs are sent. In particular the criterion's
 * current status and the contract's other criteria are NOT sent: a reviewer
 * that knows the criterion is already PASS can be nudged into agreeing with it,
 * and one that knows nothing but this requirement and this text can only judge
 * the text.
 */
export function buildReviewRequest(
  criterion: AcceptanceCriterion,
  requirement: AcceptanceRequirement,
  submission: ReviewSubmission,
  deliverable?: { id: string; description: string },
): EvidenceReviewRequest {
  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    criterion: {
      id: criterion.id,
      description: criterion.description,
      required: criterion.required,
    },
    requirement: {
      id: requirement.id,
      description: requirement.description,
      acceptedSourceTypes: [...requirement.acceptedSourceTypes],
      minimumCount: requirement.minimumCount,
    },
    ...(deliverable
      ? { deliverable: { id: deliverable.id, description: deliverable.description } }
      : {}),
    submission: {
      sourceType: submission.sourceType,
      sourceName: submission.sourceName,
      content: submission.content,
    },
  };
}

function isSuggestedEvidence(value: unknown): value is SuggestedEvidence {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return SOURCE_TYPES.includes(item.sourceType as never) && typeof item.hint === "string";
}

function isEvidenceReview(value: unknown): value is EvidenceReview {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    DECISIONS.includes(item.decision as never) &&
    FINDINGS.includes(item.finding as never) &&
    typeof item.rationale === "string" &&
    SOURCE_TYPES.includes(item.proofBoundary as never) &&
    Array.isArray(item.suggestedNextEvidence) &&
    item.suggestedNextEvidence.every(isSuggestedEvidence)
  );
}

/**
 * The one thing every failed review must tell the user, in the same words.
 *
 * Kept as a constant rather than folded into each branch because it is a
 * guarantee, not a description: whatever went wrong on the wire, the ledger was
 * not touched. "The AI was down and the page said something vague" is how a
 * fabricated PASS gets into a demo.
 */
export const REVIEW_FAILURE_GUARANTEE = "这份材料仍在等待检查，完成情况没有被改变。";

/**
 * Turns anything the transport or the server can throw into one sentence a
 * person can act on.
 *
 * The server's own Chinese copy is preferred where it exists — it is more
 * specific than anything this layer could invent — and the guarantee is
 * appended to all of them alike.
 */
export function reviewErrorDetail(error: unknown): string {
  if (error instanceof ReviewRequestError) return error.message;
  if (error instanceof DOMException && error.name === "AbortError") {
    return "检查请求超时，已停止等待。";
  }
  if (error instanceof Error && error.name === "AbortError") {
    return "检查请求超时，已停止等待。";
  }
  if (error instanceof TypeError) {
    return "无法连接检查服务（网络中断或本地服务未启动）。";
  }
  return "检查失败，请稍后重试。";
}

/** What went wrong, plus the guarantee that nothing was written. */
export function reviewErrorMessage(error: unknown): string {
  return `${reviewErrorDetail(error)} ${REVIEW_FAILURE_GUARANTEE}`;
}

export interface EvidenceReviewClientOptions {
  fetchImpl?: typeof fetch;
  endpoint?: string;
  /** Guards against a hung request leaving the form stuck on "审核中…". */
  timeoutMs?: number;
}

export const REVIEW_ENDPOINT = "/api/evidence/review";
export const REVIEW_TIMEOUT_MS = 30_000;

async function readError(response: Response): Promise<ReviewRequestError> {
  let message = "";
  let code = "";
  try {
    const body = (await response.json()) as ErrorEnvelope;
    message = typeof body.error?.message === "string" ? body.error.message : "";
    code = typeof body.error?.code === "string" ? body.error.code : "";
  } catch {
    // A non-JSON error body (a proxy page, a crashed worker) is not worth
    // surfacing; the status code still produces a usable message below.
  }
  if (message) return new ReviewRequestError(message, response.status, code);
  return new ReviewRequestError(
    `检查服务返回了 ${response.status}，但没有给出原因。这份材料仍在等待检查。`,
    response.status,
    code,
  );
}

/**
 * Asks the server to review one submission.
 *
 * A successful return is a PROPOSAL. This function writes nothing: the caller
 * decides whether to adopt the review, and the ledger only changes through an
 * explicit user action.
 */
export async function requestEvidenceReview(
  request: EvidenceReviewRequest,
  options: EvidenceReviewClientOptions = {},
): Promise<SubmittedReview> {
  const doFetch = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? REVIEW_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? REVIEW_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await doFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } finally {
    // Cleared on both paths: a resolved request must not leave a pending timer,
    // and a rejected one must not be aborted after the fact.
    clearTimeout(timer);
  }

  if (!response.ok) throw await readError(response);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ReviewRequestError(
      "检查服务返回了无法解析的内容，本次结果已丢弃。",
      response.status,
      "MALFORMED_RESPONSE",
    );
  }

  const envelope = body as Partial<SubmittedReview>;
  if (!isEvidenceReview(envelope.review)) {
    throw new ReviewRequestError(
      "检查结果的格式不正确，已丢弃。",
      response.status,
      "MALFORMED_REVIEW",
    );
  }

  return {
    review: envelope.review,
    reviewer: envelope.reviewer === "AI" ? "AI" : "MOCK",
    promptVersion: typeof envelope.promptVersion === "string" ? envelope.promptVersion : "unknown",
    generation: envelope.generation === "AI" ? "AI" : "MOCK",
  };
}

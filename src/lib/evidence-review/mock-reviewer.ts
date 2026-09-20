/**
 * Deterministic offline evidence reviewer.
 *
 * Selected by `BOSS_GENERATOR=mock` (the default), so the whole evidence loop
 * is demonstrable with no API key and no network, and so the rules can be
 * tested exactly. It is a stand-in for judgement, not a substitute for it: it
 * classifies observable markers in pasted output and refuses to give a verdict
 * when the content shows nothing decisive.
 *
 * Everything structural (wrong source type, content too thin, injection,
 * self-declared platform verification) is decided by `deterministicGuard`, which
 * the LLM reviewer runs too, so both reviewers agree on those cases by
 * construction.
 */
import { EvidenceSourceType } from "@/lib/contracts";

import {
  EvidenceReview,
  EvidenceReviewRequest,
  EvidenceReviewer,
  SuggestedEvidence,
} from "./types";
import {
  deterministicGuard,
  honestCeiling,
  PROOF_BOUNDARY_TEXT,
} from "./validation";

export const MOCK_PROMPT_VERSION = "evidence-review.mock.v1";

/**
 * Success stated as the ABSENCE of failure. Checked before the failure patterns,
 * because "0 failed" and "no errors" contain the very words the failure
 * patterns look for, and reading them as a failure would invert the verdict.
 */
const PASS_NEGATION_PATTERNS: readonly RegExp[] = [
  /0\s+(failed|failures?|errors?)\b/i,
  /no\s+(failures?|errors?)\b/i,
  /全部通过/,
  /无(失败|报错|异常)/,
  /0\s*(个)?(失败|报错|异常)/,
];

/** Remaining indicators that something succeeded. */
const PASS_PATTERNS: readonly RegExp[] = [
  /all\s+\d*\s*tests?\s+passed/i,
  /\b\d+\s+passed\b/i,
  /\bpassed\b/i,
  /\bsuccess(ful(ly)?)?\b/i,
  /测试通过/,
  /通过测试/,
  /验收通过/,
  /(检查|验证)通过/,
  /\u2705/,
  /\u2713/,
];

/** Strong indicators that something failed. */
const FAIL_PATTERNS: readonly RegExp[] = [
  /traceback/i,
  /assertionerror/i,
  /\bassertion\s+failed\b/i,
  /\bfailed\b/i,
  /\bfailures?\b/i,
  /\berror\b/i,
  /\bexception\b/i,
  /未通过/,
  /不通过/,
  /失败/,
  /报错/,
  /异常/,
  /无法(通过|编译|运行)/,
  /\u274c/,
];

function firstMatch(patterns: readonly RegExp[], text: string): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

/**
 * Identifier boundaries: `test_shape`, `stage2_input`, `Stage2Descriptor`.
 *
 * Evidence is overwhelmingly written in this form — a command line, a file
 * name, a symbol — so a tokenizer that treats `tests/test_shape.py` as one word
 * finds no overlap with the criterion it literally tests, and the relevance
 * check then blocks the most natural submission there is.
 */
const CASE_OR_DIGIT_BOUNDARY = /(?<=[a-z])(?=[A-Z])|(?<=[A-Za-z])(?=[0-9])|(?<=[0-9])(?=[A-Za-z])/;
const IDENTIFIER_SEPARATOR = /[_./\\-]+/;

/**
 * Tokens used for a relevance check: latin words of 3+ characters and CJK
 * bigrams. Deliberately generous — a false "relevant" only means the reviewer
 * looks at the content, while a false "irrelevant" would block real evidence,
 * so the check only fires when there is no overlap at all, and each identifier
 * contributes both itself and its parts.
 */
export function contentTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  const add = (candidate: string) => {
    const token = candidate.toLowerCase();
    // Bare numbers carry no topical meaning and would match every log, so they
    // are dropped on both the whole-token and the split path.
    if (token.length >= 3 && !/^[0-9]+$/.test(token)) tokens.add(token);
  };
  for (const raw of text.match(/[A-Za-z0-9_./\\-]{3,}/g) ?? []) {
    add(raw);
    for (const chunk of raw.split(CASE_OR_DIGIT_BOUNDARY)) {
      for (const part of chunk.split(IDENTIFIER_SEPARATOR)) add(part);
    }
  }
  for (const run of text.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length === 1) {
      tokens.add(run);
      continue;
    }
    for (let index = 0; index + 1 < run.length; index++) {
      tokens.add(run.slice(index, index + 2));
    }
  }
  return tokens;
}

export function sharesRelevance(content: string, haystack: string): boolean {
  const haystackTokens = contentTokens(haystack);
  for (const token of contentTokens(content)) {
    if (haystackTokens.has(token)) return true;
  }
  return false;
}

function suggestionFor(
  request: EvidenceReviewRequest,
  hint: string,
): SuggestedEvidence[] {
  return request.requirement.acceptedSourceTypes
    .map((sourceType) => ({
      sourceType,
      hint: `${hint}（来源：${PROOF_BOUNDARY_TEXT[sourceType]}）`,
    }))
    .slice(0, 3);
}

export class MockEvidenceReviewer implements EvidenceReviewer {
  readonly reviewerKind = "MOCK" as const;
  readonly promptVersion = MOCK_PROMPT_VERSION;

  async review(request: EvidenceReviewRequest): Promise<EvidenceReview> {
    const guard = deterministicGuard(request);
    if (guard) return guard;

    const { submission, criterion, requirement } = request;
    const content = submission.content.trim();
    const boundary: EvidenceSourceType = honestCeiling(submission.sourceType);
    const boundaryText = PROOF_BOUNDARY_TEXT[boundary];

    const relevance =
      sharesRelevance(
        content,
        [criterion.description, requirement.description, requirement.id, submission.sourceName].join("\n"),
      );
    // Order matters: negated failure wording first ("0 failed" is success), then
    // failure markers, then the remaining success markers.
    const negationMarker = firstMatch(PASS_NEGATION_PATTERNS, content);
    const failureMarker = negationMarker === null ? firstMatch(FAIL_PATTERNS, content) : null;
    const passMarker =
      negationMarker ?? (failureMarker === null ? firstMatch(PASS_PATTERNS, content) : null);

    // A failure log is evidence about this attempt even when it never names the
    // criterion, so an explicit failure marker survives a failed relevance check.
    if (!relevance && failureMarker === null) {
      return {
        decision: "INCONCLUSIVE",
        finding: "INCONCLUSIVE",
        rationale:
          `这条内容看不出与 ${criterion.id} / ${requirement.id} 的关系。` +
          "请提交针对该验收项的可观察内容：相关命令与输出、对应代码片段，或该结论的依据。",
        proofBoundary: boundary,
        suggestedNextEvidence: suggestionFor(request, `补充与 ${requirement.id} 直接相关的内容`),
      };
    }

    if (failureMarker !== null) {
      return {
        decision: "ACCEPTED",
        finding: "FAIL",
        rationale:
          `内容中出现失败信号「${failureMarker}」，作为「${boundaryText}」可以证明这次尝试没有达到 ${criterion.id}，` +
          `但证明上限只到「${boundaryText}」，不能推断其它未提交的部分。` +
          "接受这条证据不等于验收通过：它记录的是一个失败，可以进入失败资产库继续孵化。",
        proofBoundary: boundary,
        suggestedNextEvidence: suggestionFor(request, "修复后附上新的运行结果"),
      };
    }

    if (passMarker !== null) {
      return {
        decision: "ACCEPTED",
        finding: "PASS",
        rationale:
          `内容中出现成功信号「${passMarker}」，且与 ${requirement.id} 相关，可以支持 ${criterion.id} 通过。` +
          `证明上限为「${boundaryText}」，因此它证明的是${boundary === "USER_REPORTED" ? "用户声称做过" : "提交内容自身"}，` +
          "不是平台独立执行过验证。",
        proofBoundary: boundary,
        suggestedNextEvidence: [],
      };
    }

    return {
      decision: "ACCEPTED",
      finding: "INCONCLUSIVE",
      rationale:
        `内容与 ${requirement.id} 相关，但没有出现能判定通过或失败的信号，` +
        `因此只作为「${boundaryText}」记录，不改变 ${criterion.id} 的判定。` +
        "要改变判定，请提交带有明确结论的片段，例如测试汇总行或报错信息。",
      proofBoundary: boundary,
      suggestedNextEvidence: suggestionFor(request, "补充带有明确结论的内容"),
    };
  }
}

/**
 * LLM-backed evidence reviewer, using the SAME transport as Goal Discovery.
 *
 * There is deliberately no second HTTP client and no second JSON extractor: the
 * existing `OpenAICompatibleTransport` already speaks OpenAI-compatible chat
 * completions (DeepSeek by default), and `extractJson` already handles fenced or
 * prose-wrapped replies. Reusing them means the evidence loop works in both
 * `mock` and `llm` mode by changing one environment variable, and there is no
 * parallel construction path to drift out of sync with the AI owner's adapter.
 *
 * Flow per attempt:
 *   attempt 1 — system + user prompt, extract JSON, validate semantically.
 *   attempt 2 (only if attempt 1 was invalid) — resend with the diagnostics so
 *               the model can repair its own output.
 *   after that — throw REVIEW_FAILED. No partial verdicts, no fixture fallback,
 *               and no silently relaxed rules.
 */
import { extractJson, LlmTransport } from "../goal-discovery/llm-generator";
import {
  EVIDENCE_REVIEW_SYSTEM_PROMPT,
  PROMPT_VERSION,
  buildEvidenceReviewRepairPrompt,
  buildEvidenceReviewUserPrompt,
} from "./prompt";
import {
  EvidenceReview,
  EvidenceReviewRequest,
  EvidenceReviewer,
  ReviewError,
} from "./types";
import {
  deterministicGuard,
  formatReviewDiagnostics,
  validateReviewResult,
} from "./validation";

export const MAX_ATTEMPTS = 2;

export interface LLMEvidenceReviewerOptions {
  transport: LlmTransport;
}

export class LLMEvidenceReviewer implements EvidenceReviewer {
  readonly reviewerKind = "AI" as const;
  readonly promptVersion = PROMPT_VERSION;

  constructor(private readonly options: LLMEvidenceReviewerOptions) {}

  async review(request: EvidenceReviewRequest): Promise<EvidenceReview> {
    const guard = deterministicGuard(request);
    if (guard) return guard;

    const payload = {
      criterion: request.criterion,
      requirement: request.requirement,
      submission: request.submission,
    };

    let lastDiagnostics: string[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const userPrompt =
        attempt === 1
          ? buildEvidenceReviewUserPrompt(payload)
          : buildEvidenceReviewRepairPrompt(payload, lastDiagnostics);

      let content: string | null;
      try {
        const response = await this.options.transport.complete({
          systemPrompt: EVIDENCE_REVIEW_SYSTEM_PROMPT,
          userPrompt,
          temperature: 0,
        });
        content = response.content;
      } catch (error) {
        // The transport reports its own failures; surface them as review
        // failures so the caller has a single error type to map.
        throw new ReviewError(
          "TRANSPORT_ERROR",
          `evidence review transport failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const doc = content === null ? null : extractJson(content);
      if (doc === null) {
        lastDiagnostics = [
          "The previous reply was not a single JSON object. Reply with ONE complete JSON object and nothing else.",
        ];
        continue;
      }

      const outcome = validateReviewResult(doc, request);
      if (outcome.outcome === "REVIEW") {
        return outcome.review;
      }
      lastDiagnostics = [
        formatReviewDiagnostics(outcome.diagnostics),
        "Return ONE complete replacement JSON object. Do not change the submitted evidence, do not raise proofBoundary above submission.sourceType, and never output AUTO_VERIFIED.",
      ];
    }

    throw new ReviewError(
      "REVIEW_FAILED",
      `model output failed validation after ${MAX_ATTEMPTS} attempts (prompt ${PROMPT_VERSION})`,
      lastDiagnostics,
    );
  }
}

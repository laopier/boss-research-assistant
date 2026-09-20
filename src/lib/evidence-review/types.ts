/**
 * Wire types for the Evidence Review boundary.
 *
 * This module owns the shape of `POST /api/evidence/review`. It is a NEW
 * server-side boundary introduced for the failure/evidence loop; the shared
 * `boss-contract.v0` schema is deliberately NOT touched, because nothing here
 * changes what a contract contains. See `docs/contracts.zh-CN.md` §6/§7/§8 for
 * the source-type and "accepted does not mean passed" semantics this boundary
 * has to preserve.
 *
 * A reviewer answers one question: given a piece of submitted text and the
 * evidence requirement it claims to satisfy, is it admissible evidence, what
 * does it actually show, and what is the highest thing it can prove?
 */
import { EvidenceSourceType } from "@/lib/contracts";

export const REVIEW_SCHEMA_VERSION = "evidence-review.v0" as const;

/** Submissions are pasted text only: short notes, code fragments, logs. */
export const CONTENT_MIN_LENGTH = 1;
export const CONTENT_MAX_LENGTH = 4000;
export const SOURCE_NAME_MAX_LENGTH = 200;
export const RATIONALE_MAX_LENGTH = 2000;
export const HINT_MAX_LENGTH = 200;
export const MAX_SUGGESTED_EVIDENCE = 3;

export type ReviewDecision = "ACCEPTED" | "REJECTED" | "INCONCLUSIVE";
export type ReviewFinding = "PASS" | "FAIL" | "INCONCLUSIVE";

export const SOURCE_TYPES: readonly EvidenceSourceType[] = [
  "USER_REPORTED",
  "ARTIFACT_INSPECTED",
  "LOG_INSPECTED",
  "AUTO_VERIFIED",
];

export const DECISIONS: readonly ReviewDecision[] = ["ACCEPTED", "REJECTED", "INCONCLUSIVE"];
export const FINDINGS: readonly ReviewFinding[] = ["PASS", "FAIL", "INCONCLUSIVE"];

export interface ReviewCriterionContext {
  id: string;
  description: string;
  required: boolean;
}

export interface ReviewRequirementContext {
  id: string;
  description: string;
  acceptedSourceTypes: EvidenceSourceType[];
  minimumCount: number;
}

export interface ReviewSubmission {
  sourceType: EvidenceSourceType;
  sourceName: string;
  content: string;
}

export interface EvidenceReviewRequest {
  schemaVersion: typeof REVIEW_SCHEMA_VERSION;
  criterion: ReviewCriterionContext;
  requirement: ReviewRequirementContext;
  submission: ReviewSubmission;
}

export interface SuggestedEvidence {
  sourceType: EvidenceSourceType;
  hint: string;
}

/**
 * A verdict on one piece of submitted evidence.
 *
 * `decision` and `finding` are separate on purpose (§8): ACCEPTED means the
 * evidence is admissible and may be applied to the criterion, while `finding`
 * says what it shows. ACCEPTED with FAIL is a normal, useful outcome — it is
 * how a failure becomes knowledge.
 *
 * `proofBoundary` is the highest thing the reviewed content actually proves,
 * which is never higher than the boundary the submission declared and never
 * AUTO_VERIFIED (see `honestCeiling`).
 */
export interface EvidenceReview {
  decision: ReviewDecision;
  finding: ReviewFinding;
  rationale: string;
  proofBoundary: EvidenceSourceType;
  suggestedNextEvidence: SuggestedEvidence[];
}

export type ReviewErrorCode =
  | "INPUT_REJECTED"
  | "INVALID_OUTPUT"
  | "CONFIG_ERROR"
  | "TRANSPORT_ERROR"
  | "REVIEW_FAILED";

export class ReviewError extends Error {
  constructor(
    public readonly code: ReviewErrorCode,
    message: string,
    public readonly diagnostics: string[] = [],
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

export interface EvidenceReviewer {
  /** Deterministic label for the UI: which reviewer produced the verdict. */
  readonly reviewerKind: "MOCK" | "AI";
  /** Pinned identity of the prompt/rule set, for auditability. */
  readonly promptVersion: string;
  /** Returns a validated review or throws `ReviewError`. */
  review(request: EvidenceReviewRequest): Promise<EvidenceReview>;
}

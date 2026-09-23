import {
  AcceptanceCriterion,
  BossContract,
  BossStatus,
  CriterionStatus,
  EvidenceSourceType,
} from "./contracts";
import type { ReviewDecision, ReviewFinding, SuggestedEvidence } from "./evidence-review/types";

/**
 * Failure ledger: the acceptance gate, evidence recording, status derivation,
 * and the link from a recorded failure to the next Boss.
 *
 * OWNERSHIP: Web. This is a new, Web-owned module. It does not modify the
 * shared contract, `schemas/boss-contract.v0.schema.json`, or the HTTP API — it
 * only reads a contract and derives state from evidence a user records.
 *
 * The derivation rules are implemented from `docs/contracts.zh-CN.md` rather
 * than invented here:
 *
 * - §3  A criterion is `UNKNOWN`, `PASS`, or `FAIL`. `PASS` requires *every*
 *       evidence requirement to be satisfied; `FAIL` requires accepted evidence
 *       showing the criterion is not satisfied.
 * - §4  Boss precedence is `BLOCKED` > `CLEAR` > `PARTIAL` > `ACTIVE`, and
 *       `PARTIAL` specifically requires at least one required criterion to pass
 *       — it is not a blanket "not finished yet".
 * - §7  A requirement is satisfied by accepted PASS evidence of an accepted
 *       source type, at least `minimumCount` times. Evidence must map to a
 *       specific criterion and requirement; unrelated or inconclusive evidence
 *       cannot be used to pad.
 * - §8  Only `reviewStatus: "ACCEPTED"` evidence participates in the
 *       computation, and being accepted does not imply a `PASS` finding.
 * - §11 An out-of-scope need becomes a new Boss instead of widening this one.
 *
 * Two things are deliberately NOT expressible here, because the demo's worst
 * defect was that both were possible:
 *
 * - A submitter cannot state a `finding`. Recording evidence writes
 *   `INCONCLUSIVE`, and the verdict arrives from the review boundary, so
 *   "我写了一段话，我自己判定通过，我自己接受" has no representation.
 * - A human decision cannot be anonymous. There is no longer a reducer that
 *   flips `reviewStatus` on its own: it is either `withReviewOutcome` (adopting
 *   a review) or `withOverride` (adopting a review and then disagreeing with it,
 *   with a written reason).
 *
 * Everything here is a pure function over an immutable ledger, so the rules are
 * unit-testable without a browser, a server, or a database.
 */

export type EvidenceFinding = "PASS" | "FAIL" | "INCONCLUSIVE";
export type EvidenceReviewStatus = "PENDING" | "ACCEPTED" | "REJECTED";

export interface EvidenceRecord {
  id: string;
  contractId: string;
  contractRevision: number;
  criterionId: string;
  requirementId: string;
  /**
   * The deliverable the submitter says this material belongs to, if any.
   *
   * The shared contract has no link between a deliverable and a criterion, and
   * issue #15 asks for exactly that association to live here instead: the user
   * picks a deliverable when submitting, and `deriveDeliverable` reads the links
   * back out of the records. Absent on records written before the field existed
   * and on evidence imported from a fixture, which predates the association.
   */
  deliverableId?: string;
  /**
   * The strongest source boundary the adopted review says the submitted
   * content actually proves. `sourceType` above remains the submitter's claim;
   * this field is the effective boundary used by derivation after review.
   *
   * Optional for records written before evidence review existed. Those legacy
   * records fall back to `sourceType` so an upgrade does not erase old work.
   */
  proofBoundary?: EvidenceSourceType;
  sourceType: EvidenceSourceType;
  sourceName: string;
  summary: string;
  finding: EvidenceFinding;
  reviewStatus: EvidenceReviewStatus;
  recordedAt: string;
}

/** Display context kept per Boss so the ledger can name where a failure came from. */
export interface BossContext {
  contractId: string;
  objective: string;
  rawGoal: string;
  /**
   * How the contract was produced, kept so the workbench can still badge a
   * Boss after a refresh. Absent on contexts written before this existed.
   */
  generation?: "MOCK" | "AI";
}

/** Where a Boss came from, when it was incubated out of a recorded failure. */
export interface Incubation {
  fromEvidenceId: string;
  fromContractId: string;
  criterionId: string;
  summary: string;
}

/**
 * A review the user adopted, as returned by `POST /api/evidence/review`.
 *
 * This is the reviewer's *advice* plus the record of its adoption. It is kept
 * after the fact for one reason: the page has to be able to explain, weeks
 * later, why a criterion moved — "这个结论是 AI 给的，还是人改的？理由是什么？"
 * The applied verdict itself lives on the evidence record; this is the evidence
 * of how it got there.
 */
export interface ReviewOutcome {
  evidenceId: string;
  decision: ReviewDecision;
  finding: ReviewFinding;
  rationale: string;
  /** The highest thing the reviewed content actually proves (§6). */
  proofBoundary: EvidenceSourceType;
  suggestedNextEvidence: SuggestedEvidence[];
  /** Which reviewer produced this: the deterministic mock, or the AI. */
  reviewerKind: "MOCK" | "AI";
  promptVersion: string;
  reviewedAt: string;
}

/**
 * A human override must be explainable to be worth storing, so a reason shorter
 * than this is refused. The threshold is the same one the review boundary uses
 * for "meaningful content": the goal is to force a sentence, not a keystroke.
 */
export const MIN_OVERRIDE_REASON_LENGTH = 8;

/** One entry in the append-only record of human disagreement. */
export interface ReviewOverride {
  evidenceId: string;
  /** The status the record actually held before the human intervened. */
  fromStatus: EvidenceReviewStatus;
  fromFinding: EvidenceFinding;
  toStatus: EvidenceReviewStatus;
  toFinding: EvidenceFinding;
  reason: string;
  at: string;
}

export interface OverrideDraft {
  evidenceId: string;
  toStatus: EvidenceReviewStatus;
  /** Defaults to the review's finding: overriding the decision is not the same
   *  as also changing what the content shows. */
  toFinding?: EvidenceFinding;
  reason: string;
  at: string;
}

/**
 * True when an override carries enough of an explanation to be auditable.
 *
 * Takes only the reason so a form can ask "may I enable the confirm button?"
 * without having to fabricate a draft (and, in particular, without inventing a
 * timestamp it has not decided yet).
 */
export function isAuditableOverride(draft: Pick<OverrideDraft, "reason">): boolean {
  return draft.reason.trim().length >= MIN_OVERRIDE_REASON_LENGTH;
}

export interface Ledger {
  version: 1;
  evidence: EvidenceRecord[];
  /** evidenceId -> the review the user adopted for that evidence, if any. */
  reviews: Record<string, ReviewOutcome>;
  /** Append-only audit trail of human overrides. Entries are never rewritten. */
  overrides: ReviewOverride[];
  /** contractId -> ISO timestamp of the moment the user accepted the contract. */
  accepted: Record<string, string>;
  contexts: Record<string, BossContext>;
  /** newContractId -> the failure it was incubated from. */
  incubations: Record<string, Incubation>;
  /**
   * contractId -> the full contract, so the workbench can restore every Boss
   * after a refresh. Written when a contract is generated or loaded; never
   * edited in place afterwards (a Negotiation revision will add a new entry).
   */
  contracts: Record<string, BossContract>;
  /**
   * The research roadmap: one project, its milestones, and which Boss is open.
   * Absent on ledgers written before the workbench existed; `undefined` means
   * "no roadmap yet", which the page treats as the first-run state.
   */
  project?: ResearchProject;
}

/** One milestone of the research roadmap (#18): a titled group of Bosses. */
export interface RoadmapMilestone {
  id: string;
  title: string;
  bossIds: string[];
}

/**
 * One accepted negotiation, kept so the page can answer "为什么总进度变了".
 *
 * Written only after the user explicitly accepts a proposal; the proposal
 * itself never touches storage (the evidence-review trust shape).
 */
export interface PlanRevision {
  revision: number;
  at: string;
  /** The user's own words for why the plan changed. */
  reason: string;
  /** Structured diff: every change this revision applied. */
  changes: Array<{ kind: string; summary: string }>;
  progressBefore: number;
  progressAfter: number;
}

/**
 * The project-level roadmap.
 *
 * Deliberately local and Web-owned: the shared contract schema describes ONE
 * Boss, and #18's Project/Milestone layer lives above it, so it is stored here
 * rather than invented into the shared schema. Bosses are referenced by
 * contractId; the contracts themselves live in `Ledger.contracts`.
 */
export interface ResearchProject {
  goal: string;
  milestones: RoadmapMilestone[];
  /** The Boss the workbench currently has open. */
  currentBossId?: string;
  revision: number;
  updatedAt: string;
  /**
   * Accepted plan revisions, newest first. Absent until the first
   * negotiation is accepted.
   */
  history?: PlanRevision[];
}

export const LEDGER_STORAGE_KEY = "boss-research-assistant.failure-ledger.v1";

/** The subset of the Storage API used here, so tests can pass a fake. */
export interface LedgerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function emptyLedger(): Ledger {
  return {
    version: 1,
    evidence: [],
    reviews: {},
    overrides: [],
    accepted: {},
    contexts: {},
    incubations: {},
    contracts: {},
  };
}

const SOURCE_TYPES: EvidenceSourceType[] = [
  "USER_REPORTED",
  "ARTIFACT_INSPECTED",
  "LOG_INSPECTED",
  "AUTO_VERIFIED",
];
const FINDINGS: EvidenceFinding[] = ["PASS", "FAIL", "INCONCLUSIVE"];
const REVIEW_STATUSES: EvidenceReviewStatus[] = ["PENDING", "ACCEPTED", "REJECTED"];
const REVIEW_DECISIONS: ReviewDecision[] = ["ACCEPTED", "REJECTED", "INCONCLUSIVE"];
const REVIEWER_KINDS: Array<ReviewOutcome["reviewerKind"]> = ["MOCK", "AI"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEvidenceRecord(value: unknown): value is EvidenceRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.contractId === "string" &&
    typeof value.contractRevision === "number" &&
    Number.isInteger(value.contractRevision) &&
    typeof value.criterionId === "string" &&
    typeof value.requirementId === "string" &&
    (value.deliverableId === undefined || typeof value.deliverableId === "string") &&
    (value.proofBoundary === undefined ||
      SOURCE_TYPES.includes(value.proofBoundary as EvidenceSourceType)) &&
    SOURCE_TYPES.includes(value.sourceType as EvidenceSourceType) &&
    typeof value.sourceName === "string" &&
    typeof value.summary === "string" &&
    FINDINGS.includes(value.finding as EvidenceFinding) &&
    REVIEW_STATUSES.includes(value.reviewStatus as EvidenceReviewStatus) &&
    typeof value.recordedAt === "string"
  );
}

function isBossContext(value: unknown): value is BossContext {
  return (
    isRecord(value) &&
    typeof value.contractId === "string" &&
    typeof value.objective === "string" &&
    typeof value.rawGoal === "string" &&
    (value.generation === undefined || value.generation === "MOCK" || value.generation === "AI")
  );
}

function isIncubation(value: unknown): value is Incubation {
  return (
    isRecord(value) &&
    typeof value.fromEvidenceId === "string" &&
    typeof value.fromContractId === "string" &&
    typeof value.criterionId === "string" &&
    typeof value.summary === "string"
  );
}

function isSuggestedEvidence(value: unknown): value is SuggestedEvidence {
  return (
    isRecord(value) &&
    SOURCE_TYPES.includes(value.sourceType as EvidenceSourceType) &&
    typeof value.hint === "string"
  );
}

/**
 * Validates a stored review outcome.
 *
 * Storage is untrusted and this payload is rendered directly, so anything that
 * is not a string ends up as React's "Objects are not valid as a child" crash.
 * Bounds are not re-checked here — the wire validation in
 * `evidence-review/validation.ts` already did that, and a long rationale is
 * truncated at render time rather than treated as corruption.
 */
function isReviewOutcome(value: unknown): value is ReviewOutcome {
  if (!isRecord(value)) return false;
  return (
    typeof value.evidenceId === "string" &&
    REVIEW_DECISIONS.includes(value.decision as ReviewDecision) &&
    FINDINGS.includes(value.finding as EvidenceFinding) &&
    typeof value.rationale === "string" &&
    SOURCE_TYPES.includes(value.proofBoundary as EvidenceSourceType) &&
    Array.isArray(value.suggestedNextEvidence) &&
    value.suggestedNextEvidence.every(isSuggestedEvidence) &&
    REVIEWER_KINDS.includes(value.reviewerKind as ReviewOutcome["reviewerKind"]) &&
    typeof value.promptVersion === "string" &&
    typeof value.reviewedAt === "string"
  );
}

function isReviewOverride(value: unknown): value is ReviewOverride {
  if (!isRecord(value)) return false;
  return (
    typeof value.evidenceId === "string" &&
    REVIEW_STATUSES.includes(value.fromStatus as EvidenceReviewStatus) &&
    FINDINGS.includes(value.fromFinding as EvidenceFinding) &&
    REVIEW_STATUSES.includes(value.toStatus as EvidenceReviewStatus) &&
    FINDINGS.includes(value.toFinding as EvidenceFinding) &&
    typeof value.reason === "string" &&
    typeof value.at === "string"
  );
}

function isStringMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isValueMap<T>(
  value: unknown,
  predicate: (item: unknown) => item is T,
): value is Record<string, T> {
  return isRecord(value) && Object.values(value).every(predicate);
}

/**
 * Key-field check for a stored contract.
 *
 * The full schema is validated where contracts enter the system (the API
 * response path and the fixture tests). Here we only need to know that the
 * stored value is a contract-shaped object the page can render and derive
 * from; re-running full schema validation on every load would be a cost with
 * no benefit, since we wrote this value ourselves.
 */
function isBossContract(value: unknown): value is BossContract {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.objective === "string" &&
    typeof value.revision === "number" &&
    Array.isArray(value.acceptanceCriteria) &&
    Array.isArray(value.deliverables) &&
    value.acceptanceCriteria.every(
      (item: unknown) => isRecord(item) && typeof (item as { id?: unknown }).id === "string",
    )
  );
}

function isRoadmapMilestone(value: unknown): value is RoadmapMilestone {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    Array.isArray(value.bossIds) &&
    value.bossIds.every((item: unknown) => typeof item === "string")
  );
}

function isPlanRevision(value: unknown): value is PlanRevision {
  return (
    isRecord(value) &&
    typeof value.revision === "number" &&
    typeof value.at === "string" &&
    typeof value.reason === "string" &&
    typeof value.progressBefore === "number" &&
    typeof value.progressAfter === "number" &&
    Array.isArray(value.changes) &&
    value.changes.every(
      (item: unknown) =>
        isRecord(item) &&
        typeof (item as { kind?: unknown }).kind === "string" &&
        typeof (item as { summary?: unknown }).summary === "string",
    )
  );
}

function isResearchProject(value: unknown): value is ResearchProject {
  return (
    isRecord(value) &&
    typeof value.goal === "string" &&
    Array.isArray(value.milestones) &&
    value.milestones.every(isRoadmapMilestone) &&
    (value.currentBossId === undefined || typeof value.currentBossId === "string") &&
    typeof value.revision === "number" &&
    typeof value.updatedAt === "string" &&
    (value.history === undefined ||
      (Array.isArray(value.history) && value.history.every(isPlanRevision)))
  );
}

/**
 * Reads the ledger, degrading to an empty one on anything unexpected.
 *
 * Storage is treated as untrusted: a corrupt payload, a quota error, or a
 * browser with storage disabled must never break the page. Losing the ledger is
 * recoverable; a blank app is not.
 *
 * `reviews` and `overrides` were added after the first published build, so a
 * payload written by that build simply does not have them. The same applies to
 * `contracts` and `project` (the workbench). A missing key is filled in with
 * its empty value and the ledger loads; a *present but malformed* key is
 * corruption like any other and fails closed, consistently with the rest of
 * this function.
 */
export function loadLedger(storage: LedgerStorage | null): Ledger {
  if (!storage) return emptyLedger();
  try {
    const raw = storage.getItem(LEDGER_STORAGE_KEY);
    if (!raw) return emptyLedger();
    const parsed = JSON.parse(raw) as Partial<Ledger>;
    const reviews = parsed.reviews === undefined ? {} : parsed.reviews;
    const overrides = parsed.overrides === undefined ? [] : parsed.overrides;
    const contracts = parsed.contracts === undefined ? {} : parsed.contracts;
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.evidence) ||
      !parsed.evidence.every(isEvidenceRecord) ||
      !isValueMap(reviews, isReviewOutcome) ||
      !Array.isArray(overrides) ||
      !overrides.every(isReviewOverride) ||
      !isStringMap(parsed.accepted) ||
      !isValueMap(parsed.contexts, isBossContext) ||
      !isValueMap(parsed.incubations, isIncubation) ||
      !isValueMap(contracts, isBossContract) ||
      (parsed.project !== undefined && !isResearchProject(parsed.project))
    ) {
      return emptyLedger();
    }
    return {
      version: 1,
      evidence: parsed.evidence,
      reviews,
      overrides,
      accepted: parsed.accepted,
      contexts: parsed.contexts,
      incubations: parsed.incubations,
      contracts,
      ...(parsed.project !== undefined ? { project: parsed.project } : {}),
    };
  } catch {
    return emptyLedger();
  }
}

export function saveLedger(storage: LedgerStorage | null, ledger: Ledger): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LEDGER_STORAGE_KEY, JSON.stringify(ledger));
    return true;
  } catch {
    return false;
  }
}

/** Returns the browser's localStorage, or null when it is unavailable. */
export function browserStorage(): LedgerStorage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Immutable updates
// ---------------------------------------------------------------------------

export interface EvidenceDraft {
  contractId: string;
  contractRevision: number;
  criterionId: string;
  requirementId: string;
  /** Optional: the deliverable this submission belongs to. Copied verbatim. */
  deliverableId?: string;
  sourceType: EvidenceSourceType;
  sourceName: string;
  summary: string;
}

export function withRecordedEvidence(
  ledger: Ledger,
  draft: EvidenceDraft,
  meta: { id: string; recordedAt: string },
): Ledger {
  const record: EvidenceRecord = {
    ...draft,
    id: meta.id,
    // The submitter states what they did and what they are handing over; they do
    // not get to state a verdict. Until a review says otherwise the record
    // asserts nothing, which is exactly what INCONCLUSIVE means.
    finding: "INCONCLUSIVE",
    // Freshly recorded evidence starts PENDING: the user still has to have it
    // reviewed and adopt the review before it can influence any status (§8).
    reviewStatus: "PENDING",
    recordedAt: meta.recordedAt,
  };
  return { ...ledger, evidence: [...ledger.evidence, record] };
}

/** §8, in the direction the UI needs it: a review decision becomes a ledger status. */
export function reviewStatusForDecision(decision: ReviewDecision): EvidenceReviewStatus {
  if (decision === "ACCEPTED") return "ACCEPTED";
  if (decision === "REJECTED") return "REJECTED";
  // INCONCLUSIVE is not a rejection of the person; it is a statement that this
  // content does not decide anything. The record stays PENDING so the page keeps
  // asking for evidence instead of quietly closing the criterion.
  return "PENDING";
}

/**
 * Adopts a review: the record's status and finding become the reviewer's, and
 * the outcome is kept so the page can explain the verdict later.
 *
 * The finding comes from the review and never from the submission. A submitter's
 * claim of "测试全部通过" cannot survive a reviewer that read the same text and
 * found a traceback — and, with `withRecordedEvidence` above, there was never a
 * claim stored to begin with.
 *
 * A review of evidence that is not in the ledger is refused rather than stored:
 * it would be an orphan that no criterion can ever reference.
 */
export function withReviewOutcome(ledger: Ledger, outcome: ReviewOutcome): Ledger {
  const target = ledger.evidence.find((item) => item.id === outcome.evidenceId);
  if (!target) return ledger;
  return {
    ...ledger,
    evidence: ledger.evidence.map((item) =>
      item.id === outcome.evidenceId
        ? {
            ...item,
            reviewStatus: reviewStatusForDecision(outcome.decision),
            finding: outcome.finding,
            proofBoundary: outcome.proofBoundary,
          }
        : item,
    ),
    reviews: { ...ledger.reviews, [outcome.evidenceId]: outcome },
  };
}

/**
 * Applies a human decision that disagrees with a review, and writes down why.
 *
 * Two things are recorded together on purpose: the review stays in `reviews`
 * (so "AI 说了什么" is retrievable) and the override joins the append-only
 * `overrides` log (so "谁在什么时候把它改成了什么、理由是什么" is retrievable).
 * An override with no usable reason is refused outright — an unexplained
 * override is indistinguishable from the self-approval this boundary exists to
 * remove, and `isAuditableOverride` lets the UI disable the button before
 * getting here.
 */
export function withOverride(
  ledger: Ledger,
  draft: OverrideDraft,
  outcome?: ReviewOutcome,
): Ledger {
  const target = ledger.evidence.find((item) => item.id === draft.evidenceId);
  if (!target || !isAuditableOverride(draft)) return ledger;

  const base = outcome ? withReviewOutcome(ledger, outcome) : ledger;
  const toFinding = draft.toFinding ?? target.finding;

  return {
    ...base,
    evidence: base.evidence.map((item) =>
      item.id === draft.evidenceId
        ? { ...item, reviewStatus: draft.toStatus, finding: toFinding }
        : item,
    ),
    overrides: [
      ...ledger.overrides,
      {
        evidenceId: draft.evidenceId,
        fromStatus: target.reviewStatus,
        fromFinding: target.finding,
        toStatus: draft.toStatus,
        toFinding,
        reason: draft.reason.trim(),
        at: draft.at,
      },
    ],
  };
}

/** The review adopted for a piece of evidence, or undefined if none was. */
export function reviewFor(ledger: Ledger, evidenceId: string): ReviewOutcome | undefined {
  return ledger.reviews[evidenceId];
}

/**
 * The most recent human override of a piece of evidence, or undefined.
 *
 * The log is append-only, so "was this overridden" must read the last entry
 * rather than the first: a user who changes their mind twice has two, and the
 * later one is the truth.
 */
export function latestOverrideFor(ledger: Ledger, evidenceId: string): ReviewOverride | undefined {
  return ledger.overrides.filter((item) => item.evidenceId === evidenceId).at(-1);
}

export function withAcceptedContract(ledger: Ledger, contractId: string, at: string): Ledger {
  return { ...ledger, accepted: { ...ledger.accepted, [contractId]: at } };
}

export function withContext(ledger: Ledger, context: BossContext): Ledger {
  return { ...ledger, contexts: { ...ledger.contexts, [context.contractId]: context } };
}

/**
 * Persists a full contract so the workbench can restore it after a refresh.
 *
 * Written when a contract is generated, loaded from a fixture, or created by a
 * negotiation. Never edited in place: a revision produces a new contract with
 * a new revision number, and the roadmap decides which one is current.
 */
export function withContract(ledger: Ledger, contract: BossContract): Ledger {
  return { ...ledger, contracts: { ...ledger.contracts, [contract.id]: contract } };
}

/**
 * Creates the project roadmap when the first Boss arrives.
 *
 * MVP keeps one project with one milestone so the workbench has somewhere to
 * put a freshly generated Boss; negotiation (#18) is what will grow it into
 * multiple milestones.
 */
export function withNewProject(ledger: Ledger, goal: string, contractId: string, at: string): Ledger {
  if (ledger.project) return ledger;
  return {
    ...ledger,
    project: {
      goal: goal.trim() || contractId,
      milestones: [{ id: "M-1", title: "第一阶段", bossIds: [contractId] }],
      currentBossId: contractId,
      revision: 1,
      updatedAt: at,
    },
  };
}

/**
 * Adds a Boss to the roadmap. Without a target milestone it joins the first
 * non-completed one (a new Boss is work that is about to start, so it belongs
 * where work is still open), falling back to the last milestone.
 */
export function withBossInProject(
  ledger: Ledger,
  contractId: string,
  milestoneId?: string,
  at: string = new Date().toISOString(),
): Ledger {
  const project = ledger.project;
  if (!project) return ledger;
  if (project.milestones.some((milestone) => milestone.bossIds.includes(contractId))) {
    return ledger;
  }

  const target =
    project.milestones.find((milestone) => milestone.id === milestoneId) ??
    project.milestones.find(
      (milestone) =>
        milestone.bossIds.length === 0 ||
        milestone.bossIds.some((id) => !isBossClear(ledger, id)),
    ) ??
    project.milestones.at(-1);
  if (!target) return ledger;

  return {
    ...ledger,
    project: {
      ...project,
      revision: project.revision + 1,
      updatedAt: at,
      currentBossId: contractId,
      milestones: project.milestones.map((milestone) =>
        milestone.id === target.id
          ? { ...milestone, bossIds: [...milestone.bossIds, contractId] }
          : milestone,
      ),
    },
  };
}

/** Opens a Boss in the workbench without touching the roadmap structure. */
export function withCurrentBoss(ledger: Ledger, contractId: string): Ledger {
  const project = ledger.project;
  if (!project) return ledger;
  return { ...ledger, project: { ...project, currentBossId: contractId } };
}

function isBossClear(ledger: Ledger, contractId: string): boolean {
  const contract = ledger.contracts[contractId];
  if (!contract) return false;
  const records = ledger.evidence.filter((item) => item.contractId === contractId);
  return deriveBoss(contract, records, Boolean(ledger.accepted[contractId])).status === "CLEAR";
}

/**
 * Seeds the ledger with the evidence a contract already carries.
 *
 * A freshly generated contract has none — Goal Discovery is forbidden from
 * inventing evidence — but the frozen demo fixture ships four accepted items.
 * Importing them keeps a single source of truth for derivation (the ledger)
 * instead of mixing contract fields with ledger records and having the two
 * disagree.
 *
 * Idempotent: re-importing the same contract adds nothing, so this is safe to
 * call on every render.
 *
 * Imported items carry the fixture's own findings and accepted status and get no
 * entry in `reviews`: they predate the review boundary and claiming otherwise
 * would forge an audit trail. The page shows them as existing records rather
 * than as reviewed ones.
 */
export function withImportedEvidence(
  ledger: Ledger,
  contract: BossContract,
  importedAt: string,
): Ledger {
  const existing = new Set(ledger.evidence.map((item) => `${item.contractId}:${item.id}`));
  const base = new Date(importedAt).getTime();

  const additions: EvidenceRecord[] = [];
  contract.evidenceItems.forEach((item, index) => {
    if (existing.has(`${contract.id}:${item.id}`)) return;
    additions.push({
      id: item.id,
      contractId: contract.id,
      contractRevision: contract.revision,
      criterionId: item.criterionId,
      requirementId: item.requirementId,
      sourceType: item.sourceType,
      sourceName: item.sourceName,
      summary: item.summary,
      finding: item.finding,
      reviewStatus: item.reviewStatus,
      // The schema has no per-evidence timestamp, so import time stands in.
      // Offsetting one millisecond per item preserves the contract's own order
      // through the time-based sorts in listFailures.
      recordedAt: new Date(base + index).toISOString(),
    });
  });

  if (additions.length === 0) return ledger;
  return { ...ledger, evidence: [...ledger.evidence, ...additions] };
}

export function withIncubation(
  ledger: Ledger,
  newContractId: string,
  incubation: Incubation,
): Ledger {
  return { ...ledger, incubations: { ...ledger.incubations, [newContractId]: incubation } };
}

// ---------------------------------------------------------------------------
// Derivation (§3, §4, §7, §8)
// ---------------------------------------------------------------------------

export interface CriterionDerivation {
  status: CriterionStatus;
  reason: string;
  acceptedCount: number;
  pendingCount: number;
}

export function evidenceFor(
  ledger: Ledger,
  contractId: string,
  criterionId: string,
): EvidenceRecord[] {
  return ledger.evidence.filter(
    (item) => item.contractId === contractId && item.criterionId === criterionId,
  );
}

export function deriveCriterion(
  criterion: AcceptanceCriterion,
  records: readonly EvidenceRecord[],
): CriterionDerivation {
  const requirements = new Map(
    criterion.evidenceRequirements.map((item) => [item.id, item] as const),
  );

  // §8: only accepted evidence counts.
  const accepted = records.filter((item) => item.reviewStatus === "ACCEPTED");
  const effectiveSourceType = (item: EvidenceRecord) => item.proofBoundary ?? item.sourceType;

  // §7: evidence must map to a requirement of this criterion and its reviewed
  // proof boundary must be accepted, so neither unrelated evidence nor a weak
  // user report submitted as a log can pad a count.
  const relevant = accepted.filter((item) => {
    const requirement = requirements.get(item.requirementId);
    return requirement?.acceptedSourceTypes.includes(effectiveSourceType(item)) ?? false;
  });
  const pendingCount = records.filter((item) => item.reviewStatus !== "ACCEPTED").length;

  // §3: accepted evidence showing the criterion is not satisfied takes priority.
  const failure = relevant.find((item) => item.finding === "FAIL");
  if (failure) {
    return {
      status: "FAIL",
      acceptedCount: relevant.length,
      pendingCount,
      reason: `已接受的证据「${failure.sourceName}」判定为未通过。`,
    };
  }

  // §3 + §7: PASS requires every requirement to be satisfied by accepted
  // evidence whose finding is actually PASS. ACCEPTED means admissible, not
  // conclusive; an INCONCLUSIVE finding remains visible but proves no criterion.
  const passing = relevant.filter((item) => item.finding === "PASS");
  const unmet: string[] = [];
  for (const requirement of criterion.evidenceRequirements) {
    const count = passing.filter(
      (item) =>
        item.requirementId === requirement.id &&
        requirement.acceptedSourceTypes.includes(effectiveSourceType(item)),
    ).length;
    if (count < requirement.minimumCount) {
      unmet.push(`${requirement.id} ${count}/${requirement.minimumCount}`);
    }
  }

  if (unmet.length === 0) {
    return {
      status: "PASS",
      acceptedCount: relevant.length,
      pendingCount,
      reason: `${criterion.evidenceRequirements.length} 项证据要求全部满足。`,
    };
  }

  const extra = pendingCount > 0 ? `；另有 ${pendingCount} 条尚未接受，不参与判定` : "";
  return {
    status: "UNKNOWN",
    acceptedCount: relevant.length,
    pendingCount,
    reason: `证据要求未满足：${unmet.join("、")}${extra}。`,
  };
}

/**
 * The derivation issue #15 asks for on the deliverable side.
 *
 * The contract ships every deliverable as `NOT_STARTED` and frozen — the
 * generator cannot know what the user will actually produce — so the live
 * status is derived here and never written back into the contract. The link
 * between a deliverable and its acceptance criteria is *declared by the user*
 * when submitting (`deliverableId` on the record): the shared schema has no
 * such field, and inventing one is a contract change this module must not make.
 *
 * Rules, from the issue:
 * - no linked evidence            -> NOT_STARTED
 * - linked evidence, but the linked
 *   criteria are not all PASS     -> IN_PROGRESS
 * - every linked criterion has linked PASS evidence -> DONE
 *
 * "Linked" means any record naming this deliverable, including rejected and
 * pending ones: IN_PROGRESS says "someone started on this", and erasing that
 * because the first submission was rejected would contradict the journey
 * (a failure lowers completion but must not erase history). DONE, by contrast,
 * is only ever reached through accepted PASS evidence that names this exact
 * deliverable. A pass from unrelated evidence may complete a criterion, but it
 * cannot silently complete a deliverable the reviewer never inspected.
 */
export interface DeliverableDerivation {
  status: "NOT_STARTED" | "IN_PROGRESS" | "DONE";
  reason: string;
  /** Criteria this deliverable's evidence was linked to, in first-seen order. */
  relatedCriteria: string[];
  /** Records naming this deliverable, whatever their review status. */
  linkedEvidenceCount: number;
}

export function deriveDeliverable(
  contract: BossContract,
  deliverableId: string,
  records: readonly EvidenceRecord[],
): DeliverableDerivation {
  const linked = records.filter((item) => item.deliverableId === deliverableId);
  if (linked.length === 0) {
    return {
      status: "NOT_STARTED",
      reason: "还没有为这个交付物提交过任何材料。",
      relatedCriteria: [],
      linkedEvidenceCount: 0,
    };
  }

  // First-seen order, so the chips on the card follow the user's own story
  // rather than the storage order of the ledger.
  const relatedCriteria: string[] = [];
  for (const item of linked) {
    if (!relatedCriteria.includes(item.criterionId)) relatedCriteria.push(item.criterionId);
  }

  // A criterion the contract no longer knows about can never be PASS, and a
  // PASS from evidence that did not name this deliverable cannot complete it.
  const unpassed = relatedCriteria.filter((criterionId) => {
    const criterion = contract.acceptanceCriteria.find((item) => item.id === criterionId);
    if (!criterion) return true;
    return (
      deriveCriterion(
        criterion,
        linked.filter((item) => item.criterionId === criterionId),
      ).status !== "PASS"
    );
  });

  if (unpassed.length === 0) {
    return {
      status: "DONE",
      reason: `关联的验收项（${relatedCriteria.join("、")}）已全部通过。`,
      relatedCriteria,
      linkedEvidenceCount: linked.length,
    };
  }

  return {
    status: "IN_PROGRESS",
    reason: `已提交 ${linked.length} 条材料，关联验收项 ${unpassed.join("、")} 尚未全部通过。`,
    relatedCriteria,
    linkedEvidenceCount: linked.length,
  };
}

export interface BossDerivation {
  status: BossStatus;
  reason: string;
  requiredPassed: number;
  requiredTotal: number;
  optionalPassed: number;
  optionalTotal: number;
}

/**
 * §4 precedence, applied only once the contract has been accepted. Before that
 * the Boss is still `DRAFT` and the acceptance semantics are not in force.
 */
export function deriveBoss(
  contract: BossContract,
  records: readonly EvidenceRecord[],
  accepted: boolean,
): BossDerivation {
  const required = contract.acceptanceCriteria.filter((item) => item.required);
  const optional = contract.acceptanceCriteria.filter((item) => !item.required);

  const statusOf = (criterion: AcceptanceCriterion) =>
    deriveCriterion(criterion, records.filter((item) => item.criterionId === criterion.id)).status;

  const requiredStatuses = required.map(statusOf);
  const optionalStatuses = optional.map(statusOf);
  const requiredPassed = requiredStatuses.filter((status) => status === "PASS").length;
  const optionalPassed = optionalStatuses.filter((status) => status === "PASS").length;

  const summary = {
    requiredPassed,
    requiredTotal: required.length,
    optionalPassed,
    optionalTotal: optional.length,
  };

  if (!accepted) {
    return { status: "DRAFT", reason: "合同尚未接受，验收语义还未生效。", ...summary };
  }

  // §4.1 — the schema has no "resolved" flag on a blocker, so any recorded
  // blocker is treated as unresolved.
  if (contract.blockers.length > 0) {
    return {
      status: "BLOCKED",
      reason: `存在 ${contract.blockers.length} 个未解除的阻塞项。`,
      ...summary,
    };
  }

  // §4.2 — "all required criteria are PASS". With no required criteria the
  // universal claim holds vacuously, so this is intentionally not guarded by a
  // non-empty check.
  if (requiredPassed === required.length) {
    return {
      status: "CLEAR",
      reason: `全部 ${required.length} 个必需验收项通过。`,
      ...summary,
    };
  }

  // §4.3 — PARTIAL needs at least one required pass; it is not a general
  // "not finished" state.
  if (requiredPassed > 0) {
    return {
      status: "PARTIAL",
      reason: `必需验收项 ${requiredPassed}/${required.length} 通过，尚未全部通过。`,
      ...summary,
    };
  }

  // §4.4
  return { status: "ACTIVE", reason: "尚无必需验收项通过。", ...summary };
}

// ---------------------------------------------------------------------------
// Failure assets and incubation
// ---------------------------------------------------------------------------

export interface FailureAsset {
  evidence: EvidenceRecord;
  context: BossContext | undefined;
  /** True once a later accepted PASS exists for the same criterion. */
  resolved: boolean;
  resolvedAt: string | null;
}

/**
 * Every accepted failure is an asset, including ones that were later fixed —
 * the point of accumulating failures is that the knowledge outlives the fix.
 */
export function listFailures(ledger: Ledger): FailureAsset[] {
  const failures = ledger.evidence.filter(
    (item) => item.reviewStatus === "ACCEPTED" && item.finding === "FAIL",
  );

  return failures
    .map((evidence) => {
      const later = ledger.evidence
        .filter(
          (item) =>
            item.contractId === evidence.contractId &&
            item.criterionId === evidence.criterionId &&
            item.reviewStatus === "ACCEPTED" &&
            item.finding === "PASS" &&
            item.recordedAt > evidence.recordedAt,
        )
        .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1));

      return {
        evidence,
        context: ledger.contexts[evidence.contractId],
        resolved: later.length > 0,
        resolvedAt: later[0]?.recordedAt ?? null,
      } satisfies FailureAsset;
    })
    .sort((a, b) => (a.evidence.recordedAt < b.evidence.recordedAt ? 1 : -1));
}

/** Keeps a composed goal inside the API's 1..500 character window. */
export function clampGoal(text: string, max = 500): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

/**
 * Turns a recorded failure into the goal for the next Boss. §11: the next step
 * becomes a new Boss rather than widening the current one, so this produces a
 * goal narrow enough for Goal Discovery to bound again.
 */
export function buildIncubationGoal(failure: FailureAsset): string {
  const source = failure.evidence.sourceName.trim();
  const parts = [
    "上一个 Boss 有一个验收项被判定未通过，需要修正这个具体问题：",
    failure.evidence.summary.trim(),
    source ? `（证据来源：${source}）` : "",
    "请只收敛到能解决该问题的最小一步，不要扩大到完整论文复现。",
  ];
  return clampGoal(parts.join(""));
}

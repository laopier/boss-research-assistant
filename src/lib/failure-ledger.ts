import {
  AcceptanceCriterion,
  BossContract,
  BossStatus,
  CriterionStatus,
  EvidenceSourceType,
} from "./contracts";

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
 * - §7  A requirement is satisfied by accepted evidence of an accepted source
 *       type, at least `minimumCount` times. Evidence must map to a specific
 *       criterion and requirement; unrelated evidence cannot be used to pad.
 * - §8  Only `reviewStatus: "ACCEPTED"` evidence participates in the
 *       computation, and being accepted does not imply a `PASS` finding.
 * - §11 An out-of-scope need becomes a new Boss instead of widening this one.
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
}

/** Where a Boss came from, when it was incubated out of a recorded failure. */
export interface Incubation {
  fromEvidenceId: string;
  fromContractId: string;
  criterionId: string;
  summary: string;
}

export interface Ledger {
  version: 1;
  evidence: EvidenceRecord[];
  /** contractId -> ISO timestamp of the moment the user accepted the contract. */
  accepted: Record<string, string>;
  contexts: Record<string, BossContext>;
  /** newContractId -> the failure it was incubated from. */
  incubations: Record<string, Incubation>;
}

export const LEDGER_STORAGE_KEY = "boss-research-assistant.failure-ledger.v1";

/** The subset of the Storage API used here, so tests can pass a fake. */
export interface LedgerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function emptyLedger(): Ledger {
  return { version: 1, evidence: [], accepted: {}, contexts: {}, incubations: {} };
}

/**
 * Reads the ledger, degrading to an empty one on anything unexpected.
 *
 * Storage is treated as untrusted: a corrupt payload, a quota error, or a
 * browser with storage disabled must never break the page. Losing the ledger is
 * recoverable; a blank app is not.
 */
export function loadLedger(storage: LedgerStorage | null): Ledger {
  if (!storage) return emptyLedger();
  try {
    const raw = storage.getItem(LEDGER_STORAGE_KEY);
    if (!raw) return emptyLedger();
    const parsed = JSON.parse(raw) as Partial<Ledger>;
    if (parsed.version !== 1 || !Array.isArray(parsed.evidence)) return emptyLedger();
    return {
      version: 1,
      evidence: parsed.evidence,
      accepted: parsed.accepted ?? {},
      contexts: parsed.contexts ?? {},
      incubations: parsed.incubations ?? {},
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
  sourceType: EvidenceSourceType;
  sourceName: string;
  summary: string;
  finding: EvidenceFinding;
}

export function withRecordedEvidence(
  ledger: Ledger,
  draft: EvidenceDraft,
  meta: { id: string; recordedAt: string },
): Ledger {
  // Freshly recorded evidence starts PENDING: the user still has to accept it
  // before it can influence any status (§8).
  const record: EvidenceRecord = {
    ...draft,
    id: meta.id,
    reviewStatus: "PENDING",
    recordedAt: meta.recordedAt,
  };
  return { ...ledger, evidence: [...ledger.evidence, record] };
}

export function withReview(
  ledger: Ledger,
  evidenceId: string,
  reviewStatus: EvidenceReviewStatus,
): Ledger {
  return {
    ...ledger,
    evidence: ledger.evidence.map((item) =>
      item.id === evidenceId ? { ...item, reviewStatus } : item,
    ),
  };
}

export function withAcceptedContract(ledger: Ledger, contractId: string, at: string): Ledger {
  return { ...ledger, accepted: { ...ledger.accepted, [contractId]: at } };
}

export function withContext(ledger: Ledger, context: BossContext): Ledger {
  return { ...ledger, contexts: { ...ledger.contexts, [context.contractId]: context } };
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
  const requirementIds = new Set(criterion.evidenceRequirements.map((item) => item.id));

  // §8: only accepted evidence counts.
  const accepted = records.filter((item) => item.reviewStatus === "ACCEPTED");
  // §7: evidence must map to a requirement of this criterion, so unrelated
  // evidence cannot be used to pad a count.
  const relevant = accepted.filter((item) => requirementIds.has(item.requirementId));
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

  // §3 + §7: PASS requires every requirement to be satisfied.
  const unmet: string[] = [];
  for (const requirement of criterion.evidenceRequirements) {
    const count = relevant.filter(
      (item) =>
        item.requirementId === requirement.id &&
        requirement.acceptedSourceTypes.includes(item.sourceType),
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

import { AcceptanceCriterion, Blocker, BossContract, EvidenceSourceType } from "./contracts";
import {
  EvidenceRecord,
  FailureAsset,
  Ledger,
  deriveBoss,
  deriveCriterion,
  deriveDeliverable,
  listFailures,
  reviewFor,
} from "./failure-ledger";

/**
 * Web-owned derivation for "how far is this Boss, and what do I do next?"
 *
 * issue #15 asks for Completion Progress + Research Journey + a single next
 * action; issue #17 (Feature 2) widens that into "explainable progress". This
 * module is pure and reads only the ledger + the contract, so it is testable
 * without a browser and never writes. Nothing here changes the shared schema:
 * it derives, like the rest of the ledger.
 */

/** A requirement that is not yet satisfied, with enough detail to point the user at it. */
export interface MissingRequirement {
  criterionId: string;
  criterionRequired: boolean;
  /**
   * 1-based position of the criterion in the contract's full
   * `acceptanceCriteria` list (issue #21). The page numbers tasks from this so
   * every region agrees; when it is absent the UI falls back to the id.
   */
  criterionIndex?: number;
  requirementId: string;
  description: string;
  have: number;
  need: number;
  acceptedSourceTypes: EvidenceSourceType[];
}

export type NextAction =
  | { kind: "ACCEPT_CONTRACT" }
  | { kind: "ADVANCE_PROJECT" }
  | { kind: "REVISE_CONTRACT" }
  | { kind: "RESOLVE_BLOCKER"; blocker: Blocker }
  | { kind: "INCUBATE_FAILURE"; failure: FailureAsset }
  | { kind: "SUBMIT_EVIDENCE"; missing: MissingRequirement };

export interface ProgressDerivation {
  /** 产出进度: completed deliverables / all deliverables. */
  deliverablesDone: number;
  deliverablesTotal: number;
  /** 通关进度: required criteria only, per issue #15 §A. */
  requiredPassed: number;
  requiredTotal: number;
  optionalPassed: number;
  optionalTotal: number;
  /** Every requirement (required and optional) that is not yet satisfied. */
  missing: MissingRequirement[];
  /** Blocker ids, shown separately so a blocked Boss is explainable. */
  blockers: string[];
  /** Accepted failures on this Boss that no later pass has resolved. */
  unresolvedFailures: number;
  nextAction: NextAction;
}

/** §7: accepted evidence of an accepted source type counts toward a requirement. */
function countSatisfying(
  criterion: AcceptanceCriterion,
  requirement: AcceptanceCriterion["evidenceRequirements"][number],
  records: readonly EvidenceRecord[],
): number {
  return records.filter(
    (item) =>
      item.criterionId === criterion.id &&
      item.requirementId === requirement.id &&
      item.reviewStatus === "ACCEPTED" &&
      requirement.acceptedSourceTypes.includes(item.sourceType),
  ).length;
}

/**
 * The requirements that still need evidence.
 *
 * A criterion that is already FAIL is not "missing evidence" — it is a recorded
 * failure waiting to be incubated, and issue #15's next-action rules treat the
 * two differently, so `deriveCriterion` decides and this function follows it.
 */
export function missingRequirements(
  criterion: AcceptanceCriterion,
  records: readonly EvidenceRecord[],
  criterionIndex?: number,
): MissingRequirement[] {
  if (deriveCriterion(criterion, records).status === "FAIL") return [];
  return criterion.evidenceRequirements
    .map((requirement) => ({
      criterionId: criterion.id,
      criterionRequired: criterion.required,
      ...(criterionIndex === undefined ? {} : { criterionIndex }),
      requirementId: requirement.id,
      description: requirement.description,
      have: countSatisfying(criterion, requirement, records),
      need: requirement.minimumCount,
      acceptedSourceTypes: requirement.acceptedSourceTypes,
    }))
    .filter((item) => item.have < item.need);
}

/**
 * The one thing to do next, picked by the priority issue #15 gives.
 *
 * Priority: accept the contract first; then, if every required criterion has
 * passed, continue to the next bounded stage; then, if an accepted failure is still unresolved,
 * incubate it; otherwise keep submitting evidence. An optional failure does not
 * block completion — that is §4, already pinned by the Boss-derivation tests.
 */
export function deriveProgress(
  contract: BossContract,
  ledger: Ledger,
  accepted: boolean,
): ProgressDerivation {
  const records = ledger.evidence.filter((item) => item.contractId === contract.id);
  const boss = deriveBoss(contract, records, accepted);

  const deliverablesDone = contract.deliverables.filter(
    (deliverable) => deriveDeliverable(contract, deliverable.id, records).status === "DONE",
  ).length;

  // `index` counts the full list, not the missing ones, so "验收项 3" means the
  // third criterion of the contract everywhere it appears (issue #21).
  const missing = contract.acceptanceCriteria.flatMap((criterion, index) =>
    missingRequirements(criterion, records, index + 1),
  );

  const unresolved = listFailures(ledger).filter(
    (failure) => failure.evidence.contractId === contract.id && !failure.resolved,
  );

  const blockers = contract.blockers.map((blocker) => blocker.id);

  let nextAction: NextAction;
  if (!accepted) {
    nextAction = { kind: "ACCEPT_CONTRACT" };
  } else if (boss.status === "BLOCKED" && contract.blockers[0]) {
    nextAction = { kind: "RESOLVE_BLOCKER", blocker: contract.blockers[0] };
  } else if (boss.status === "CLEAR") {
    nextAction = { kind: "ADVANCE_PROJECT" };
  } else if (unresolved.length > 0) {
    nextAction = { kind: "INCUBATE_FAILURE", failure: unresolved[0] };
  } else if (missing.length > 0) {
    nextAction = {
      kind: "SUBMIT_EVIDENCE",
      missing: missing.find((item) => item.criterionRequired) ?? missing[0],
    };
  } else {
    // An accepted empty contract cannot be completed: there is no acceptance
    // criterion that could justify CLEAR. Keep the page honest and direct the
    // user back to contract negotiation instead of exporting a false report.
    nextAction = { kind: "REVISE_CONTRACT" };
  }

  return {
    deliverablesDone,
    deliverablesTotal: contract.deliverables.length,
    requiredPassed: boss.requiredPassed,
    requiredTotal: boss.requiredTotal,
    optionalPassed: boss.optionalPassed,
    optionalTotal: boss.optionalTotal,
    missing,
    blockers,
    unresolvedFailures: unresolved.length,
    nextAction,
  };
}

// ---------------------------------------------------------------------------
// Research journey
// ---------------------------------------------------------------------------

export type JourneyEventKind =
  | "CONTRACT_ACCEPTED"
  | "EVIDENCE_RECORDED"
  | "REVIEW_ADOPTED"
  | "REVIEW_OVERRIDDEN"
  | "FAILURE_RECORDED"
  | "CRITERION_PASSED"
  | "INCUBATED"
  | "BOSS_CLEAR";

export interface JourneyEvent {
  kind: JourneyEventKind;
  at: string;
  text: string;
}

/** When a record actually took effect: the review's moment, or the record's if none. */
function adoptionTime(ledger: Ledger, record: EvidenceRecord): string {
  return reviewFor(ledger, record.id)?.reviewedAt ?? record.recordedAt;
}

/** Accepted, relevant evidence for one criterion, used to date a PASS. */
function acceptedRelevant(criterion: AcceptanceCriterion, records: readonly EvidenceRecord[]) {
  const types = new Set(criterion.evidenceRequirements.flatMap((item) => item.acceptedSourceTypes));
  return records.filter(
    (item) =>
      item.criterionId === criterion.id &&
      item.reviewStatus === "ACCEPTED" &&
      types.has(item.sourceType),
  );
}

function maxTime(...values: string[]): string {
  return values
    .filter(Boolean)
    .sort()
    .at(-1) as string;
}

/**
 * The research journey: every durable action, in time order.
 *
 * A failure lowering completion does not erase history; neither does a later
 * pass. So each record contributes its own "recorded" event even when a review
 * then adopted it, and a pass does not remove the failure event that came
 * before. This is the "打怪升级" accumulation issue #17 wants the page to show.
 */
export function listJourneyEvents(contract: BossContract, ledger: Ledger): JourneyEvent[] {
  const records = ledger.evidence.filter((item) => item.contractId === contract.id);
  const events: JourneyEvent[] = [];

  const acceptedAt = ledger.accepted[contract.id];
  if (acceptedAt) {
    events.push({ kind: "CONTRACT_ACCEPTED", at: acceptedAt, text: "确认了这一步的目标和完成标准。" });
  }

  const criterionPassedAt = new Map<string, string>();
  for (const criterion of contract.acceptanceCriteria) {
    const relevant = acceptedRelevant(criterion, records);
    if (deriveCriterion(criterion, records).status === "PASS" && relevant.length > 0) {
      criterionPassedAt.set(
        criterion.id,
        maxTime(...relevant.map((item) => adoptionTime(ledger, item))),
      );
    }
  }

  for (const record of records) {
    events.push({
      kind: "EVIDENCE_RECORDED",
      at: record.recordedAt,
      text: `提交了材料「${record.sourceName}」。`,
    });

    const review = reviewFor(ledger, record.id);
    if (review) {
      events.push({
        kind: "REVIEW_ADOPTED",
        at: review.reviewedAt,
        text: `采用了对「${record.sourceName}」的检查结果。`,
      });
    }

    for (const override of ledger.overrides) {
      if (override.evidenceId === record.id) {
        events.push({
          kind: "REVIEW_OVERRIDDEN",
          at: override.at,
          text: `人工覆盖了「${record.sourceName}」的判定：${override.reason}`,
        });
      }
    }

    if (record.reviewStatus === "ACCEPTED" && record.finding === "FAIL") {
      events.push({
        kind: "FAILURE_RECORDED",
        at: adoptionTime(ledger, record),
        text: `检查发现一个问题：${record.summary}`,
      });
    }
  }

  for (const [criterionId, at] of criterionPassedAt) {
    events.push({ kind: "CRITERION_PASSED", at, text: `一条完成标准已经通过（${criterionId}）。` });
  }

  for (const incubation of Object.values(ledger.incubations)) {
    if (incubation.fromContractId !== contract.id) continue;
    const source = records.find((item) => item.id === incubation.fromEvidenceId);
    events.push({
      kind: "INCUBATED",
      at: source?.recordedAt ?? "",
      text: `把一个未解决的问题拆成了新的下一步（${incubation.criterionId}）。`,
    });
  }

  const required = contract.acceptanceCriteria.filter((item) => item.required);
  if (required.length > 0 && required.every((item) => criterionPassedAt.has(item.id))) {
    events.push({
      kind: "BOSS_CLEAR",
      at: maxTime(...required.map((item) => criterionPassedAt.get(item.id) ?? "")),
      text: "所有必须完成的标准都已通过，这一步完成。",
    });
  }

  // Stable sort by time; equal timestamps keep insertion order, which already
  // follows the ledger's own order for records.
  return events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/**
 * Failure ledger tests.
 *
 * These pin the derivation rules to `docs/contracts.zh-CN.md`. The numbering in
 * the test names refers to that document, so a change in behaviour here should
 * be traceable to a change in the rules rather than to a refactor.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { AcceptanceCriterion, BossContract } from "../lib/contracts";
import {
  EvidenceRecord,
  Ledger,
  LedgerStorage,
  MIN_OVERRIDE_REASON_LENGTH,
  ReviewOutcome,
  buildIncubationGoal,
  clampGoal,
  deriveBoss,
  deriveCriterion,
  deriveDeliverable,
  emptyLedger,
  isAuditableOverride,
  latestOverrideFor,
  listFailures,
  loadLedger,
  reviewFor,
  reviewStatusForDecision,
  saveLedger,
  withAcceptedContract,
  withContext,
  withIncubation,
  withOverride,
  withRecordedEvidence,
  withReviewOutcome,
} from "../lib/failure-ledger";

function criterion(overrides: Partial<AcceptanceCriterion> = {}): AcceptanceCriterion {
  return {
    id: "AC-1",
    description: "The module preserves shape",
    required: true,
    status: "UNKNOWN",
    evidenceRequirements: [
      {
        id: "REQ-1",
        description: "A runtime test checks shape",
        acceptedSourceTypes: ["LOG_INSPECTED", "AUTO_VERIFIED"],
        minimumCount: 1,
      },
    ],
    ...overrides,
  };
}

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: "EV-1",
    contractId: "boss-1",
    contractRevision: 1,
    criterionId: "AC-1",
    requirementId: "REQ-1",
    sourceType: "LOG_INSPECTED",
    sourceName: "tests/test_waca.py",
    summary: "shape and gradient tests passed",
    finding: "PASS",
    reviewStatus: "ACCEPTED",
    recordedAt: "2026-09-18T10:00:00.000Z",
    ...overrides,
  };
}

function contract(overrides: Partial<BossContract> = {}): BossContract {
  return {
    schemaVersion: "boss-contract.v0",
    recordKind: "LIVE",
    revision: 1,
    id: "boss-1",
    title: "Bounded first step",
    rawGoal: "我想复现 WACA",
    objective: "Implement a bounded WACA-SE module",
    deadline: null,
    deliverables: [{ id: "DEL-1", description: "module", status: "NOT_STARTED" }],
    acceptanceCriteria: [criterion()],
    scopeGuard: { inScope: ["x"], outOfScope: ["y"], newBossPolicy: "CREATE_NEW_BOSS" },
    known: [],
    unknowns: [],
    assumptions: [],
    estimatedMinutes: 90,
    assistanceMode: "COACH",
    status: "DRAFT",
    evidenceItems: [],
    blockers: [],
    changeHistory: [],
    ...overrides,
  };
}

function memoryStorage(initial?: string): LedgerStorage {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
  };
}

describe("criterion derivation (§3, §7, §8)", () => {
  it("is UNKNOWN with no evidence at all", () => {
    const result = deriveCriterion(criterion(), []);
    assert.equal(result.status, "UNKNOWN");
  });

  it("is PASS when an accepted requirement is met", () => {
    const result = deriveCriterion(criterion(), [evidence()]);
    assert.equal(result.status, "PASS");
    assert.equal(result.acceptedCount, 1);
  });

  it("does not treat accepted but INCONCLUSIVE evidence as proof", () => {
    const result = deriveCriterion(criterion(), [evidence({ finding: "INCONCLUSIVE" })]);
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.acceptedCount, 1, "the record remains accepted and auditable");
  });

  it("ignores PENDING evidence (§8)", () => {
    const result = deriveCriterion(criterion(), [evidence({ reviewStatus: "PENDING" })]);
    assert.equal(result.status, "UNKNOWN", "pending evidence must not count");
    assert.equal(result.acceptedCount, 0);
    assert.equal(result.pendingCount, 1);
  });

  it("ignores REJECTED evidence (§8)", () => {
    const result = deriveCriterion(criterion(), [evidence({ reviewStatus: "REJECTED" })]);
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.acceptedCount, 0);
  });

  it("treats an accepted FAIL as FAIL even when a PASS also exists (§3)", () => {
    const result = deriveCriterion(criterion(), [
      evidence({ id: "EV-1", finding: "PASS" }),
      evidence({ id: "EV-2", finding: "FAIL", sourceName: "models/waca.py" }),
    ]);
    assert.equal(result.status, "FAIL");
    assert.match(result.reason, /models\/waca\.py/);
  });

  it("does not let a PENDING FAIL affect the status (§8)", () => {
    const result = deriveCriterion(criterion(), [
      evidence({ id: "EV-1", finding: "PASS" }),
      evidence({ id: "EV-2", finding: "FAIL", reviewStatus: "PENDING" }),
    ]);
    assert.equal(result.status, "PASS", "an unaccepted failure must not flip the criterion");
  });

  it("does not accept a source type the requirement rejects (§7)", () => {
    const result = deriveCriterion(criterion(), [evidence({ sourceType: "USER_REPORTED" })]);
    assert.equal(result.status, "UNKNOWN", "USER_REPORTED is not in acceptedSourceTypes");
  });

  it("uses the reviewed proof boundary instead of the submitter-declared source type", () => {
    const result = deriveCriterion(criterion(), [
      evidence({ sourceType: "LOG_INSPECTED", proofBoundary: "USER_REPORTED" }),
    ]);
    assert.equal(
      result.status,
      "UNKNOWN",
      "a user report must not satisfy a requirement that accepts only inspected logs",
    );
  });

  it("accepts a reviewed lower boundary when the requirement explicitly allows it", () => {
    const acceptsReports = criterion({
      evidenceRequirements: [
        {
          id: "REQ-1",
          description: "a report is sufficient for this criterion",
          acceptedSourceTypes: ["USER_REPORTED"],
          minimumCount: 1,
        },
      ],
    });
    const result = deriveCriterion(acceptsReports, [
      evidence({ sourceType: "LOG_INSPECTED", proofBoundary: "USER_REPORTED" }),
    ]);
    assert.equal(result.status, "PASS");
  });

  it("does not let a rejected source type force a FAIL verdict (§7)", () => {
    const result = deriveCriterion(criterion(), [
      evidence({ sourceType: "USER_REPORTED", finding: "FAIL" }),
    ]);
    assert.equal(result.status, "UNKNOWN", "an invalid source must not affect the verdict");
  });

  it("enforces minimumCount (§7)", () => {
    const twoRequired = criterion({
      evidenceRequirements: [
        {
          id: "REQ-1",
          description: "two independent runs",
          acceptedSourceTypes: ["LOG_INSPECTED"],
          minimumCount: 2,
        },
      ],
    });
    assert.equal(deriveCriterion(twoRequired, [evidence()]).status, "UNKNOWN");
    assert.equal(
      deriveCriterion(twoRequired, [evidence({ id: "EV-1" }), evidence({ id: "EV-2" })]).status,
      "PASS",
    );
  });

  it("requires every requirement, not just one (§3)", () => {
    const twoRequirements = criterion({
      evidenceRequirements: [
        {
          id: "REQ-A",
          description: "static check",
          acceptedSourceTypes: ["ARTIFACT_INSPECTED"],
          minimumCount: 1,
        },
        {
          id: "REQ-B",
          description: "runtime check",
          acceptedSourceTypes: ["LOG_INSPECTED"],
          minimumCount: 1,
        },
      ],
    });
    const onlyStatic = [
      evidence({ id: "EV-1", requirementId: "REQ-A", sourceType: "ARTIFACT_INSPECTED" }),
    ];
    assert.equal(deriveCriterion(twoRequirements, onlyStatic).status, "UNKNOWN");

    const both = [...onlyStatic, evidence({ id: "EV-2", requirementId: "REQ-B" })];
    assert.equal(deriveCriterion(twoRequirements, both).status, "PASS");
  });

  it("cannot be padded with evidence belonging to another requirement (§7)", () => {
    const result = deriveCriterion(criterion(), [evidence({ requirementId: "REQ-OTHER" })]);
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.acceptedCount, 0);
  });
});

describe("Boss derivation (§4)", () => {
  it("stays DRAFT before the contract is accepted", () => {
    const result = deriveBoss(contract(), [evidence()], false);
    assert.equal(result.status, "DRAFT");
    assert.equal(result.requiredPassed, 1, "progress is still reported while DRAFT");
  });

  it("is CLEAR when every required criterion passes", () => {
    const result = deriveBoss(contract(), [evidence()], true);
    assert.equal(result.status, "CLEAR");
    assert.equal(result.requiredPassed, 1);
    assert.equal(result.requiredTotal, 1);
  });

  it("is CLEAR when there are no required criteria at all (vacuous truth, §4.2)", () => {
    const result = deriveBoss(contract({ acceptanceCriteria: [criterion({ required: false })] }), [], true);
    assert.equal(result.status, "CLEAR");
  });

  it("is PARTIAL when only some required criteria pass", () => {
    const twoRequired = contract({
      acceptanceCriteria: [
        criterion({ id: "AC-1" }),
        criterion({ id: "AC-2" }),
      ],
    });
    const result = deriveBoss(twoRequired, [evidence({ criterionId: "AC-1" })], true);
    assert.equal(result.status, "PARTIAL");
    assert.equal(result.requiredPassed, 1);
    assert.equal(result.requiredTotal, 2);
  });

  it("is ACTIVE when no required criterion passes", () => {
    const result = deriveBoss(contract(), [], true);
    assert.equal(result.status, "ACTIVE");
    assert.equal(result.requiredPassed, 0);
  });

  it("does not become CLEAR from accepted but INCONCLUSIVE evidence", () => {
    const result = deriveBoss(contract(), [evidence({ finding: "INCONCLUSIVE" })], true);
    assert.equal(result.status, "ACTIVE");
    assert.equal(result.requiredPassed, 0);
  });

  it("lets an optional failure coexist with CLEAR (§5)", () => {
    const mixed = contract({
      acceptanceCriteria: [
        criterion({ id: "AC-1", required: true }),
        criterion({ id: "AC-2", required: false }),
      ],
    });
    const records = [
      evidence({ id: "EV-1", criterionId: "AC-1", finding: "PASS" }),
      evidence({ id: "EV-2", criterionId: "AC-2", finding: "FAIL", sourceName: "viz" }),
    ];
    const result = deriveBoss(mixed, records, true);
    assert.equal(result.status, "CLEAR", "an optional failure must not block CLEAR");
    assert.equal(result.requiredPassed, 1);
    assert.equal(result.optionalTotal, 1);
    assert.equal(result.optionalPassed, 0);
  });

  it("puts BLOCKED above CLEAR (§4.1)", () => {
    const blocked = contract({
      blockers: [
        { id: "BL-1", description: "missing dataset", affectedCriteria: ["AC-1"], resolution: "obtain it" },
      ],
    });
    const result = deriveBoss(blocked, [evidence()], true);
    assert.equal(result.status, "BLOCKED");
  });
});

describe("deliverable derivation (issue #15)", () => {
  const twoCriteria = contract({
    deliverables: [
      { id: "DEL-1", description: "module", status: "NOT_STARTED" },
      { id: "DEL-2", description: "visualization", status: "NOT_STARTED" },
    ],
    acceptanceCriteria: [
      criterion(),
      criterion({ id: "AC-2", description: "The visualization renders both masks", required: false }),
    ],
  });

  it("is NOT_STARTED when no evidence names the deliverable", () => {
    const result = deriveDeliverable(twoCriteria, "DEL-1", []);
    assert.equal(result.status, "NOT_STARTED");
    assert.equal(result.linkedEvidenceCount, 0);
    assert.deepEqual(result.relatedCriteria, []);
  });

  it("is IN_PROGRESS once material is linked, even before any review", () => {
    // The issue's rule: 已提交或审核中 → IN_PROGRESS. A pending record is the
    // honest floor — the fact of submitting is already history.
    const records = [
      evidence({ id: "EV-1", deliverableId: "DEL-1", reviewStatus: "PENDING", finding: "INCONCLUSIVE" }),
    ];
    const result = deriveDeliverable(twoCriteria, "DEL-1", records);
    assert.equal(result.status, "IN_PROGRESS");
    assert.equal(result.linkedEvidenceCount, 1);
    assert.deepEqual(result.relatedCriteria, ["AC-1"]);
  });

  it("stays IN_PROGRESS after a rejected submission, instead of erasing the start", () => {
    const records = [evidence({ id: "EV-1", deliverableId: "DEL-1", reviewStatus: "REJECTED" })];
    const result = deriveDeliverable(twoCriteria, "DEL-1", records);
    assert.equal(result.status, "IN_PROGRESS");
  });

  it("is DONE when every criterion the material was linked to is PASS", () => {
    const records = [evidence({ id: "EV-1", deliverableId: "DEL-1", finding: "PASS" })];
    const result = deriveDeliverable(twoCriteria, "DEL-1", records);
    assert.equal(result.status, "DONE");
  });

  it("stays IN_PROGRESS with accepted but INCONCLUSIVE evidence", () => {
    const records = [
      evidence({ id: "EV-1", deliverableId: "DEL-1", finding: "INCONCLUSIVE" }),
    ];
    const result = deriveDeliverable(twoCriteria, "DEL-1", records);
    assert.equal(result.status, "IN_PROGRESS");
  });

  it("keeps DONE false while a linked criterion has an accepted FAIL", () => {
    const records = [evidence({ id: "EV-1", deliverableId: "DEL-1", finding: "FAIL" })];
    const result = deriveDeliverable(twoCriteria, "DEL-1", records);
    assert.equal(result.status, "IN_PROGRESS");
    assert.match(result.reason, /AC-1/);
  });

  it("requires ALL linked criteria to pass, not just one", () => {
    const records = [
      evidence({ id: "EV-1", deliverableId: "DEL-1", finding: "PASS" }),
      evidence({
        id: "EV-2",
        criterionId: "AC-2",
        requirementId: "REQ-1",
        deliverableId: "DEL-1",
        reviewStatus: "PENDING",
        finding: "INCONCLUSIVE",
      }),
    ];
    const result = deriveDeliverable(twoCriteria, "DEL-1", records);
    assert.equal(result.status, "IN_PROGRESS");
    assert.deepEqual(result.relatedCriteria, ["AC-1", "AC-2"]);
  });

  it("never reads another deliverable's evidence", () => {
    const records = [
      evidence({ id: "EV-1", deliverableId: "DEL-2", finding: "PASS" }),
      evidence({ id: "EV-2", deliverableId: "DEL-2", criterionId: "AC-2", finding: "PASS" }),
    ];
    assert.equal(deriveDeliverable(twoCriteria, "DEL-2", records).status, "DONE");
    assert.equal(deriveDeliverable(twoCriteria, "DEL-1", records).status, "NOT_STARTED");
  });

  it("counts a PASS reached by other evidence towards DONE, because DONE is about acceptance", () => {
    // The link declares the association; it does not claim this record alone
    // must carry the pass. An accepted pass anywhere on the criterion counts.
    const records = [
      evidence({ id: "EV-1", deliverableId: "DEL-1", reviewStatus: "REJECTED" }),
      evidence({ id: "EV-2", finding: "PASS" }),
    ];
    const result = deriveDeliverable(twoCriteria, "DEL-1", records);
    assert.equal(result.status, "DONE");
  });

  it("stays honest when a linked criterion is unknown to the contract", () => {
    const records = [
      evidence({ id: "EV-1", deliverableId: "DEL-1", criterionId: "AC-GONE", finding: "PASS" }),
    ];
    const result = deriveDeliverable(twoCriteria, "DEL-1", records);
    assert.equal(result.status, "IN_PROGRESS", "a vanished criterion can never be PASS");
  });

  it("records the link on submission and reloads it from storage", () => {
    const draft = {
      contractId: "boss-1",
      contractRevision: 1,
      criterionId: "AC-1",
      requirementId: "REQ-1",
      deliverableId: "DEL-1",
      sourceType: "LOG_INSPECTED" as const,
      sourceName: "tests/test_waca.py",
      summary: "shape and gradient tests passed",
    };
    const ledger = withRecordedEvidence(emptyLedger(), draft, {
      id: "EV-9",
      recordedAt: "2026-09-20T10:00:00.000Z",
    });
    assert.equal(ledger.evidence[0].deliverableId, "DEL-1");
    assert.equal(deriveDeliverable(twoCriteria, "DEL-1", ledger.evidence).status, "IN_PROGRESS");

    const storage = memoryStorage();
    saveLedger(storage, ledger);
    assert.equal(loadLedger(storage).evidence[0].deliverableId, "DEL-1");
  });

  it("reads records written before the deliverable link existed", () => {
    const legacy = JSON.stringify({
      version: 1,
      evidence: [evidence()],
      accepted: {},
      contexts: {},
      incubations: {},
    });
    const loaded = loadLedger(memoryStorage(legacy));
    assert.equal(loaded.evidence[0].deliverableId, undefined, "no link is the legacy default");
    assert.equal(deriveDeliverable(twoCriteria, "DEL-1", loaded.evidence).status, "NOT_STARTED");
  });

  it("fails closed on a non-string deliverable link", () => {
    // Typed as EvidenceRecord via a cast because the value is deliberately not one.
    const corrupted = { ...evidence(), deliverableId: 7 } as unknown as EvidenceRecord;
    const malformed = JSON.stringify({ ...emptyLedger(), evidence: [corrupted] });
    assert.deepEqual(loadLedger(memoryStorage(malformed)), emptyLedger());
  });
});

describe("ledger storage", () => {
  it("round-trips reviews and the override log through a storage implementation", () => {
    const storage = memoryStorage();
    const reviewed = withReviewOutcome(
      recorded(),
      outcome({ finding: "FAIL", proofBoundary: "USER_REPORTED", suggestedNextEvidence: [] }),
    );
    const ledger = withOverride(
      reviewed,
      {
        evidenceId: "EV-1",
        toStatus: "REJECTED",
        reason: "这段内容只能证明用户声称做过，不足以判定。",
        at: "2026-09-18T10:30:00.000Z",
      },
      reviewed.reviews["EV-1"],
    );

    assert.equal(saveLedger(storage, ledger), true);
    assert.deepEqual(loadLedger(storage), ledger);
    const reloaded = loadLedger(storage);
    assert.equal(reloaded.reviews["EV-1"].rationale, ledger.reviews["EV-1"].rationale);
    assert.equal(reloaded.overrides[0].reason, ledger.overrides[0].reason);
  });

  it("reads a payload written before reviews and overrides existed", () => {
    // The shape the first published build wrote: no `reviews`, no `overrides`.
    const legacy = JSON.stringify({
      version: 1,
      evidence: [evidence()],
      accepted: { "boss-1": "2026-09-18T10:00:00.000Z" },
      contexts: {},
      incubations: {},
    });
    const loaded = loadLedger(memoryStorage(legacy));
    assert.equal(loaded.evidence.length, 1, "an older payload must not be discarded");
    assert.equal(loaded.accepted["boss-1"], "2026-09-18T10:00:00.000Z");
    assert.deepEqual(loaded.reviews, {});
    assert.deepEqual(loaded.overrides, []);
  });

  it("fails closed on a present but malformed review or override", () => {
    const malformedReview = JSON.stringify({
      ...emptyLedger(),
      reviews: { "EV-1": { evidenceId: "EV-1", decision: "PROBABLY" } },
    });
    const malformedOverrides = JSON.stringify({ ...emptyLedger(), overrides: { "EV-1": {} } });
    const nullReviews = JSON.stringify({ ...emptyLedger(), reviews: null });

    assert.deepEqual(loadLedger(memoryStorage(malformedReview)), emptyLedger());
    assert.deepEqual(loadLedger(memoryStorage(malformedOverrides)), emptyLedger());
    assert.deepEqual(loadLedger(memoryStorage(nullReviews)), emptyLedger());
  });

  it("round-trips through a storage implementation", () => {
    const storage = memoryStorage();
    const ledger = withAcceptedContract(emptyLedger(), "boss-1", "2026-09-18T10:00:00.000Z");
    assert.equal(saveLedger(storage, ledger), true);
    assert.deepEqual(loadLedger(storage), ledger);
  });

  it("returns an empty ledger for an absent or corrupt payload", () => {
    assert.deepEqual(loadLedger(memoryStorage()), emptyLedger());
    assert.deepEqual(loadLedger(memoryStorage("{ not json")), emptyLedger());
    assert.deepEqual(loadLedger(memoryStorage('{"version":99}')), emptyLedger());
  });

  it("rejects structurally invalid nested storage instead of crashing later", () => {
    const malformedEvidence = JSON.stringify({
      ...emptyLedger(),
      evidence: [{ id: "EV-1", sourceName: null }],
    });
    const malformedMaps = JSON.stringify({
      ...emptyLedger(),
      accepted: [],
    });

    assert.deepEqual(loadLedger(memoryStorage(malformedEvidence)), emptyLedger());
    assert.deepEqual(loadLedger(memoryStorage(malformedMaps)), emptyLedger());
  });

  it("survives a storage implementation that throws", () => {
    const hostile: LedgerStorage = {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    assert.deepEqual(loadLedger(hostile), emptyLedger());
    assert.equal(saveLedger(hostile, emptyLedger()), false);
  });

  it("treats a null storage as an empty ledger, not a crash", () => {
    assert.deepEqual(loadLedger(null), emptyLedger());
    assert.equal(saveLedger(null, emptyLedger()), false);
  });
});

describe("recording and review", () => {
  it("records new evidence as PENDING and asserts no verdict (§8)", () => {
    const ledger = withRecordedEvidence(
      emptyLedger(),
      {
        contractId: "boss-1",
        contractRevision: 1,
        criterionId: "AC-1",
        requirementId: "REQ-1",
        sourceType: "LOG_INSPECTED",
        sourceName: "log",
        summary: "ok",
      },
      { id: "EV-1", recordedAt: "2026-09-18T10:00:00.000Z" },
    );
    assert.equal(ledger.evidence.length, 1);
    assert.equal(ledger.evidence[0].reviewStatus, "PENDING");
    assert.equal(
      ledger.evidence[0].finding,
      "INCONCLUSIVE",
      "a submitter cannot state a verdict; the review supplies it",
    );
    assert.equal(deriveCriterion(criterion(), ledger.evidence).status, "UNKNOWN");
  });

  it("adopts a review and then it affects the status", () => {
    const recorded = withRecordedEvidence(
      emptyLedger(),
      {
        contractId: "boss-1",
        contractRevision: 1,
        criterionId: "AC-1",
        requirementId: "REQ-1",
        sourceType: "LOG_INSPECTED",
        sourceName: "log",
        summary: "ok",
      },
      { id: "EV-1", recordedAt: "2026-09-18T10:00:00.000Z" },
    );
    const adopted = withReviewOutcome(
      recorded,
      outcome({ evidenceId: "EV-1", decision: "ACCEPTED", finding: "PASS" }),
    );
    assert.equal(adopted.evidence[0].proofBoundary, "LOG_INSPECTED");
    assert.equal(deriveCriterion(criterion(), adopted.evidence).status, "PASS");
  });

  it("persists a downgraded review boundary and uses it during derivation", () => {
    const adopted = withReviewOutcome(
      recorded(),
      outcome({
        decision: "ACCEPTED",
        finding: "PASS",
        proofBoundary: "USER_REPORTED",
        rationale: "文本只说明用户声称运行过，没有可核查日志。",
      }),
    );
    assert.equal(adopted.evidence[0].sourceType, "LOG_INSPECTED", "preserve the user's claim");
    assert.equal(adopted.evidence[0].proofBoundary, "USER_REPORTED");
    assert.equal(deriveCriterion(criterion(), adopted.evidence).status, "UNKNOWN");
  });

  it("leaves other evidence untouched when reviewing one item", () => {
    const base = withRecordedEvidence(
      withRecordedEvidence(emptyLedger(), draft("EV-1"), meta("EV-1", 1)),
      draft("EV-2"),
      meta("EV-2", 2),
    );
    const reviewed = withOverride(
      base,
      { evidenceId: "EV-2", toStatus: "REJECTED", reason: "这段文本与验收项无关。", at: "2026-09-18T10:05:00.000Z" },
    );
    assert.equal(reviewed.evidence.find((item) => item.id === "EV-1")?.reviewStatus, "PENDING");
    assert.equal(reviewed.evidence.find((item) => item.id === "EV-2")?.reviewStatus, "REJECTED");
  });
});

function draft(criterionId: string) {
  return {
    contractId: "boss-1",
    contractRevision: 1,
    criterionId,
    requirementId: "REQ-1",
    sourceType: "LOG_INSPECTED" as const,
    sourceName: "log",
    summary: "ok",
  };
}

function meta(id: string, hour: number) {
  return { id, recordedAt: `2026-09-18T${String(hour).padStart(2, "0")}:00:00.000Z` };
}

function outcome(overrides: Partial<ReviewOutcome> = {}): ReviewOutcome {
  return {
    evidenceId: "EV-1",
    decision: "ACCEPTED",
    finding: "PASS",
    rationale: "日志显示 12 个用例全部通过。",
    proofBoundary: "LOG_INSPECTED",
    suggestedNextEvidence: [],
    reviewerKind: "MOCK",
    promptVersion: "evidence-review.mock.v1",
    reviewedAt: "2026-09-18T10:01:00.000Z",
    ...overrides,
  };
}

/** One recorded, unreviewed piece of evidence, ready to be reviewed. */
function recorded(id = "EV-1"): Ledger {
  return withRecordedEvidence(emptyLedger(), draft("AC-1"), {
    id,
    recordedAt: "2026-09-18T10:00:00.000Z",
  });
}

describe("review adoption and audited overrides", () => {
  it("maps a decision onto a ledger status, keeping INCONCLUSIVE as pending", () => {
    assert.equal(reviewStatusForDecision("ACCEPTED"), "ACCEPTED");
    assert.equal(reviewStatusForDecision("REJECTED"), "REJECTED");
    assert.equal(
      reviewStatusForDecision("INCONCLUSIVE"),
      "PENDING",
      "an undecided review must keep asking for evidence, not close the criterion",
    );
  });

  it("takes the finding from the review, not from the submitter", () => {
    // The submission says nothing; the reviewer read a traceback in it.
    const ledger = withReviewOutcome(
      recorded(),
      outcome({ finding: "FAIL", rationale: "日志含 Traceback，Stage 2 收到 X。" }),
    );
    assert.equal(ledger.evidence[0].finding, "FAIL");
    assert.equal(deriveCriterion(criterion(), ledger.evidence).status, "FAIL");
    assert.equal(reviewFor(ledger, "EV-1")?.rationale, "日志含 Traceback，Stage 2 收到 X。");
  });

  it("keeps INCONCLUSIVE evidence out of the derivation but visible on the record", () => {
    const ledger = withReviewOutcome(
      recorded(),
      outcome({ decision: "INCONCLUSIVE", finding: "INCONCLUSIVE" }),
    );
    assert.equal(ledger.evidence[0].reviewStatus, "PENDING");
    assert.equal(reviewFor(ledger, "EV-1")?.decision, "INCONCLUSIVE");
    assert.equal(deriveCriterion(criterion(), ledger.evidence).status, "UNKNOWN");
    assert.equal(deriveCriterion(criterion(), ledger.evidence).pendingCount, 1);
  });

  it("does not let a rejected submission move the criterion (§8)", () => {
    const ledger = withReviewOutcome(
      recorded(),
      outcome({ decision: "REJECTED", finding: "INCONCLUSIVE", rationale: "与验收项无关。" }),
    );
    assert.equal(ledger.evidence[0].reviewStatus, "REJECTED");
    const derived = deriveCriterion(criterion(), ledger.evidence);
    assert.equal(derived.status, "UNKNOWN");
    assert.equal(derived.acceptedCount, 0, "a rejected submission is not evidence");
    // `pendingCount` counts everything that is not accepted — a rejection is
    // "not accepted" too. The distinction the UI needs is which source decides,
    // and only ACCEPTED does.
    assert.equal(derived.pendingCount, 1);
  });

  it("refuses a review of evidence the ledger does not hold", () => {
    const ledger = withReviewOutcome(recorded(), outcome({ evidenceId: "EV-MISSING" }));
    assert.equal(ledger.evidence.length, 1);
    assert.equal(ledger.evidence[0].reviewStatus, "PENDING");
    assert.equal(reviewFor(ledger, "EV-MISSING"), undefined, "no orphan review");
  });

  it("records an override as a transition with a reason, and keeps the review it overrode", () => {
    const reviewed = withReviewOutcome(
      recorded(),
      outcome({ decision: "REJECTED", finding: "INCONCLUSIVE", rationale: "没有看到运行输出。" }),
    );
    const overridden = withOverride(
      reviewed,
      {
        evidenceId: "EV-1",
        toStatus: "ACCEPTED",
        toFinding: "PASS",
        reason: "已在本地重跑，输出附在 PR 描述里。",
        at: "2026-09-18T10:30:00.000Z",
      },
      reviewed.reviews["EV-1"],
    );

    assert.equal(overridden.evidence[0].reviewStatus, "ACCEPTED");
    assert.equal(deriveCriterion(criterion(), overridden.evidence).status, "PASS");

    const audit = latestOverrideFor(overridden, "EV-1");
    assert.ok(audit, "the override must be visible in the audit trail");
    assert.equal(audit.fromStatus, "REJECTED");
    assert.equal(audit.toStatus, "ACCEPTED");
    assert.equal(audit.reason, "已在本地重跑，输出附在 PR 描述里。");
    assert.equal(
      reviewFor(overridden, "EV-1")?.rationale,
      "没有看到运行输出。",
      "the AI's advice survives the human disagreement",
    );
  });

  it("refuses an override with no usable reason", () => {
    const base = recorded();
    const blank = withOverride(base, {
      evidenceId: "EV-1",
      toStatus: "ACCEPTED",
      reason: "   ",
      at: "2026-09-18T10:30:00.000Z",
    });
    const tooShort = withOverride(base, {
      evidenceId: "EV-1",
      toStatus: "ACCEPTED",
      reason: "行吧",
      at: "2026-09-18T10:30:00.000Z",
    });
    assert.equal(blank, base, "a blank reason must not change the ledger");
    assert.equal(tooShort, base);
    assert.equal(base.overrides.length, 0);
    assert.equal(isAuditableOverride({ reason: "x".repeat(MIN_OVERRIDE_REASON_LENGTH) }), true);
    assert.equal(
      isAuditableOverride({ reason: "x".repeat(MIN_OVERRIDE_REASON_LENGTH - 1) }),
      false,
      "the length gate is the form's, and it must match the reducer's",
    );
    assert.equal(isAuditableOverride({ reason: `  ${"x".repeat(MIN_OVERRIDE_REASON_LENGTH)}  ` }), true);
  });

  it("defaults the overridden finding to the review's, not to PASS", () => {
    const reviewed = withReviewOutcome(recorded(), outcome({ finding: "FAIL" }));
    const overridden = withOverride(
      reviewed,
      { evidenceId: "EV-1", toStatus: "REJECTED", reason: "这条日志不是本轮产生的。", at: "t" },
      reviewed.reviews["EV-1"],
    );
    assert.equal(overridden.evidence[0].reviewStatus, "REJECTED");
    assert.equal(
      overridden.evidence[0].finding,
      "FAIL",
      "disagreeing with the decision must not silently rewrite what the content shows",
    );
  });

  it("keeps every override, newest last, when a user changes their mind twice", () => {
    const base = recorded();
    const first = withOverride(base, {
      evidenceId: "EV-1",
      toStatus: "ACCEPTED",
      reason: "第一次：本地重跑通过。",
      at: "2026-09-18T10:30:00.000Z",
    });
    const second = withOverride(first, {
      evidenceId: "EV-1",
      toStatus: "REJECTED",
      reason: "发现跑的是旧版本，撤回。",
      at: "2026-09-18T11:00:00.000Z",
    });

    assert.equal(second.overrides.length, 2, "the audit log is append-only");
    assert.equal(second.evidence[0].reviewStatus, "REJECTED");
    assert.equal(latestOverrideFor(second, "EV-1")?.reason, "发现跑的是旧版本，撤回。");
  });

  it("refuses an override of evidence the ledger does not hold", () => {
    const base = recorded();
    const result = withOverride(base, {
      evidenceId: "EV-MISSING",
      toStatus: "ACCEPTED",
      reason: "这段理由足够长，应该被接受。",
      at: "t",
    });
    assert.equal(result, base);
  });
});

describe("agreement with the frozen product truth", () => {
  // The strongest available check on this module: run the derivation over the
  // frozen demo fixture and require it to reproduce the statuses that
  // examples/waca-se-boss.json and docs/product/mvp0-acceptance.md declare.
  // If the rules and the fixture ever drift apart, this fails.
  const fixture = JSON.parse(
    readFileSync(resolve(__dirname, "../../examples/waca-se-boss.json"), "utf-8"),
  ) as BossContract;

  const records: EvidenceRecord[] = fixture.evidenceItems.map((item, index) => ({
    ...item,
    contractId: fixture.id,
    contractRevision: fixture.revision,
    recordedAt: `2026-09-18T10:00:0${index}.000Z`,
  }));

  it("reproduces every criterion status declared by the fixture", () => {
    for (const criterion of fixture.acceptanceCriteria) {
      const derived = deriveCriterion(
        criterion,
        records.filter((item) => item.criterionId === criterion.id),
      );
      assert.equal(
        derived.status,
        criterion.status,
        `${criterion.id}: fixture says ${criterion.status}, derivation says ${derived.status} (${derived.reason})`,
      );
    }
  });

  it("reproduces the fixture's PARTIAL Boss status", () => {
    const derived = deriveBoss(fixture, records, true);
    assert.equal(derived.status, fixture.status);
    assert.equal(derived.status, "PARTIAL");
    assert.equal(derived.requiredPassed, 2);
    assert.equal(derived.requiredTotal, 3);
  });

  it("exposes the accepted failures in the fixture as failure assets", () => {
    const ledger: Ledger = withContext(
      { ...emptyLedger(), evidence: records },
      { contractId: fixture.id, objective: fixture.objective, rawGoal: fixture.rawGoal },
    );
    const failures = listFailures(ledger);
    assert.equal(failures.length, 2, "EV-2 and EV-3 are accepted FAIL findings");
    for (const failure of failures) {
      assert.equal(failure.evidence.criterionId, "AC-2");
      assert.equal(failure.resolved, false);
    }
  });
});

describe("failure assets and incubation (§11)", () => {
  function ledgerWith(records: EvidenceRecord[]): Ledger {
    const base: Ledger = { ...emptyLedger(), evidence: records };
    return withContext(base, { contractId: "boss-1", objective: "WACA-SE module", rawGoal: "复现 WACA" });
  }

  it("lists only accepted failures", () => {
    const ledger = ledgerWith([
      evidence({ id: "EV-1", finding: "FAIL", reviewStatus: "ACCEPTED" }),
      evidence({ id: "EV-2", finding: "FAIL", reviewStatus: "PENDING" }),
      evidence({ id: "EV-3", finding: "PASS", reviewStatus: "ACCEPTED" }),
    ]);
    const failures = listFailures(ledger);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].evidence.id, "EV-1");
  });

  it("orders failures newest first", () => {
    const ledger = ledgerWith([
      evidence({ id: "EV-1", finding: "FAIL", recordedAt: "2026-09-18T09:00:00.000Z" }),
      evidence({ id: "EV-2", finding: "FAIL", recordedAt: "2026-09-18T11:00:00.000Z" }),
    ]);
    assert.deepEqual(
      listFailures(ledger).map((item) => item.evidence.id),
      ["EV-2", "EV-1"],
    );
  });

  it("marks a failure resolved once a later accepted PASS exists, and keeps it", () => {
    const ledger = ledgerWith([
      evidence({ id: "EV-1", finding: "FAIL", recordedAt: "2026-09-18T09:00:00.000Z" }),
      evidence({ id: "EV-2", finding: "PASS", recordedAt: "2026-09-18T12:00:00.000Z" }),
    ]);
    const failures = listFailures(ledger);
    assert.equal(failures.length, 1, "a fixed failure is still accumulated knowledge");
    assert.equal(failures[0].resolved, true);
    assert.equal(failures[0].resolvedAt, "2026-09-18T12:00:00.000Z");
  });

  it("does not mark a failure resolved by an earlier PASS", () => {
    const ledger = ledgerWith([
      evidence({ id: "EV-1", finding: "PASS", recordedAt: "2026-09-18T09:00:00.000Z" }),
      evidence({ id: "EV-2", finding: "FAIL", recordedAt: "2026-09-18T12:00:00.000Z" }),
    ]);
    assert.equal(listFailures(ledger)[0].resolved, false);
  });

  it("builds an incubation goal carrying the failure summary and source", () => {
    const ledger = ledgerWith([evidence({ id: "EV-1", finding: "FAIL", summary: "Stage 2 received X rather than Xweak" })]);
    const goal = buildIncubationGoal(listFailures(ledger)[0]);
    assert.match(goal, /Stage 2 received X rather than Xweak/);
    assert.match(goal, /tests\/test_waca\.py/);
    assert.ok(goal.length >= 1 && goal.length <= 500, "goal must satisfy the API contract");
  });

  it("clamps an over-long goal to the API limit", () => {
    const long = clampGoal("x".repeat(900));
    assert.equal(long.length, 500);
    assert.ok(long.endsWith("…"));
    assert.equal(clampGoal("  padded  "), "padded");
  });

  it("records the lineage of an incubated Boss", () => {
    const ledger = withIncubation(emptyLedger(), "boss-2", {
      fromEvidenceId: "EV-1",
      fromContractId: "boss-1",
      criterionId: "AC-2",
      summary: "Xweak not used",
    });
    assert.equal(ledger.incubations["boss-2"].fromContractId, "boss-1");
    assert.equal(ledger.incubations["boss-2"].criterionId, "AC-2");
  });
});

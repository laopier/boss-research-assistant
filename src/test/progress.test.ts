/**
 * Progress and journey derivation tests.
 *
 * These pin the "explainable progress" rules from issue #15 (Completion
 * Progress + next action) and issue #17 (Feature 2). The next-action priority
 * and the "a failure is not erased by a later pass" journey behaviour are the
 * product truths under test here.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AcceptanceCriterion, BossContract } from "../lib/contracts";
import {
  EvidenceRecord,
  Ledger,
  ReviewOutcome,
  emptyLedger,
  withAcceptedContract,
  withIncubation,
  withOverride,
  withRecordedEvidence,
  withReviewOutcome,
} from "../lib/failure-ledger";
import {
  deriveProgress,
  listJourneyEvents,
  missingRequirements,
} from "../lib/progress";

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
        acceptedSourceTypes: ["LOG_INSPECTED"],
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
    sourceName: "tests/test_shape.py",
    summary: "shape test passed",
    finding: "PASS",
    reviewStatus: "ACCEPTED",
    recordedAt: "2026-09-20T10:00:00.000Z",
    ...overrides,
  };
}

function outcome(overrides: Partial<ReviewOutcome> = {}): ReviewOutcome {
  return {
    evidenceId: "EV-1",
    decision: "ACCEPTED",
    finding: "PASS",
    rationale: "日志显示 shape 测试通过。",
    proofBoundary: "LOG_INSPECTED",
    suggestedNextEvidence: [],
    reviewerKind: "MOCK",
    promptVersion: "evidence-review.mock.v1",
    reviewedAt: "2026-09-20T10:05:00.000Z",
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
    rawGoal: "复现 WACA",
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

function ledger(records: EvidenceRecord[]): Ledger {
  return { ...emptyLedger(), evidence: records };
}

describe("missingRequirements", () => {
  it("lists every unmet requirement with the shortfall and accepted sources", () => {
    const result = missingRequirements(criterion(), []);
    assert.equal(result.length, 1);
    assert.equal(result[0].requirementId, "REQ-1");
    assert.equal(result[0].have, 0);
    assert.equal(result[0].need, 1);
    assert.deepEqual(result[0].acceptedSourceTypes, ["LOG_INSPECTED"]);
  });

  it("is empty once the requirement is satisfied", () => {
    const result = missingRequirements(criterion(), [evidence()]);
    assert.deepEqual(result, []);
  });

  it("reports a shortfall against the minimum count", () => {
    const two = criterion({
      evidenceRequirements: [
        {
          id: "REQ-1",
          description: "a runtime test",
          acceptedSourceTypes: ["LOG_INSPECTED"],
          minimumCount: 2,
        },
      ],
    });
    const result = missingRequirements(two, [evidence()]);
    assert.equal(result[0].have, 1);
    assert.equal(result[0].need, 2);
  });

  it("is empty for a criterion that already has an accepted failure", () => {
    const result = missingRequirements(criterion(), [evidence({ finding: "FAIL" })]);
    assert.deepEqual(result, [], "a FAIL is a failure to incubate, not missing evidence");
  });
});

describe("deriveProgress", () => {
  it("asks to accept the contract first", () => {
    const result = deriveProgress(contract(), ledger([]), false);
    assert.equal(result.nextAction.kind, "ACCEPT_CONTRACT");
    assert.equal(result.requiredPassed, 0);
    assert.equal(result.deliverablesDone, 0);
  });

  it("points at the first missing requirement when nothing has been submitted", () => {
    const result = deriveProgress(contract(), ledger([]), true);
    assert.equal(result.nextAction.kind, "SUBMIT_EVIDENCE");
    if (result.nextAction.kind === "SUBMIT_EVIDENCE") {
      assert.equal(result.nextAction.missing.requirementId, "REQ-1");
    }
    assert.equal(result.missing.length, 1);
  });

  it("reports completion when all required criteria pass", () => {
    const result = deriveProgress(contract(), ledger([evidence()]), true);
    assert.equal(result.requiredPassed, 1);
    assert.equal(result.nextAction.kind, "COMPLETE_BOSS");
  });

  it("prefers incubation when an accepted failure is unresolved", () => {
    const result = deriveProgress(contract(), ledger([evidence({ finding: "FAIL" })]), true);
    assert.equal(result.nextAction.kind, "INCUBATE_FAILURE");
    assert.equal(result.unresolvedFailures, 1);
  });

  it("does not block completion on an optional failure", () => {
    const optionalFailure = contract({
      acceptanceCriteria: [criterion(), criterion({ id: "AC-2", required: false })],
    });
    const records = [
      evidence(),
      evidence({ id: "EV-2", criterionId: "AC-2", requirementId: "REQ-1", finding: "FAIL" }),
    ];
    const result = deriveProgress(optionalFailure, ledger(records), true);
    assert.equal(result.requiredPassed, 1);
    assert.equal(result.nextAction.kind, "COMPLETE_BOSS", "optional FAIL must not block CLEAR");
    assert.equal(result.unresolvedFailures, 1);
  });

  it("counts only completed deliverables", () => {
    const twoDeliverables = contract({
      deliverables: [
        { id: "DEL-1", description: "module", status: "NOT_STARTED" },
        { id: "DEL-2", description: "viz", status: "NOT_STARTED" },
      ],
    });
    const records = [evidence({ deliverableId: "DEL-1" })];
    const result = deriveProgress(twoDeliverables, ledger(records), true);
    assert.equal(result.deliverablesDone, 1);
    assert.equal(result.deliverablesTotal, 2);
  });

  it("marks optional requirements as optional in the gap list", () => {
    const withOptional = contract({
      acceptanceCriteria: [criterion(), criterion({ id: "AC-2", required: false })],
    });
    const result = deriveProgress(withOptional, ledger([evidence()]), true);
    const optional = result.missing.find((item) => item.criterionId === "AC-2");
    assert.ok(optional, "an unmet optional requirement is still a gap to show");
    assert.equal(optional?.criterionRequired, false);
  });

  it("surfaces blockers without inventing an evidence action for them", () => {
    const blocked = contract({
      blockers: [
        { id: "BL-1", description: "missing dataset", affectedCriteria: ["AC-1"], resolution: "obtain it" },
      ],
    });
    const result = deriveProgress(blocked, ledger([]), true);
    assert.deepEqual(result.blockers, ["BL-1"]);
    assert.equal(result.nextAction.kind, "RESOLVE_BLOCKER");
    assert.notEqual(result.nextAction.kind, "COMPLETE_BOSS");
  });

  it("prioritizes a missing required criterion over an earlier optional one", () => {
    const optionalFirst = contract({
      acceptanceCriteria: [
        criterion({ id: "AC-OPTIONAL", required: false }),
        criterion({ id: "AC-REQUIRED", required: true }),
      ],
    });
    const result = deriveProgress(optionalFirst, ledger([]), true);
    assert.equal(result.nextAction.kind, "SUBMIT_EVIDENCE");
    if (result.nextAction.kind === "SUBMIT_EVIDENCE") {
      assert.equal(result.nextAction.missing.criterionId, "AC-REQUIRED");
    }
  });
});

describe("listJourneyEvents", () => {
  it("is empty for a contract with no activity", () => {
    assert.deepEqual(listJourneyEvents(contract(), emptyLedger()), []);
  });

  it("records acceptance, evidence, adoption and override in time order", () => {
    let l = withAcceptedContract(emptyLedger(), "boss-1", "2026-09-20T09:00:00.000Z");
    l = withRecordedEvidence(
      l,
      {
        contractId: "boss-1",
        contractRevision: 1,
        criterionId: "AC-1",
        requirementId: "REQ-1",
        sourceType: "LOG_INSPECTED",
        sourceName: "tests/test_shape.py",
        summary: "shape test passed",
      },
      { id: "EV-1", recordedAt: "2026-09-20T10:00:00.000Z" },
    );
    l = withReviewOutcome(l, outcome({ finding: "FAIL" }));
    l = withOverride(
      l,
      {
        evidenceId: "EV-1",
        toStatus: "ACCEPTED",
        toFinding: "FAIL",
        reason: "审核器只看到粘贴文本，但日志已在 CI 完整跑过。",
        at: "2026-09-20T10:30:00.000Z",
      },
      l.reviews["EV-1"],
    );

    const events = listJourneyEvents(contract(), l);
    const kinds = events.map((item) => item.kind);
    assert.ok(kinds.includes("CONTRACT_ACCEPTED"));
    assert.ok(kinds.includes("EVIDENCE_RECORDED"));
    assert.ok(kinds.includes("REVIEW_ADOPTED"));
    assert.ok(kinds.includes("REVIEW_OVERRIDDEN"));
    assert.ok(kinds.includes("FAILURE_RECORDED"));

    const times = events.map((item) => item.at);
    assert.deepEqual(times, [...times].sort(), "events must be in time order");
  });

  it("emits a criterion pass and Boss clear for a completed contract", () => {
    let l = withRecordedEvidence(
      emptyLedger(),
      {
        contractId: "boss-1",
        contractRevision: 1,
        criterionId: "AC-1",
        requirementId: "REQ-1",
        sourceType: "LOG_INSPECTED",
        sourceName: "tests/test_shape.py",
        summary: "shape test passed",
      },
      { id: "EV-1", recordedAt: "2026-09-20T10:00:00.000Z" },
    );
    l = withReviewOutcome(l, outcome({ finding: "PASS" }));

    const events = listJourneyEvents(contract(), l);
    const kinds = events.map((item) => item.kind);
    assert.ok(kinds.includes("CRITERION_PASSED"));
    assert.ok(kinds.includes("BOSS_CLEAR"));
  });

  it("keeps a failure event even after a later pass", () => {
    // A later accepted PASS resolves the failure in listFailures, but the
    // criterion stays FAIL (§3: any accepted failure) — and, more importantly,
    // the failure event must survive in the journey regardless. That is the
    // "a failure lowers completion but is not erased" rule.
    let l = withRecordedEvidence(
      emptyLedger(),
      {
        contractId: "boss-1",
        contractRevision: 1,
        criterionId: "AC-1",
        requirementId: "REQ-1",
        sourceType: "LOG_INSPECTED",
        sourceName: "run1.log",
        summary: "first run failed",
      },
      { id: "EV-1", recordedAt: "2026-09-20T10:00:00.000Z" },
    );
    l = withReviewOutcome(l, outcome({ evidenceId: "EV-1", finding: "FAIL" }));
    l = withRecordedEvidence(
      l,
      {
        contractId: "boss-1",
        contractRevision: 1,
        criterionId: "AC-1",
        requirementId: "REQ-1",
        sourceType: "LOG_INSPECTED",
        sourceName: "run2.log",
        summary: "second run passed",
      },
      { id: "EV-2", recordedAt: "2026-09-20T11:00:00.000Z" },
    );
    l = withReviewOutcome(
      l,
      outcome({ evidenceId: "EV-2", finding: "PASS", reviewedAt: "2026-09-20T11:05:00.000Z" }),
    );

    const events = listJourneyEvents(contract(), l);
    const kinds = events.map((item) => item.kind);
    assert.ok(kinds.includes("FAILURE_RECORDED"), "a later pass must not erase the failure");
    const recordedCount = kinds.filter((kind) => kind === "EVIDENCE_RECORDED").length;
    assert.equal(recordedCount, 2, "both submissions remain in the journey");
  });

  it("records an incubation from this contract", () => {
    let l = withRecordedEvidence(
      emptyLedger(),
      {
        contractId: "boss-1",
        contractRevision: 1,
        criterionId: "AC-1",
        requirementId: "REQ-1",
        sourceType: "LOG_INSPECTED",
        sourceName: "run1.log",
        summary: "failed",
      },
      { id: "EV-1", recordedAt: "2026-09-20T10:00:00.000Z" },
    );
    l = withIncubation(l, "boss-2", {
      fromEvidenceId: "EV-1",
      fromContractId: "boss-1",
      criterionId: "AC-1",
      summary: "failed",
    });

    const kinds = listJourneyEvents(contract(), l).map((item) => item.kind);
    assert.ok(kinds.includes("INCUBATED"));
  });
});

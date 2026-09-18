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
  buildIncubationGoal,
  clampGoal,
  deriveBoss,
  deriveCriterion,
  emptyLedger,
  listFailures,
  loadLedger,
  saveLedger,
  withAcceptedContract,
  withContext,
  withIncubation,
  withRecordedEvidence,
  withReview,
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

describe("ledger storage", () => {
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
  it("records new evidence as PENDING (§8)", () => {
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
        finding: "PASS",
      },
      { id: "EV-1", recordedAt: "2026-09-18T10:00:00.000Z" },
    );
    assert.equal(ledger.evidence.length, 1);
    assert.equal(ledger.evidence[0].reviewStatus, "PENDING");
    assert.equal(deriveCriterion(criterion(), ledger.evidence).status, "UNKNOWN");
  });

  it("accepts evidence and then it affects the status", () => {
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
        finding: "PASS",
      },
      { id: "EV-1", recordedAt: "2026-09-18T10:00:00.000Z" },
    );
    const accepted = withReview(recorded, "EV-1", "ACCEPTED");
    assert.equal(deriveCriterion(criterion(), accepted.evidence).status, "PASS");
  });

  it("leaves other evidence untouched when reviewing one item", () => {
    const base = withRecordedEvidence(
      withRecordedEvidence(emptyLedger(), draft("EV-1"), meta("EV-1", 1)),
      draft("EV-2"),
      meta("EV-2", 2),
    );
    const reviewed = withReview(base, "EV-2", "REJECTED");
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
    finding: "PASS" as const,
  };
}

function meta(id: string, hour: number) {
  return { id, recordedAt: `2026-09-18T${String(hour).padStart(2, "0")}:00:00.000Z` };
}

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

/**
 * Roadmap derivation tests (#18 §1, #17 Feature 1).
 *
 * The number under test is the project-level progress: it must come out of the
 * milestone/Boss composition (each intermediate value is shown in the UI), and
 * the storage round-trip must keep every Boss restorable after a refresh.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AcceptanceCriterion, BossContract } from "../lib/contracts";
import {
  Ledger,
  LedgerStorage,
  emptyLedger,
  loadLedger,
  saveLedger,
  withAcceptedContract,
  withBossInProject,
  withContract,
  withCurrentBoss,
  withNewProject,
} from "../lib/failure-ledger";
import { deriveRoadmap, nextActionSummary } from "../lib/roadmap";

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

function ledgerWith(contracts: BossContract[], patch: Partial<Ledger> = {}): Ledger {
  let ledger: Ledger = { ...emptyLedger(), ...patch };
  for (const item of contracts) ledger = withContract(ledger, item);
  return ledger;
}

function project(overrides: Record<string, unknown> = {}): NonNullable<Ledger["project"]> {
  return {
    goal: "复现 WACA 论文",
    milestones: [
      { id: "M-1", title: "读懂论文与数据", bossIds: ["boss-1"] },
      { id: "M-2", title: "构建并验证模型", bossIds: ["boss-2"] },
    ],
    currentBossId: "boss-1",
    revision: 1,
    updatedAt: "2026-09-23T10:00:00.000Z",
    ...overrides,
  } as NonNullable<Ledger["project"]>;
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

describe("deriveRoadmap", () => {
  it("is null while no roadmap exists (first-run state)", () => {
    assert.equal(deriveRoadmap(emptyLedger()), null);
  });

  it("composes milestone progress from each Boss's required-criteria state", () => {
    const contracts = [
      contract({ id: "boss-1", acceptanceCriteria: [criterion()] }),
      contract({ id: "boss-2", acceptanceCriteria: [criterion(), criterion({ id: "AC-2" })] }),
    ];
    let ledger = ledgerWith(contracts, { project: project() });
    // boss-1 accepted + its requirement satisfied -> CLEAR (score 1).
    ledger = withAcceptedContract(ledger, "boss-1", "2026-09-23T10:00:00.000Z");
    ledger = {
      ...ledger,
      evidence: [
        {
          id: "EV-1",
          contractId: "boss-1",
          contractRevision: 1,
          criterionId: "AC-1",
          requirementId: "REQ-1",
          sourceType: "LOG_INSPECTED",
          sourceName: "run.log",
          summary: "passed",
          finding: "PASS",
          reviewStatus: "ACCEPTED",
          recordedAt: "2026-09-23T10:01:00.000Z",
        },
      ],
    };

    const roadmap = deriveRoadmap(ledger);
    assert.ok(roadmap);
    const [first, second] = roadmap.milestones;
    assert.equal(first.state, "DONE", "its only Boss is clear, so the milestone is done");
    assert.equal(first.progress, 1);
    assert.equal(second.state, "ACTIVE", "the first not-DONE milestone is active");
    assert.equal(second.progress, 0, "boss-2 has no evidence yet");
    assert.equal(second.id, roadmap.activeMilestoneId);
    assert.equal(roadmap.progressPercent, 50, "1 of 2 Bosses fully through");
    assert.equal(roadmap.bossesDone, 1);
    assert.equal(roadmap.bossesTotal, 2);
  });

  it("is complete when every milestone's Bosses are clear", () => {
    let ledger = ledgerWith([contract({ id: "boss-1" }), contract({ id: "boss-2" })], {
      project: project(),
    });
    ledger = withAcceptedContract(ledger, "boss-1", "2026-09-23T10:00:00.000Z");
    ledger = withAcceptedContract(ledger, "boss-2", "2026-09-23T10:00:00.000Z");
    // Both contracts have one requirement that cannot be met without evidence,
    // so clear the bar the honest way: accepted satisfying evidence each.
    ledger = {
      ...ledger,
      evidence: [
        {
          id: "EV-1",
          contractId: "boss-1",
          contractRevision: 1,
          criterionId: "AC-1",
          requirementId: "REQ-1",
          sourceType: "LOG_INSPECTED",
          sourceName: "a.log",
          summary: "passed",
          finding: "PASS",
          reviewStatus: "ACCEPTED",
          recordedAt: "2026-09-23T10:01:00.000Z",
        },
        {
          id: "EV-2",
          contractId: "boss-2",
          contractRevision: 1,
          criterionId: "AC-1",
          requirementId: "REQ-1",
          sourceType: "LOG_INSPECTED",
          sourceName: "b.log",
          summary: "passed",
          finding: "PASS",
          reviewStatus: "ACCEPTED",
          recordedAt: "2026-09-23T10:02:00.000Z",
        },
      ],
    };

    const roadmap = deriveRoadmap(ledger);
    assert.ok(roadmap);
    assert.equal(roadmap.progressPercent, 100);
    assert.ok(roadmap.milestones.every((item) => item.state === "DONE"));
    assert.equal(roadmap.activeMilestoneId, undefined);
  });

  it("scores a partial Boss at its required-pass fraction", () => {
    const two = contract({
      acceptanceCriteria: [criterion(), criterion({ id: "AC-2" })],
    });
    const ledger = ledgerWith([two], { project: project() });
    const roadmap = deriveRoadmap(ledger);
    assert.ok(roadmap);
    assert.equal(roadmap.progressPercent, 0, "no pass yet, so 0 even with two criteria");
    assert.equal(roadmap.milestones[0].state, "ACTIVE");
  });

  it("carries the current Boss id through", () => {
    const ledger = ledgerWith([contract()], { project: project() });
    assert.equal(deriveRoadmap(ledger)?.currentBossId, "boss-1");
  });
});

describe("roadmap storage", () => {
  it("round-trips contracts and the project through storage", () => {
    const ledger = ledgerWith([contract()], { project: project() });
    const storage = memoryStorage();
    assert.equal(saveLedger(storage, ledger), true);
    const loaded = loadLedger(storage);
    assert.equal(loaded.contracts["boss-1"]?.objective, "Implement a bounded WACA-SE module");
    assert.equal(loaded.project?.goal, "复现 WACA 论文");
    assert.deepEqual(loaded.project?.milestones[0].bossIds, ["boss-1"]);
  });

  it("reads a payload written before the workbench existed", () => {
    const legacy = JSON.stringify({
      version: 1,
      evidence: [],
      accepted: {},
      contexts: {},
      incubations: {},
    });
    const loaded = loadLedger(memoryStorage(legacy));
    assert.deepEqual(loaded.contracts, {});
    assert.equal(loaded.project, undefined);
    assert.deepEqual(deriveRoadmap(loaded), null);
  });

  it("fails closed on a malformed project", () => {
    const malformed = JSON.stringify({ ...emptyLedger(), project: { goal: 42 } });
    assert.deepEqual(loadLedger(memoryStorage(malformed)), emptyLedger());
  });
});

describe("roadmap updates", () => {
  it("creates a one-milestone project with the first Boss", () => {
    const ledger = withNewProject(emptyLedger(), "复现 WACA", "boss-1", "2026-09-23T10:00:00.000Z");
    assert.equal(ledger.project?.goal, "复现 WACA");
    assert.deepEqual(ledger.project?.milestones[0].bossIds, ["boss-1"]);
    assert.equal(ledger.project?.currentBossId, "boss-1");
  });

  it("never overwrites an existing project", () => {
    const seeded = ledgerWith([], { project: project() });
    const ledger = withNewProject(seeded, "另一个目标", "boss-9", "2026-09-23T10:01:00.000Z");
    assert.equal(ledger.project?.goal, "复现 WACA 论文");
    assert.ok(!ledger.project.milestones.some((m) => m.bossIds.includes("boss-9")));
  });

  it("appends a new Boss to the first milestone that still has open work", () => {
    let ledger = ledgerWith([contract({ id: "boss-1" }), contract({ id: "boss-2" })], {
      project: project(),
    });
    // boss-1 (in M-1) is done; boss-9 should therefore join M-2.
    ledger = withAcceptedContract(ledger, "boss-1", "2026-09-23T10:00:00.000Z");
    ledger = {
      ...ledger,
      evidence: [
        {
          id: "EV-1",
          contractId: "boss-1",
          contractRevision: 1,
          criterionId: "AC-1",
          requirementId: "REQ-1",
          sourceType: "LOG_INSPECTED",
          sourceName: "a.log",
          summary: "passed",
          finding: "PASS",
          reviewStatus: "ACCEPTED",
          recordedAt: "2026-09-23T10:01:00.000Z",
        },
      ],
    };

    const updated = withBossInProject(ledger, "boss-2b", undefined, "2026-09-23T10:05:00.000Z");
    const m1 = updated.project?.milestones.find((item) => item.id === "M-1");
    const m2 = updated.project?.milestones.find((item) => item.id === "M-2");
    assert.ok(!m1?.bossIds.includes("boss-2b"), "the completed milestone is not the target");
    assert.ok(m2?.bossIds.includes("boss-2b"));
    assert.equal(updated.project?.currentBossId, "boss-2b", "a newly added Boss opens");
  });

  it("ignores a Boss that is already on the roadmap", () => {
    const seeded = ledgerWith([contract()], { project: project() });
    const updated = withBossInProject(seeded, "boss-1", "M-2", "2026-09-23T10:05:00.000Z");
    assert.deepEqual(updated.project?.milestones[0].bossIds, ["boss-1"]);
    assert.deepEqual(updated.project?.milestones[1].bossIds, ["boss-2"]);
  });

  it("switches the open Boss without touching the structure", () => {
    const seeded = ledgerWith([], { project: project() });
    const updated = withCurrentBoss(seeded, "boss-2");
    assert.equal(updated.project?.currentBossId, "boss-2");
    assert.equal(updated.project?.revision, 1, "switching is not a roadmap revision");
  });
});

describe("nextActionSummary", () => {
  it("asks for contract acceptance on a fresh Boss", () => {
    const ledger = ledgerWith([contract()], { project: project() });
    assert.equal(nextActionSummary(ledger, "boss-1"), "接受合同，开始记录证据");
  });

  it("points at the missing criterion while evidence is outstanding", () => {
    let ledger = ledgerWith([contract()], { project: project() });
    ledger = withAcceptedContract(ledger, "boss-1", "2026-09-23T10:00:00.000Z");
    assert.match(nextActionSummary(ledger, "boss-1"), /AC-1/);
  });

  it("says so when the contract is missing entirely", () => {
    assert.match(nextActionSummary(emptyLedger(), "ghost"), /合同缺失/);
  });
});

describe("milestone states", () => {
  it("marks a later milestone as active once it carries real progress", () => {
    // The demo project has this exact shape: the first milestone is untouched
    // while the second one already sits at 2/3. Calling the second one
    // "not started" next to a 67% bar would be a lie.
    let ledger = ledgerWith(
      [
        contract({ id: "boss-1", acceptanceCriteria: [criterion(), criterion({ id: "AC-2" })] }),
      ],
      {
        project: {
          goal: "g",
          milestones: [
            { id: "M-1", title: "first", bossIds: ["boss-0"] },
            { id: "M-2", title: "second", bossIds: ["boss-1"] },
          ],
          currentBossId: "boss-1",
          revision: 1,
          updatedAt: "2026-09-23T10:00:00.000Z",
        } as Ledger["project"],
      },
    );
    ledger = withAcceptedContract(ledger, "boss-1", "2026-09-23T10:00:00.000Z");
    ledger = {
      ...ledger,
      evidence: [
        {
          id: "EV-1",
          contractId: "boss-1",
          contractRevision: 1,
          criterionId: "AC-1",
          requirementId: "REQ-1",
          sourceType: "LOG_INSPECTED",
          sourceName: "a.log",
          summary: "passed",
          finding: "PASS",
          reviewStatus: "ACCEPTED",
          recordedAt: "2026-09-23T10:01:00.000Z",
        },
      ],
    };

    const roadmap = deriveRoadmap(ledger);
    assert.ok(roadmap);
    const [first, second] = roadmap.milestones;
    assert.equal(first.state, "ACTIVE", "the first not-DONE milestone is active");
    assert.equal(second.state, "ACTIVE", "real progress outranks the empty first slot");
    assert.equal(second.progress, 0.5);
  });
});

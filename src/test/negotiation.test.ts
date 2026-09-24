/**
 * Boss Negotiation tests (#18 §2).
 *
 * The trust shape under test: a proposal is advice that never touches storage
 * until it is applied, and applying it is safe by construction — no contract
 * or evidence is ever deleted, an accepted proposal is exactly one new plan
 * revision with its reason, diff and progress impact recorded.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AcceptanceCriterion, BossContract } from "../lib/contracts";
import {
  Ledger,
  emptyLedger,
  withAcceptedContract,
  withContract,
  withNewProject,
} from "../lib/failure-ledger";
import {
  applyProposalWith,
  draftProposal,
  previewImpact,
} from "../lib/negotiation";

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

function ledgerWith(contracts: BossContract[]): Ledger {
  let ledger = emptyLedger();
  for (const item of contracts) ledger = withContract(ledger, item);
  ledger = withNewProject(ledger, "复现 WACA", contracts[0]?.id ?? "boss-1", "2026-09-23T10:00:00.000Z");
  return ledger;
}

const REASON = "训练阶段比预想难，先集中把数据审计做完。";
const AT = "2026-09-23T11:00:00.000Z";

describe("draftProposal", () => {
  it("composes a DEFER proposal with a beginner-readable summary", () => {
    const ledger = ledgerWith([contract(), contract({ id: "boss-2", objective: "Audit the dataset" })]);
    const proposal = draftProposal(
      { kind: "DEFER_BOSS", contractId: "boss-1" },
      REASON,
      ledger,
      "np-1",
      AT,
    );
    assert.ok(!("error" in proposal));
    if ("error" in proposal) return;
    assert.equal(proposal.changes.length, 1);
    assert.match(proposal.changes[0].summary, /移到最后一个里程碑/);
    assert.match(proposal.note, /总进度会先下降/);
    assert.equal(proposal.generator, "rule-based.v2");
    assert.equal(proposal.request, REASON);
  });

  it("refuses to defer a Boss that was not chosen", () => {
    const proposal = draftProposal({ kind: "DEFER_BOSS" }, REASON, ledgerWith([contract()]), "np-1", AT);
    assert.ok("error" in proposal);
  });

  it("refuses to remove the last remaining milestone", () => {
    const ledger = ledgerWith([contract()]);
    const proposal = draftProposal(
      { kind: "REMOVE_MILESTONE", milestoneId: ledger.project?.milestones[0].id },
      REASON,
      ledger,
      "np-1",
      AT,
    );
    assert.ok("error" in proposal);
  });

  it("refuses an unnamed new milestone and a no-op move", () => {
    const ledger = ledgerWith([contract()]);
    const unnamed = draftProposal({ kind: "ADD_MILESTONE", title: "  " }, REASON, ledger, "np-1", AT);
    assert.ok("error" in unnamed);
    const milestoneId = ledger.project?.milestones[0].id;
    const noOp = draftProposal(
      { kind: "MOVE_BOSS", contractId: "boss-1", milestoneId },
      REASON,
      ledger,
      "np-1",
      AT,
    );
    assert.ok("error" in noOp);
  });

  it("previews a duplicate replacement as two explicit atomic changes", () => {
    const ledger = ledgerWith([contract()]);
    const milestoneId = ledger.project?.milestones[0].id;
    const proposal = draftProposal(
      {
        kind: "REPLACE_BOSS",
        contractId: "boss-1",
        milestoneId,
        nextGoal: "跑通数据加载、模型前向和一次训练迭代",
      },
      "取消一个重复，新增最小可运行示例吧",
      ledger,
      "np-replace",
      AT,
    );
    assert.ok(!("error" in proposal));
    if ("error" in proposal) return;
    assert.equal(proposal.changes.length, 2);
    assert.match(proposal.changes[0].summary, /暂停重复/);
    assert.match(proposal.changes[1].summary, /生成一个新的 Boss/);
    assert.match(proposal.note, /生成失败时原计划不会改变/);
  });
});

describe("applyProposalWith", () => {
  it("defers a Boss without deleting its contract or evidence", () => {
    let ledger = ledgerWith([contract(), contract({ id: "boss-2", objective: "Audit the dataset" })]);
    ledger = withAcceptedContract(ledger, "boss-1", "2026-09-23T10:30:00.000Z");
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
          recordedAt: "2026-09-23T10:31:00.000Z",
        },
      ],
    };
    const proposal = draftProposal(
      { kind: "DEFER_BOSS", contractId: "boss-1" },
      REASON,
      ledger,
      "np-1",
      AT,
    );
    assert.ok(!("error" in proposal));
    if ("error" in proposal) return;

    const applied = applyProposalWith(ledger, proposal, { kind: "DEFER_BOSS", contractId: "boss-1" }, AT);

    // The Boss moved to the last milestone...
    const milestones = applied.project?.milestones ?? [];
    assert.ok(
      milestones.every((item) => !item.bossIds.includes("boss-1") || item.id === milestones.at(-1)?.id),
      "boss-1 lives only in the last milestone",
    );
    // ...but nothing was destroyed:
    assert.ok(applied.contracts["boss-1"], "the contract survives");
    assert.equal(applied.evidence.length, 1, "the evidence survives");
    assert.equal(applied.accepted["boss-1"], "2026-09-23T10:30:00.000Z", "acceptance survives");
    // ...and the acceptance is recorded as one new revision with the story:
    assert.equal(applied.project?.revision, (ledger.project?.revision ?? 0) + 1);
    const history = applied.project?.history ?? [];
    assert.equal(history[0].reason, REASON);
    assert.equal(history[0].changes.length, 1);
    assert.equal(typeof history[0].progressBefore, "number");
    assert.equal(typeof history[0].progressAfter, "number");
  });

  it("re-homes the Bosses when a milestone is removed", () => {
    // A two-milestone project where both Bosses live in M-1; removing M-1
    // must re-home them into M-2, not orphan them.
    let ledger = ledgerWith([
      contract({ id: "boss-1" }),
      contract({ id: "boss-2", objective: "Audit the dataset" }),
    ]);
    ledger = {
      ...ledger,
      project: {
        ...ledger.project!,
        milestones: [
          { id: "M-1", title: "first", bossIds: ["boss-1", "boss-2"] },
          { id: "M-2", title: "second", bossIds: [] },
        ],
      },
    };

    const proposal = draftProposal(
      { kind: "REMOVE_MILESTONE", milestoneId: "M-1" },
      REASON,
      ledger,
      "np-2",
      AT,
    );
    assert.ok(!("error" in proposal));
    if ("error" in proposal) return;

    const applied = applyProposalWith(ledger, proposal, { kind: "REMOVE_MILESTONE", milestoneId: "M-1" }, AT);
    const milestones = applied.project?.milestones ?? [];
    assert.equal(milestones.length, 1, "M-1 is gone");
    assert.equal(milestones[0].id, "M-2");
    assert.deepEqual(
      [...milestones[0].bossIds].sort(),
      ["boss-1", "boss-2"],
      "both Bosses were re-homed, not deleted",
    );
    assert.ok(applied.contracts["boss-1"] && applied.contracts["boss-2"]);
  });

  it("updates the current Boss when it is dropped from the roadmap", () => {
    const ledger = ledgerWith([contract(), contract({ id: "boss-2", objective: "Audit the dataset" })]);
    const proposal = draftProposal(
      { kind: "DROP_BOSS", contractId: "boss-1" },
      REASON,
      ledger,
      "np-1",
      AT,
    );
    assert.ok(!("error" in proposal));
    if ("error" in proposal) return;

    const applied = applyProposalWith(ledger, proposal, { kind: "DROP_BOSS", contractId: "boss-1" }, AT);
    const onRoadmap = (applied.project?.milestones ?? []).some((item) =>
      item.bossIds.includes("boss-1"),
    );
    assert.equal(onRoadmap, false, "boss-1 is off the roadmap");
    assert.ok(applied.contracts["boss-1"], "but its contract is kept in the ledger");
    assert.notEqual(applied.project?.currentBossId, "boss-1", "the open Boss moves off a dropped one");
  });

  it("atomically replaces a duplicate with an already generated Boss in one revision", () => {
    let ledger = ledgerWith([contract()]);
    ledger = withContract(
      ledger,
      contract({ id: "boss-minimal-run", objective: "跑通最小可运行示例" }),
    );
    const milestoneId = ledger.project?.milestones[0].id;
    const input = {
      kind: "REPLACE_BOSS" as const,
      contractId: "boss-1",
      milestoneId,
      nextGoal: "跑通数据加载、模型前向和一次训练迭代",
    };
    const proposal = draftProposal(input, "取消一个重复，新增最小可运行示例吧", ledger, "np-3", AT);
    assert.ok(!("error" in proposal));
    if ("error" in proposal) return;

    const applied = applyProposalWith(
      ledger,
      proposal,
      { ...input, replacementContractId: "boss-minimal-run" },
      AT,
    );
    const bossIds = applied.project?.milestones[0].bossIds ?? [];
    assert.deepEqual(bossIds, ["boss-minimal-run"]);
    assert.equal(applied.project?.currentBossId, "boss-minimal-run");
    assert.equal(applied.project?.revision, (ledger.project?.revision ?? 0) + 1);
    assert.equal(applied.project?.history?.[0].changes.length, 2);
    assert.ok(applied.contracts["boss-1"], "paused contract is preserved");
  });

  it("does nothing without a project", () => {
    const ledger = ledgerWith([contract()]);
    const proposal = draftProposal(
      { kind: "DEFER_BOSS", contractId: "boss-1" },
      REASON,
      { ...ledger, project: undefined },
      "np-1",
      AT,
    );
    assert.ok("error" in proposal);
  });
});

describe("previewImpact", () => {
  it("shows before/after progress without touching the ledger", () => {
    const ledger = ledgerWith([
      contract(),
      contract({ id: "boss-2", objective: "Audit the dataset" }),
    ]);
    const proposal = draftProposal(
      { kind: "DROP_BOSS", contractId: "boss-1" },
      REASON,
      ledger,
      "np-1",
      AT,
    );
    assert.ok(!("error" in proposal));
    if ("error" in proposal) return;

    const impact = previewImpact(ledger, proposal, { kind: "DROP_BOSS", contractId: "boss-1" });
    assert.ok(impact);
    assert.equal(impact.progressBefore, 0);
    assert.equal(impact.progressAfter, 0);
    assert.match(impact.evidenceNote, /不会被删除/);
    // The real ledger is untouched by a preview:
    assert.equal(ledger.project?.revision, 1);
    assert.deepEqual(ledger.project?.history, undefined);
  });

  it("notes a state change when deferring finishes nothing but reorders", () => {
    const ledger = ledgerWith([contract(), contract({ id: "boss-2", objective: "Audit the dataset" })]);
    const proposal = draftProposal(
      { kind: "DEFER_BOSS", contractId: "boss-1" },
      REASON,
      ledger,
      "np-1",
      AT,
    );
    assert.ok(!("error" in proposal));
    if ("error" in proposal) return;

    const impact = previewImpact(ledger, proposal, { kind: "DEFER_BOSS", contractId: "boss-1" });
    assert.ok(impact);
    assert.equal(impact.progressBefore, impact.progressAfter, "reordering does not change totals");
  });
});

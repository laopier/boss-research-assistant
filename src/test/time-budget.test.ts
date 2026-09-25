/**
 * Time budget tests (Issue #23).
 *
 * The numbers under test are the ones a beginner will read and act on: the
 * route total, the overshoot against the time they say they have, and how many
 * daily sessions one step needs. The storage cases matter just as much — a bad
 * budget must cost the budget and nothing else, because `loadLedger` discards
 * the entire local research record on any other malformed key.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BossContract, ProjectPlanDraft } from "../lib/contracts";
import {
  LEDGER_STORAGE_KEY,
  Ledger,
  LedgerStorage,
  emptyLedger,
  loadLedger,
  saveLedger,
  withAcceptedContract,
  withContract,
  withNewProject,
  withTimeBudget,
  withoutTimeBudget,
} from "../lib/failure-ledger";
import { deriveRoadmap } from "../lib/roadmap";
import {
  MAX_DAILY_MINUTES,
  MAX_PLANNED_DAYS,
  overBudgetMinutes,
  sanitizeTimeBudget,
  sumRouteMinutes,
  totalBudgetMinutes,
  workSessions,
} from "../lib/time-budget";

const AT = "2026-09-25T10:00:00.000Z";

function contract(overrides: Partial<BossContract> = {}): BossContract {
  return {
    schemaVersion: "boss-contract.v0",
    recordKind: "LIVE",
    revision: 1,
    id: "boss-1",
    title: "读懂一篇论文",
    rawGoal: "一周内读懂一篇论文并做 5 分钟汇报",
    objective: "产出结构化阅读笔记",
    deadline: null,
    deliverables: [{ id: "DEL-1", description: "阅读笔记", status: "NOT_STARTED" }],
    acceptanceCriteria: [
      {
        id: "AC-1",
        description: "笔记包含四个小节",
        required: true,
        status: "UNKNOWN",
        evidenceRequirements: [
          {
            id: "REQ-1",
            description: "笔记文件本身",
            acceptedSourceTypes: ["ARTIFACT_INSPECTED"],
            minimumCount: 1,
          },
        ],
      },
    ],
    scopeGuard: { inScope: ["阅读"], outOfScope: ["复现"], newBossPolicy: "CREATE_NEW_BOSS" },
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

/** The route from the issue: 60 + 60 + 120 + 60 + 90 + 60 = 450 minutes. */
function sixStepPlan(): ProjectPlanDraft {
  return {
    schemaVersion: "project-plan.v1",
    milestones: [
      {
        id: "M-1",
        title: "准备",
        steps: [
          { id: "S-1", title: "选定论文", objective: "确定读哪篇", estimatedMinutes: 60 },
          { id: "S-2", title: "通读全文", objective: "读一遍", estimatedMinutes: 60 },
          { id: "S-3", title: "精读方法", objective: "读懂方法", estimatedMinutes: 120 },
        ],
      },
      {
        id: "M-2",
        title: "输出",
        steps: [
          { id: "S-4", title: "整理笔记", objective: "写出笔记", estimatedMinutes: 60 },
          { id: "S-5", title: "准备汇报", objective: "做 5 分钟汇报", estimatedMinutes: 90 },
          { id: "S-6", title: "演练", objective: "练一遍", estimatedMinutes: 60 },
        ],
      },
    ],
    assumptions: ["初始估算"],
  };
}

function projectLedger(): Ledger {
  let ledger = withContract(emptyLedger(), contract());
  ledger = withNewProject(ledger, "一周内读懂一篇论文并做 5 分钟汇报", "boss-1", AT, sixStepPlan());
  return withAcceptedContract(ledger, "boss-1", AT);
}

function fakeStorage(seed?: unknown): LedgerStorage {
  const map = new Map<string, string>();
  if (seed !== undefined) map.set(LEDGER_STORAGE_KEY, JSON.stringify(seed));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("time budget arithmetic", () => {
  it("sums the whole route: 60/60/120/60/90/60 = 450", () => {
    const roadmap = deriveRoadmap(projectLedger());
    assert.equal(roadmap?.plannedMinutes.total, 450);
    assert.equal(roadmap?.plannedMinutes.estimable, true);
  });

  it("reports a 30 minute overshoot for a 420 minute budget against a 450 minute route", () => {
    assert.equal(totalBudgetMinutes({ plannedDays: 7, dailyMinutes: 60 }), 420);
    assert.equal(overBudgetMinutes(450, { plannedDays: 7, dailyMinutes: 60 }), 30);
  });

  it("does not warn when the route fits the budget exactly, or sits below it", () => {
    assert.equal(overBudgetMinutes(420, { plannedDays: 7, dailyMinutes: 60 }), 0);
    assert.equal(overBudgetMinutes(300, { plannedDays: 7, dailyMinutes: 60 }), 0);
  });

  it("never invents a warning from a missing budget", () => {
    assert.equal(totalBudgetMinutes(undefined), undefined);
    assert.equal(overBudgetMinutes(450, undefined), 0);
  });

  it("asks for two work sessions for a 120 minute step in a 60 minute day", () => {
    assert.equal(workSessions(120, 60), 2);
    assert.equal(workSessions(90, 60), 2);
    assert.equal(workSessions(60, 60), 1);
    assert.equal(workSessions(120, 0), 0);
  });
});

describe("budget validation", () => {
  it("accepts the edges and nothing outside them", () => {
    assert.deepEqual(sanitizeTimeBudget({ plannedDays: 1, dailyMinutes: 1 }), {
      plannedDays: 1,
      dailyMinutes: 1,
    });
    assert.deepEqual(
      sanitizeTimeBudget({ plannedDays: MAX_PLANNED_DAYS, dailyMinutes: MAX_DAILY_MINUTES }),
      { plannedDays: MAX_PLANNED_DAYS, dailyMinutes: MAX_DAILY_MINUTES },
    );
  });

  it("rejects zero, negatives, fractions, strings, NaN and out-of-range values", () => {
    for (const bad of [
      undefined,
      null,
      "7 days",
      7,
      [],
      {},
      { plannedDays: 0, dailyMinutes: 60 },
      { plannedDays: 7, dailyMinutes: 0 },
      { plannedDays: -1, dailyMinutes: 60 },
      { plannedDays: 7, dailyMinutes: -60 },
      { plannedDays: 7.5, dailyMinutes: 60 },
      { plannedDays: 7, dailyMinutes: 60.5 },
      { plannedDays: "7", dailyMinutes: 60 },
      { plannedDays: NaN, dailyMinutes: 60 },
      { plannedDays: Infinity, dailyMinutes: 60 },
      { plannedDays: MAX_PLANNED_DAYS + 1, dailyMinutes: 60 },
      { plannedDays: 7, dailyMinutes: MAX_DAILY_MINUTES + 1 },
    ]) {
      assert.equal(sanitizeTimeBudget(bad), undefined, `expected rejection: ${JSON.stringify(bad)}`);
    }
  });
});

describe("route minutes", () => {
  it("counts each planned step exactly once", () => {
    const roadmap = deriveRoadmap(projectLedger());
    const stepCount = roadmap?.milestones.reduce((sum, item) => sum + item.plannedSteps.length, 0);
    assert.equal(stepCount, 6);
    assert.equal(roadmap?.plannedMinutes.total, 450);
  });

  it("reports a legacy project as not estimable instead of counting placeholders", () => {
    // No `steps`: deriveRoadmap substitutes 1 minute per Boss, which is a
    // placeholder and must never be shown as a real total.
    assert.deepEqual(sumRouteMinutes([{ steps: undefined }]), { total: 0, estimable: false });
    assert.deepEqual(sumRouteMinutes([]), { total: 0, estimable: false });
    assert.deepEqual(sumRouteMinutes([{ steps: [{ estimatedMinutes: 60 }] }]), {
      total: 60,
      estimable: true,
    });
  });

  it("recomputes after the route changes", () => {
    const before = deriveRoadmap(projectLedger());
    assert.equal(before?.plannedMinutes.total, 450);

    const shorter = projectLedger();
    const replanned: Ledger = {
      ...shorter,
      project: {
        ...shorter.project!,
        milestones: shorter.project!.milestones.map((milestone) => ({
          ...milestone,
          steps: milestone.steps?.filter((step) => step.id !== "S-3"),
        })),
      },
    };
    const after = deriveRoadmap(replanned);
    assert.equal(after?.plannedMinutes.total, 330);
  });
});

describe("storing a budget", () => {
  it("writes only the budget and leaves revision, history and progress alone", () => {
    const before = projectLedger();
    const progressBefore = deriveRoadmap(before)?.progressPercent;
    const revisionBefore = before.project?.revision;

    const after = withTimeBudget(before, { plannedDays: 7, dailyMinutes: 60 });

    assert.deepEqual(after.project?.timeBudget, { plannedDays: 7, dailyMinutes: 60 });
    assert.equal(after.project?.revision, revisionBefore);
    assert.deepEqual(after.project?.history, before.project?.history);
    assert.equal(deriveRoadmap(after)?.progressPercent, progressBefore);
    assert.deepEqual(after.contracts, before.contracts);
    assert.deepEqual(after.evidence, before.evidence);
  });

  it("refuses an invalid or half-filled budget instead of overwriting the saved one", () => {
    const saved = withTimeBudget(projectLedger(), { plannedDays: 7, dailyMinutes: 60 });
    for (const bad of [
      { plannedDays: 0, dailyMinutes: 60 },
      { plannedDays: 7, dailyMinutes: 0 },
      { plannedDays: 7.5, dailyMinutes: 60 },
      { plannedDays: 7, dailyMinutes: MAX_DAILY_MINUTES + 1 },
    ] as const) {
      const next = withTimeBudget(saved, bad);
      assert.equal(next, saved, "an invalid budget must not change the ledger");
      assert.deepEqual(next.project?.timeBudget, { plannedDays: 7, dailyMinutes: 60 });
    }
  });

  it("clears only the budget", () => {
    const saved = withTimeBudget(projectLedger(), { plannedDays: 7, dailyMinutes: 60 });
    const cleared = withoutTimeBudget(saved);
    assert.equal(Object.hasOwn(cleared.project!, "timeBudget"), false);
    assert.equal(cleared.project?.goal, saved.project?.goal);
    assert.equal(cleared.project?.revision, saved.project?.revision);
    assert.deepEqual(cleared.project?.milestones, saved.project?.milestones);
    assert.deepEqual(cleared.contracts, saved.contracts);
  });
});

describe("storage round-trip", () => {
  it("keeps a saved budget across a reload", () => {
    const storage = fakeStorage();
    saveLedger(storage, withTimeBudget(projectLedger(), { plannedDays: 7, dailyMinutes: 60 }));
    const reloaded = loadLedger(storage);
    assert.deepEqual(reloaded.project?.timeBudget, { plannedDays: 7, dailyMinutes: 60 });
    assert.equal(reloaded.project?.goal, "一周内读懂一篇论文并做 5 分钟汇报");
  });

  it("removes a cleared budget for good", () => {
    const storage = fakeStorage();
    const saved = withTimeBudget(projectLedger(), { plannedDays: 7, dailyMinutes: 60 });
    saveLedger(storage, withoutTimeBudget(saved));
    const reloaded = loadLedger(storage);
    assert.equal(Object.hasOwn(reloaded.project!, "timeBudget"), false);
    assert.equal(reloaded.project?.goal, "一周内读懂一篇论文并做 5 分钟汇报");
  });

  it("loads an old project that has no budget at all", () => {
    const storage = fakeStorage();
    saveLedger(storage, projectLedger());
    const reloaded = loadLedger(storage);
    assert.equal(Object.hasOwn(reloaded.project!, "timeBudget"), false);
    assert.equal(deriveRoadmap(reloaded)?.plannedMinutes.total, 450);
  });

  it("drops a corrupt budget and keeps every other research record", () => {
    const saved = withTimeBudget(projectLedger(), { plannedDays: 7, dailyMinutes: 60 });
    const corrupt = JSON.parse(JSON.stringify(saved)) as Ledger;
    (corrupt.project as unknown as Record<string, unknown>).timeBudget = {
      plannedDays: "七天",
      dailyMinutes: 60,
    };

    const storage = fakeStorage(corrupt);
    const reloaded = loadLedger(storage);

    // The key is gone, not merely undefined.
    assert.equal(Object.hasOwn(reloaded.project!, "timeBudget"), false);
    assert.equal(reloaded.project?.goal, saved.project?.goal);
    assert.equal(reloaded.project?.revision, saved.project?.revision);
    assert.deepEqual(reloaded.project?.milestones, saved.project?.milestones);
    assert.deepEqual(Object.keys(reloaded.contracts), Object.keys(saved.contracts));
    assert.equal(deriveRoadmap(reloaded)?.plannedMinutes.total, 450);
  });

  it("still fails closed on a malformed contract, as before", () => {
    const saved = projectLedger();
    const corrupt = JSON.parse(JSON.stringify(saved)) as Ledger;
    (corrupt.contracts as unknown as Record<string, unknown>)["boss-1"] = { id: "boss-1" };
    const reloaded = loadLedger(fakeStorage(corrupt));
    assert.deepEqual(reloaded, emptyLedger());
  });
});

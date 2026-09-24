import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BossContract } from "../lib/contracts";
import { createMockProjectPlan, parseProjectPlan } from "../lib/project-plan";

const first = {
  title: "整理论文复现范围",
  objective: "输出一份可评审的复现启动说明",
  estimatedMinutes: 120,
} as BossContract;

describe("project plan boundary", () => {
  it("creates a full provisional route whose first step matches the first Boss", () => {
    const plan = createMockProjectPlan("我想复现这篇论文", first);
    assert.equal(plan.schemaVersion, "project-plan.v1");
    assert.ok(plan.milestones.length >= 2);
    assert.ok(plan.milestones.flatMap((item) => item.steps).length >= 4);
    assert.equal(plan.milestones[0].steps[0].objective, first.objective);
    assert.deepEqual(parseProjectPlan(plan), plan);
  });

  it("rejects duplicate ids, missing future work, and invalid effort estimates", () => {
    const plan = createMockProjectPlan("我想复现这篇论文", first);
    const duplicate = structuredClone(plan);
    duplicate.milestones[1].steps[0].id = duplicate.milestones[0].steps[0].id;
    assert.equal(parseProjectPlan(duplicate), null);

    const tooShort = structuredClone(plan);
    tooShort.milestones = tooShort.milestones.slice(0, 2);
    assert.equal(parseProjectPlan(tooShort), null, "a two-step outline is not a whole-project route");

    const invalidEstimate = structuredClone(plan);
    invalidEstimate.milestones[0].steps[0].estimatedMinutes = 0;
    assert.equal(parseProjectPlan(invalidEstimate), null);
  });
});

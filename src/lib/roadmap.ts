import {
  ResearchProject,
  deriveBoss,
} from "./failure-ledger";
import { Ledger } from "./failure-ledger";
import { deriveProgress } from "./progress";

/**
 * Project-level roadmap derivation (#18 §1).
 *
 * The unit of progress is a Boss's required criteria: a cleared Boss scores 1,
 * an open Boss scores its required-pass fraction. A milestone's progress is
 * the composition of its Bosses' scores, and the project's progress is the
 * composition of its milestones weighted by how many Bosses they contain —
 * which is the same as the plain Boss average, but computed *through* the
 * roadmap structure so every intermediate number is shown and explainable,
 * which is what "not a naive average" means here: no milestone, no Boss and no
 * weight is hidden inside one percentage.
 */
export interface MilestoneDerivation {
  id: string;
  title: string;
  state: "DONE" | "ACTIVE" | "PENDING";
  /** Fraction 0..1: composition of its Bosses' required-criteria scores. */
  progress: number;
  bossesDone: number;
  bossesTotal: number;
  bossIds: string[];
  plannedSteps: Array<{
    id: string;
    title: string;
    objective: string;
    estimatedMinutes: number;
    contractId?: string;
    state: "DONE" | "ACTIVE" | "PLANNED";
  }>;
  /** Sum of the planned effort used in the global weighted calculation. */
  weightMinutes: number;
}

export interface RoadmapDerivation {
  goal: string;
  revision: number;
  /** Percent 0..100 across the whole project, derived as described above. */
  progressPercent: number;
  bossesDone: number;
  bossesTotal: number;
  milestones: MilestoneDerivation[];
  /** First milestone that is not DONE, or undefined when everything is. */
  activeMilestoneId: string | undefined;
  currentBossId: string | undefined;
}

export function deriveRoadmap(ledger: Ledger): RoadmapDerivation | null {
  const project: ResearchProject | undefined = ledger.project;
  if (!project) return null;

  const milestones: MilestoneDerivation[] = project.milestones.map((milestone) => {
    const plannedSteps = milestone.steps?.map((step) => {
      const score = step.contractId ? bossScore(ledger, step.contractId) : 0;
      return {
        ...step,
        state: (score >= 1 ? "DONE" : step.contractId ? "ACTIVE" : "PLANNED") as
          | "DONE"
          | "ACTIVE"
          | "PLANNED",
      };
    }) ?? milestone.bossIds.map((contractId) => ({
      id: contractId,
      title: ledger.contracts[contractId]?.title ?? contractId,
      objective: ledger.contracts[contractId]?.objective ?? contractId,
      estimatedMinutes: 1,
      contractId,
      state: (isBossCleared(ledger, contractId) ? "DONE" : "ACTIVE") as "DONE" | "ACTIVE",
    }));
    const bossesDone = plannedSteps.filter((step) => step.state === "DONE").length;
    const weightMinutes = plannedSteps.reduce((sum, step) => sum + step.estimatedMinutes, 0);
    const progress = weightMinutes === 0
      ? 0
      : plannedSteps.reduce(
          (sum, step) => sum + (step.contractId ? bossScore(ledger, step.contractId) : 0) * step.estimatedMinutes,
          0,
        ) / weightMinutes;
    return {
      id: milestone.id,
      title: milestone.title,
      bossesDone,
      bossesTotal: plannedSteps.length,
      progress,
      bossIds: milestone.bossIds,
      plannedSteps,
      weightMinutes,
      state: "PENDING",
    };
  });

  // State assignment: a milestone is DONE when all of its Bosses are; the
  // first not-DONE milestone is the active one, and so is any later milestone
  // that already carries progress (the user may work ahead of the order —
  // calling that "not started" while showing 67% would be a lie).
  let activeAssigned = false;
  for (const milestone of milestones) {
    if (milestone.bossesTotal > 0 && milestone.bossesDone === milestone.bossesTotal) {
      milestone.state = "DONE";
    } else if (!activeAssigned || milestone.progress > 0) {
      milestone.state = "ACTIVE";
      activeAssigned = true;
    }
  }

  const bossesTotal = milestones.reduce((sum, item) => sum + item.bossesTotal, 0);
  const bossesDone = milestones.reduce((sum, item) => sum + item.bossesDone, 0);
  const totalWeight = milestones.reduce((sum, item) => sum + item.weightMinutes, 0);
  const progressPercent =
    totalWeight === 0
      ? 0
      : Math.round(
          (milestones.reduce(
            (sum, item) => sum + item.progress * item.weightMinutes,
            0,
          ) /
            totalWeight) *
            100,
        );

  return {
    goal: project.goal,
    revision: project.revision,
    progressPercent,
    bossesDone,
    bossesTotal,
    milestones,
    activeMilestoneId: milestones.find((item) => item.state === "ACTIVE")?.id,
    currentBossId: project.currentBossId,
  };
}

/** The next outlined step that has not yet been expanded into a Boss contract. */
export function nextPlannedStep(project: ResearchProject) {
  for (const milestone of project.milestones) {
    const step = milestone.steps?.find((item) => !item.contractId);
    if (step) return { milestoneId: milestone.id, milestoneTitle: milestone.title, step };
  }
  return undefined;
}

function isBossCleared(ledger: Ledger, contractId: string): boolean {
  const contract = ledger.contracts[contractId];
  if (!contract) return false;
  return deriveBoss(contract, recordsOf(ledger, contractId), Boolean(ledger.accepted[contractId])).status === "CLEAR";
}

/** Cleared = full score; otherwise the required-pass fraction. */
function bossScore(ledger: Ledger, contractId: string): number {
  const contract = ledger.contracts[contractId];
  if (!contract) return 0;
  const boss = deriveBoss(contract, recordsOf(ledger, contractId), Boolean(ledger.accepted[contractId]));
  if (boss.status === "CLEAR") return 1;
  if (boss.requiredTotal === 0) return 0;
  return boss.requiredPassed / boss.requiredTotal;
}

/**
 * deriveBoss takes the records of ONE contract — unlike the page, which
 * pre-filters. Forgetting the filter let one Boss's evidence pad another's
 * progress (caught by the composition test: boss-2 scored 0.5 off boss-1's
 * accepted evidence).
 */
function recordsOf(ledger: Ledger, contractId: string) {
  return ledger.evidence.filter((item) => item.contractId === contractId);
}

/** One line for a workbench card: what the user should do next on this Boss. */
export function nextActionSummary(ledger: Ledger, contractId: string): string {
  const contract = ledger.contracts[contractId];
  if (!contract) return "该 Boss 的合同缺失，无法推导下一步。";
  const accepted = Boolean(ledger.accepted[contractId]);
  const progress = deriveProgress(contract, ledger, accepted);
  switch (progress.nextAction.kind) {
    case "ACCEPT_CONTRACT":
      return "接受合同，开始记录证据";
    case "ADVANCE_PROJECT":
      return "当前阶段已通过，继续生成下一阶段 Boss";
    case "INCUBATE_FAILURE":
      return `存在未解决的失败（${progress.nextAction.failure.evidence.criterionId}），可孵化下一 Boss`;
    case "SUBMIT_EVIDENCE":
      return `为 ${progress.nextAction.missing.criterionId} 补充 ${progress.nextAction.missing.need - progress.nextAction.missing.have} 条证据`;
    case "REVISE_CONTRACT":
      return "合同缺少验收标准，需要协商补充";
    case "RESOLVE_BLOCKER":
      return `先解除阻塞项 ${progress.nextAction.blocker.id}`;
  }
}

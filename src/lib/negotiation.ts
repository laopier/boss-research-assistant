import {
  Ledger,
  PlanRevision,
  ResearchProject,
} from "./failure-ledger";
import { deriveRoadmap } from "./roadmap";

/**
 * Boss Negotiation (#18 §2): the plan changes only through an explicit,
 * previewed, user-accepted proposal.
 *
 * The trust shape is the one evidence review established: `draftProposal`
 * produces ADVICE that lives in component state, `applyProposal` is the only
 * path to storage, and it is called only from the user's accept action. A
 * proposal therefore cannot move the roadmap, and neither can anything that
 * is not an accepted proposal.
 *
 * `draftProposal` remains deterministic after the negotiation chat has turned
 * free-form intent into a validated structured input. The chat can ask
 * clarifying questions, but only this exact input plus explicit user
 * acceptance can reach `applyProposalWith`.
 */

export type NegotiationKind =
  /** 把一个 Boss 挪到更晚的里程碑（延期/降级）。 */
  | "DEFER_BOSS"
  /** 把一个 Boss 挪到指定里程碑（调整顺序/替换当前安排）。 */
  | "MOVE_BOSS"
  /** 新增一个空里程碑（新阶段）。 */
  | "ADD_MILESTONE"
  /** 删除里程碑：其中的 Boss 不会丢失，会并入相邻里程碑。 */
  | "REMOVE_MILESTONE"
  /** 把 Boss 移出路线图（暂停）；合同与证据保留在账本中。 */
  | "DROP_BOSS"
  /** 暂停一个重复 Boss，并用 AI 生成的下一步 Boss 在指定阶段替换它。 */
  | "REPLACE_BOSS"
  /** Add one future Boss-sized step to an existing planned milestone. */
  | "ADD_PLANNED_STEP"
  /** Remove one not-yet-expanded future step from the global denominator. */
  | "DROP_PLANNED_STEP";

export interface ProposalChange {
  kind: NegotiationKind;
  /** 初学者能读懂的一行说明。 */
  summary: string;
}

export interface NegotiationProposal {
  id: string;
  /** The user's own words — kept verbatim into the revision history. */
  request: string;
  createdAt: string;
  changes: ProposalChange[];
  /** Which deterministic proposal composer produced this preview. */
  generator: string;
  /** One-paragraph explanation of what the change means for the plan. */
  note: string;
}

export interface ProposalInput {
  kind: NegotiationKind;
  /** For DEFER_BOSS / MOVE_BOSS / DROP_BOSS. */
  contractId?: string;
  /** For MOVE_BOSS (target) / REMOVE_MILESTONE. */
  milestoneId?: string;
  /** For ADD_MILESTONE. */
  title?: string;
  /** For REPLACE_BOSS: the bounded goal used to generate the replacement. */
  nextGoal?: string;
  /**
   * Filled by the client only after generation succeeds. The negotiation model
   * is never allowed to provide or invent this id.
   */
  replacementContractId?: string;
  /** For DROP_PLANNED_STEP. */
  stepId?: string;
  /** For ADD_PLANNED_STEP. */
  estimatedMinutes?: number;
}

export interface ProposalImpact {
  progressBefore: number;
  progressAfter: number;
  /** Milestone-level state changes, in roadmap order. */
  milestoneNotes: string[];
  /** What the change means for existing evidence. */
  evidenceNote: string;
}

export function draftProposal(
  input: ProposalInput,
  request: string,
  ledger: Ledger,
  id: string,
  at: string,
): NegotiationProposal | { error: string } {
  const change = buildChange(input, ledger);
  if ("error" in change) return change;

  return {
    id,
    request: request.trim(),
    createdAt: at,
    changes: [change.change, ...(change.extraChange ? [change.extraChange] : [])],
    generator: "rule-based.v2",
    note: change.note,
  };
}

function buildChange(
  input: ProposalInput,
  ledger: Ledger,
): { change: ProposalChange; extraChange?: ProposalChange; note: string } | { error: string } {
  const projectName = ledger.project;
  if (!projectName) return { error: "还没有项目路线图，无法协商变更。" };

  switch (input.kind) {
    case "DEFER_BOSS": {
      const contractId = input.contractId;
      if (!contractId || !findMilestoneOf(projectName, contractId)) {
        return { error: "请先选择要延期的 Boss。" };
      }
      const last = projectName.milestones.at(-1);
      if (!last) return { error: "路线图里没有里程碑。" };
      return {
        change: {
          kind: "DEFER_BOSS",
          summary: `把「${bossTitle(ledger, contractId)}」移到最后一个里程碑「${last.title}」，先集中完成更早的阶段。`,
        },
        note: "总进度会先下降：这个 Boss 的工作被推迟了，但它没有消失，已完成的部分照常保留。",
      };
    }
    case "MOVE_BOSS": {
      const contractId = input.contractId;
      const milestoneId = input.milestoneId;
      if (!contractId || !milestoneId) return { error: "请选择要移动的 Boss 和目标里程碑。" };
      const from = findMilestoneOf(projectName, contractId);
      const to = projectName.milestones.find((item) => item.id === milestoneId);
      if (!from || !to) return { error: "找不到该 Boss 或目标里程碑。" };
      if (from.id === to.id) return { error: "这个 Boss 已经在该里程碑里了。" };
      return {
        change: {
          kind: "MOVE_BOSS",
          summary: `把「${bossTitle(ledger, contractId)}」从「${from.title}」调整到「${to.title}」。`,
        },
        note: "这只改变顺序和归属，Boss 的验收标准与已有证据都不受影响。",
      };
    }
    case "ADD_MILESTONE": {
      const title = input.title?.trim();
      if (!title) return { error: "请给新里程碑起一个名字。" };
      return {
        change: {
          kind: "ADD_MILESTONE",
          summary: `新增里程碑「${title}」，放在路线图最后；之后新建的 Boss 可以归入这里。`,
        },
        note: "新增阶段不会降低当前进度：还没有 Boss 归属，它对百分比的影响是零，直到你往里加工作。",
      };
    }
    case "REMOVE_MILESTONE": {
      const milestoneId = input.milestoneId;
      if (!milestoneId) return { error: "请选择要删除的里程碑。" };
      const target = projectName.milestones.find((item) => item.id === milestoneId);
      if (!target) return { error: "找不到该里程碑。" };
      if (projectName.milestones.length <= 1) {
        return { error: "至少要保留一个里程碑，不能全部删除。" };
      }
      const neighbor =
        projectName.milestones.find((item) => item.id !== milestoneId && item.bossIds.length >= 0) ??
        projectName.milestones[0];
      return {
        change: {
          kind: "REMOVE_MILESTONE",
          summary: `删除里程碑「${target.title}」${target.bossIds.length > 0 ? `，里面的 ${target.bossIds.length} 个 Boss 会并入「${neighbor.title}」，不会被删除` : "（它目前是空的）"}。`,
        },
        note: "里程碑是组织方式，不是工作本身：里面的 Boss 与全部证据都保留，只是换了归属。",
      };
    }
    case "DROP_BOSS": {
      const contractId = input.contractId;
      if (!contractId || !findMilestoneOf(projectName, contractId)) {
        return { error: "请先选择要暂停的 Boss。" };
      }
      return {
        change: {
          kind: "DROP_BOSS",
          summary: `把「${bossTitle(ledger, contractId)}」移出当前路线图（暂停）。它的合同和已记录的证据都保留在本地账本里，之后可以随时加回来。`,
        },
        note: "总进度会重新计算（分母变小），已完成的 Boss 和所有证据记录都不会被删除。",
      };
    }
    case "REPLACE_BOSS": {
      const contractId = input.contractId;
      const milestoneId = input.milestoneId;
      const nextGoal = input.nextGoal?.trim();
      const from = contractId ? findMilestoneOf(projectName, contractId) : undefined;
      const target = projectName.milestones.find((item) => item.id === milestoneId);
      if (!contractId || !from) return { error: "请先选择要暂停的重复 Boss。" };
      if (!milestoneId || !target) return { error: "请选择新 Boss 所在的里程碑。" };
      if (!nextGoal) return { error: "请说明下一步 Boss 要完成什么。" };
      return {
        change: {
          kind: "REPLACE_BOSS",
          summary: `暂停重复的「${bossTitle(ledger, contractId)}」，保留其合同与证据。`,
        },
        extraChange: {
          kind: "REPLACE_BOSS",
          summary: `根据“${nextGoal}”生成一个新的 Boss，并放入「${target.title}」。`,
        },
        note: "接受后会先生成新 Boss；只有生成成功，替换才会作为一个计划版本整体生效。生成失败时原计划不会改变。",
      };
    }
    case "ADD_PLANNED_STEP": {
      const milestone = projectName.milestones.find((item) => item.id === input.milestoneId);
      const title = input.title?.trim();
      const objective = input.nextGoal?.trim();
      const estimatedMinutes = input.estimatedMinutes;
      if (!milestone || !milestone.steps) return { error: "请选择已有整体规划的目标里程碑。" };
      if (!title || !objective) return { error: "请说明新增步骤的名称和目标。" };
      if (!estimatedMinutes || estimatedMinutes < 15 || estimatedMinutes > 480) {
        return { error: "请为新增步骤提供 15 到 480 分钟的预计投入。" };
      }
      return {
        change: {
          kind: "ADD_PLANNED_STEP",
          summary: `在「${milestone.title}」新增未来步骤「${title}」（预计 ${estimatedMinutes} 分钟）：${objective}`,
        },
        note: "新增工作会扩大整体计划的分母，因此当前百分比可能下降；这是路线更完整，不代表已经完成的工作倒退。",
      };
    }
    case "DROP_PLANNED_STEP": {
      const match = projectName.milestones
        .flatMap((milestone) => (milestone.steps ?? []).map((step) => ({ milestone, step })))
        .find((item) => item.step.id === input.stepId);
      if (!match) return { error: "找不到要移除的未来步骤。" };
      if (match.step.contractId) return { error: "该步骤已经生成 Boss，请改为暂停对应 Boss。" };
      return {
        change: {
          kind: "DROP_PLANNED_STEP",
          summary: `从「${match.milestone.title}」移除尚未开始的步骤「${match.step.title}」。`,
        },
        note: "该步骤尚无合同或证据；移除后整体分母会缩小，计划版本会记录你的原因。",
      };
    }
  }
}

function bossTitle(ledger: Ledger, contractId: string): string {
  return ledger.contracts[contractId]?.objective ?? contractId;
}

function findMilestoneOf(
  project: ResearchProject,
  contractId: string,
): ResearchProject["milestones"][number] | undefined {
  return project.milestones.find((milestone) => milestone.bossIds.includes(contractId));
}

/**
 * Applies a proposal together with the structured input that produced it.
 *
 * The split exists so the stored revision history stays human-readable
 * (summaries), while the application stays exact (payloads).
 */
export function applyProposalWith(
  ledger: Ledger,
  proposal: NegotiationProposal,
  input: ProposalInput,
  at: string,
): Ledger {
  const current = ledger.project;
  if (!current) return ledger;

  const progressBefore = deriveRoadmap(ledger)?.progressPercent ?? 0;
  let milestones = current.milestones.map((item) => ({
    ...item,
    bossIds: [...item.bossIds],
    ...(item.steps ? { steps: item.steps.map((step) => ({ ...step })) } : {}),
  }));
  let currentBossId = current.currentBossId;

  const detachEverywhere = (contractId: string) => {
    let detachedStep: NonNullable<(typeof milestones)[number]["steps"]>[number] | undefined;
    milestones = milestones.map((item) => {
      const found = item.steps?.find((step) => step.contractId === contractId);
      if (found && !detachedStep) detachedStep = found;
      return {
        ...item,
        bossIds: item.bossIds.filter((id) => id !== contractId),
        ...(item.steps
          ? { steps: item.steps.filter((step) => step.contractId !== contractId) }
          : {}),
      };
    });
    if (currentBossId === contractId) {
      currentBossId = milestones.flatMap((item) => item.bossIds)[0];
    }
    return detachedStep;
  };

  switch (input.kind) {
    case "DEFER_BOSS": {
      if (input.contractId) {
        const step = detachEverywhere(input.contractId);
        const last = milestones.at(-1);
        last?.bossIds.push(input.contractId);
        if (step && last?.steps) last.steps.push(step);
      }
      break;
    }
    case "REPLACE_BOSS": {
      const oldStep = input.contractId ? detachEverywhere(input.contractId) : undefined;
      if (input.replacementContractId && input.milestoneId) {
        const target = milestones.find((item) => item.id === input.milestoneId);
        if (target && !target.bossIds.includes(input.replacementContractId)) {
          target.bossIds.push(input.replacementContractId);
          if (target.steps) {
            const replacement = ledger.contracts[input.replacementContractId];
            target.steps.push({
              id: oldStep?.id ?? `S-${input.replacementContractId}`,
              title: replacement?.title ?? oldStep?.title ?? input.nextGoal ?? "新增步骤",
              objective: replacement?.objective ?? oldStep?.objective ?? input.nextGoal ?? "新增步骤",
              estimatedMinutes: replacement?.estimatedMinutes ?? oldStep?.estimatedMinutes ?? 90,
              contractId: input.replacementContractId,
            });
          }
          currentBossId = input.replacementContractId;
        }
      }
      break;
    }
    case "MOVE_BOSS": {
      if (input.contractId && input.milestoneId) {
        const step = detachEverywhere(input.contractId);
        const target = milestones.find((item) => item.id === input.milestoneId);
        target?.bossIds.push(input.contractId);
        if (step && target?.steps) target.steps.push(step);
      }
      break;
    }
    case "ADD_MILESTONE": {
      const title =
        input.title?.trim() || proposal.changes[0]?.summary.replace(/^新增里程碑「|」.*$/g, "") || "新增阶段";
      milestones.push({
        id: `M-${at}-${milestones.length + 1}`.replace(/[:.]/g, ""),
        title,
        bossIds: [],
        ...(milestones.some((item) => item.steps !== undefined) ? { steps: [] } : {}),
      });
      break;
    }
    case "REMOVE_MILESTONE": {
      if (input.milestoneId && milestones.length > 1) {
        const target = milestones.find((item) => item.id === input.milestoneId);
        const orphanIds = target?.bossIds ?? [];
        const orphanSteps = target?.steps ?? [];
        milestones = milestones.filter((item) => item.id !== input.milestoneId);
        const remaining = milestones.find((item) => item.id !== input.milestoneId) ?? milestones[0];
        if (remaining) {
          remaining.bossIds.push(...orphanIds);
          if (remaining.steps) remaining.steps.push(...orphanSteps);
        }
      }
      break;
    }
    case "DROP_BOSS": {
      if (input.contractId) detachEverywhere(input.contractId);
      break;
    }
    case "ADD_PLANNED_STEP": {
      if (input.milestoneId && input.title && input.nextGoal && input.estimatedMinutes) {
        const target = milestones.find((item) => item.id === input.milestoneId);
        target?.steps?.push({
          id: input.stepId ?? `S-${at}-${target.steps.length + 1}`.replace(/[:.]/g, ""),
          title: input.title.trim(),
          objective: input.nextGoal.trim(),
          estimatedMinutes: input.estimatedMinutes,
        });
      }
      break;
    }
    case "DROP_PLANNED_STEP": {
      if (input.stepId) {
        milestones = milestones.map((milestone) => ({
          ...milestone,
          ...(milestone.steps
            ? { steps: milestone.steps.filter((step) => step.id !== input.stepId) }
            : {}),
        }));
      }
      break;
    }
  }

  const nextProject: ResearchProject = {
    ...current,
    milestones,
    currentBossId,
    revision: current.revision + 1,
    updatedAt: at,
  };
  const progressAfter = deriveRoadmap({ ...ledger, project: nextProject })?.progressPercent ?? 0;
  const revision: PlanRevision = {
    revision: nextProject.revision,
    at,
    reason: proposal.request,
    changes: proposal.changes.map((item) => ({ kind: item.kind, summary: item.summary })),
    progressBefore,
    progressAfter,
  };

  return {
    ...ledger,
    project: {
      ...nextProject,
      history: [revision, ...(nextProject.history ?? [])],
    },
  };
}

/** Before/after preview for an un-applied proposal (never touches storage). */
export function previewImpact(
  ledger: Ledger,
  proposal: NegotiationProposal,
  input: ProposalInput,
): ProposalImpact | null {
  if (!ledger.project) return null;
  if (input.kind === "REPLACE_BOSS" && !input.replacementContractId) {
    const target = ledger.project.milestones.find((item) => item.id === input.milestoneId);
    const progress = deriveRoadmap(ledger)?.progressPercent ?? 0;
    return {
      progressBefore: progress,
      progressAfter: progress,
      milestoneNotes: target
        ? [`「${target.title}」会在新 Boss 生成后重新计算进度。`]
        : [],
      evidenceNote: "被暂停 Boss 的合同与证据都会保留；新 Boss 生成失败时，原路线不会发生变化。",
    };
  }
  const before = deriveRoadmap(ledger);
  const hypothetical = applyProposalWith(ledger, proposal, input, "1970-01-01T00:00:00.000Z");
  const after = deriveRoadmap(hypothetical);
  if (!before || !after) return null;

  const milestoneNotes: string[] = [];
  for (const afterMilestone of after.milestones) {
    const beforeMilestone = before.milestones.find((item) => item.id === afterMilestone.id);
    if (!beforeMilestone) {
      milestoneNotes.push(`新增里程碑「${afterMilestone.title}」。`);
      continue;
    }
    if (beforeMilestone.state !== afterMilestone.state) {
      milestoneNotes.push(
        `「${afterMilestone.title}」：${stateText(beforeMilestone.state)} → ${stateText(afterMilestone.state)}。`,
      );
    }
  }
  for (const beforeMilestone of before.milestones) {
    if (!after.milestones.some((item) => item.id === beforeMilestone.id)) {
      milestoneNotes.push(`里程碑「${beforeMilestone.title}」已删除，其中的 Boss 并入相邻里程碑。`);
    }
  }

  return {
    progressBefore: before.progressPercent,
    progressAfter: after.progressPercent,
    milestoneNotes,
    evidenceNote:
      "已有证据与合同都不会被删除：DROP/删除里程碑只改变路线图的组织方式，账本中的历史完整保留。",
  };
}

function stateText(state: "DONE" | "ACTIVE" | "PENDING"): string {
  if (state === "DONE") return "已完成";
  if (state === "ACTIVE") return "进行中";
  return "未开始";
}

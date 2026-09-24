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
  | "DROP_BOSS";

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
  /** Which composer produced this: "rule-based.v1" today, the AI later. */
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
    changes: [change.change],
    generator: "rule-based.v1",
    note: change.note,
  };
}

function buildChange(
  input: ProposalInput,
  ledger: Ledger,
): { change: ProposalChange; note: string } | { error: string } {
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
  let milestones = current.milestones.map((item) => ({ ...item, bossIds: [...item.bossIds] }));
  let currentBossId = current.currentBossId;

  const removeEverywhere = (contractId: string) => {
    milestones = milestones.map((item) => ({
      ...item,
      bossIds: item.bossIds.filter((id) => id !== contractId),
    }));
    if (currentBossId === contractId) {
      currentBossId = milestones.flatMap((item) => item.bossIds)[0];
    }
  };

  switch (input.kind) {
    case "DEFER_BOSS": {
      if (input.contractId) {
        removeEverywhere(input.contractId);
        milestones.at(-1)?.bossIds.push(input.contractId);
      }
      break;
    }
    case "MOVE_BOSS": {
      if (input.contractId && input.milestoneId) {
        removeEverywhere(input.contractId);
        milestones
          .find((item) => item.id === input.milestoneId)
          ?.bossIds.push(input.contractId);
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
      });
      break;
    }
    case "REMOVE_MILESTONE": {
      if (input.milestoneId && milestones.length > 1) {
        const target = milestones.find((item) => item.id === input.milestoneId);
        const orphanIds = target?.bossIds ?? [];
        milestones = milestones.filter((item) => item.id !== input.milestoneId);
        const remaining = milestones.find((item) => item.id !== input.milestoneId) ?? milestones[0];
        if (remaining) remaining.bossIds.push(...orphanIds);
      }
      break;
    }
    case "DROP_BOSS": {
      if (input.contractId) removeEverywhere(input.contractId);
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

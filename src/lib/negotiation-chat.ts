import { NegotiationKind, ProposalInput } from "./negotiation";

export const NEGOTIATION_CHAT_VERSION = "negotiation-chat.v2" as const;
export const MAX_NEGOTIATION_MESSAGE_LENGTH = 800;
export const MAX_NEGOTIATION_HISTORY = 12;

export interface NegotiationChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface NegotiationChatContext {
  goal: string;
  revision: number;
  currentBossId?: string;
  milestones: Array<{
    id: string;
    title: string;
    bosses: Array<{ id: string; objective: string }>;
    plannedSteps?: Array<{
      id: string;
      title: string;
      objective: string;
      estimatedMinutes: number;
      contractId?: string;
    }>;
  }>;
}

export interface NegotiationChatRequest {
  version: typeof NEGOTIATION_CHAT_VERSION;
  message: string;
  history: NegotiationChatMessage[];
  context: NegotiationChatContext;
}

export interface NegotiationChatReply {
  reply: string;
  state: "DISCUSSING" | "PROPOSAL";
  proposalInput?: ProposalInput;
  generator: "AI" | "MOCK";
}

const NEGOTIATION_KINDS = new Set<NegotiationKind>([
  "DEFER_BOSS",
  "MOVE_BOSS",
  "ADD_MILESTONE",
  "REMOVE_MILESTONE",
  "DROP_BOSS",
  "REPLACE_BOSS",
  "ADD_PLANNED_STEP",
  "DROP_PLANNED_STEP",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

export function parseNegotiationRequest(value: unknown): NegotiationChatRequest | null {
  if (!isRecord(value) || value.version !== NEGOTIATION_CHAT_VERSION) return null;
  const message = cleanText(value.message, MAX_NEGOTIATION_MESSAGE_LENGTH);
  if (!message || !Array.isArray(value.history) || value.history.length > MAX_NEGOTIATION_HISTORY) {
    return null;
  }
  const history: NegotiationChatMessage[] = [];
  for (const item of value.history) {
    if (!isRecord(item) || (item.role !== "user" && item.role !== "assistant")) return null;
    const content = cleanText(item.content, MAX_NEGOTIATION_MESSAGE_LENGTH);
    if (!content) return null;
    history.push({ role: item.role, content });
  }

  if (!isRecord(value.context)) return null;
  const goal = cleanText(value.context.goal, 500);
  if (!goal || typeof value.context.revision !== "number" || !Number.isInteger(value.context.revision)) {
    return null;
  }
  if (!Array.isArray(value.context.milestones) || value.context.milestones.length > 20) return null;
  const milestones: NegotiationChatContext["milestones"] = [];
  for (const milestone of value.context.milestones) {
    if (!isRecord(milestone) || !Array.isArray(milestone.bosses) || milestone.bosses.length > 30) {
      return null;
    }
    const id = cleanText(milestone.id, 120);
    const title = cleanText(milestone.title, 120);
    if (!id || !title) return null;
    const bosses: Array<{ id: string; objective: string }> = [];
    for (const boss of milestone.bosses) {
      if (!isRecord(boss)) return null;
      const bossId = cleanText(boss.id, 120);
      const objective = cleanText(boss.objective, 1000);
      if (!bossId || !objective) return null;
      bosses.push({ id: bossId, objective });
    }
    let plannedSteps: NegotiationChatContext["milestones"][number]["plannedSteps"];
    if (milestone.plannedSteps !== undefined) {
      if (!Array.isArray(milestone.plannedSteps) || milestone.plannedSteps.length > 20) return null;
      plannedSteps = [];
      for (const step of milestone.plannedSteps) {
        if (!isRecord(step)) return null;
        const stepId = cleanText(step.id, 120);
        const stepTitle = cleanText(step.title, 140);
        const objective = cleanText(step.objective, 500);
        if (
          !stepId ||
          !stepTitle ||
          !objective ||
          typeof step.estimatedMinutes !== "number" ||
          !Number.isInteger(step.estimatedMinutes) ||
          step.estimatedMinutes < 15 ||
          step.estimatedMinutes > 480 ||
          (step.contractId !== undefined && !cleanText(step.contractId, 120))
        ) {
          return null;
        }
        plannedSteps.push({
          id: stepId,
          title: stepTitle,
          objective,
          estimatedMinutes: step.estimatedMinutes,
          ...(step.contractId ? { contractId: String(step.contractId).trim() } : {}),
        });
      }
    }
    milestones.push({ id, title, bosses, ...(plannedSteps ? { plannedSteps } : {}) });
  }
  const currentBossId =
    value.context.currentBossId === undefined
      ? undefined
      : cleanText(value.context.currentBossId, 120) ?? undefined;

  return {
    version: NEGOTIATION_CHAT_VERSION,
    message,
    history,
    context: { goal, revision: value.context.revision, currentBossId, milestones },
  };
}

export function parseNegotiationModelReply(
  value: unknown,
  context: NegotiationChatContext,
): Omit<NegotiationChatReply, "generator"> | null {
  if (!isRecord(value)) return null;
  const reply = cleanText(value.reply, 1200);
  if (!reply || (value.state !== "DISCUSSING" && value.state !== "PROPOSAL")) return null;
  if (value.state === "DISCUSSING") return { reply, state: "DISCUSSING" };
  if (!isRecord(value.proposalInput) || !NEGOTIATION_KINDS.has(value.proposalInput.kind as NegotiationKind)) {
    return null;
  }

  const knownBosses = new Set(context.milestones.flatMap((item) => item.bosses.map((boss) => boss.id)));
  const knownMilestones = new Set(context.milestones.map((item) => item.id));
  const knownFutureSteps = new Set(
    context.milestones.flatMap((item) =>
      (item.plannedSteps ?? []).filter((step) => !step.contractId).map((step) => step.id),
    ),
  );
  const kind = value.proposalInput.kind as NegotiationKind;
  const contractId = cleanText(value.proposalInput.contractId, 120) ?? undefined;
  const milestoneId = cleanText(value.proposalInput.milestoneId, 120) ?? undefined;
  const title = cleanText(value.proposalInput.title, 40) ?? undefined;
  const nextGoal = cleanText(value.proposalInput.nextGoal, 500) ?? undefined;
  const stepId = cleanText(value.proposalInput.stepId, 120) ?? undefined;
  const estimatedMinutes = value.proposalInput.estimatedMinutes;

  if ((kind === "DEFER_BOSS" || kind === "DROP_BOSS") && (!contractId || !knownBosses.has(contractId))) {
    return null;
  }
  if (
    kind === "MOVE_BOSS" &&
    (!contractId || !knownBosses.has(contractId) || !milestoneId || !knownMilestones.has(milestoneId))
  ) {
    return null;
  }
  if (kind === "REMOVE_MILESTONE" && (!milestoneId || !knownMilestones.has(milestoneId))) {
    return null;
  }
  if (kind === "ADD_MILESTONE" && !title) return null;
  if (
    kind === "REPLACE_BOSS" &&
    (!contractId ||
      !knownBosses.has(contractId) ||
      !milestoneId ||
      !knownMilestones.has(milestoneId) ||
      !nextGoal)
  ) {
    return null;
  }
  if (
    kind === "ADD_PLANNED_STEP" &&
    (!milestoneId ||
      !knownMilestones.has(milestoneId) ||
      !title ||
      !nextGoal ||
      typeof estimatedMinutes !== "number" ||
      !Number.isInteger(estimatedMinutes) ||
      estimatedMinutes < 15 ||
      estimatedMinutes > 480)
  ) {
    return null;
  }
  if (kind === "DROP_PLANNED_STEP" && (!stepId || !knownFutureSteps.has(stepId))) return null;

  return {
    reply,
    state: "PROPOSAL",
    proposalInput: {
      kind,
      contractId,
      milestoneId,
      title,
      nextGoal,
      stepId,
      ...(typeof estimatedMinutes === "number" ? { estimatedMinutes } : {}),
    },
  };
}

export function buildNegotiationPrompt(request: NegotiationChatRequest): string {
  return JSON.stringify({
    task: "Discuss a requested research-plan adjustment and propose a safe executable change only when the request is clear.",
    currentPlan: request.context,
    conversation: [...request.history, { role: "user", content: request.message }],
    supportedExecutableChanges: {
      DEFER_BOSS: "Move one existing Boss to the final milestone.",
      MOVE_BOSS: "Move one existing Boss to a named existing milestone.",
      ADD_MILESTONE: "Add a new empty milestone.",
      REMOVE_MILESTONE: "Remove a milestone while preserving and re-homing every Boss.",
      DROP_BOSS: "Pause a Boss by removing it from the roadmap while preserving its contract and evidence.",
      REPLACE_BOSS:
        "Pause one existing duplicate Boss, generate one bounded next-step Boss from nextGoal, and place it in one existing milestone. Use this for requests such as 'cancel one duplicate and add the minimal runnable example'.",
      ADD_PLANNED_STEP:
        "Add one not-yet-expanded future step to an existing milestone. Provide milestoneId, title, nextGoal, and estimatedMinutes (15..480).",
      DROP_PLANNED_STEP:
        "Remove one future step that has no contract yet. Provide its existing stepId.",
    },
    instruction:
      "Reply in the user's language. The user may discuss any desired adjustment; do not force them to choose from a menu. Resolve short confirmations from the immediately preceding assistant question and the full conversation; do not ask again after the user has selected one of your stated options. Ask one concise clarifying question only when intent, target, or tradeoff is genuinely unclear. If the desired change is outside the executable set, discuss it honestly and help reformulate it as a safe next step instead of pretending it was applied. When one supported change is unambiguous, return state PROPOSAL with proposalInput. For REPLACE_BOSS, contractId is the existing Boss to pause, milestoneId is where the generated replacement belongs, and nextGoal is a concrete bounded instruction for generating that new Boss; never invent a replacement id. Otherwise return DISCUSSING without proposalInput. Return one JSON object only.",
    outputShape: {
      reply: "string",
      state: "DISCUSSING or PROPOSAL",
      proposalInput: "omit while DISCUSSING; otherwise {kind, contractId?, milestoneId?, title?, nextGoal?, stepId?, estimatedMinutes?}",
    },
  });
}

export const NEGOTIATION_SYSTEM_PROMPT = [
  "You are Boss, a calm research-planning partner for beginners.",
  "Treat conversation as advice only. Never claim the plan changed.",
  "A plan changes only after the UI shows a concrete proposal and the user explicitly accepts it.",
  "Understand free-form intent, explain tradeoffs in plain language, and ask at most one focused question per turn.",
  "Never invent Boss ids or milestone ids; use only ids in currentPlan.",
  "Return one JSON object and no prose outside it.",
].join("\n");

import {
  BossContract,
  PROJECT_PLAN_SCHEMA_VERSION,
  ProjectPlanDraft,
} from "./contracts";
import {
  apiKeyFromEnv,
  DEFAULT_API_BASE,
  DEFAULT_MODEL,
  GeneratorEnv,
} from "./goal-discovery/factory";
import { GenerationError } from "./goal-discovery/generator";
import { extractJson, OpenAICompatibleTransport } from "./goal-discovery/llm-generator";

const MAX_PLAN_ATTEMPTS = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= max ? text : null;
}

/** Strict boundary for the model-authored global outline. */
export function parseProjectPlan(value: unknown): ProjectPlanDraft | null {
  if (!isRecord(value) || value.schemaVersion !== PROJECT_PLAN_SCHEMA_VERSION) return null;
  if (!Array.isArray(value.milestones) || value.milestones.length < 2 || value.milestones.length > 6) {
    return null;
  }
  if (!Array.isArray(value.assumptions) || value.assumptions.length > 6) return null;
  const assumptions: string[] = [];
  for (const item of value.assumptions) {
    const text = cleanText(item, 240);
    if (!text) return null;
    assumptions.push(text);
  }

  const milestoneIds = new Set<string>();
  const stepIds = new Set<string>();
  const milestones: ProjectPlanDraft["milestones"] = [];
  let stepCount = 0;
  for (const milestone of value.milestones) {
    if (!isRecord(milestone) || !Array.isArray(milestone.steps)) return null;
    const id = cleanText(milestone.id, 80);
    const title = cleanText(milestone.title, 120);
    if (!id || !title || milestoneIds.has(id) || milestone.steps.length < 1 || milestone.steps.length > 4) {
      return null;
    }
    milestoneIds.add(id);
    const steps: ProjectPlanDraft["milestones"][number]["steps"] = [];
    for (const step of milestone.steps) {
      if (!isRecord(step)) return null;
      const stepId = cleanText(step.id, 80);
      const stepTitle = cleanText(step.title, 140);
      const objective = cleanText(step.objective, 500);
      const estimatedMinutes = step.estimatedMinutes;
      if (
        !stepId ||
        !stepTitle ||
        !objective ||
        stepIds.has(stepId) ||
        typeof estimatedMinutes !== "number" ||
        !Number.isInteger(estimatedMinutes) ||
        estimatedMinutes < 15 ||
        estimatedMinutes > 480
      ) {
        return null;
      }
      stepIds.add(stepId);
      steps.push({ id: stepId, title: stepTitle, objective, estimatedMinutes });
      stepCount += 1;
    }
    milestones.push({ id, title, steps });
  }
  if (stepCount < 4 || stepCount > 12) return null;
  return { schemaVersion: PROJECT_PLAN_SCHEMA_VERSION, milestones, assumptions };
}

export function createMockProjectPlan(goal: string, first: BossContract): ProjectPlanDraft {
  const chinese = /[\u3400-\u9fff]/u.test(goal);
  const items = chinese
    ? [
        ["理解问题与冻结范围", first.title, first.objective, first.estimatedMinutes],
        ["准备资源", "准备环境与数据", "获得可检查的数据、依赖和运行环境，并记录来源与版本。", 120],
        ["最小链路", "跑通最小可运行示例", "用最小数据跑通数据加载、模型前向和一次训练迭代。", 180],
        ["完整验证", "完成主要实验与对照", "按计划运行主要实验，保存指标、日志和对照结果。", 300],
        ["总结交付", "整理复现结论", "对照原目标整理结果、差异、限制和下一步建议。", 120],
      ]
    : [
        ["Understand and bound", first.title, first.objective, first.estimatedMinutes],
        ["Prepare resources", "Prepare environment and data", "Obtain inspectable data, dependencies, and a reproducible environment.", 120],
        ["Minimal pipeline", "Run a minimal example", "Run data loading, model forward, and one training iteration on minimal data.", 180],
        ["Full validation", "Run the main experiments", "Run the main experiments and retain metrics, logs, and comparisons.", 300],
        ["Synthesis", "Write the reproduction conclusion", "Summarize results, differences, limitations, and next actions.", 120],
      ];
  return {
    schemaVersion: PROJECT_PLAN_SCHEMA_VERSION,
    milestones: items.map(([milestoneTitle, title, objective, minutes], index) => ({
      id: `M-${index + 1}`,
      title: String(milestoneTitle),
      steps: [
        {
          id: `S-${index + 1}`,
          title: String(title),
          objective: String(objective),
          estimatedMinutes: Number(minutes),
        },
      ],
    })),
    assumptions: chinese
      ? ["这是首次创建时的粗粒度路线图，可在获得新信息后通过协商调整。"]
      : ["This is a coarse initial outline and may be revised through negotiation."],
  };
}

function prompt(goal: string, first: BossContract, repair?: string): string {
  return JSON.stringify({
    task: "Create a coarse but complete project roadmap for a novice researcher.",
    schemaVersion: PROJECT_PLAN_SCHEMA_VERSION,
    goal,
    firstBoss: {
      title: first.title,
      objective: first.objective,
      estimatedMinutes: first.estimatedMinutes,
    },
    rules: [
      "Use the same language as the goal.",
      "Return 2 to 6 milestones and 4 to 12 total Boss-sized steps.",
      "The first step must represent firstBoss; later steps outline the path to the whole goal without pretending they are already complete.",
      "Each step has a unique id, title, objective, and estimatedMinutes from 15 to 480.",
      "Prefer one integrated step over splitting sections of the same document into separate tasks.",
      "This is an initial estimate, so put important uncertainty in assumptions.",
      "Return exactly one JSON object and no prose.",
    ],
    outputShape: {
      schemaVersion: PROJECT_PLAN_SCHEMA_VERSION,
      milestones: [
        {
          id: "M-1",
          title: "string",
          steps: [{ id: "S-1", title: "string", objective: "string", estimatedMinutes: 90 }],
        },
      ],
      assumptions: ["string"],
    },
    ...(repair ? { previousAttemptInvalid: true, repairInstruction: repair } : {}),
  });
}

export async function generateProjectPlan(
  goal: string,
  first: BossContract,
  env: GeneratorEnv = process.env as unknown as GeneratorEnv,
): Promise<ProjectPlanDraft> {
  const mode = (env.BOSS_GENERATOR ?? "mock").trim().toLowerCase();
  if (mode === "mock") return createMockProjectPlan(goal, first);
  if (mode !== "llm") throw new GenerationError("CONFIG_ERROR", "unknown project-plan generator mode");
  const apiKey = apiKeyFromEnv(env);
  if (!apiKey) throw new GenerationError("CONFIG_ERROR", "project-plan generation requires an API key");
  const transport = new OpenAICompatibleTransport({
    apiKey,
    baseUrl: env.BOSS_API_BASE ?? DEFAULT_API_BASE,
    model: (env.BOSS_MODEL ?? DEFAULT_MODEL).trim(),
  });

  let repair = "";
  for (let attempt = 0; attempt < MAX_PLAN_ATTEMPTS; attempt += 1) {
    const response = await transport.complete({
      systemPrompt:
        "You are the project-roadmap adapter of Boss Research Assistant. Produce a provisional, complete research route without claiming future work is done. Return JSON only.",
      userPrompt: prompt(goal, first, repair || undefined),
      temperature: attempt === 0 ? 0.2 : 0,
    });
    const parsed = parseProjectPlan(response.content ? extractJson(response.content) : null);
    if (parsed) return parsed;
    repair = "The previous reply violated project-plan.v1. Repair all ids, bounds, counts, and required fields.";
  }
  throw new GenerationError("GENERATION_FAILED", "project roadmap failed validation after two attempts");
}

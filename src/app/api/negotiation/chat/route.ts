import { NextResponse } from "next/server";

import {
  apiKeyFromEnv,
  DEFAULT_API_BASE,
  DEFAULT_MODEL,
  GeneratorEnv,
} from "@/lib/goal-discovery/factory";
import { extractJson, OpenAICompatibleTransport } from "@/lib/goal-discovery/llm-generator";
import {
  buildNegotiationPrompt,
  NEGOTIATION_SYSTEM_PROMPT,
  NegotiationChatReply,
  parseNegotiationModelReply,
  parseNegotiationRequest,
} from "@/lib/negotiation-chat";
import { generatorEnvForRequest } from "@/lib/request-api-config";

function invalid(message: string) {
  return NextResponse.json({ error: { code: "INVALID_REQUEST", message } }, { status: 400 });
}

function mockReply(message: string, currentBossId: string | undefined): NegotiationChatReply {
  if (currentBossId && /延期|推迟|晚点|later|defer/i.test(message)) {
    return {
      reply: "我理解为：先保留已有成果，把当前 Boss 延后处理。下面已经生成可预览的调整提案。",
      state: "PROPOSAL",
      proposalInput: { kind: "DEFER_BOSS", contractId: currentBossId },
      generator: "MOCK",
    };
  }
  if (currentBossId && /暂停|先不做|移出|drop|pause/i.test(message)) {
    return {
      reply: "我理解为：暂时把当前 Boss 移出路线图，但保留合同和全部证据。下面已经生成可预览的调整提案。",
      state: "PROPOSAL",
      proposalInput: { kind: "DROP_BOSS", contractId: currentBossId },
      generator: "MOCK",
    };
  }
  return {
    reply: "我听到了你的调整想法。为了避免改错，请再告诉我：具体想调整哪个 Boss，以及希望它调整到什么阶段？",
    state: "DISCUSSING",
    generator: "MOCK",
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid("请求内容不是有效的 JSON。");
  }
  const parsed = parseNegotiationRequest(body);
  if (!parsed) return invalid("协商消息或当前路线信息不完整。");

  let requestEnv: GeneratorEnv;
  try {
    requestEnv = generatorEnvForRequest(request);
  } catch {
    return invalid("API Key 格式不正确。");
  }
  const mode = (requestEnv.BOSS_GENERATOR ?? "mock").trim().toLowerCase();
  if (mode === "mock") {
    return NextResponse.json(mockReply(parsed.message, parsed.context.currentBossId));
  }
  if (mode !== "llm") {
    return NextResponse.json(
      { error: { code: "CONFIG_ERROR", message: "协商服务配置错误。" } },
      { status: 500 },
    );
  }

  const apiKey = apiKeyFromEnv(requestEnv);
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: "CONFIG_ERROR", message: "协商 AI 尚未配置。" } },
      { status: 500 },
    );
  }

  try {
    const transport = new OpenAICompatibleTransport({
      apiKey,
      baseUrl: requestEnv.BOSS_API_BASE ?? DEFAULT_API_BASE,
      model: (requestEnv.BOSS_MODEL ?? DEFAULT_MODEL).trim(),
    });
    const prompt = buildNegotiationPrompt(parsed);
    let invalidOutput = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await transport.complete({
        systemPrompt: NEGOTIATION_SYSTEM_PROMPT,
        userPrompt:
          attempt === 0
            ? prompt
            : `${prompt}\n\nThe previous answer was invalid JSON or violated the executable schema. Repair it. Return exactly one valid JSON object. Previous answer: ${invalidOutput.slice(0, 1600)}`,
        temperature: attempt === 0 ? 0.2 : 0,
      });
      invalidOutput = response.content ?? "";
      const doc = response.content ? extractJson(response.content) : null;
      const reply = parseNegotiationModelReply(doc, parsed.context);
      if (reply) return NextResponse.json({ ...reply, generator: "AI" as const });
    }
    throw new Error("模型回复不符合协商协议");
  } catch {
    return NextResponse.json(
      { error: { code: "NEGOTIATION_FAILED", message: "Boss 暂时没有回复，请稍后再试。" } },
      { status: 502 },
    );
  }
}

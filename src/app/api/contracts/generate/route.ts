import { NextResponse } from "next/server";
import { CONTRACT_SCHEMA_VERSION, GenerateBossContractRequest } from "@/lib/contracts";
import { getGenerator } from "@/lib/goal-discovery/factory";
import { GenerationError } from "@/lib/goal-discovery/generator";

const INVALID_GOAL_MESSAGE = "请输入 1 到 500 个字符的科研目标，并使用当前接口版本。";

function invalidRequest(message: string) {
  return NextResponse.json(
    { error: { code: "INVALID_REQUEST" as const, message } },
    { status: 400 },
  );
}

/**
 * Goal Discovery generate endpoint.
 *
 * The generator is selected server-side by BOSS_GENERATOR (mock | llm).
 * Failures are never silently fallen back to a fixture: INPUT_REJECTED maps to
 * 400, everything else to 500 with a concise retry hint.
 *
 * A malformed request body is a client error and must answer 400, so parsing is
 * kept out of the generation try block. Previously both happened inside one try,
 * which meant request.json() throwing on invalid JSON was caught by the
 * catch-all and reported as 500 INTERNAL_ERROR — contradicting the documented
 * contract in docs/api-contract.md and the behaviour of the original route.
 */
export async function POST(request: Request) {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return invalidRequest("请求内容不是有效的 JSON。");
  }

  // Valid JSON is not necessarily a usable body: it may be null, an array, or a
  // primitive. Normalise those to an empty object so the validation below
  // reports 400 instead of a property access throwing and surfacing as 500.
  const body: Partial<GenerateBossContractRequest> =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Partial<GenerateBossContractRequest>)
      : {};

  const goal = typeof body.goal === "string" ? body.goal.trim() : "";

  if (body.schemaVersion !== CONTRACT_SCHEMA_VERSION || !goal || goal.length > 500) {
    return invalidRequest(INVALID_GOAL_MESSAGE);
  }

  try {
    const generator = getGenerator();
    const contract = await generator.generate(goal);

    return NextResponse.json({
      contract,
      generation: (process.env.BOSS_GENERATOR ?? "mock").trim().toLowerCase() === "llm" ? "AI" : "MOCK",
    });
  } catch (error) {
    if (error instanceof GenerationError && error.code === "INPUT_REJECTED") {
      return invalidRequest(INVALID_GOAL_MESSAGE);
    }
    if (error instanceof GenerationError && error.code === "CONFIG_ERROR") {
      return NextResponse.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: `生成器配置错误：${error.message}`,
          },
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "合同生成失败，请稍后重试。",
        },
      },
      { status: 500 },
    );
  }
}

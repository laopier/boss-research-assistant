import { NextResponse } from "next/server";
import { CONTRACT_SCHEMA_VERSION, GenerateBossContractRequest } from "@/lib/contracts";
import { getGenerator } from "@/lib/goal-discovery/factory";
import { GenerationError } from "@/lib/goal-discovery/generator";

/**
 * Goal Discovery generate endpoint.
 *
 * The generator is selected server-side by BOSS_GENERATOR (mock | llm).
 * Failures are never silently fallen back to a fixture: INPUT_REJECTED maps
 * to 400, everything else to 500 with a concise retry hint.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<GenerateBossContractRequest>;
    const goal = typeof body.goal === "string" ? body.goal.trim() : "";

    if (body.schemaVersion !== CONTRACT_SCHEMA_VERSION || !goal || goal.length > 500) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "请输入 1 到 500 个字符的科研目标，并使用当前接口版本。",
          },
        },
        { status: 400 },
      );
    }

    const generator = getGenerator();
    const contract = await generator.generate(goal);

    return NextResponse.json({
      contract,
      generation: (process.env.BOSS_GENERATOR ?? "mock").trim().toLowerCase() === "llm" ? "AI" : "MOCK",
    });
  } catch (error) {
    if (error instanceof GenerationError && error.code === "INPUT_REJECTED") {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "请输入 1 到 500 个字符的科研目标，并使用当前接口版本。",
          },
        },
        { status: 400 },
      );
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

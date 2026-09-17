import { NextResponse } from "next/server";
import { CONTRACT_SCHEMA_VERSION, GenerateBossContractRequest } from "@/lib/contracts";
import { createMockContract } from "@/lib/mock-contract";

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

    return NextResponse.json(createMockContract(goal));
  } catch {
    return NextResponse.json(
      {
        error: { code: "INVALID_REQUEST", message: "请求内容不是有效的 JSON。" },
      },
      { status: 400 },
    );
  }
}

import { NextResponse } from "next/server";

import { getEvidenceReviewer } from "@/lib/evidence-review/factory";
import { ReviewError } from "@/lib/evidence-review/types";
import { validateReviewRequest } from "@/lib/evidence-review/validation";
import { generatorEnvForRequest } from "@/lib/request-api-config";

const INVALID_BODY_MESSAGE = "请求内容不是有效的 JSON。";

function invalidRequest(message: string) {
  return NextResponse.json(
    { error: { code: "INVALID_REQUEST" as const, message } },
    { status: 400 },
  );
}

function internalError(message: string) {
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR" as const, message } },
    { status: 500 },
  );
}

/**
 * Evidence Review endpoint.
 *
 * The reviewer is selected server-side by the same `BOSS_GENERATOR` switch as
 * Goal Discovery, and the AI is never consulted when the request itself already
 * settles the verdict (wrong source type, content too thin, prompt injection, a
 * self-declared platform verification) — `deterministicGuard` short-circuits
 * those inside the reviewer.
 *
 * Failure policy, identical in spirit to the generate endpoint:
 *   INVALID_REQUEST (400) — malformed JSON or an unusable review request.
 *   INTERNAL_ERROR  (500) — misconfiguration, transport failure, or a model
 *                           output that could not be validated. There is no
 *                           fallback verdict: if the AI is unavailable the
 *                           caller gets an error, not a fabricated review.
 *
 * A verdict returned here is a PROPOSAL. Nothing in this route writes to the
 * ledger; the user confirms the review before it takes effect.
 */
export async function POST(request: Request) {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return invalidRequest(INVALID_BODY_MESSAGE);
  }

  const validation = validateReviewRequest(parsed);
  if (!validation.ok) {
    return invalidRequest(validation.message);
  }

  try {
    const reviewer = getEvidenceReviewer(generatorEnvForRequest(request));
    const review = await reviewer.review(validation.request);

    return NextResponse.json({
      review,
      reviewer: reviewer.reviewerKind,
      promptVersion: reviewer.promptVersion,
      generation: reviewer.reviewerKind === "AI" ? "AI" : "MOCK",
    });
  } catch (error) {
    if (error instanceof ReviewError) {
      if (error.code === "INPUT_REJECTED") {
        return invalidRequest(error.message);
      }
      if (error.code === "CONFIG_ERROR") {
        return internalError(`证据审核器配置错误：${error.message}`);
      }
      if (error.code === "TRANSPORT_ERROR") {
        return internalError(
          `AI 审核服务当前不可用，请稍后重试。系统不会在 AI 不可用时伪造审核结论。` +
            `（技术细节：${error.message.slice(0, 200)}）`,
        );
      }
      return internalError(
        "AI 审核未能给出可用结论，请重试；证据状态没有被改变。",
      );
    }
    return internalError("证据审核失败，请稍后重试。");
  }
}

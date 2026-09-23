/**
 * Reviewer selection entry point.
 *
 * Reuses the SAME `BOSS_GENERATOR` switch, API key and base URL as Goal
 * Discovery, so "mock or llm" is one environment variable for the whole product
 * and the demo can never be half-configured. Unknown values are CONFIG_ERROR,
 * never a silent fallback to mock.
 */
import {
  DEFAULT_API_BASE,
  DEFAULT_MODEL,
  GeneratorEnv,
  apiKeyFromEnv,
} from "../goal-discovery/factory";
import { OpenAICompatibleTransport } from "../goal-discovery/llm-generator";
import { LLMEvidenceReviewer } from "./llm-reviewer";
import { MockEvidenceReviewer } from "./mock-reviewer";
import { EvidenceReviewer, ReviewError } from "./types";

export type ReviewMode = "mock" | "llm";

/** Parses `BOSS_GENERATOR`, rejecting unknown values. */
export function resolveReviewMode(env: GeneratorEnv = process.env as unknown as GeneratorEnv): ReviewMode {
  const mode = (env.BOSS_GENERATOR ?? "mock").trim().toLowerCase();
  if (mode === "mock" || mode === "llm") return mode;
  throw new ReviewError(
    "CONFIG_ERROR",
    `BOSS_GENERATOR must be "mock" or "llm", got "${mode}"`,
  );
}

export function getEvidenceReviewer(
  env: GeneratorEnv = process.env as unknown as GeneratorEnv,
): EvidenceReviewer {
  const mode = resolveReviewMode(env);

  if (mode === "mock") {
    return new MockEvidenceReviewer();
  }

  const apiKey = apiKeyFromEnv(env);
  if (!apiKey) {
    throw new ReviewError(
      "CONFIG_ERROR",
      "BOSS_GENERATOR=llm requires BOSS_API_KEY or DEEPSEEK_API_KEY in the server environment",
    );
  }

  const transport = new OpenAICompatibleTransport({
    apiKey,
    baseUrl: env.BOSS_API_BASE ?? DEFAULT_API_BASE,
    model: (env.BOSS_MODEL ?? DEFAULT_MODEL).trim(),
  });
  return new LLMEvidenceReviewer({ transport });
}

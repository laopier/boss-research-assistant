/**
 * Generator selection entry point.
 *
 * BOSS_GENERATOR=mock (default) — deterministic offline generator.
 * BOSS_GENERATOR=llm           — live model via an OpenAI-compatible
 *                                endpoint; requires BOSS_API_KEY in the
 *                                server environment (never in the browser,
 *                                never in Git).
 *
 * Unknown values are CONFIG_ERROR, not a silent fallback.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { BossContractJson } from "./contract-types";
import { ContractGenerator, GenerationError } from "./generator";
import { LLMContractGenerator, OpenAICompatibleTransport } from "./llm-generator";
import { MockContractGenerator } from "./mock-generator";
import { FixtureSignature } from "./validation";

export const DEFAULT_API_BASE = "https://api.deepseek.com";
export const DEFAULT_MODEL = "deepseek-chat";

export interface GeneratorEnv {
  BOSS_GENERATOR?: string;
  BOSS_API_KEY?: string;
  BOSS_API_BASE?: string;
  BOSS_MODEL?: string;
}

function loadFixture(path: string): BossContractJson {
  return JSON.parse(readFileSync(path, "utf-8")) as BossContractJson;
}

const repoRoot = resolve(__dirname, "../../..");

const wacaSeBossFixture = loadFixture(resolve(repoRoot, "examples/waca-se-boss.json"));
const wacaAiFixture = loadFixture(resolve(repoRoot, "examples/ai/waca.json"));
const literatureReadingFixture = loadFixture(resolve(repoRoot, "examples/ai/literature-reading.json"));
const datasetInvestigationFixture = loadFixture(resolve(repoRoot, "examples/ai/dataset-investigation.json"));

/**
 * (id, title, objective) triples of the repository demo fixtures, deduplicated
 * by id — `examples/ai/waca.json` and `examples/waca-se-boss.json` share the
 * id `boss-waca-se-demo`, so the map yields three unique signatures.
 */
export const KNOWN_FIXTURE_SIGNATURES: readonly FixtureSignature[] = Array.from(
  new Map(
    ([wacaSeBossFixture, wacaAiFixture, literatureReadingFixture, datasetInvestigationFixture] as BossContractJson[])
      .map((doc) => [doc.id, { id: doc.id, title: doc.title, objective: doc.objective } satisfies FixtureSignature]),
  ).values(),
);

export function getGenerator(env: GeneratorEnv = process.env): ContractGenerator {
  const mode = (env.BOSS_GENERATOR ?? "mock").trim().toLowerCase();
  if (mode === "mock") {
    return new MockContractGenerator();
  }
  if (mode === "llm") {
    const apiKey = (env.BOSS_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new GenerationError(
        "CONFIG_ERROR",
        "BOSS_GENERATOR=llm requires BOSS_API_KEY to be set in the server environment",
      );
    }
    const transport = new OpenAICompatibleTransport({
      apiKey,
      baseUrl: env.BOSS_API_BASE ?? DEFAULT_API_BASE,
      model: (env.BOSS_MODEL ?? DEFAULT_MODEL).trim(),
    });
    return new LLMContractGenerator({
      transport,
      validationOptions: { knownFixtureSignatures: KNOWN_FIXTURE_SIGNATURES },
    });
  }
  throw new GenerationError("CONFIG_ERROR", `BOSS_GENERATOR must be "mock" or "llm", got "${mode}"`);
}

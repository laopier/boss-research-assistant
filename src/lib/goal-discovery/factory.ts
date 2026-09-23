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
  /** Provider-specific alias accepted for simpler DeepSeek deployments. */
  DEEPSEEK_API_KEY?: string;
  BOSS_API_BASE?: string;
  BOSS_MODEL?: string;
}

/** Keeps the generic variable canonical while accepting the common DeepSeek alias. */
export function apiKeyFromEnv(env: GeneratorEnv): string {
  return env.BOSS_API_KEY?.trim() || env.DEEPSEEK_API_KEY?.trim() || "";
}

/**
 * Repository-root candidates for locating the demo fixtures.
 *
 * `__dirname` is correct under tsx (`src/lib/goal-discovery`), but bundlers
 * such as Turbopack may rewrite it to a virtual path (e.g. `d:\ROOT`), so we
 * always fall back to the process working directory.
 */
function candidateRepoRoots(): string[] {
  return [resolve(__dirname, "../../.."), process.cwd()];
}

function loadFixtureIfPresent(root: string, relativePath: string): BossContractJson | null {
  try {
    return JSON.parse(readFileSync(resolve(root, relativePath), "utf-8")) as BossContractJson;
  } catch {
    return null;
  }
}

const FIXTURE_PATHS = [
  "examples/waca-se-boss.json",
  "examples/ai/waca.json",
  "examples/ai/literature-reading.json",
  "examples/ai/dataset-investigation.json",
] as const;

let cachedSignatures: readonly FixtureSignature[] | null = null;

/**
 * (id, title, objective) triples of the repository demo fixtures, deduplicated
 * by id — `examples/ai/waca.json` and `examples/waca-se-boss.json` share the
 * id `boss-waca-se-demo`, so the map yields three unique signatures.
 *
 * Loaded lazily (never at module evaluation) so that a missing or unreadable
 * fixture file cannot crash the module graph in a dev server or a bundled
 * deployment; unreachable fixtures are simply skipped.
 */
export function loadKnownFixtureSignatures(): readonly FixtureSignature[] {
  if (cachedSignatures !== null) {
    return cachedSignatures;
  }
  const roots = candidateRepoRoots();
  const docs: BossContractJson[] = [];
  for (const relativePath of FIXTURE_PATHS) {
    const doc = roots
      .map((root) => loadFixtureIfPresent(root, relativePath))
      .find((candidate): candidate is BossContractJson => candidate !== null);
    if (doc !== undefined) {
      docs.push(doc);
    }
  }
  cachedSignatures = Array.from(
    new Map(
      docs.map((doc) => [
        doc.id,
        { id: doc.id, title: doc.title, objective: doc.objective } satisfies FixtureSignature,
      ]),
    ).values(),
  );
  return cachedSignatures;
}

export function getGenerator(env: GeneratorEnv = process.env as unknown as GeneratorEnv): ContractGenerator {
  const mode = (env.BOSS_GENERATOR ?? "mock").trim().toLowerCase();
  if (mode === "mock") {
    return new MockContractGenerator();
  }
  if (mode === "llm") {
    const apiKey = apiKeyFromEnv(env);
    if (!apiKey) {
      throw new GenerationError(
        "CONFIG_ERROR",
        "BOSS_GENERATOR=llm requires BOSS_API_KEY or DEEPSEEK_API_KEY in the server environment",
      );
    }
    const transport = new OpenAICompatibleTransport({
      apiKey,
      baseUrl: env.BOSS_API_BASE ?? DEFAULT_API_BASE,
      model: (env.BOSS_MODEL ?? DEFAULT_MODEL).trim(),
    });
    return new LLMContractGenerator({
      transport,
      validationOptions: { knownFixtureSignatures: loadKnownFixtureSignatures() },
    });
  }
  throw new GenerationError("CONFIG_ERROR", `BOSS_GENERATOR must be "mock" or "llm", got "${mode}"`);
}

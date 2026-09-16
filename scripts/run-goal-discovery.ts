/**
 * Real-model run harness for Goal Discovery.
 *
 * Usage (from the repo root, with .env containing BOSS_API_KEY):
 *   node --import tsx scripts/run-goal-discovery.ts fixtures   # replay the
 *                                     three demo fixture rawGoals
 *   node --import tsx scripts/run-goal-discovery.ts eval       # run the full
 *                                     adversarial eval set examples/ai/eval/cases.v1.json
 *
 * Every case writes a JSON artifact (raw model outputs preserved verbatim)
 * plus a summary.json. Artifacts live under docs/ai/runs/<date>/.
 *
 * The script reads .env but never writes secrets into artifacts.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { BossContractJson } from "../src/lib/goal-discovery/contract-types";
import { KNOWN_FIXTURE_SIGNATURES } from "../src/lib/goal-discovery/factory";
import { LLMContractGenerator } from "../src/lib/goal-discovery/llm-generator";
import { LlmRequest, LlmResponse, LlmTransport } from "../src/lib/goal-discovery/llm-generator";
import { OpenAICompatibleTransport } from "../src/lib/goal-discovery/llm-generator";
import { formatDiagnostics, validateContract } from "../src/lib/goal-discovery/validation";

const repoRoot = resolve(__dirname, "..");

/** Minimal .env loader: KEY=VALUE lines, trim, strip quotes, never override. */
function loadDotEnv(path: string): void {
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    return;
  }
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

interface AttemptRecord {
  userPrompt: string;
  rawOutput: string;
  durationMs: number;
}

class RecordingTransport implements LlmTransport {
  readonly attempts: AttemptRecord[] = [];

  constructor(private readonly inner: LlmTransport) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const startedAt = Date.now();
    const response = await this.inner.complete(request);
    this.attempts.push({
      userPrompt: request.userPrompt,
      rawOutput: response.content ?? "",
      durationMs: Date.now() - startedAt,
    });
    return response;
  }
}

interface EvalCase {
  id: string;
  goal: string;
  expected: "CONTRACT" | "INPUT_REJECTED";
  intent: string;
}

interface CaseArtifact {
  id: string;
  goal: string;
  expected: EvalCase["expected"];
  intent: string;
  outcome: "CONTRACT" | "INPUT_REJECTED" | "INVALID_OUTPUT" | "ERROR";
  attempts: AttemptRecord[];
  contract: BossContractJson | null;
  postValidation: { outcome: string; diagnostics: string[] } | null;
  failureDiagnostics: string[] | null;
  error: string | null;
  durationMs: number;
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "fixtures" && mode !== "eval") {
    console.error('usage: run-goal-discovery.ts <fixtures|eval>');
    process.exit(2);
  }

  loadDotEnv(resolve(repoRoot, ".env"));

  const apiKey = (process.env.BOSS_API_KEY ?? "").trim();
  if (!apiKey) {
    console.error("BOSS_API_KEY is required (set it in .env)");
    process.exit(2);
  }

  const runDate = new Date().toISOString().slice(0, 10);
  const outDir = resolve(
    repoRoot,
    `docs/ai/runs/${runDate}/${mode === "fixtures" ? "first-run" : "eval-run"}`,
  );
  mkdirSync(outDir, { recursive: true });

  const cases: EvalCase[] =
    mode === "fixtures"
      ? [
          "examples/ai/waca.json",
          "examples/ai/literature-reading.json",
          "examples/ai/dataset-investigation.json",
        ].map((path, index) => {
          const doc = JSON.parse(readFileSync(resolve(repoRoot, path), "utf-8")) as BossContractJson;
          return {
            id: `FIXTURE-${index + 1}`,
            goal: doc.rawGoal,
            expected: "CONTRACT" as const,
            intent: `replay rawGoal of ${path}`,
          };
        })
      : (JSON.parse(
          readFileSync(resolve(repoRoot, "examples/ai/eval/cases.v1.json"), "utf-8"),
        ) as { cases: EvalCase[] }).cases;

  const artifacts: CaseArtifact[] = [];
  const startedAt = Date.now();

  for (const testCase of cases) {
    const caseStartedAt = Date.now();
    const transport = new RecordingTransport(
      new OpenAICompatibleTransport({
        apiKey,
        baseUrl: process.env.BOSS_API_BASE ?? "https://api.deepseek.com",
        model: (process.env.BOSS_MODEL ?? "deepseek-chat").trim(),
      }),
    );
    const generator = new LLMContractGenerator({
      transport,
      validationOptions: { knownFixtureSignatures: KNOWN_FIXTURE_SIGNATURES },
    });

    const artifact: CaseArtifact = {
      ...testCase,
      outcome: "ERROR",
      attempts: transport.attempts,
      contract: null,
      postValidation: null,
      failureDiagnostics: null,
      error: null,
      durationMs: 0,
    };

    try {
      const contract = await generator.generate(testCase.goal);
      artifact.contract = contract;
      const recheck = validateContract(testCase.goal, contract, {
        knownFixtureSignatures: KNOWN_FIXTURE_SIGNATURES,
      });
      artifact.postValidation = {
        outcome: recheck.outcome,
        diagnostics: recheck.diagnostics.map((d) => formatDiagnostics([d])),
      };
      artifact.outcome = recheck.outcome;
    } catch (error) {
      artifact.outcome = "ERROR";
      artifact.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      if (error instanceof Error && "diagnostics" in error && Array.isArray((error as { diagnostics?: unknown }).diagnostics)) {
        artifact.failureDiagnostics = (error as { diagnostics: string[] }).diagnostics;
      }
      // A clean INPUT_REJECTED is an expected outcome, not an error.
      if (error instanceof Error && (error as { code?: unknown }).code === "INPUT_REJECTED") {
        artifact.outcome = "INPUT_REJECTED";
        artifact.error = null;
      }
    }

    artifact.durationMs = Date.now() - caseStartedAt;
    artifacts.push(artifact);
    writeFileSync(
      resolve(outDir, `${testCase.id}.json`),
      JSON.stringify(artifact, null, 2),
      "utf-8",
    );
    console.log(`${testCase.id}: ${artifact.outcome} (${artifact.attempts.length} attempts, ${artifact.durationMs}ms)`);
  }

  const passed = artifacts.filter(
    (a) =>
      (a.expected === "CONTRACT" && a.outcome === "CONTRACT") ||
      (a.expected === "INPUT_REJECTED" && a.outcome === "INPUT_REJECTED"),
  );
  const summary = {
    mode,
    runDate,
    model: (process.env.BOSS_MODEL ?? "deepseek-chat").trim(),
    total: artifacts.length,
    passed: passed.length,
    failed: artifacts.length - passed.length,
    durationMs: Date.now() - startedAt,
    cases: artifacts.map((a) => ({
      id: a.id,
      expected: a.expected,
      outcome: a.outcome,
      attempts: a.attempts.length,
      durationMs: a.durationMs,
    })),
  };
  writeFileSync(resolve(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf-8");
  console.log(`summary: ${summary.passed}/${summary.total} passed -> ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

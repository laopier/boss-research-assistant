/**
 * Generator tests: input guards, mock determinism, transport behaviour,
 * JSON extraction, and the two-attempt repair loop of the LLM generator.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { BossContractJson } from "../lib/goal-discovery/contract-types";
import { assertGoalValid, GenerationError } from "../lib/goal-discovery/generator";
import {
  extractJson,
  LLMContractGenerator,
  LlmRequest,
  LlmResponse,
  LlmTransport,
  OpenAICompatibleTransport,
} from "../lib/goal-discovery/llm-generator";
import { buildMockContract, MockContractGenerator } from "../lib/goal-discovery/mock-generator";
import { validateContract } from "../lib/goal-discovery/validation";

// ---------------------------------------------------------------------------
// assertGoalValid
// ---------------------------------------------------------------------------

test("assertGoalValid accepts exactly 500 characters and rejects 501", () => {
  assert.equal(assertGoalValid(`  ${"读".repeat(500)}  `).length, 500);
  assert.throws(() => assertGoalValid("读".repeat(501)), (error: unknown) => {
    assert.ok(error instanceof GenerationError);
    assert.equal(error.code, "INPUT_REJECTED");
    return true;
  });
});

test("assertGoalValid rejects empty and whitespace-only goals", () => {
  assert.throws(() => assertGoalValid(""));
  assert.throws(() => assertGoalValid("   \n\t "));
});

// ---------------------------------------------------------------------------
// MockContractGenerator
// ---------------------------------------------------------------------------

test("mock contract passes the full validation pipeline", () => {
  const outcome = validateContract("我想复现一篇论文，但不知道从哪里开始。", buildMockContract("我想复现一篇论文，但不知道从哪里开始。"));
  assert.equal(outcome.outcome, "CONTRACT");
  assert.equal(outcome.diagnostics.length, 0);
});

test("mock generator is deterministic for the same trimmed goal", async () => {
  const generator = new MockContractGenerator();
  const a = await generator.generate("  同一个目标  ");
  const b = await generator.generate("同一个目标");
  assert.deepEqual(a, b);
});

test("mock generator differs across different goals", async () => {
  const a = await new MockContractGenerator().generate("目标甲");
  const b = await new MockContractGenerator().generate("目标乙");
  assert.notEqual(a.id, b.id);
});

test("mock generator rejects an over-length goal", async () => {
  await assert.rejects(
    () => new MockContractGenerator().generate("x".repeat(501)),
    (error: unknown) => error instanceof GenerationError && error.code === "INPUT_REJECTED",
  );
});

// ---------------------------------------------------------------------------
// OpenAICompatibleTransport
// ---------------------------------------------------------------------------

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
}

test("transport posts to baseUrl/chat/completions with auth and json_object", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const transport = new OpenAICompatibleTransport({
    apiKey: "sk-test",
    baseUrl: "https://api.example.com/v1/",
    model: "test-model",
    fetchImpl,
  });
  const response = await transport.complete({ systemPrompt: "s", userPrompt: "u" });
  assert.equal(response.content, "{}");
  assert.equal(capturedUrl, "https://api.example.com/v1/chat/completions");

  const body = JSON.parse(String(capturedInit!.body)) as Record<string, unknown>;
  assert.equal(body.model, "test-model");
  assert.equal(body.stream, false);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal((capturedInit!.headers as Record<string, string>).Authorization, "Bearer sk-test");
});

test("transport maps HTTP 500 to TRANSPORT_ERROR", async () => {
  const transport = new OpenAICompatibleTransport({
    apiKey: "k",
    baseUrl: "https://api.example.com",
    model: "m",
    fetchImpl: fakeFetch(500, { error: "boom" }),
  });
  await assert.rejects(
    () => transport.complete({ systemPrompt: "s", userPrompt: "u" }),
    (error: unknown) => error instanceof GenerationError && error.code === "TRANSPORT_ERROR",
  );
});

test("transport maps fetch failure to TRANSPORT_ERROR", async () => {
  const fetchImpl = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  const transport = new OpenAICompatibleTransport({
    apiKey: "k",
    baseUrl: "https://api.example.com",
    model: "m",
    fetchImpl,
  });
  await assert.rejects(
    () => transport.complete({ systemPrompt: "s", userPrompt: "u" }),
    (error: unknown) => error instanceof GenerationError && error.code === "TRANSPORT_ERROR",
  );
});

test("transport rejects a response without message content", async () => {
  const transport = new OpenAICompatibleTransport({
    apiKey: "k",
    baseUrl: "https://api.example.com",
    model: "m",
    fetchImpl: fakeFetch(200, { choices: [] }),
  });
  await assert.rejects(
    () => transport.complete({ systemPrompt: "s", userPrompt: "u" }),
    (error: unknown) => error instanceof GenerationError && error.code === "TRANSPORT_ERROR",
  );
});

// ---------------------------------------------------------------------------
// extractJson
// ---------------------------------------------------------------------------

test("extractJson handles raw JSON", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
});

test("extractJson handles ```json fences", () => {
  assert.deepEqual(extractJson('Here you go:\n```json\n{"a":1}\n```\nthanks'), { a: 1 });
});

test("extractJson handles bare ``` fences", () => {
  assert.deepEqual(extractJson('```\n{"a":1}\n```'), { a: 1 });
});

test("extractJson handles prose before a balanced object", () => {
  assert.deepEqual(extractJson('Sure! {"a": {"b": "has } brace"}} hope it helps'), { a: { b: "has } brace" } });
});

test("extractJson returns null when nothing parses", () => {
  assert.equal(extractJson("no json here at all"), null);
  assert.equal(extractJson(""), null);
  assert.equal(extractJson("[1,2,3]"), null);
});

// ---------------------------------------------------------------------------
// LLMContractGenerator — two-attempt repair loop
// ---------------------------------------------------------------------------

class ScriptedTransport implements LlmTransport {
  constructor(private readonly replies: string[]) {}
  readonly requests: LlmRequest[] = [];
  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    const reply = this.replies.shift();
    if (reply === undefined) throw new Error("script exhausted");
    return { content: reply };
  }
}

function validContractJson(): BossContractJson {
  return buildMockContract("我想复现一篇论文，但不知道从哪里开始。");
}

test("LLM generator returns a contract when the first attempt is valid", async () => {
  const transport = new ScriptedTransport([JSON.stringify(validContractJson())]);
  const generator = new LLMContractGenerator({ transport });
  const contract = await generator.generate("我想复现一篇论文，但不知道从哪里开始。");
  assert.equal(contract.schemaVersion, "boss-contract.v0");
  assert.equal(transport.requests.length, 1);
});

test("LLM generator includes selected project context in initial and repair prompts", async () => {
  const broken = validContractJson();
  broken.acceptanceCriteria[0].status = "PASS";
  const transport = new ScriptedTransport([JSON.stringify(broken), JSON.stringify(validContractJson())]);
  const generator = new LLMContractGenerator({ transport });
  const projectContext = {
    sourceName: "本地项目",
    fileNames: ["notes.md"],
    content: "--- file: notes.md ---\n已有工作",
  };
  await generator.generate("继续下一步", { projectContext });
  for (const request of transport.requests) {
    const payload = JSON.parse(request.userPrompt) as { projectContext?: typeof projectContext };
    assert.deepEqual(payload.projectContext, projectContext);
  }
});

test("LLM generator repairs once when the second attempt is valid", async () => {
  const broken = validContractJson();
  broken.acceptanceCriteria[0].status = "PASS"; // S11 violation
  const transport = new ScriptedTransport([JSON.stringify(broken), JSON.stringify(validContractJson())]);
  const generator = new LLMContractGenerator({ transport });
  const contract = await generator.generate("我想复现一篇论文，但不知道从哪里开始。");
  assert.equal(contract.acceptanceCriteria[0].status, "UNKNOWN");
  assert.equal(transport.requests.length, 2);
  // repair prompt carries the validation diagnostics
  const repairPrompt = JSON.parse(transport.requests[1].userPrompt) as { previousAttemptInvalid?: boolean; validationErrors?: string };
  assert.equal(repairPrompt.previousAttemptInvalid, true);
  assert.ok(repairPrompt.validationErrors!.includes("S11"));
});

test("LLM generator throws GENERATION_FAILED after two invalid attempts", async () => {
  const broken = validContractJson();
  broken.deliverables[0].status = "DONE"; // S10
  const transport = new ScriptedTransport([JSON.stringify(broken), JSON.stringify(broken)]);
  const generator = new LLMContractGenerator({ transport });
  await assert.rejects(
    () => generator.generate("我想复现一篇论文，但不知道从哪里开始。"),
    (error: unknown) => error instanceof GenerationError && error.code === "GENERATION_FAILED",
  );
  assert.equal(transport.requests.length, 2);
});

test("LLM generator treats non-JSON replies as repairable and retries", async () => {
  const transport = new ScriptedTransport(["I cannot do that.", JSON.stringify(validContractJson())]);
  const generator = new LLMContractGenerator({ transport });
  const contract = await generator.generate("我想复现一篇论文，但不知道从哪里开始。");
  assert.equal(contract.id, validContractJson().id);
});

test("LLM generator rejects an over-length goal before any transport call", async () => {
  const transport = new ScriptedTransport([]);
  const generator = new LLMContractGenerator({ transport });
  await assert.rejects(
    () => generator.generate("x".repeat(501)),
    (error: unknown) => error instanceof GenerationError && error.code === "INPUT_REJECTED",
  );
  assert.equal(transport.requests.length, 0);
});

test("S8 plagiarism triggers a repair attempt (fixture signatures forwarded)", async () => {
  const plagiarized = validContractJson(); // triple matches the known signature
  const signature = { id: plagiarized.id, title: plagiarized.title, objective: plagiarized.objective };
  const repaired = buildMockContract("一个完全不同的目标");
  const transport = new ScriptedTransport([JSON.stringify(plagiarized), JSON.stringify(repaired)]);
  const generator = new LLMContractGenerator({
    transport,
    validationOptions: { knownFixtureSignatures: [signature] },
  });
  const contract = await generator.generate("一个完全不同的目标");
  assert.equal(transport.requests.length, 2);
  assert.equal(contract.id, repaired.id);
});

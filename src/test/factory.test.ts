/**
 * Factory tests: generator selection from environment, configuration
 * errors, and the deduplicated known-fixture signature list.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_API_BASE,
  DEFAULT_MODEL,
  getGenerator,
  loadKnownFixtureSignatures,
} from "../lib/goal-discovery/factory";
import { GenerationError } from "../lib/goal-discovery/generator";
import { LLMContractGenerator } from "../lib/goal-discovery/llm-generator";
import { MockContractGenerator } from "../lib/goal-discovery/mock-generator";

test("defaults to the mock generator when BOSS_GENERATOR is unset", () => {
  assert.ok(getGenerator({}) instanceof MockContractGenerator);
});

test("explicit mock value selects the mock generator", () => {
  assert.ok(getGenerator({ BOSS_GENERATOR: "mock" }) instanceof MockContractGenerator);
});

test("llm with a key selects the LLM generator", () => {
  assert.ok(
    getGenerator({ BOSS_GENERATOR: "llm", BOSS_API_KEY: "k" }) instanceof LLMContractGenerator,
  );
});

test("llm accepts the provider-specific DeepSeek key alias", () => {
  assert.ok(
    getGenerator({ BOSS_GENERATOR: "llm", DEEPSEEK_API_KEY: "k" }) instanceof
      LLMContractGenerator,
  );
});

test("BOSS_GENERATOR is case-insensitive and trimmed", () => {
  assert.ok(
    getGenerator({ BOSS_GENERATOR: "  LLM  ", BOSS_API_KEY: "k" }) instanceof LLMContractGenerator,
  );
});

test("llm without a key is CONFIG_ERROR", () => {
  assert.throws(
    () => getGenerator({ BOSS_GENERATOR: "llm" }),
    (error: unknown) => error instanceof GenerationError && error.code === "CONFIG_ERROR",
  );
});

test("unknown BOSS_GENERATOR value is CONFIG_ERROR", () => {
  assert.throws(
    () => getGenerator({ BOSS_GENERATOR: "quantum" }),
    (error: unknown) =>
      error instanceof GenerationError &&
      error.code === "CONFIG_ERROR" &&
      error.message.includes("quantum"),
  );
});

test("loadKnownFixtureSignatures covers the three unique fixture ids", () => {
  const ids = loadKnownFixtureSignatures().map((signature) => signature.id).sort();
  assert.deepEqual(ids, [
    "boss-dataset-investigation-demo",
    "boss-literature-reading-demo",
    "boss-waca-se-demo",
  ]);
  for (const signature of loadKnownFixtureSignatures()) {
    assert.ok(signature.title.length > 0);
    assert.ok(signature.objective.length > 0);
  }
});

test("default endpoint constants point at DeepSeek", () => {
  assert.equal(DEFAULT_API_BASE, "https://api.deepseek.com");
  assert.equal(DEFAULT_MODEL, "deepseek-chat");
});

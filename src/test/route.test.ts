/**
 * Route-level regression tests for POST /api/contracts/generate.
 *
 * The focus is the request boundary: which inputs are the client's fault (400)
 * and which are the server's (500). A malformed body used to be reported as 500
 * because JSON parsing shared a try block with generation, so the catch-all
 * swallowed it. These tests pin that down.
 *
 * Generation runs in mock mode, which is deterministic and offline, so no
 * network access or API key is required.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { POST } from "../app/api/contracts/generate/route";

const ENDPOINT = "http://localhost/api/contracts/generate";

function post(body: string, contentType = "application/json"): Promise<Response> {
  return POST(
    new Request(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    }),
  );
}

function postJson(value: unknown): Promise<Response> {
  return post(JSON.stringify(value));
}

describe("POST /api/contracts/generate", () => {
  const originalGenerator = process.env.BOSS_GENERATOR;

  before(() => {
    process.env.BOSS_GENERATOR = "mock";
  });

  after(() => {
    if (originalGenerator === undefined) {
      delete process.env.BOSS_GENERATOR;
    } else {
      process.env.BOSS_GENERATOR = originalGenerator;
    }
  });

  describe("malformed bodies are client errors (400)", () => {
    it("rejects a body that is not valid JSON", async () => {
      const response = await post("not json");
      assert.equal(response.status, 400);
      const body = (await response.json()) as { error: { code: string } };
      assert.equal(body.error.code, "INVALID_REQUEST");
    });

    it("rejects an empty body", async () => {
      const response = await post("");
      assert.equal(response.status, 400);
    });

    // Valid JSON is not necessarily a usable body. Each of these previously
    // risked a property access on a non-object and surfacing as 500.
    for (const [label, payload] of [
      ["null", "null"],
      ["an array", "[]"],
      ["a string", '"hello"'],
      ["a number", "42"],
      ["a boolean", "true"],
    ] as const) {
      it(`rejects ${label} body`, async () => {
        const response = await post(payload);
        assert.equal(response.status, 400, `${label} should be a 400`);
        const body = (await response.json()) as { error: { code: string } };
        assert.equal(body.error.code, "INVALID_REQUEST");
      });
    }
  });

  describe("invalid payloads are client errors (400)", () => {
    it("rejects an empty goal", async () => {
      const response = await postJson({ schemaVersion: "boss-contract.v0", goal: "   " });
      assert.equal(response.status, 400);
    });

    it("rejects a goal longer than 500 characters", async () => {
      const response = await postJson({ schemaVersion: "boss-contract.v0", goal: "x".repeat(501) });
      assert.equal(response.status, 400);
    });

    it("rejects a mismatched schemaVersion", async () => {
      const response = await postJson({ schemaVersion: "boss-contract.v1", goal: "test" });
      assert.equal(response.status, 400);
    });

    it("rejects a missing goal field", async () => {
      const response = await postJson({ schemaVersion: "boss-contract.v0" });
      assert.equal(response.status, 400);
    });

    it("does not leak the submitted goal length as an internal fault", async () => {
      const response = await postJson({ schemaVersion: "boss-contract.v0", goal: "x".repeat(501) });
      const body = (await response.json()) as { error: { code: string } };
      assert.notEqual(body.error.code, "INTERNAL_ERROR");
    });
  });

  describe("a valid goal is accepted", () => {
    it("returns a live DRAFT contract in mock mode", async () => {
      const goal = "我想复现 WACA 论文，但不知道从哪里开始";
      const response = await postJson({ schemaVersion: "boss-contract.v0", goal });
      assert.equal(response.status, 200);

      const body = (await response.json()) as {
        generation: string;
        contract: {
          recordKind: string;
          status: string;
          rawGoal: string;
          revision: number;
          evidenceItems: unknown[];
          criteria: unknown;
          acceptanceCriteria: Array<{ status: string }>;
        };
      };

      assert.equal(body.generation, "MOCK");
      assert.equal(body.contract.recordKind, "LIVE");
      assert.equal(body.contract.status, "DRAFT");
      assert.equal(body.contract.revision, 1);
      // The submitted goal is preserved verbatim, not reinterpreted.
      assert.equal(body.contract.rawGoal, goal);
      // Goal Discovery must not invent evidence or pre-complete criteria.
      assert.deepEqual(body.contract.evidenceItems, []);
      assert.ok(body.contract.acceptanceCriteria.length > 0);
      for (const criterion of body.contract.acceptanceCriteria) {
        assert.equal(criterion.status, "UNKNOWN");
      }
    });

    it("accepts a goal at the 500 character limit", async () => {
      const response = await postJson({
        schemaVersion: "boss-contract.v0",
        goal: "x".repeat(500),
      });
      assert.equal(response.status, 200);
    });
  });
});

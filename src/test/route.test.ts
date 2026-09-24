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

    it("rejects malformed or oversized local project context", async () => {
      const malformed = await postJson({
        schemaVersion: "boss-contract.v0",
        goal: "continue",
        projectContext: { sourceName: "repo", fileNames: [], content: "x" },
      });
      assert.equal(malformed.status, 400);

      const oversized = await postJson({
        schemaVersion: "boss-contract.v0",
        goal: "continue",
        projectContext: {
          sourceName: "repo",
          fileNames: ["README.md"],
          content: "x".repeat(24_001),
        },
      });
      assert.equal(oversized.status, 400);
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

    it("accepts bounded, explicitly selected local context", async () => {
      const response = await postJson({
        schemaVersion: "boss-contract.v0",
        goal: "根据已有笔记生成下一步",
        projectContext: {
          sourceName: "本地项目",
          fileNames: ["README.md"],
          content: "--- file: README.md ---\n已完成数据审计。",
        },
      });
      assert.equal(response.status, 200);
    });

    it("generates a complete project outline only when the first Boss asks for it", async () => {
      const response = await postJson({
        schemaVersion: "boss-contract.v0",
        goal: "我想复现一篇论文",
        includeProjectPlan: true,
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        projectPlan?: { schemaVersion: string; milestones: Array<{ steps: unknown[] }> };
      };
      assert.equal(body.projectPlan?.schemaVersion, "project-plan.v1");
      assert.ok((body.projectPlan?.milestones.length ?? 0) >= 2);
      assert.ok((body.projectPlan?.milestones.flatMap((item) => item.steps).length ?? 0) >= 4);

      const ordinary = await postJson({
        schemaVersion: "boss-contract.v0",
        goal: "生成后续 Boss",
      });
      const ordinaryBody = (await ordinary.json()) as { projectPlan?: unknown };
      assert.equal(ordinaryBody.projectPlan, undefined);
    });
  });
});

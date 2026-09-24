import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { POST } from "../app/api/negotiation/chat/route";
import {
  NEGOTIATION_CHAT_VERSION,
  NegotiationChatContext,
  parseNegotiationModelReply,
  parseNegotiationRequest,
} from "../lib/negotiation-chat";

const context: NegotiationChatContext = {
  goal: "完成论文复现",
  revision: 1,
  currentBossId: "boss-1",
  milestones: [
    {
      id: "M-1",
      title: "读懂论文",
      bosses: [{ id: "boss-1", objective: "整理论文方法" }],
    },
    { id: "M-2", title: "完成实验", bosses: [] },
  ],
};

function request(message = "我想把当前任务延期到后面") {
  return {
    version: NEGOTIATION_CHAT_VERSION,
    message,
    history: [{ role: "assistant" as const, content: "你想怎么调整？" }],
    context,
  };
}

describe("negotiation chat validation", () => {
  it("accepts a bounded free-form conversation request", () => {
    assert.deepEqual(parseNegotiationRequest(request()), request());
  });

  it("rejects oversized messages and unknown versions", () => {
    assert.equal(parseNegotiationRequest({ ...request(), message: "x".repeat(801) }), null);
    assert.equal(parseNegotiationRequest({ ...request(), version: "future" }), null);
  });

  it("accepts a proposal only when it references the visible roadmap", () => {
    assert.deepEqual(
      parseNegotiationModelReply(
        {
          reply: "我已经整理成提案。",
          state: "PROPOSAL",
          proposalInput: { kind: "MOVE_BOSS", contractId: "boss-1", milestoneId: "M-2" },
        },
        context,
      ),
      {
        reply: "我已经整理成提案。",
        state: "PROPOSAL",
        proposalInput: {
          kind: "MOVE_BOSS",
          contractId: "boss-1",
          milestoneId: "M-2",
          title: undefined,
        },
      },
    );
    assert.equal(
      parseNegotiationModelReply(
        {
          reply: "完成。",
          state: "PROPOSAL",
          proposalInput: { kind: "MOVE_BOSS", contractId: "invented", milestoneId: "M-2" },
        },
        context,
      ),
      null,
    );
  });

  it("keeps a clarifying reply non-mutating", () => {
    assert.deepEqual(
      parseNegotiationModelReply({ reply: "你具体想推迟哪个任务？", state: "DISCUSSING" }, context),
      { reply: "你具体想推迟哪个任务？", state: "DISCUSSING" },
    );
  });
});

describe("POST /api/negotiation/chat", () => {
  const originalMode = process.env.BOSS_GENERATOR;

  before(() => {
    process.env.BOSS_GENERATOR = "mock";
  });

  after(() => {
    if (originalMode === undefined) delete process.env.BOSS_GENERATOR;
    else process.env.BOSS_GENERATOR = originalMode;
  });

  it("rejects malformed requests", async () => {
    const response = await POST(
      new Request("http://localhost/api/negotiation/chat", {
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      }),
    );
    assert.equal(response.status, 400);
  });

  it("turns free text into a previewable proposal without applying it", async () => {
    const response = await POST(
      new Request("http://localhost/api/negotiation/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request()),
      }),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      state: string;
      proposalInput: { kind: string; contractId: string };
    };
    assert.equal(body.state, "PROPOSAL");
    assert.deepEqual(body.proposalInput, { kind: "DEFER_BOSS", contractId: "boss-1" });
  });
});


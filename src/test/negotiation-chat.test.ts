import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { POST } from "../app/api/negotiation/chat/route";
import {
  NEGOTIATION_CHAT_VERSION,
  NegotiationChatContext,
  buildNegotiationPrompt,
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
          nextGoal: undefined,
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

  it("accepts a duplicate replacement only with a known Boss, milestone, and bounded next goal", () => {
    const replacement = {
      reply: "我会保留一个环境准备 Boss，暂停重复项，并生成最小可运行示例。",
      state: "PROPOSAL",
      proposalInput: {
        kind: "REPLACE_BOSS",
        contractId: "boss-1",
        milestoneId: "M-2",
        nextGoal: "跑通数据加载、模型前向与一次训练迭代的最小可运行示例",
      },
    };
    assert.deepEqual(parseNegotiationModelReply(replacement, context), {
      reply: replacement.reply,
      state: "PROPOSAL",
      proposalInput: {
        kind: "REPLACE_BOSS",
        contractId: "boss-1",
        milestoneId: "M-2",
        title: undefined,
        nextGoal: replacement.proposalInput.nextGoal,
      },
    });
    assert.equal(
      parseNegotiationModelReply(
        { ...replacement, proposalInput: { ...replacement.proposalInput, nextGoal: undefined } },
        context,
      ),
      null,
    );
  });

  it("tells the model to resolve a user's short confirmation from conversation context", () => {
    const prompt = buildNegotiationPrompt({
      ...request("取消一个重复，新增最小可运行示例吧"),
      history: [
        {
          role: "assistant",
          content: "保留环境方案，取消另一个重复 Boss，并新增最小可运行示例，可以吗？",
        },
      ],
    });
    assert.match(prompt, /REPLACE_BOSS/);
    assert.match(prompt, /do not ask again/);
    assert.match(prompt, /取消一个重复/);
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

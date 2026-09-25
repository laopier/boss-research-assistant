/**
 * Tests for the browser-side review client.
 *
 * The two things worth pinning here are not "does fetch work": they are that a
 * failure is always described as a failure, and that a malformed or missing
 * verdict is discarded rather than rendered. Every error message is asserted to
 * avoid sounding like a verdict, because "the AI was down and the page said
 * something vague" is how a fake PASS gets into a demo.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AcceptanceCriterion } from "../lib/contracts";
import {
  REVIEW_ENDPOINT,
  REVIEW_FAILURE_GUARANTEE,
  ReviewRequestError,
  buildReviewRequest,
  requestEvidenceReview,
  reviewErrorDetail,
  reviewErrorMessage,
} from "../lib/evidence-review/client";
import { REVIEW_SCHEMA_VERSION } from "../lib/evidence-review/types";

function criterion(): AcceptanceCriterion {
  return {
    id: "AC-2",
    description: "Stage 2 receives Xweak",
    required: true,
    // Deliberately not "UNKNOWN": the current status must never leave the client.
    status: "FAIL",
    evidenceRequirements: [
      {
        id: "REQ-2-SOURCE",
        description: "Source inspection identifies the tensor supplied in Stage 2",
        acceptedSourceTypes: ["ARTIFACT_INSPECTED"],
        minimumCount: 1,
      },
    ],
  };
}

const submission = {
  sourceType: "ARTIFACT_INSPECTED" as const,
  sourceName: "models/waca.py",
  content: "self.stage2_input = self.stage1_descriptor",
};

function request() {
  return buildReviewRequest(criterion(), criterion().evidenceRequirements[0], submission);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const validReview = {
  decision: "ACCEPTED",
  finding: "FAIL",
  rationale: "代码显示 Stage 2 使用的是 Stage 1 描述符。",
  proofBoundary: "ARTIFACT_INSPECTED",
  suggestedNextEvidence: [{ sourceType: "LOG_INSPECTED", hint: "附上运行日志。" }],
};

describe("buildReviewRequest", () => {
  it("sends the requirement and the submission, and nothing else", () => {
    const built = request();
    assert.equal(built.schemaVersion, REVIEW_SCHEMA_VERSION);
    assert.equal(built.requirement.id, "REQ-2-SOURCE");
    assert.deepEqual(built.requirement.acceptedSourceTypes, ["ARTIFACT_INSPECTED"]);
    assert.equal(built.submission.content, submission.content);
  });

  it("withholds the criterion's current status from the reviewer", () => {
    const built = request();
    const wire = built.criterion as unknown as Record<string, unknown>;
    assert.equal(wire.status, undefined, "a reviewer must not be anchored by the status");
    assert.deepEqual(Object.keys(wire).sort(), ["description", "id", "required"]);
  });

  it("copies the accepted source types instead of aliasing the contract", () => {
    const source = criterion();
    const built = buildReviewRequest(source, source.evidenceRequirements[0], submission);
    built.requirement.acceptedSourceTypes.push("AUTO_VERIFIED");
    assert.deepEqual(source.evidenceRequirements[0].acceptedSourceTypes, ["ARTIFACT_INSPECTED"]);
  });

  it("includes the selected deliverable so the reviewer judges the association", () => {
    const source = criterion();
    const built = buildReviewRequest(
      source,
      source.evidenceRequirements[0],
      submission,
      { id: "DEL-1", description: "可复现的 WACA 模块" },
    );
    assert.deepEqual(built.deliverable, {
      id: "DEL-1",
      description: "可复现的 WACA 模块",
    });
  });
});

describe("reviewErrorMessage", () => {
  it("passes the server's own explanation through", () => {
    const error = new ReviewRequestError("提交内容太短，无法审核。", 400, "INVALID_REQUEST");
    assert.match(reviewErrorMessage(error), /提交内容太短，无法审核。/);
  });

  it("explains an AI outage without implying a verdict", () => {
    const message = reviewErrorMessage(
      new ReviewRequestError("AI 审核服务当前不可用，请稍后重试。", 500, "INTERNAL_ERROR"),
    );
    assert.match(message, /不可用/);
  });

  it("describes a timeout, a dead connection and the unknown alike", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const timeout = reviewErrorMessage(abort);
    const offline = reviewErrorMessage(new TypeError("fetch failed"));
    const unknown = reviewErrorMessage("something odd");

    for (const message of [timeout, offline, unknown]) {
      assert.match(message, /等待检查/, "the user must be told the evidence is still unreviewed");
      assert.doesNotMatch(message, /已接受|已通过|判定为通过|AUTO_VERIFIED/);
    }
    assert.match(offline, /无法连接/);
    assert.match(timeout, /超时/);
  });

  it("carries the same guarantee when the server supplies its own wording", () => {
    // The server's 500 copy is reassuring about not fabricating a verdict, but
    // it says nothing about the evidence itself; the guarantee is what makes
    // every failure unambiguous, including the ones the server words.
    const server = new ReviewRequestError("AI 审核服务当前不可用，请稍后重试。", 500, "INTERNAL_ERROR");
    assert.match(reviewErrorMessage(server), /等待检查/);
    assert.equal(reviewErrorDetail(server), "AI 审核服务当前不可用，请稍后重试。");
    assert.equal(
      reviewErrorMessage(server),
      `AI 审核服务当前不可用，请稍后重试。 ${REVIEW_FAILURE_GUARANTEE}`,
    );
  });
});

describe("requestEvidenceReview", () => {
  it("posts the request and returns the validated verdict", async () => {
    let seenUrl = "";
    let seenBody: unknown = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seenUrl = url;
      seenBody = JSON.parse(String(init.body));
      assert.equal(init.method, "POST");
      return jsonResponse({
        review: validReview,
        reviewer: "AI",
        promptVersion: "evidence-review.v1",
        generation: "AI",
      });
    }) as unknown as typeof fetch;

    const submitted = await requestEvidenceReview(request(), { fetchImpl });
    assert.equal(seenUrl, REVIEW_ENDPOINT);
    assert.deepEqual(seenBody, request());
    assert.equal(submitted.review.finding, "FAIL");
    assert.equal(submitted.reviewer, "AI");
    assert.equal(submitted.promptVersion, "evidence-review.v1");
  });

  it("never claims an AI reviewer when the server does not say so", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ review: validReview })) as unknown as typeof fetch;
    const submitted = await requestEvidenceReview(request(), { fetchImpl });
    assert.equal(submitted.reviewer, "MOCK");
    assert.equal(submitted.promptVersion, "unknown");
  });

  it("surfaces a refusal with the server's message and status", async () => {
    const fetchImpl = (async () =>
      jsonResponse(
        { error: { code: "INVALID_REQUEST", message: "内容太短，无法审核。" } },
        400,
      )) as unknown as typeof fetch;

    await assert.rejects(requestEvidenceReview(request(), { fetchImpl }), (caught: unknown) => {
      assert.ok(caught instanceof ReviewRequestError);
      assert.equal(caught.status, 400);
      assert.equal(caught.message, "内容太短，无法审核。");
      return true;
    });
  });

  it("still explains a failure when the error body is not JSON", async () => {
    const fetchImpl = (async () =>
      new Response("<html>502 Bad Gateway</html>", { status: 502 })) as unknown as typeof fetch;

    await assert.rejects(requestEvidenceReview(request(), { fetchImpl }), (caught: unknown) => {
      assert.ok(caught instanceof ReviewRequestError);
      assert.match(caught.message, /502/);
      return true;
    });
  });

  it("discards a verdict whose shape it cannot trust", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        review: { ...validReview, decision: "PROBABLY" },
        reviewer: "AI",
      })) as unknown as typeof fetch;

    await assert.rejects(requestEvidenceReview(request(), { fetchImpl }), (caught: unknown) => {
      assert.ok(caught instanceof ReviewRequestError);
      assert.equal(caught.code, "MALFORMED_REVIEW");
      return true;
    });
  });

  it("discards a response body that is not JSON at all", async () => {
    const fetchImpl = (async () =>
      new Response("not json", { status: 200 })) as unknown as typeof fetch;

    await assert.rejects(requestEvidenceReview(request(), { fetchImpl }), (caught: unknown) => {
      assert.ok(caught instanceof ReviewRequestError);
      assert.equal(caught.code, "MALFORMED_RESPONSE");
      return true;
    });
  });

  it("propagates a transport failure instead of inventing a verdict", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await assert.rejects(requestEvidenceReview(request(), { fetchImpl }), TypeError);
  });

  it("aborts a hung request rather than leaving the form stuck", async () => {
    let observed: AbortSignal | null = null;
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        observed = init.signal ?? null;
        observed?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })) as unknown as typeof fetch;

    await assert.rejects(
      requestEvidenceReview(request(), { fetchImpl, timeoutMs: 5 }),
      (caught: unknown) => {
        assert.equal((caught as Error).name, "AbortError");
        return true;
      },
    );
    assert.ok(observed, "the request must be cancellable");
  });
});

/**
 * Render-level tests for the failure-loop components.
 *
 * There is no browser automation available in this environment, so these render
 * the components with `react-dom/server` and assert on the produced markup.
 * That catches the failure modes that type checking cannot: a component that
 * throws, a branch that renders nothing, a locked state that still offers the
 * action, or a review button showing on evidence that is already decided.
 *
 * Effects do not run under static rendering, so these cover the initial render
 * of each component rather than the full interaction.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AcceptanceCriterion } from "../lib/contracts";
import {
  EvidenceRecord,
  FailureAsset,
  deriveCriterion,
} from "../lib/failure-ledger";
import { EvidenceEntry } from "../app/evidence-entry";
import { FailureLibrary } from "../app/failure-library";

function criterion(overrides: Partial<AcceptanceCriterion> = {}): AcceptanceCriterion {
  return {
    id: "AC-2",
    description: "Stage 2 receives Xweak rather than the Stage 1 descriptor",
    required: true,
    status: "UNKNOWN",
    evidenceRequirements: [
      {
        id: "REQ-2-SOURCE",
        description: "Source inspection identifies the tensor supplied in Stage 2",
        acceptedSourceTypes: ["ARTIFACT_INSPECTED"],
        minimumCount: 1,
      },
    ],
    ...overrides,
  };
}

function record(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: "EV-2",
    contractId: "boss-1",
    contractRevision: 1,
    criterionId: "AC-2",
    requirementId: "REQ-2-SOURCE",
    sourceType: "ARTIFACT_INSPECTED",
    sourceName: "models/waca.py",
    summary: "Static inspection finds Stage 2 reuses Stage 1 information instead of Xweak.",
    finding: "FAIL",
    reviewStatus: "ACCEPTED",
    recordedAt: "2026-09-18T10:00:00.000Z",
    ...overrides,
  };
}

function renderEntry(
  props: Partial<Parameters<typeof EvidenceEntry>[0]> = {},
): string {
  const targetCriterion = props.criterion ?? criterion();
  const records = props.records ?? [];
  return renderToStaticMarkup(
    <EvidenceEntry
      criterion={targetCriterion}
      derivation={deriveCriterion(targetCriterion, records)}
      records={records}
      locked={props.locked ?? false}
      onRecord={() => {}}
      onReview={() => {}}
    />,
  );
}

describe("EvidenceEntry", () => {
  it("renders the criterion, its requirement and the accepted source types", () => {
    const html = renderEntry();
    assert.match(html, /AC-2/);
    assert.match(html, /REQ-2-SOURCE/);
    assert.match(html, /已检查产物/, "the accepted source type must be visible");
    assert.match(html, /必需/);
  });

  it("shows the derivation reason so the verdict is explainable", () => {
    const html = renderEntry();
    assert.match(html, /证据要求未满足/, "an unmet requirement must be explained");
    assert.match(html, /0\/1/, "the satisfied-of-required count must be shown");
  });

  it("offers the record action when the contract is accepted", () => {
    const html = renderEntry({ locked: false });
    assert.match(html, /记录证据/);
    assert.doesNotMatch(html, /接受合同后才能开始记录证据/);
  });

  it("blocks recording and explains why while the contract is not accepted", () => {
    const html = renderEntry({ locked: true });
    assert.match(html, /接受合同后才能开始记录证据/);
    assert.doesNotMatch(html, /记录证据<\/button>/, "no recording action while locked");
  });

  it("renders an accepted failure with its status and no review buttons", () => {
    const html = renderEntry({ records: [record()] });
    assert.match(html, /models\/waca\.py/);
    assert.match(html, /已接受/);
    assert.match(html, /未通过/);
    assert.doesNotMatch(html, /接受<\/button>/, "decided evidence must not offer review again");
  });

  it("offers accept and reject for evidence that is still pending (§8)", () => {
    const html = renderEntry({ records: [record({ reviewStatus: "PENDING" })] });
    assert.match(html, /待审核/);
    assert.match(html, /接受/);
    assert.match(html, /拒绝/);
    assert.match(html, /不参与判定/, "pending evidence must be excluded from the verdict");
  });
});

function failure(overrides: Partial<FailureAsset["evidence"]> = {}, resolved = false): FailureAsset {
  return {
    evidence: record(overrides),
    context: {
      contractId: "boss-1",
      objective: "Implement a bounded WACA-SE module",
      rawGoal: "复现 WACA",
    },
    resolved,
    resolvedAt: resolved ? "2026-09-18T12:00:00.000Z" : null,
  };
}

function renderLibrary(failures: FailureAsset[], busy = false): string {
  return renderToStaticMarkup(
    <FailureLibrary failures={failures} busy={busy} onIncubate={() => {}} />,
  );
}

describe("FailureLibrary", () => {
  it("explains the empty state instead of rendering nothing", () => {
    const html = renderLibrary([]);
    assert.match(html, /失败资产库/);
    assert.match(html, /还没有任何未通过的验收项/);
  });

  it("counts total and unresolved failures", () => {
    const html = renderLibrary([failure({ id: "EV-A" }, false), failure({ id: "EV-B" }, true)]);
    assert.match(html, /已累计 <strong>2<\/strong> 条失败证据/);
    assert.match(html, /<strong>1<\/strong> 条尚未解决/);
  });

  it("distinguishes resolved failures and keeps them as assets", () => {
    const resolvedHtml = renderLibrary([failure({}, true)]);
    assert.match(resolvedHtml, /已解决/);
    assert.match(resolvedHtml, /仍作为经验保留/);

    const openHtml = renderLibrary([failure({}, false)]);
    assert.match(openHtml, /待解决/);
    assert.match(openHtml, /孵化下一个 Boss/);
  });

  it("shows which Boss the failure came from", () => {
    const html = renderLibrary([failure()]);
    assert.match(html, /Implement a bounded WACA-SE module/);
  });

  it("disables the incubation action while a request is in flight", () => {
    const html = renderLibrary([failure()], true);
    assert.match(html, /正在孵化…/);
  });
});

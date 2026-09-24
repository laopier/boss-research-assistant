/**
 * Render-level tests for the failure-loop components.
 *
 * There is no browser automation available in this environment, so these render
 * the components with `react-dom/server` and assert on the produced markup.
 * That catches the failure modes that type checking cannot: a component that
 * throws, a branch that renders nothing, a locked state that still offers the
 * action, or a submit form that quietly hands the verdict back to the user.
 *
 * Effects do not run under static rendering, so these cover the initial render
 * of each component rather than the full interaction; the interaction is covered
 * by the pure-logic suite in `failure-ledger.test.ts` and the route suite in
 * `evidence-review-route.test.ts`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AcceptanceCriterion, BossContract, Deliverable, EvidenceSourceType } from "../lib/contracts";
import { PROOF_BOUNDARY_TEXT } from "../lib/evidence-review/validation";
import {
  EvidenceRecord,
  FailureAsset,
  Ledger,
  ReviewOutcome,
  ReviewOverride,
  deriveCriterion,
  emptyLedger,
} from "../lib/failure-ledger";
import { DeliverableCard } from "../app/deliverable-card";
import { EvidenceEntry, EvidenceSubmitForm } from "../app/evidence-entry";
import { EvidenceReviewPanel } from "../app/evidence-review-panel";
import { FailureLibrary } from "../app/failure-library";
import { ResearchJourney } from "../app/journey-panel";
import { ProgressPanel } from "../app/progress-panel";
import { Workbench } from "../app/workbench";
import { ArtifactPanel } from "../app/artifact-panel";
import { BatchEvidencePanel } from "../app/batch-evidence-panel";
import { proofBoundaryText } from "../app/labels";
import { ProgressDerivation } from "../lib/progress";
import { deriveRoadmap } from "../lib/roadmap";
import {
  withAcceptedContract,
  withContract,
} from "../lib/failure-ledger";

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

function outcome(overrides: Partial<ReviewOutcome> = {}): ReviewOutcome {
  return {
    evidenceId: "EV-2",
    decision: "ACCEPTED",
    finding: "FAIL",
    rationale: "提交的代码片段显示 Stage 2 拼接的是 Stage 1 的描述符，而不是 Xweak。",
    proofBoundary: "ARTIFACT_INSPECTED",
    suggestedNextEvidence: [
      { sourceType: "LOG_INSPECTED", hint: "附上 Stage 2 打印实际输入张量来源的运行日志。" },
    ],
    reviewerKind: "AI",
    promptVersion: "evidence-review.v1",
    reviewedAt: "2026-09-18T10:05:00.000Z",
    ...overrides,
  };
}

function override(overrides: Partial<ReviewOverride> = {}): ReviewOverride {
  return {
    evidenceId: "EV-2",
    fromStatus: "REJECTED",
    fromFinding: "INCONCLUSIVE",
    toStatus: "ACCEPTED",
    toFinding: "FAIL",
    reason: "审核器只看到粘贴文本，但同一段日志已在 CI 上完整跑过。",
    at: "2026-09-18T10:30:00.000Z",
    ...overrides,
  };
}

function ledgerWith(patch: Partial<Ledger> = {}): Ledger {
  return { ...emptyLedger(), ...patch };
}

function renderEntry(props: Partial<Parameters<typeof EvidenceEntry>[0]> = {}): string {
  const targetCriterion = props.criterion ?? criterion();
  const records = props.records ?? [];
  return renderToStaticMarkup(
    <EvidenceEntry
      criterion={targetCriterion}
      derivation={deriveCriterion(targetCriterion, records)}
      records={records}
      ledger={props.ledger ?? emptyLedger()}
      deliverables={props.deliverables}
      locked={props.locked ?? false}
      openRequest={props.openRequest}
      onOpenConsumed={props.onOpenConsumed}
      onRecord={() => "ev-test"}
      onAdopt={() => {}}
      onOverride={() => {}}
      unifiedSubmission={props.unifiedSubmission}
    />,
  );
}

function renderForm(props: Partial<Parameters<typeof EvidenceSubmitForm>[0]> = {}): string {
  return renderToStaticMarkup(
    <EvidenceSubmitForm
      criterion={props.criterion ?? criterion()}
      deliverables={props.deliverables}
      presetDeliverableId={props.presetDeliverableId}
      submitting={props.submitting ?? false}
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
  );
}

const deliverables: Deliverable[] = [
  { id: "DEL-1", description: "The WACA-SE module", status: "NOT_STARTED" },
  { id: "DEL-2", description: "The attention-mask visualization", status: "NOT_STARTED" },
];

function fullContract(overrides: Partial<BossContract> = {}): BossContract {
  return {
    schemaVersion: "boss-contract.v0",
    recordKind: "LIVE",
    revision: 1,
    id: "boss-1",
    title: "Bounded first step",
    rawGoal: "复现 WACA",
    objective: "Implement a bounded WACA-SE module",
    deadline: null,
    deliverables,
    acceptanceCriteria: [criterion()],
    scopeGuard: { inScope: ["x"], outOfScope: [], newBossPolicy: "CREATE_NEW_BOSS" },
    known: [],
    unknowns: [],
    assumptions: [],
    estimatedMinutes: 90,
    assistanceMode: "COACH",
    status: "DRAFT",
    evidenceItems: [],
    blockers: [],
    changeHistory: [],
    ...overrides,
  };
}

function renderCard(props: Partial<Parameters<typeof DeliverableCard>[0]> = {}): string {
  return renderToStaticMarkup(
    <DeliverableCard
      contract={props.contract ?? fullContract()}
      deliverable={props.deliverable ?? deliverables[0]}
      records={props.records ?? []}
      locked={props.locked ?? false}
      active={props.active ?? false}
      onSubmitFor={() => {}}
    />,
  );
}

function renderPanel(props: Partial<Parameters<typeof EvidenceReviewPanel>[0]> = {}): string {
  return renderToStaticMarkup(
    <EvidenceReviewPanel
      record={props.record ?? record()}
      adopted={props.adopted}
      proposal={props.proposal}
      override={props.override}
      busy={props.busy ?? false}
      error={props.error ?? ""}
      canRetry={props.canRetry ?? false}
      onRetry={() => {}}
      onAdopt={() => {}}
      onOverride={() => {}}
    />,
  );
}

describe("EvidenceSubmitForm", () => {
  it("collects material and offers no way to declare a verdict", () => {
    const html = renderForm();
    assert.match(html, /对应证据要求/);
    assert.match(html, /REQ-2-SOURCE/);
    assert.match(html, /粘贴内容/);
    assert.match(html, /提交并送审/);

    // The defect this ticket closes: the submitter used to pick 通过/未通过.
    assert.doesNotMatch(
      html,
      /这条证据支持什么结论/,
      "the submitter must not be able to state a finding",
    );
    assert.doesNotMatch(html, /<option value="PASS"/, "no verdict select may exist in the form");
    assert.doesNotMatch(html, /<option value="FAIL"/);
  });

  it("only offers source types the requirement accepts (§7)", () => {
    const html = renderForm();
    assert.match(html, /<option value="ARTIFACT_INSPECTED"/);
    assert.doesNotMatch(html, /<option value="AUTO_VERIFIED"/, "unaccepted sources must not be offered");
  });

  it("warns that the pasted text leaves the device", () => {
    const html = renderForm();
    assert.match(html, /DeepSeek/, "the privacy notice is required by the scope guard");
    assert.match(html, /不会被保存/);
  });

  it("cannot submit while empty", () => {
    const html = renderForm();
    assert.match(html, /disabled/, "an empty submission must not be sendable");
  });

  it("says so instead of rendering a broken form when there is no requirement", () => {
    const html = renderForm({ criterion: criterion({ evidenceRequirements: [] }) });
    assert.match(html, /没有定义证据要求/);
    assert.doesNotMatch(html, /提交并送审/);
  });

  it("offers the deliverable link when the contract has deliverables", () => {
    const html = renderForm({ deliverables });
    assert.match(html, /关联交付物/);
    assert.match(html, /<option value="DEL-1"/);
    assert.match(html, /<option value="DEL-2"/);
    assert.match(html, /不关联任何交付物/, "the default is no link, never a guessed one");
  });

  it("hides the deliverable link when there is nothing to link to", () => {
    assert.doesNotMatch(renderForm(), /关联交付物/);
  });

  it("preselects the deliverable a card pointed at", () => {
    const html = renderForm({ deliverables, presetDeliverableId: "DEL-2" });
    assert.match(html, /<option value="DEL-2" selected=""/);
    assert.doesNotMatch(html, /<option value="DEL-1" selected=""/);
  });

  it("ignores a preset that is not one of this contract's deliverables", () => {
    const html = renderForm({ deliverables, presetDeliverableId: "DEL-GONE" });
    assert.doesNotMatch(
      html,
      /value="DEL-[12]" selected=""/,
      "an unknown preset falls back to no link",
    );
  });
});

describe("EvidenceReviewPanel", () => {
  it("explains that a fresh proposal has not been applied yet", () => {
    const html = renderPanel({ proposal: outcome() });
    assert.match(html, /还没有写入判定/);
    assert.match(html, /采纳后才会影响/);
    assert.match(html, /审核建议（未采纳）/);
    assert.match(html, /采纳这个结论/);
    assert.match(html, /我不认同，人工判定/);
  });

  it("shows the verdict, its rationale and the proof boundary", () => {
    const html = renderPanel({ proposal: outcome() });
    assert.match(html, /接受/);
    assert.match(html, /判定：未通过/);
    assert.match(html, /Stage 2 拼接的是 Stage 1 的描述符/);
    assert.match(html, /证明边界/);
    assert.match(html, /成果内容/, "the boundary is described in proof terms, not source terms");
    assert.match(html, /提交时声明：已检查产物/);
  });

  it("shows what evidence is still missing", () => {
    const html = renderPanel({ proposal: outcome() });
    assert.match(html, /建议补充的证据/);
    assert.match(html, /附上 Stage 2 打印实际输入张量来源的运行日志/);
  });

  it("marks an adopted review as applied and offers only a re-decision", () => {
    const html = renderPanel({ adopted: outcome() });
    assert.match(html, /审核结论（已采纳）/);
    assert.match(html, /改判（人工覆盖）/);
    assert.doesNotMatch(html, /采纳这个结论/, "an adopted review must not be adoptable twice");
    assert.doesNotMatch(html, /还没有写入判定/);
  });

  it("never credits the AI with a verdict a human overruled", () => {
    const adopted = renderPanel({ adopted: outcome(), override: override() });
    assert.match(adopted, /审核建议（已被人工覆盖）/);
    assert.doesNotMatch(adopted, /审核结论（已采纳）/);
    assert.doesNotMatch(adopted, /^已采纳/, "the human's decision must not read as the AI's");

    // The same must hold when the user overruled the advice instead of adopting
    // it: the panel still knows the advice, but must not claim it was accepted.
    const unadopted = renderPanel({ proposal: outcome(), override: override() });
    assert.match(unadopted, /审核建议（已被人工覆盖）/);
    assert.doesNotMatch(unadopted, /审核结论（已采纳）/);
  });

  it("names the reviewer, so a mock verdict is never read as an AI one", () => {
    assert.match(renderPanel({ proposal: outcome() }), /AI 审核（DeepSeek）/);
    assert.match(
      renderPanel({ proposal: outcome({ reviewerKind: "MOCK" }) }),
      /规则审核（离线）/,
    );
  });

  it("records who overrode what, and why", () => {
    const html = renderPanel({ adopted: outcome(), override: override() });
    assert.match(html, /人工覆盖/);
    assert.match(html, /已拒绝 → 已接受/);
    assert.match(html, /同一段日志已在 CI 上完整跑过/);
  });

  it("reports an unavailable reviewer without inventing a verdict", () => {
    const html = renderPanel({ error: "AI 审核服务当前不可用，请稍后重试。" });
    assert.match(html, /AI 审核服务当前不可用/);
    assert.match(html, /还没有审核结论/);
    assert.doesNotMatch(html, /采纳这个结论/, "no verdict, nothing to adopt");
  });

  it("offers a re-review only when the page still holds the submitted text", () => {
    assert.match(renderPanel({ canRetry: true }), /重新审核这条证据/);
    assert.doesNotMatch(renderPanel({ canRetry: false }), /重新审核这条证据/);
  });
});

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

  it("offers the submit action when the contract is accepted", () => {
    const html = renderEntry({ locked: false });
    assert.match(html, /提交证据/);
    assert.doesNotMatch(html, /接受合同后才能开始记录证据/);
  });

  it("blocks submission and explains why while the contract is not accepted", () => {
    const html = renderEntry({ locked: true });
    assert.match(html, /接受合同后才能开始记录证据/);
    assert.doesNotMatch(html, /提交证据<\/button>/, "no submission action while locked");
  });

  it("renders a decided record without offering to self-approve it", () => {
    const html = renderEntry({
      records: [record()],
      ledger: ledgerWith({ reviews: { "EV-2": outcome() } }),
    });
    assert.match(html, /models\/waca\.py/);
    assert.match(html, /已接受/);
    assert.match(html, /未通过/);
    assert.match(html, /已采纳/);
    assert.doesNotMatch(html, /接受<\/button>/, "decided evidence must not offer review again");
  });

  it("shows a pending record as unreviewed rather than as a claim", () => {
    const html = renderEntry({ records: [record({ reviewStatus: "PENDING", finding: "INCONCLUSIVE" })] });
    assert.match(html, /待审核/);
    assert.match(html, /还没有审核结论/);
    assert.doesNotMatch(html, /判定：/, "an unreviewed record asserts no finding");
    assert.match(html, /不参与判定/, "pending evidence must be excluded from the verdict");
  });

  it("flags a record that a human overruled", () => {
    const html = renderEntry({
      records: [record()],
      ledger: ledgerWith({
        reviews: { "EV-2": outcome() },
        overrides: [override()],
      }),
    });
    assert.match(html, /人工覆盖/);
    assert.match(html, /同一段日志已在 CI 上完整跑过/);
  });

  it("opens the form on request, with the deliverable preselected", () => {
    const html = renderEntry({
      deliverables,
      openRequest: { deliverableId: "DEL-1" },
    });
    assert.match(html, /提交并送审/, "the request must show the form without a local click");
    assert.match(html, /关联交付物/);
    assert.match(html, /<option value="DEL-1" selected=""/);
    // No effect runs on close in static render; what matters is that the open
    // state is render-derived from the request rather than copied by an effect.
    assert.doesNotMatch(html, /提交证据<\/button>/);
  });

  it("stays closed when the request points at another criterion's card", () => {
    const html = renderEntry({ openRequest: undefined });
    assert.match(html, /提交证据<\/button>/);
    assert.doesNotMatch(html, /提交并送审/);
  });

  it("keeps the form locked behind contract acceptance even on request", () => {
    const html = renderEntry({ locked: true, openRequest: { deliverableId: "DEL-1" } });
    assert.match(html, /接受合同后才能开始记录证据/);
    assert.doesNotMatch(html, /提交并送审/);
  });
});

describe("DeliverableCard", () => {
  it("shows NOT_STARTED with an explanation when nothing is linked", () => {
    const html = renderCard();
    assert.match(html, /DEL-1/);
    assert.match(html, /未开始/);
    assert.match(html, /还没有为这个交付物提交过任何材料/);
    assert.doesNotMatch(html, /已完成/);
  });

  it("offers a submission entry point once the contract is accepted", () => {
    const html = renderCard();
    assert.match(html, /为此交付物提交证据/);
    assert.match(html, /<option value="AC-2"/);
    assert.match(html, /去提交/);
  });

  it("blocks the entry point while the contract is not accepted", () => {
    const html = renderCard({ locked: true });
    assert.match(html, /接受合同后，可以为这个交付物提交材料/);
    assert.doesNotMatch(html, /去提交/, "no submission entry while locked");
  });

  it("derives IN_PROGRESS from linked material and names the unpassed criterion", () => {
    const html = renderCard({
      records: [record({ deliverableId: "DEL-1" })],
    });
    assert.match(html, /进行中/);
    assert.match(html, /已提交 1 条材料/);
    assert.match(html, /AC-2 尚未全部通过/);
    assert.match(html, /href="#criterion-AC-2"/, "the related criterion is linked");
    // Regression: the chip used to read the contract's frozen `status` (always
    // UNKNOWN in a fresh contract) instead of the derived one, so it said
    // 待验证 next to a record that had already decided 未通过.
    assert.match(html, /AC-2 · 未通过/);
  });

  it("derives DONE only from criteria that all pass", () => {
    // One accepted record carrying REQ-2-SOURCE satisfies the fixture's single
    // requirement, so AC-2 is PASS and the linked deliverable is DONE.
    const html = renderCard({
      records: [record({ deliverableId: "DEL-1", finding: "PASS" })],
    });
    assert.match(html, /已完成/);
    assert.match(html, /关联的验收项（AC-2）已全部通过/);
  });

  it("replaces the entry point with a pointer while its form is open", () => {
    const html = renderCard({ active: true });
    assert.match(html, /提交表单已在/);
    assert.match(html, /AC-2<\/a> 的卡片中打开/);
    assert.doesNotMatch(html, /去提交/);
  });

  it("never renders the contract's frozen status as the live one", () => {
    // The fixture's contract says NOT_STARTED; with a passing link the card
    // must say DONE regardless, because the derived status is the truth.
    const frozen = fullContract({
      deliverables: [{ id: "DEL-1", description: "The WACA-SE module", status: "NOT_STARTED" }],
    });
    const html = renderCard({
      contract: frozen,
      records: [record({ deliverableId: "DEL-1", finding: "PASS" })],
    });
    assert.match(html, /已完成/);
    assert.doesNotMatch(html, /未开始/);
  });
});

describe("copy consistency", () => {
  it("keeps the client proof-boundary table identical to the server's", () => {
    assert.deepEqual(
      proofBoundaryText,
      PROOF_BOUNDARY_TEXT,
      "the browser copy and the server copy must not drift",
    );
  });
});

const missingFixture = {
  criterionId: "AC-2",
  criterionRequired: true,
  requirementId: "REQ-2-SOURCE",
  description: "Source inspection",
  have: 0,
  need: 1,
  acceptedSourceTypes: ["ARTIFACT_INSPECTED"] as EvidenceSourceType[],
};

function progressFixture(overrides: Partial<ProgressDerivation> = {}): ProgressDerivation {
  return {
    deliverablesDone: 1,
    deliverablesTotal: 2,
    requiredPassed: 1,
    requiredTotal: 2,
    optionalPassed: 0,
    optionalTotal: 1,
    missing: [missingFixture],
    blockers: [],
    unresolvedFailures: 0,
    nextAction: { kind: "SUBMIT_EVIDENCE", missing: missingFixture },
    ...overrides,
  };
}

function renderProgress(progress: ProgressDerivation): string {
  return renderToStaticMarkup(
    <ProgressPanel
      progress={progress}
      onAccept={() => {}}
      onIncubate={() => {}}
      onSubmitEvidence={() => {}}
      onAdvanceProject={() => {}}
      onExportReport={() => {}}
    />,
  );
}

describe("ProgressPanel", () => {
  it("shows both derived progress bars, never an editable percentage", () => {
    const html = renderProgress(progressFixture());
    assert.match(html, /产出进度/);
    assert.match(html, /1\/2 交付物/);
    assert.match(html, /通关进度/);
    assert.match(html, /1\/2 必需验收项/);
    assert.doesNotMatch(html, /<input/, "there is no input for a user to type a percentage");
  });

  it("names the requirement still missing and the source types it accepts", () => {
    const html = renderProgress(progressFixture());
    assert.match(html, /REQ-2-SOURCE 还缺 1 条/);
    assert.match(html, /已检查产物/);
  });

  it("renders the submit-evidence action with the criterion it targets", () => {
    const html = renderProgress(progressFixture());
    assert.match(html, /去 AC-2 提交证据/);
  });

  it("offers to accept the contract first when that has not happened", () => {
    const html = renderProgress(
      progressFixture({ nextAction: { kind: "ACCEPT_CONTRACT" }, missing: [] }),
    );
    assert.match(html, /接受合同，开始记录证据/);
  });

  it("offers incubation for an unresolved failure", () => {
    const html = renderProgress(
      progressFixture({
        nextAction: { kind: "INCUBATE_FAILURE", failure: failure() },
        missing: [],
        unresolvedFailures: 1,
      }),
    );
    assert.match(html, /有一条未解决的失败记录/);
    assert.match(html, /孵化成下一个 Boss/);
  });

  it("offers the next stage and a separate report once the Boss is clear", () => {
    const html = renderProgress(
      progressFixture({ nextAction: { kind: "ADVANCE_PROJECT" }, missing: [] }),
    );
    assert.match(html, /生成下一阶段 Boss/);
    assert.match(html, /导出本阶段验收报告/);
  });

  it("lists blockers separately from missing evidence", () => {
    const html = renderProgress(progressFixture({ blockers: ["BL-1"] }));
    assert.match(html, /当前阻塞：BL-1/);
  });

  it("never offers completion while the next action is to resolve a blocker", () => {
    const html = renderProgress(
      progressFixture({
        blockers: ["BL-1"],
        missing: [],
        nextAction: {
          kind: "RESOLVE_BLOCKER",
          blocker: {
            id: "BL-1",
            description: "缺少数据集",
            affectedCriteria: ["AC-1"],
            resolution: "申请访问权限",
          },
        },
      }),
    );
    assert.match(html, /先解除阻塞项 BL-1/);
    assert.doesNotMatch(html, /完成 Boss，导出验收报告/);
  });
});

describe("ResearchJourney", () => {
  it("explains the empty state", () => {
    const html = renderToStaticMarkup(<ResearchJourney events={[]} />);
    assert.match(html, /科研历程/);
    assert.match(html, /还没有任何动作/);
  });

  it("renders each event kind in order", () => {
    const events = [
      { kind: "CONTRACT_ACCEPTED" as const, at: "2026-09-20T09:00:00.000Z", text: "接受 Boss Contract，验收语义生效。" },
      { kind: "FAILURE_RECORDED" as const, at: "2026-09-20T10:00:00.000Z", text: "发现未通过的证据：失败" },
      { kind: "CRITERION_PASSED" as const, at: "2026-09-20T11:00:00.000Z", text: "验收项 AC-1 通过。" },
    ];
    const html = renderToStaticMarkup(<ResearchJourney events={events} />);
    assert.match(html, /接受合同/);
    assert.match(html, /发现失败/);
    assert.match(html, /验收通过/);
    assert.match(html, /失败/);
    const accept = html.indexOf("接受合同");
    const fail = html.indexOf("发现失败");
    assert.ok(accept < fail, "events must render in chronological order");
  });

  it("keeps a failure visible even when a pass follows it", () => {
    const events = [
      { kind: "FAILURE_RECORDED" as const, at: "2026-09-20T10:00:00.000Z", text: "发现未通过的证据：失败" },
      { kind: "CRITERION_PASSED" as const, at: "2026-09-20T11:00:00.000Z", text: "验收项 AC-1 通过。" },
    ];
    const html = renderToStaticMarkup(<ResearchJourney events={events} />);
    assert.match(html, /发现失败/);
    assert.match(html, /验收通过/);
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

function workbenchLedger(): Ledger {
  let ledger = emptyLedger();
  ledger = withContract(ledger, fullContract());
  ledger = withContract(
    ledger,
    fullContract({ id: "boss-2", objective: "Audit the dataset before any training" }),
  );
  ledger = withAcceptedContract(ledger, "boss-1", "2026-09-23T10:00:00.000Z");
  // boss-1 must be genuinely CLEAR for the 50% assertion: an accepted PASS
  // record that satisfies its single requirement.
  ledger = {
    ...ledger,
    evidence: [
      ...ledger.evidence,
      {
        id: "EV-WB",
        contractId: "boss-1",
        contractRevision: 1,
        criterionId: "AC-2",
        requirementId: "REQ-2-SOURCE",
        sourceType: "ARTIFACT_INSPECTED",
        sourceName: "models/waca.py",
        summary: "Stage 2 receives Xweak",
        finding: "PASS",
        reviewStatus: "ACCEPTED",
        recordedAt: "2026-09-23T10:01:00.000Z",
      },
    ],
  };
  return {
    ...ledger,
    project: {
      goal: "复现 WACA 论文",
      milestones: [
        { id: "M-1", title: "读懂论文与数据", bossIds: ["boss-2"] },
        { id: "M-2", title: "构建并验证模型", bossIds: ["boss-1"] },
      ],
      currentBossId: "boss-1",
      revision: 1,
      updatedAt: "2026-09-23T10:00:00.000Z",
    },
  };
}

function renderWorkbench(): string {
  const ledger = workbenchLedger();
  const roadmap = deriveRoadmap(ledger);
  assert.ok(roadmap && ledger.project);
  return renderToStaticMarkup(
    <Workbench
      project={ledger.project}
      roadmap={roadmap}
      ledger={ledger}
      onOpenBoss={() => {}}
      onNewBoss={() => {}}
      onStartOver={() => {}}
      onApplyProposal={() => {}}
    />,
  );
}

describe("Workbench", () => {
  it("shows the project goal, the global progress and the composition", () => {
    const html = renderWorkbench();
    assert.match(html, /复现 WACA 论文/);
    assert.match(html, /项目整体进度/);
    assert.match(html, /50%/);
    assert.match(html, /1\/2 个规划步骤/);
    assert.match(
      html,
      /分母来自项目创建时生成的完整路线图/,
      "the number must be explainable, not an opaque average",
    );
  });

  it("renders every milestone with its state and its Bosses", () => {
    const html = renderWorkbench();
    assert.match(html, /读懂论文与数据/);
    assert.match(html, /构建并验证模型/);
    assert.match(html, /Audit the dataset before any training/);
    assert.match(html, /Implement a bounded WACA-SE module/);
  });

  it("marks the open Boss and names each Boss's next action", () => {
    const html = renderWorkbench();
    assert.match(html, /当前/, "the open Boss must be visible on the workbench");
    assert.match(html, /继续这个 Boss/);
    assert.match(html, /下一步：/);
    assert.match(html, /接受合同，开始记录证据/, "boss-2 is untouched, so accept first");
  });

  it("offers the new-Boss flow", () => {
    assert.match(renderWorkbench(), /新建 Boss/);
  });

  it("shows future planned steps before their detailed Boss contracts exist", () => {
    const ledger = workbenchLedger();
    const plannedLedger = {
      ...ledger,
      project: {
        ...ledger.project!,
        milestones: [
          {
            ...ledger.project!.milestones[0],
            steps: [
              {
                id: "S-future",
                title: "跑通最小可运行示例",
                objective: "完成数据加载、前向传播和一次训练迭代",
                estimatedMinutes: 180,
              },
            ],
          },
          ledger.project!.milestones[1],
        ],
      },
    };
    const roadmap = deriveRoadmap(plannedLedger);
    assert.ok(roadmap && plannedLedger.project);
    const html = renderToStaticMarkup(
      <Workbench
        project={plannedLedger.project}
        roadmap={roadmap}
        ledger={plannedLedger}
        onOpenBoss={() => {}}
        onNewBoss={() => {}}
        onStartOver={() => {}}
        onApplyProposal={() => {}}
      />,
    );
    assert.match(html, /跑通最小可运行示例/);
    assert.match(html, /计划中/);
    assert.match(html, /预计 180 分钟/);
  });

  it("does not show one Boss as complete because another Boss has matching evidence ids", () => {
    let ledger = workbenchLedger();
    ledger = withAcceptedContract(ledger, "boss-2", "2026-09-23T10:02:00.000Z");
    const roadmap = deriveRoadmap(ledger);
    assert.ok(roadmap && ledger.project);
    const html = renderToStaticMarkup(
      <Workbench
        project={ledger.project}
        roadmap={roadmap}
        ledger={ledger}
        onOpenBoss={() => {}}
        onNewBoss={() => {}}
        onStartOver={() => {}}
        onApplyProposal={() => {}}
      />,
    );

    assert.equal(
      (html.match(/class="status status-pass">已完成<\/span>/g) ?? []).length,
      2,
      "one marker belongs to the completed milestone and only one belongs to boss-1",
    );
  });
});


function renderArtifactPanel(): string {
  return renderToStaticMarkup(<ArtifactPanel onUse={() => {}} onCancel={() => {}} />);
}

describe("ArtifactPanel", () => {
  it("offers the explicit permission flow and a cancel path", () => {
    const html = renderArtifactPanel();
    assert.match(html, /连接本地项目目录/);
    assert.match(html, /取消/);
  });

  it("states the privacy boundary up front", () => {
    const html = renderArtifactPanel();
    assert.match(html, /只读、不修改本地文件/);
    assert.match(html, /勾选/);
    assert.match(html, /已检查产物/, "the ceiling is ARTIFACT_INSPECTED");
    assert.match(html, /平台自动验证/, "and AUTO_VERIFIED is explicitly ruled out");
  });
});

describe("EvidenceSubmitForm artifact entry", () => {
  it("offers reading from the local project as an alternative to pasting", () => {
    const html = renderForm();
    assert.match(html, /从本地项目读取文件/);
  });

  it("does not offer artifact reading when the requirement disallows that source", () => {
    const html = renderForm({
      criterion: criterion({
        evidenceRequirements: [
          {
            id: "REQ-LOG",
            description: "A runtime log",
            acceptedSourceTypes: ["LOG_INSPECTED"],
            minimumCount: 1,
          },
        ],
      }),
    });
    assert.doesNotMatch(html, />从本地项目读取文件…<\/button>/);
    assert.match(html, /当前证据要求不接受本地文件静态检查/);
  });
});

describe("BatchEvidencePanel", () => {
  it("offers one artifact submission for all artifact-inspectable criteria", () => {
    const contract = fullContract({
      acceptanceCriteria: [criterion({ id: "AC-1" }), criterion({ id: "AC-2" })],
    });
    const html = renderToStaticMarkup(
      <BatchEvidencePanel
        contract={contract}
        locked={false}
        onRecord={() => "ev-test"}
        onAdopt={() => {}}
      />,
    );
    assert.match(html, /提交一次，审核全部标准/);
    assert.match(html, /核查 2 项验收标准/);
    assert.equal((html.match(/type="file"/g) ?? []).length, 1);
  });

  it("turns artifact-backed criterion cards into diagnostics instead of repeated forms", () => {
    const html = renderEntry({ unifiedSubmission: true });
    assert.doesNotMatch(html, />提交证据<\/button>/);
    assert.match(html, /AC-2/);
  });
});

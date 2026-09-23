"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  ApiErrorResponse,
  BossContract,
  CONTRACT_SCHEMA_VERSION,
  GenerateBossContractResponse,
} from "@/lib/contracts";
import {
  FailureAsset,
  Ledger,
  OverrideDraft,
  ReviewOutcome,
  buildIncubationGoal,
  deriveBoss,
  deriveCriterion,
  listFailures,
  withAcceptedContract,
  withBossInProject,
  withContext,
  withContract,
  withCurrentBoss,
  withImportedEvidence,
  withIncubation,
  withNewProject,
  withOverride,
  withRecordedEvidence,
  withReviewOutcome,
} from "@/lib/failure-ledger";
import {
  getLedgerServerSnapshot,
  getLedgerSnapshot,
  hydrateLedger,
  subscribeLedger,
  updateLedger,
} from "@/lib/ledger-store";
import { deriveRoadmap } from "@/lib/roadmap";
import { applyProposalWith } from "@/lib/negotiation";
import datasetInvestigationFixture from "../../examples/ai/dataset-investigation.json";
import literatureReadingFixture from "../../examples/ai/literature-reading.json";
import wacaDemoFixture from "../../examples/waca-se-boss.json";
import { DeliverableCard } from "./deliverable-card";
import { EvidenceEntry, EvidenceSubmissionInput } from "./evidence-entry";
import { FailureLibrary } from "./failure-library";
import { ResearchJourney } from "./journey-panel";
import { ProgressPanel } from "./progress-panel";
import { Workbench } from "./workbench";
import {
  assistanceModeText,
  bossStatusText,
  criterionStatusClass,
  criterionStatusText,
} from "./labels";
import { deriveProgress, listJourneyEvents } from "@/lib/progress";

/**
 * The frozen MVP-0 demonstration case.
 *
 * docs/product/mvp0-acceptance.md fixes the demo truth as this fixture: the
 * submitted WACA-SE module runs and preserves shape, but Stage 2 reuses Stage 1
 * information instead of Xweak, so AC-2 is FAIL and the Boss stays PARTIAL
 * rather than CLEAR. The expected sequence is PASS / FAIL / PASS / UNKNOWN, and
 * the required badge is 模拟数据, which `generation: "MOCK"` produces below.
 *
 * Why it is offered explicitly: the generated path always returns a fresh DRAFT
 * contract whose criteria are all UNKNOWN, because Goal Discovery is forbidden
 * from inventing evidence. So the failure story cannot be reached through
 * generation, and it is the reason this product exists. This entry point makes
 * the frozen case visible without changing the default path, the API, or the
 * shared schema.
 *
 * The cast is safe: `src/test/validation.test.ts` validates every repository
 * fixture against schemas/boss-contract.v0.schema.json, so drift fails the suite.
 */
const WACA_DEMO_FIXTURE = wacaDemoFixture as unknown as BossContract;
const LITERATURE_DEMO_FIXTURE = literatureReadingFixture as unknown as BossContract;
const DATASET_DEMO_FIXTURE = datasetInvestigationFixture as unknown as BossContract;

function formatDeadline(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Home() {
  const [goal, setGoal] = useState("我想复现 WACA 论文，但不知道从哪里开始");
  const [view, setView] = useState<"workbench" | "boss" | "new">("workbench");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [incubating, setIncubating] = useState(false);
  const [notice, setNotice] = useState("");

  const ledger = useSyncExternalStore(
    subscribeLedger,
    getLedgerSnapshot,
    getLedgerServerSnapshot,
  );

  // The store hydrates from localStorage once, after mount. Its server snapshot
  // is empty, so the first client render matches the server-rendered markup and
  // there is no hydration mismatch.
  useEffect(() => {
    hydrateLedger();
  }, []);

  // The open Boss comes from the roadmap, not from component state, so a
  // refresh restores it. The effective view falls back to "new" while no
  // roadmap exists — a derived fallback rather than an effect-set state.
  const roadmap = useMemo(() => deriveRoadmap(ledger), [ledger]);
  const contract = roadmap?.currentBossId ? ledger.contracts[roadmap.currentBossId] ?? null : null;
  const effectiveView = ledger.project === undefined ? "new" : view;

  const accepted = contract ? Boolean(ledger.accepted[contract.id]) : false;
  const lineage = contract ? ledger.incubations[contract.id] : undefined;

  const contractRecords = useMemo(
    () => (contract ? ledger.evidence.filter((item) => item.contractId === contract.id) : []),
    [contract, ledger],
  );

  const boss = useMemo(
    () => (contract ? deriveBoss(contract, contractRecords, accepted) : null),
    [contract, contractRecords, accepted],
  );

  const failures = useMemo(() => listFailures(ledger), [ledger]);

  const progress = useMemo(
    () => (contract ? deriveProgress(contract, ledger, accepted) : null),
    [contract, ledger, accepted],
  );

  const journeyEvents = useMemo(
    () => (contract ? listJourneyEvents(contract, ledger) : []),
    [contract, ledger],
  );

  /**
   * The "complete the Boss" action: exports an acceptance report and resets to
   * the empty state so the user can start the next Boss. No schema, no server —
   * the report is derived from the same ledger the page already renders.
   */
  function exportReport() {
    if (!contract || !progress) return;
    const report = {
      exportedAt: new Date().toISOString(),
      contract: {
        id: contract.id,
        title: contract.title,
        objective: contract.objective,
        revision: contract.revision,
      },
      status: boss?.status ?? "UNKNOWN",
      progress: {
        requiredPassed: progress.requiredPassed,
        requiredTotal: progress.requiredTotal,
        optionalPassed: progress.optionalPassed,
        optionalTotal: progress.optionalTotal,
        deliverablesDone: progress.deliverablesDone,
        deliverablesTotal: progress.deliverablesTotal,
      },
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${contract.id}-acceptance-report.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("验收报告已导出。你可以回到上方开始下一个 Boss。");
  }

  async function requestContract(goalText: string): Promise<GenerateBossContractResponse> {
    const response = await fetch("/api/contracts/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schemaVersion: CONTRACT_SCHEMA_VERSION, goal: goalText }),
    });
    const body = (await response.json()) as GenerateBossContractResponse | ApiErrorResponse;
    if (!response.ok || "error" in body) {
      throw new Error("error" in body ? body.error.message : "生成失败，请稍后重试。");
    }
    return body;
  }

  /**
   * Registers a contract end-to-end: import its evidence, remember its goal,
   * persist the full contract for the workbench, and place it on the roadmap —
   * creating the project when this is the first Boss, otherwise appending it
   * to the first milestone that still has open work.
   */
  const registerContract = useCallback(
    (next: BossContract, at: string, goalText: string, seed: Ledger, generation: "MOCK" | "AI") => {
      let registered = withImportedEvidence(seed, next, at);
      registered = withContext(registered, {
        contractId: next.id,
        objective: next.objective,
        rawGoal: next.rawGoal,
        generation,
      });
      registered = withContract(registered, next);
      if (!registered.project) {
        registered = withNewProject(registered, goalText, next.id, at);
      } else {
        registered = withBossInProject(registered, next.id, undefined, at);
      }
      return registered;
    },
    [],
  );

  async function submitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const body = await requestContract(goal);
      updateLedger((current) =>
        registerContract(body.contract, new Date().toISOString(), goal, current, body.generation),
      );
      setView("boss");
      setNotice("新 Boss 已生成并加入项目路线图。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Loads the frozen demonstration project instead of calling the API: one
   * research goal, two milestones, three Bosses built from the repository's
   * fixtures. The WACA Boss carries the failure story; the other two start
   * empty so the workbench shows pending milestones as well.
   *
   * Offered only while no roadmap exists, so it can never overwrite a project
   * the user has already started.
   */
  function loadDemoProject() {
    setError("");
    setNotice("");
    const at = new Date().toISOString();
    updateLedger((current) => {
      let next = current;
      for (const fixture of [LITERATURE_DEMO_FIXTURE, DATASET_DEMO_FIXTURE, WACA_DEMO_FIXTURE]) {
        next = withImportedEvidence(next, fixture, at);
        next = withContext(next, {
          contractId: fixture.id,
          objective: fixture.objective,
          rawGoal: fixture.rawGoal,
        });
        next = withContract(next, fixture);
      }
      next = {
        ...next,
        project: {
          goal: "复现 WACA 论文",
          milestones: [
            {
              id: "M-1",
              title: "读懂论文与数据",
              bossIds: [LITERATURE_DEMO_FIXTURE.id, DATASET_DEMO_FIXTURE.id],
            },
            { id: "M-2", title: "构建并验证模型", bossIds: [WACA_DEMO_FIXTURE.id] },
          ],
          currentBossId: WACA_DEMO_FIXTURE.id,
          revision: 1,
          updatedAt: at,
        },
      };
      return next;
    });
    setView("workbench");
    setNotice("已载入演示项目：2 个里程碑、3 个 Boss。");
  }

  function acceptContract() {
    if (!contract) return;
    setNotice("合同已接受，验收语义生效。现在可以记录证据。");
    updateLedger((current) => withAcceptedContract(current, contract.id, new Date().toISOString()));
  }

  /**
   * Records one submission and returns its id.
   *
   * Written before the review is requested, on purpose: "the user submitted
   * this" is a fact the ledger should hold even if the reviewer is unreachable,
   * and the resulting PENDING record is what lets the page say "已经记录，但还
   * 没有被审核" instead of pretending nothing happened. The verdict itself is
   * NOT written here — see `adoptReview`.
   *
   * `content` is intentionally dropped: it is review input, not ledger state.
   */
  function recordEvidence(criterionId: string, input: EvidenceSubmissionInput): string {
    const at = new Date().toISOString();
    const id = `ev-${at}-${Math.random().toString(36).slice(2, 8)}`;
    if (!contract) return id;
    updateLedger((current) =>
      withRecordedEvidence(
        current,
        {
          contractId: contract.id,
          contractRevision: contract.revision,
          criterionId,
          requirementId: input.requirementId,
          deliverableId: input.deliverableId,
          sourceType: input.sourceType,
          sourceName: input.sourceName,
          summary: input.summary,
        },
        { id, recordedAt: at },
      ),
    );
    return id;
  }

  /** Adopts a review the user accepted. This is the only path from advice to state. */
  function adoptReview(outcome: ReviewOutcome) {
    updateLedger((current) => withReviewOutcome(current, outcome));
    setNotice("已采纳审核结论，相关验收项的状态已按证据重新推导。");
  }

  /**
   * Applies a human decision that disagrees with the review.
   *
   * The rejected advice is passed along so the ledger keeps both halves of the
   * story: what the reviewer said, and why a person overruled it.
   */
  function overrideEvidence(draft: OverrideDraft, outcome: ReviewOutcome | undefined) {
    updateLedger((current) => withOverride(current, draft, outcome));
    setNotice("已按人工判定覆盖，审计记录已写入本地账本。");
  }

  /**
   * Turns an accumulated failure into the next Boss by asking Goal Discovery to
   * bound the failure as a new goal (§11: a new need becomes a new Boss rather
   * than widening the current one).
   */
  async function incubate(failure: FailureAsset) {
    const goalText = buildIncubationGoal(failure);
    setError("");
    setNotice("");
    setIncubating(true);
    try {
      const body = await requestContract(goalText);
      const at = new Date().toISOString();
      setGoal(goalText);
      updateLedger((current) => {
        const registered = registerContract(
          body.contract,
          at,
          goalText,
          current,
          body.generation,
        );
        return withIncubation(registered, body.contract.id, {
          fromEvidenceId: failure.evidence.id,
          fromContractId: failure.evidence.contractId,
          criterionId: failure.evidence.criterionId,
          summary: failure.evidence.summary,
        });
      });
      setView("boss");
      setNotice("已从该失败记录孵化出一个新的 Boss，并加入当前里程碑。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "孵化失败，请稍后重试。");
    } finally {
      setIncubating(false);
    }
  }

  return (
    <main>
      <header className="hero">
        <div className="brand"><span>B</span> Boss 科研助手</div>
        <p className="eyebrow">失败经验累积与孵化 · MVP-0</p>
        <h1>让失败的尝试，<br />不再白费。</h1>
        <p className="intro">
          Boss 把模糊的科研目标收敛成有边界的任务，用<strong>证据</strong>而不是感觉来判定每一项是否通过。
          未通过的验收项不会消失——它沉淀成失败资产，随时可以孵化成下一个更小的目标。
        </p>
      </header>

      {notice && <p className="notice" role="status">{notice}</p>}

      {effectiveView === "workbench" && roadmap && ledger.project && (
        <Workbench
          project={ledger.project}
          roadmap={roadmap}
          ledger={ledger}
          onOpenBoss={(contractId) => {
            updateLedger((current) => withCurrentBoss(current, contractId));
            setView("boss");
            setNotice("");
          }}
          onNewBoss={() => {
            setError("");
            setView("new");
          }}
          onApplyProposal={(proposal, input) => {
            updateLedger((current) =>
              applyProposalWith(current, proposal, input, new Date().toISOString()),
            );
            setNotice(
              `已接受协商修改，计划版本更新到 Revision ${(ledger.project?.revision ?? 0) + 1}，变更原因已保存。`,
            );
          }}
        />
      )}

      {effectiveView === "new" && (
        <>
          <section className="input-panel" aria-labelledby="goal-heading">
            <form onSubmit={submitGoal}>
              <label id="goal-heading" htmlFor="goal">
                {ledger.project ? "新 Boss 的目标" : "你的科研目标"}
              </label>
              <textarea
                id="goal"
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                maxLength={500}
                placeholder="例如：我想复现一篇注意力机制论文，但不知道第一步做什么"
              />
              <div className="form-footer">
                <span>{goal.length} / 500</span>
                <span className="actions">
                  {ledger.project && (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => setView("workbench")}
                    >
                      返回工作台
                    </button>
                  )}
                  <button disabled={loading || incubating || !goal.trim()} type="submit">
                    {loading ? "正在生成…" : "生成 Boss Contract"}
                  </button>
                </span>
              </div>
              {error && <p className="error" role="alert">{error}</p>}
            </form>

            {!ledger.project && (
              <div className="demo-entry">
                <p className="muted">
                  也可以直接载入固定的 WACA 演示项目：1 个研究目标、2 个里程碑、3 个 Boss。
                  其中「构建并验证模型」已经跑过一次验收，一项因为阶段间复用了错误输入而被判定为
                  <strong>未通过</strong>，所以整个项目停在途中而非完成。
                </p>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={loadDemoProject}
                  disabled={loading || incubating}
                >
                  载入 WACA 演示项目
                </button>
              </div>
            )}
          </section>

          {!ledger.project && (
            <section className="empty-state">
              <div className="step">01 <strong>描述意图</strong></div>
              <div className="step">02 <strong>收敛目标</strong></div>
              <div className="step">03 <strong>证据判定</strong></div>
              <div className="step">04 <strong>失败沉淀</strong></div>
            </section>
          )}
        </>
      )}

      {effectiveView === "boss" && contract && boss && progress && (
        <>
          {roadmap && (
            <button
              type="button"
              className="button-secondary back-to-workbench"
              onClick={() => setView("workbench")}
            >
              ← 返回工作台
            </button>
          )}
          <ContractView
            contract={contract}
            generation={contract ? ledger.contexts[contract.id]?.generation : undefined}
            accepted={accepted}
            boss={boss}
            lineage={lineage}
            records={contractRecords}
            ledger={ledger}
            progress={progress}
            journeyEvents={journeyEvents}
            onAccept={acceptContract}
            onRecord={recordEvidence}
            onAdopt={adoptReview}
            onOverride={overrideEvidence}
            onIncubate={incubate}
            onCompleteBoss={exportReport}
          />

          <FailureLibrary failures={failures} busy={incubating} onIncubate={incubate} />
        </>
      )}
    </main>
  );
}

interface ContractViewProps {
  /** How this contract was produced, so the badge survives a refresh. */
  generation: "MOCK" | "AI" | undefined;
  contract: BossContract;
  accepted: boolean;
  boss: ReturnType<typeof deriveBoss>;
  lineage: Ledger["incubations"][string] | undefined;
  records: Ledger["evidence"];
  ledger: Ledger;
  progress: ReturnType<typeof deriveProgress>;
  journeyEvents: ReturnType<typeof listJourneyEvents>;
  onAccept: () => void;
  onRecord: (criterionId: string, input: EvidenceSubmissionInput) => string;
  onAdopt: (outcome: ReviewOutcome) => void;
  onOverride: (draft: OverrideDraft, outcome: ReviewOutcome | undefined) => void;
  onIncubate: (failure: FailureAsset) => void;
  onCompleteBoss: () => void;
}

function ContractView({
  generation,
  contract,
  accepted,
  boss,
  lineage,
  records,
  ledger,
  progress,
  journeyEvents,
  onAccept,
  onRecord,
  onAdopt,
  onOverride,
  onIncubate,
  onCompleteBoss,
}: ContractViewProps) {
  /**
   * A request to open a criterion's submission form, either from a deliverable
   * card (with a deliverable preselected) or from the progress panel's
   * "submit evidence" action (no deliverable). Held here because the
   * deliverables section, the progress panel and the criteria cards are
   * siblings.
   */
  const [submitFor, setSubmitFor] = useState<{
    criterionId: string;
    deliverableId?: string;
  } | null>(null);

  const evidenceByCriterion = new Map<string, Ledger["evidence"]>();
  for (const item of records) {
    const bucket = evidenceByCriterion.get(item.criterionId);
    if (bucket) bucket.push(item);
    else evidenceByCriterion.set(item.criterionId, [item]);
  }

  return (
    <section className="contract" aria-live="polite">
      <div className="contract-heading">
        <div>
          <p className="eyebrow">当前 Boss Contract</p>
          <h2>{contract.objective}</h2>
          <p className="raw-goal">原始目标：{contract.rawGoal}</p>
          {contract.recordKind === "DEMO_FIXTURE" && (
            <p className="demo-caption">
              固定演示案例 · 来源 <code>examples/waca-se-boss.json</code>
            </p>
          )}
          {lineage && (
            <p className="lineage">
              孵化自失败记录 <code>{lineage.fromEvidenceId}</code>（{lineage.criterionId}）：{lineage.summary}
            </p>
          )}
        </div>
        {generation === "AI" ? (
          <span className="ai-badge">AI 生成</span>
        ) : generation === "MOCK" ? (
          <span className="mock-badge">模拟数据</span>
        ) : contract.recordKind === "DEMO_FIXTURE" ? (
          <span className="mock-badge">演示数据</span>
        ) : null}
      </div>

      <div className="meta-grid">
        <article><span>合同版本</span><strong>Revision {contract.revision}</strong></article>
        <article><span>预计时间</span><strong>{contract.estimatedMinutes} 分钟</strong></article>
        <article><span>协作模式</span><strong>{assistanceModeText[contract.assistanceMode]}</strong></article>
        <article><span>状态</span><strong>{bossStatusText[boss.status]}</strong></article>
        <article>
          <span>截止时间</span>
          <strong>{contract.deadline ? formatDeadline(contract.deadline) : "未设定"}</strong>
        </article>
      </div>

      <div className={accepted ? "gate gate-done" : "gate"}>
        <div>
          <strong>{accepted ? "合同已接受" : "合同尚未接受"}</strong>
          <p className="muted">
            {accepted
              ? "验收语义已生效。记录证据后，判定由证据推导，不由「程序能跑」推导。"
              : "接受合同后，验收语义才会生效，才能开始记录证据。这一步不会修改合同内容。"}
          </p>
        </div>
        {!accepted && (
          <button type="button" onClick={onAccept}>接受合同</button>
        )}
      </div>

      <ProgressPanel
        progress={progress}
        onAccept={onAccept}
        onIncubate={onIncubate}
        onSubmitEvidence={(criterionId) => setSubmitFor({ criterionId })}
        onCompleteBoss={onCompleteBoss}
      />

      <div className="content-grid">
        <article className="criteria-card">
          <h3>验收标准与证据</h3>
          {contract.acceptanceCriteria.map((criterion) => (
            <EvidenceEntry
              key={`${contract.id}:${criterion.id}`}
              criterion={criterion}
              derivation={deriveCriterion(criterion, evidenceByCriterion.get(criterion.id) ?? [])}
              records={evidenceByCriterion.get(criterion.id) ?? []}
              ledger={ledger}
              deliverables={contract.deliverables}
              locked={!accepted}
              openRequest={
                submitFor?.criterionId === criterion.id
                  ? { deliverableId: submitFor.deliverableId }
                  : undefined
              }
              onOpenConsumed={() => {
                if (submitFor?.criterionId === criterion.id) setSubmitFor(null);
              }}
              onRecord={(input) => onRecord(criterion.id, input)}
              onAdopt={onAdopt}
              onOverride={onOverride}
            />
          ))}
        </article>

        <article className="evidence-card">
          <h3>Evidence Map</h3>
          <p className="muted">
            每条验收标准对应的证据要求与已收集证据。只有被<strong>接受</strong>的证据参与判定，
            而「被接受」不等于「通过」。
          </p>

          {contract.acceptanceCriteria.map((criterion) => {
            const items = evidenceByCriterion.get(criterion.id) ?? [];
            const derivation = deriveCriterion(criterion, items);
            const acceptedItems = items.filter((item) => item.reviewStatus === "ACCEPTED");
            return (
              <div className="evidence-group" key={criterion.id}>
                <div className="evidence-group-head">
                  <strong>{criterion.id}</strong>
                  <span className={criterionStatusClass[derivation.status]}>
                    {criterionStatusText[derivation.status]}
                  </span>
                </div>
                {items.length === 0 ? (
                  <p className="evidence-empty">
                    {derivation.status === "UNKNOWN"
                      ? "尚无证据：该验收项还没有被验证过。"
                      : "尚无证据条目：当前状态由其他环节推导。"}
                  </p>
                ) : (
                  <p className="evidence-empty">
                    已收集 {items.length} 条，其中 {acceptedItems.length} 条已接受。
                  </p>
                )}
              </div>
            );
          })}
        </article>
      </div>

      <section className="deliverables">
        <h3>交付物</h3>
        <p className="muted">
          每个交付物的状态由<strong>关联证据</strong>推导，不能手动更改：提交过材料即「进行中」，
          关联的验收项全部通过才算「已完成」。关联关系在提交证据时声明，保存在本地账本里。
        </p>
        <div className="deliverable-grid">
          {contract.deliverables.map((deliverable) => (
            <DeliverableCard
              key={deliverable.id}
              contract={contract}
              deliverable={deliverable}
              records={records}
              locked={!accepted}
              active={submitFor?.deliverableId === deliverable.id}
              onSubmitFor={(criterionId, deliverableId) =>
                setSubmitFor({ criterionId, deliverableId })
              }
            />
          ))}
        </div>
      </section>

      <ResearchJourney events={journeyEvents} />

      <div className="guard-grid">
        <article>
          <h3>范围内</h3>
          <ul>{contract.scopeGuard.inScope.map((item) => <li key={item}>{item}</li>)}</ul>
        </article>
        <article>
          <h3>范围外</h3>
          <ul>{contract.scopeGuard.outOfScope.map((item) => <li key={item}>{item}</li>)}</ul>
        </article>
      </div>

      <div className="clue-grid">
        <article><h3>已知</h3><ul>{contract.known.map((item) => <li key={item}>{item}</li>)}</ul></article>
        <article><h3>当前未知</h3><ul>{contract.unknowns.map((item) => <li key={item}>{item}</li>)}</ul></article>
        <article><h3>假设</h3><ul>{contract.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></article>
      </div>

      {contract.blockers.length > 0 && (
        <section className="blockers">
          <h3>阻塞项</h3>
          {contract.blockers.map((blocker) => (
            <div className="blocker" key={blocker.id}>
              <strong>{blocker.id}</strong>
              <p>{blocker.description}</p>
              <p className="muted">影响验收项：{blocker.affectedCriteria.join(" / ")}</p>
              <p className="muted">解除方式：{blocker.resolution}</p>
            </div>
          ))}
        </section>
      )}

      {contract.changeHistory.length > 0 && (
        <section className="history">
          <h3>修订记录</h3>
          {contract.changeHistory.map((record) => (
            <div className="history-record" key={record.revision}>
              <strong>Revision {record.revision}</strong>
              <span className="muted">{record.changedAt} · {record.changedBy}</span>
              <p>{record.reason}</p>
            </div>
          ))}
        </section>
      )}
    </section>
  );
}

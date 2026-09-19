"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  ApiErrorResponse,
  BossContract,
  CONTRACT_SCHEMA_VERSION,
  GenerateBossContractResponse,
} from "@/lib/contracts";
import {
  EvidenceReviewStatus,
  FailureAsset,
  Ledger,
  buildIncubationGoal,
  deriveBoss,
  deriveCriterion,
  listFailures,
  withAcceptedContract,
  withContext,
  withImportedEvidence,
  withIncubation,
  withRecordedEvidence,
  withReview,
} from "@/lib/failure-ledger";
import {
  getLedgerServerSnapshot,
  getLedgerSnapshot,
  hydrateLedger,
  subscribeLedger,
  updateLedger,
} from "@/lib/ledger-store";
import wacaDemoFixture from "../../examples/waca-se-boss.json";
import { EvidenceDraftInput, EvidenceEntry } from "./evidence-entry";
import { FailureLibrary } from "./failure-library";
import {
  assistanceModeText,
  bossStatusText,
  criterionStatusClass,
  criterionStatusText,
  deliverableStatusText,
} from "./labels";

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
  const [result, setResult] = useState<GenerateBossContractResponse | null>(null);
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

  const contract = result?.contract ?? null;
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

  /** Registers a new contract in the ledger: import its evidence, remember its goal. */
  const registerContract = useCallback((next: BossContract, at: string, seed: Ledger) => {
    const imported = withImportedEvidence(seed, next, at);
    return withContext(imported, {
      contractId: next.id,
      objective: next.objective,
      rawGoal: next.rawGoal,
    });
  }, []);

  async function submitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const body = await requestContract(goal);
      setResult(body);
      updateLedger((current) => registerContract(body.contract, new Date().toISOString(), current));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Loads the frozen demonstration case instead of calling the API. Kept
   * separate from submitGoal so the generated path stays the default.
   *
   * The fixture supplies the acceptance truth; the field supplies `rawGoal`, so
   * the page shows the goal the presenter actually typed. This mirrors the
   * original MVP-0 mock, which also replaced only `rawGoal`.
   */
  function loadDemoCase() {
    setError("");
    setNotice("");
    const submitted = goal.trim();
    const next: BossContract = {
      ...WACA_DEMO_FIXTURE,
      rawGoal: submitted || WACA_DEMO_FIXTURE.rawGoal,
    };
    setResult({ generation: "MOCK", contract: next });
    updateLedger((current) => registerContract(next, new Date().toISOString(), current));
  }

  function acceptContract() {
    if (!contract) return;
    setNotice("合同已接受，验收语义生效。现在可以记录证据。");
    updateLedger((current) => withAcceptedContract(current, contract.id, new Date().toISOString()));
  }

  function recordEvidence(criterionId: string, input: EvidenceDraftInput) {
    if (!contract) return;
    const at = new Date().toISOString();
    updateLedger((current) =>
      withRecordedEvidence(
        current,
        {
          contractId: contract.id,
          contractRevision: contract.revision,
          criterionId,
          ...input,
        },
        { id: `ev-${at}-${Math.random().toString(36).slice(2, 8)}`, recordedAt: at },
      ),
    );
  }

  function reviewEvidence(evidenceId: string, reviewStatus: EvidenceReviewStatus) {
    updateLedger((current) => withReview(current, evidenceId, reviewStatus));
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
      setResult(body);
      updateLedger((current) => {
        const registered = registerContract(body.contract, at, current);
        return withIncubation(registered, body.contract.id, {
          fromEvidenceId: failure.evidence.id,
          fromContractId: failure.evidence.contractId,
          criterionId: failure.evidence.criterionId,
          summary: failure.evidence.summary,
        });
      });
      setNotice("已从该失败记录孵化出一个新的 Boss。");
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

      <section className="input-panel" aria-labelledby="goal-heading">
        <form onSubmit={submitGoal}>
          <label id="goal-heading" htmlFor="goal">你的科研目标</label>
          <textarea
            id="goal"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            maxLength={500}
            placeholder="例如：我想复现一篇注意力机制论文，但不知道第一步做什么"
          />
          <div className="form-footer">
            <span>{goal.length} / 500</span>
            <button disabled={loading || incubating || !goal.trim()} type="submit">
              {loading ? "正在生成…" : "生成 Boss Contract"}
            </button>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </form>

        <div className="demo-entry">
          <p className="muted">
            也可以直接载入固定的 WACA 演示案例：那份合同已经跑过一次验收，其中一项因为阶段间
            复用了错误输入而被判定为<strong>未通过</strong>，所以它停在「部分完成」而非「已完成」。
          </p>
          <button
            type="button"
            className="button-secondary"
            onClick={loadDemoCase}
            disabled={loading || incubating}
          >
            载入 WACA 演示案例
          </button>
        </div>
      </section>

      {notice && <p className="notice" role="status">{notice}</p>}

      {!result && (
        <section className="empty-state">
          <div className="step">01 <strong>描述意图</strong></div>
          <div className="step">02 <strong>收敛目标</strong></div>
          <div className="step">03 <strong>证据判定</strong></div>
          <div className="step">04 <strong>失败沉淀</strong></div>
        </section>
      )}

      {result && contract && boss && (
        <ContractView
          data={result}
          contract={contract}
          accepted={accepted}
          boss={boss}
          lineage={lineage}
          records={contractRecords}
          onAccept={acceptContract}
          onRecord={recordEvidence}
          onReview={reviewEvidence}
        />
      )}

      {result && (
        <FailureLibrary failures={failures} busy={incubating} onIncubate={incubate} />
      )}
    </main>
  );
}

interface ContractViewProps {
  data: GenerateBossContractResponse;
  contract: BossContract;
  accepted: boolean;
  boss: ReturnType<typeof deriveBoss>;
  lineage: Ledger["incubations"][string] | undefined;
  records: Ledger["evidence"];
  onAccept: () => void;
  onRecord: (criterionId: string, input: EvidenceDraftInput) => void;
  onReview: (evidenceId: string, reviewStatus: EvidenceReviewStatus) => void;
}

function ContractView({
  data,
  contract,
  accepted,
  boss,
  lineage,
  records,
  onAccept,
  onRecord,
  onReview,
}: ContractViewProps) {
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
        {data.generation === "AI" ? (
          <span className="ai-badge">AI 生成</span>
        ) : (
          <span className="mock-badge">模拟数据</span>
        )}
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

      <p className="progress-note">
        <span className={criterionStatusClass[boss.status === "CLEAR" ? "PASS" : "UNKNOWN"]}>
          {bossStatusText[boss.status]}
        </span>
        <span>{boss.reason}</span>
        <span className="muted">
          必需 {boss.requiredPassed}/{boss.requiredTotal} 通过；可选 {boss.optionalPassed}/{boss.optionalTotal} 通过
        </span>
      </p>

      <div className="content-grid">
        <article className="criteria-card">
          <h3>验收标准与证据</h3>
          {contract.acceptanceCriteria.map((criterion) => (
            <EvidenceEntry
              key={`${contract.id}:${criterion.id}`}
              criterion={criterion}
              derivation={deriveCriterion(criterion, evidenceByCriterion.get(criterion.id) ?? [])}
              records={evidenceByCriterion.get(criterion.id) ?? []}
              locked={!accepted}
              onRecord={(input) => onRecord(criterion.id, input)}
              onReview={onReview}
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
        <div className="deliverable-grid">
          {contract.deliverables.map((deliverable) => (
            <article key={deliverable.id}>
              <div className="deliverable-head">
                <strong>{deliverable.id}</strong>
                <span className="status status-unknown">
                  {deliverableStatusText[deliverable.status]}
                </span>
              </div>
              <p>{deliverable.description}</p>
            </article>
          ))}
        </div>
      </section>

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

"use client";

import { FormEvent, useState } from "react";
import {
  ApiErrorResponse,
  BossContract,
  CONTRACT_SCHEMA_VERSION,
  EvidenceItem,
  GenerateBossContractResponse,
} from "@/lib/contracts";
import wacaDemoFixture from "../../examples/waca-se-boss.json";

/**
 * The frozen MVP-0 demonstration case.
 *
 * docs/product/mvp0-acceptance.md fixes the demo truth as this fixture: the
 * submitted WACA-SE module runs and preserves shape, but Stage 2 reuses Stage 1
 * information instead of Xweak, so AC-2 is FAIL and the Boss stays PARTIAL
 * rather than CLEAR. The expected sequence is PASS / FAIL / PASS / UNKNOWN, and
 * the required badge is 模拟数据, which `generation: "MOCK"` produces below.
 *
 * Why it is offered explicitly: the generated path
 * (POST /api/contracts/generate) always returns a fresh DRAFT contract whose
 * criteria are all UNKNOWN, because Goal Discovery is forbidden from inventing
 * evidence. So the failure story — the whole point of this product — cannot be
 * reached through generation. This entry point makes the frozen case visible
 * without changing the default path, the API, or the shared schema.
 *
 * The cast is safe: `src/test/validation.test.ts` validates every repository
 * fixture against schemas/boss-contract.v0.schema.json, so drift fails the suite.
 */
const WACA_DEMO_FIXTURE = wacaDemoFixture as unknown as BossContract;

/**
 * Copy tables.
 *
 * The left-hand values are owned by schemas/boss-contract.v0.schema.json and
 * must never be renamed here. The Chinese copy for Boss, criterion, finding and
 * review status is frozen in docs/product/mvp0-acceptance.md.
 */
const criterionStatusText = {
  UNKNOWN: "待验证",
  PASS: "通过",
  FAIL: "未通过",
};

const criterionStatusClass = {
  UNKNOWN: "status status-unknown",
  PASS: "status status-pass",
  FAIL: "status status-fail",
};

const bossStatusText = {
  DRAFT: "草稿",
  ACTIVE: "进行中",
  PARTIAL: "部分完成",
  CLEAR: "已完成",
  BLOCKED: "受阻",
};

const deliverableStatusText = {
  NOT_STARTED: "未开始",
  IN_PROGRESS: "进行中",
  DONE: "已完成",
};

const sourceTypeText = {
  USER_REPORTED: "用户陈述",
  ARTIFACT_INSPECTED: "已检查产物",
  LOG_INSPECTED: "已检查日志",
  AUTO_VERIFIED: "平台自动验证",
};

const findingText = {
  PASS: "通过",
  FAIL: "未通过",
  INCONCLUSIVE: "无法判断",
};

const reviewStatusText = {
  PENDING: "待审核",
  ACCEPTED: "已接受",
  REJECTED: "已拒绝",
};

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

  async function submitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/contracts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemaVersion: CONTRACT_SCHEMA_VERSION, goal }),
      });
      const body = (await response.json()) as GenerateBossContractResponse | ApiErrorResponse;
      if (!response.ok || "error" in body) {
        throw new Error("error" in body ? body.error.message : "生成失败，请稍后重试。");
      }
      setResult(body);
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
    const submitted = goal.trim();
    setResult({
      generation: "MOCK",
      contract: {
        ...WACA_DEMO_FIXTURE,
        rawGoal: submitted || WACA_DEMO_FIXTURE.rawGoal,
      },
    });
  }

  return (
    <main>
      <header className="hero">
        <div className="brand"><span>B</span> Boss 科研助手</div>
        <p className="eyebrow">MVP-0 · Goal-to-Contract Vertical Slice</p>
        <h1>先把模糊目标，变成<br />一个能验收的 Boss。</h1>
        <p className="intro">告诉 Boss 你想研究什么。系统会把目标收敛成一份可验收的 Boss Contract；未配置模型密钥时使用离线模拟生成。</p>
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
            <button disabled={loading || !goal.trim()} type="submit">
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
          <button type="button" className="button-secondary" onClick={loadDemoCase} disabled={loading}>
            载入 WACA 演示案例
          </button>
        </div>
      </section>

      {!result && (
        <section className="empty-state">
          <div className="step">01 <strong>描述意图</strong></div>
          <div className="step">02 <strong>收敛目标</strong></div>
          <div className="step">03 <strong>定义证据</strong></div>
        </section>
      )}

      {result && <ContractView data={result} />}
    </main>
  );
}

function ContractView({ data }: { data: GenerateBossContractResponse }) {
  const { contract } = data;

  const evidenceByCriterion = new Map<string, EvidenceItem[]>();
  for (const item of contract.evidenceItems) {
    const bucket = evidenceByCriterion.get(item.criterionId);
    if (bucket) bucket.push(item);
    else evidenceByCriterion.set(item.criterionId, [item]);
  }

  const requiredCount = contract.acceptanceCriteria.filter((item) => item.required).length;
  const failedRequired = contract.acceptanceCriteria.filter(
    (item) => item.required && item.status === "FAIL",
  ).length;

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
        <article><span>协作模式</span><strong>{contract.assistanceMode}</strong></article>
        <article><span>状态</span><strong>{bossStatusText[contract.status]}</strong></article>
        <article>
          <span>截止时间</span>
          <strong>{contract.deadline ? formatDeadline(contract.deadline) : "未设定"}</strong>
        </article>
      </div>

      <p className="progress-note">
        必需验收项 {requiredCount} 条
        {failedRequired > 0
          ? `，其中 ${failedRequired} 条未通过——Boss 不会因为「程序能跑」就判定完成。`
          : "，全部通过后 Boss 才会进入已完成。"}
      </p>

      <div className="content-grid">
        <article className="criteria-card">
          <h3>验收标准</h3>
          {contract.acceptanceCriteria.map((criterion, index) => (
            <div className="criterion" key={criterion.id}>
              <span className="index">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{criterion.id}</strong>
                <span className={criterion.required ? "tag tag-required" : "tag"}>
                  {criterion.required ? "必需" : "可选"}
                </span>
                <p>{criterion.description}</p>
                <ul className="requirement-list">
                  {criterion.evidenceRequirements.map((requirement) => (
                    <li key={requirement.id}>
                      <code>{requirement.id}</code>
                      <span>{requirement.description}</span>
                      <span className="source-types">
                        可接受来源：
                        {requirement.acceptedSourceTypes
                          .map((source) => sourceTypeText[source])
                          .join(" / ")}
                        ，至少 {requirement.minimumCount} 条
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <span className={criterionStatusClass[criterion.status]}>
                {criterionStatusText[criterion.status]}
              </span>
            </div>
          ))}
        </article>

        <article className="evidence-card">
          <h3>Evidence Map</h3>
          <p className="muted">
            每条验收标准对应的证据要求与已收集证据。证据必须来自实际读取，
            本页不会替系统假设证据存在。
          </p>

          {contract.acceptanceCriteria.map((criterion) => {
            const items = evidenceByCriterion.get(criterion.id) ?? [];
            return (
              <div className="evidence-group" key={criterion.id}>
                <div className="evidence-group-head">
                  <strong>{criterion.id}</strong>
                  <span className={criterionStatusClass[criterion.status]}>
                    {criterionStatusText[criterion.status]}
                  </span>
                </div>
                {items.length === 0 ? (
                  <p className="evidence-empty">
                    {criterion.status === "UNKNOWN"
                      ? "尚无证据：该验收项还没有被验证过。"
                      : "尚无证据条目：当前状态由其他环节推导。"}
                  </p>
                ) : (
                  items.map((item) => (
                    <div className="evidence-item" key={item.id}>
                      <div className="evidence-item-head">
                        <span className="evidence-source">{sourceTypeText[item.sourceType]}</span>
                        <span className="evidence-name">{item.sourceName}</span>
                      </div>
                      <p>{item.summary}</p>
                      <div className="evidence-item-foot">
                        <span>判定：{findingText[item.finding]}</span>
                        <span>审核：{reviewStatusText[item.reviewStatus]}</span>
                        <code>{item.requirementId}</code>
                      </div>
                    </div>
                  ))
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

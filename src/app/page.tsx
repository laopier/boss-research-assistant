"use client";

import { FormEvent, useState } from "react";
import {
  ApiErrorResponse,
  CONTRACT_SCHEMA_VERSION,
  GenerateBossContractResponse,
} from "@/lib/contracts";

const statusText = {
  UNKNOWN: "待验证",
  PASS: "通过",
  FAIL: "未通过",
};

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

  return (
    <main>
      <header className="hero">
        <div className="brand"><span>B</span> Boss 科研助手</div>
        <p className="eyebrow">MVP-0 · Goal-to-Contract Vertical Slice</p>
        <h1>先把模糊目标，变成<br />一个能验收的 Boss。</h1>
        <p className="intro">告诉 Boss 你想研究什么。当前版本会返回仓库固定 WACA 示例，用来验证产品链路与团队接口。</p>
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
  return (
    <section className="contract" aria-live="polite">
      <div className="contract-heading">
        <div>
          <p className="eyebrow">当前 Boss Contract</p>
          <h2>{contract.objective}</h2>
        </div>
        <span className="mock-badge">模拟数据</span>
      </div>

      <div className="meta-grid">
        <article><span>合同版本</span><strong>Revision {contract.revision}</strong></article>
        <article><span>预计时间</span><strong>{contract.estimatedMinutes} 分钟</strong></article>
        <article><span>协作模式</span><strong>{contract.assistanceMode}</strong></article>
        <article><span>状态</span><strong>{contract.status}</strong></article>
      </div>

      <div className="content-grid">
        <article className="criteria-card">
          <h3>验收标准</h3>
          {contract.acceptanceCriteria.map((criterion, index) => (
            <div className="criterion" key={criterion.id}>
              <span className="index">{String(index + 1).padStart(2, "0")}</span>
              <div><strong>{criterion.id}</strong><p>{criterion.description}</p></div>
              <span className="status">{statusText[criterion.status]}</span>
            </div>
          ))}
        </article>

        <article className="evidence-card">
          <h3>Evidence Map</h3>
          <p className="muted">当前展示仓库固定 WACA 示例的验收状态。</p>
          {contract.acceptanceCriteria.map((criterion) => (
            <div className="evidence" key={criterion.id}>
              <span>{criterion.description}</span>
              <strong>{statusText[criterion.status]}</strong>
            </div>
          ))}
        </article>
      </div>

      <div className="guard-grid">
        <article><h3>范围边界</h3><ul>{contract.scopeGuard.inScope.map((item) => <li key={item}>{item}</li>)}</ul></article>
        <article><h3>当前未知</h3><ul>{contract.unknowns.map((item) => <li key={item}>{item}</li>)}</ul></article>
      </div>
    </section>
  );
}

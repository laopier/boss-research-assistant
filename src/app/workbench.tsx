"use client";

import { useState } from "react";
import {
  Ledger,
  ResearchProject,
  deriveBoss,
} from "@/lib/failure-ledger";
import { NegotiationProposal, ProposalInput } from "@/lib/negotiation";
import { MilestoneDerivation, RoadmapDerivation, nextActionSummary } from "@/lib/roadmap";
import { NegotiationPanel } from "./negotiation-panel";
import { bossStatusClass, bossStatusText } from "./labels";

export interface WorkbenchProps {
  project: ResearchProject;
  roadmap: RoadmapDerivation;
  ledger: Ledger;
  /** Opens a Boss in the main view. */
  onOpenBoss: (contractId: string) => void;
  /** Starts the new-Boss flow. */
  onNewBoss: () => void;
  /** Clears the current local project after the parent confirms the action. */
  onStartOver: () => void;
  /** Applies an ACCEPTED negotiation proposal (the only roadmap-write path). */
  onApplyProposal: (proposal: NegotiationProposal, input: ProposalInput) => void | Promise<void>;
}

function percent(part: number): string {
  return `${Math.round(part * 100)}%`;
}

const milestoneStateText = {
  DONE: "已完成",
  ACTIVE: "进行中",
  PENDING: "未开始",
} as const;

const milestoneStateClass = {
  DONE: "status status-pass",
  ACTIVE: "status status-progress",
  PENDING: "status status-unknown",
} as const;

/**
 * The multi-Boss workbench (#17 Feature 1, #18 §1).
 *
 * One screen answers the issue's four questions: the project goal and global
 * progress at the top, milestones in order with their Bosses underneath, and
 * each Boss card naming its next action. The open Boss is marked, and the
 * numbers are all derived — nothing here is editable.
 */
export function Workbench({
  project,
  roadmap,
  ledger,
  onOpenBoss,
  onNewBoss,
  onStartOver,
  onApplyProposal,
}: WorkbenchProps) {
  // The panel is presentation state; the proposal itself lives inside it and
  // only reaches the ledger through onApplyProposal (an explicit accept).
  const [negotiating, setNegotiating] = useState(false);

  return (
    <section className="workbench" aria-label="Boss 工作台">
      <div className="workbench-head">
        <div>
          <p className="eyebrow">科研项目 · 第 {roadmap.revision} 版计划</p>
          <h2>{roadmap.goal}</h2>
          <p className="muted">
            已完成 {roadmap.bossesDone}/{roadmap.bossesTotal} 个步骤；Boss 会先展开眼前的一步，后面的任务会按计划逐步出现。
          </p>
        </div>
        <span className="actions">
          <button
            type="button"
            className="button-secondary"
            onClick={() => setNegotiating((open) => !open)}
          >
            {negotiating ? "收起对话" : "和 Boss 调整计划"}
          </button>
          <button type="button" className="button-secondary" onClick={onNewBoss}>
            添加下一步
          </button>
          <button type="button" className="button-danger" onClick={onStartOver}>
            重新开始
          </button>
        </span>
      </div>

      {negotiating && (
        <NegotiationPanel
          ledger={ledger}
          roadmap={roadmap}
          onApply={async (proposal, input) => {
            await onApplyProposal(proposal, input);
            setNegotiating(false);
          }}
          onClose={() => setNegotiating(false)}
        />
      )}

      <div className="workbench-progress">
        <div className="progress-bar-head">
          <strong>项目整体进度</strong>
          <span>{roadmap.progressPercent}%</span>
        </div>
        <div className="progress-track">
          <div
            className="progress-fill progress-fill-criterion"
            style={{ width: `${roadmap.progressPercent}%` }}
          />
        </div>
        <p className="field-hint">
          进度会把后面还没展开的步骤也算进去，并参考每一步的预计用时。调整计划后会自动重新计算。
        </p>
        {project.planningAssumptions && project.planningAssumptions.length > 0 && (
          <details className="plan-assumptions">
            <summary>这份计划是怎么估出来的</summary>
            <ul>
              {project.planningAssumptions.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </details>
        )}
      </div>

      {roadmap.milestones.map((milestone) => (
        <MilestoneCard
          key={milestone.id}
          milestone={milestone}
          ledger={ledger}
          currentBossId={roadmap.currentBossId}
          onOpenBoss={onOpenBoss}
        />
      ))}

      {roadmap.milestones.length === 0 && (
        <p className="muted">这个项目还没有阶段。先添加一个下一步。</p>
      )}

      {project.currentBossId && ledger.contracts[project.currentBossId] && (
        <p className="muted">
          正在做：{ledger.contracts[project.currentBossId].objective}
        </p>
      )}

      {project.history && project.history.length > 0 && (
        <div className="plan-history">
          <strong>计划调整记录</strong>
          <ul>
            {project.history.slice(0, 5).map((item) => (
              <li key={item.revision}>
                <code>第 {item.revision} 版</code>
                <span>
                  {item.reason}（总进度 {item.progressBefore}% → {item.progressAfter}%）
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function MilestoneCard({
  milestone,
  ledger,
  currentBossId,
  onOpenBoss,
}: {
  milestone: MilestoneDerivation;
  ledger: Ledger;
  currentBossId: string | undefined;
  onOpenBoss: (contractId: string) => void;
}) {
  return (
    <article className="milestone">
      <div className="milestone-head">
        <strong>{milestone.title}</strong>
        <span className={milestoneStateClass[milestone.state]}>
          {milestoneStateText[milestone.state]}
        </span>
        <span className="muted">
          {milestone.bossesDone}/{milestone.bossesTotal} 步 · {percent(milestone.progress)}
        </span>
      </div>
      <div className="progress-track">
        <div
          className="progress-fill progress-fill-deliverable"
          style={{ width: percent(milestone.progress) }}
        />
      </div>

      {milestone.bossIds.length === 0 && <p className="muted">这个阶段还没有安排任务。</p>}

      <div className="boss-grid">
        {milestone.bossIds.map((contractId) => {
          const contract = ledger.contracts[contractId];
          if (!contract) {
            return (
              <article className="boss-card" key={contractId}>
                <p className="muted">这一步的详细计划没有找到（{contractId}）。</p>
              </article>
            );
          }
          // A Boss may reuse criterion / requirement ids such as AC-1 and
          // REQ-1.  Passing the whole ledger would therefore let evidence from
          // another Boss pad this card's status.  Every derivation must stay
          // inside the contract boundary.
          const contractEvidence = ledger.evidence.filter(
            (item) => item.contractId === contractId,
          );
          const boss = deriveBoss(
            contract,
            contractEvidence,
            Boolean(ledger.accepted[contractId]),
          );
          const isCurrent = currentBossId === contractId;
          return (
            <article className={isCurrent ? "boss-card boss-card-current" : "boss-card"} key={contractId}>
              <div className="boss-card-head">
                {isCurrent && <span className="tag tag-required">当前</span>}
                <span className={bossStatusClass[boss.status]}>{bossStatusText[boss.status]}</span>
              </div>
              <p className="boss-card-objective">{contract.objective}</p>
              <p className="muted">下一步：{nextActionSummary(ledger, contractId)}</p>
              <button
                type="button"
                className="button-secondary"
                onClick={() => onOpenBoss(contractId)}
              >
                {isCurrent ? "继续这一步" : "查看这一步"}
              </button>
            </article>
          );
        })}
        {milestone.plannedSteps
          .filter((step) => !step.contractId)
          .map((step) => (
            <article className="boss-card boss-card-planned" key={step.id}>
              <div className="boss-card-head">
                <span className="status status-unknown">计划中</span>
              </div>
              <p className="boss-card-objective">{step.title}</p>
              <p className="muted">{step.objective}</p>
              <p className="field-hint">预计 {step.estimatedMinutes} 分钟 · 做完前面的步骤后，Boss 会展开详细计划</p>
            </article>
          ))}
      </div>
    </article>
  );
}

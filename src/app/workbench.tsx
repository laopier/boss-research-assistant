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
import {
  MAX_DAILY_MINUTES,
  MAX_PLANNED_DAYS,
  ProjectTimeBudget,
  RouteMinutes,
  overBudgetMinutes,
  totalBudgetMinutes,
  workSessions,
} from "@/lib/time-budget";

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
  /** Stores the user's own time budget. Does not touch revision or history. */
  onSaveTimeBudget: (budget: ProjectTimeBudget) => void;
  /** Removes the time budget and nothing else. */
  onClearTimeBudget: () => void;
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
  onSaveTimeBudget,
  onClearTimeBudget,
}: WorkbenchProps) {
  // The panel is presentation state; the proposal itself lives inside it and
  // only reaches the ledger through onApplyProposal (an explicit accept).
  const [negotiating, setNegotiating] = useState(false);
  const dailyMinutes = project.timeBudget?.dailyMinutes;

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
        <TimeBudgetPanel
          plannedMinutes={roadmap.plannedMinutes}
          budget={project.timeBudget}
          onSave={onSaveTimeBudget}
          onClear={onClearTimeBudget}
        />
      </div>

      {roadmap.milestones.map((milestone) => (
        <MilestoneCard
          key={milestone.id}
          milestone={milestone}
          ledger={ledger}
          currentBossId={roadmap.currentBossId}
          dailyMinutes={dailyMinutes}
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

/**
 * "预计需要 N 个工作时段" — an estimate of how many daily sessions one step
 * needs. Shown only when a budget exists and the step does not fit in a day.
 * It never splits the step or changes its length.
 */
function SessionHint({
  minutes,
  dailyMinutes,
}: {
  minutes: number | undefined;
  dailyMinutes: number | undefined;
}) {
  if (minutes === undefined || dailyMinutes === undefined) return null;
  if (minutes <= dailyMinutes) return null;
  return (
    <p className="step-sessions">
      预计需要 {workSessions(minutes, dailyMinutes)} 个工作时段
    </p>
  );
}

/**
 * Time budget (Issue #23): shows what the whole route is expected to cost and,
 * only once the user has answered both questions, how that compares with the
 * time they say they have.
 *
 * The summary always reads the SAVED budget, never the draft being typed, so an
 * unfinished edit cannot change what the page claims. Nothing here splits work,
 * resizes steps, or touches acceptance or progress.
 */
function TimeBudgetPanel({
  plannedMinutes,
  budget,
  onSave,
  onClear,
}: {
  plannedMinutes: RouteMinutes;
  budget: ProjectTimeBudget | undefined;
  onSave: (budget: ProjectTimeBudget) => void;
  onClear: () => void;
}) {
  const [days, setDays] = useState(budget ? String(budget.plannedDays) : "");
  const [minutes, setMinutes] = useState(budget ? String(budget.dailyMinutes) : "");
  const [message, setMessage] = useState("");

  const budgetTotal = totalBudgetMinutes(budget);
  const gap = overBudgetMinutes(plannedMinutes.total, budget);

  function readCount(raw: string): number | undefined {
    const text = raw.trim();
    if (text === "") return undefined;
    const value = Number(text);
    return Number.isInteger(value) ? value : undefined;
  }

  function handleSave(): void {
    const plannedDays = readCount(days);
    const dailyMinutes = readCount(minutes);
    if (plannedDays === undefined || dailyMinutes === undefined) {
      setMessage("两项都要填写（整数），才能保存预算；已保存的预算不会被改动。");
      return;
    }
    if (plannedDays < 1 || plannedDays > MAX_PLANNED_DAYS) {
      setMessage(`天数请填 1–${MAX_PLANNED_DAYS} 之间的整数。`);
      return;
    }
    if (dailyMinutes < 1 || dailyMinutes > MAX_DAILY_MINUTES) {
      setMessage(`每天分钟数请填 1–${MAX_DAILY_MINUTES} 之间的整数。`);
      return;
    }
    onSave({ plannedDays, dailyMinutes });
    setMessage("已保存预算。");
  }

  function handleClear(): void {
    onClear();
    setDays("");
    setMinutes("");
    setMessage("已清除预算。");
  }

  return (
    <div className="time-budget">
      {plannedMinutes.estimable ? (
        <>
          <p className="time-budget-total">
            完整路线预计总时长 <strong>{plannedMinutes.total} 分钟</strong>
            <span className="time-budget-note">（包含已经完成的步骤）</span>
          </p>
          {budgetTotal === undefined ? (
            <p className="time-budget-muted">
              填写「计划投入几天」和「每天可用多少分钟」后，可以对比总预算。
            </p>
          ) : gap > 0 ? (
            <p className="time-budget-warning">
              预计超出可用时间 {gap} 分钟（可用 {budgetTotal} 分钟）
            </p>
          ) : (
            <p className="time-budget-muted">
              可用时间 {budgetTotal} 分钟，路线预计 {plannedMinutes.total} 分钟。
            </p>
          )}
        </>
      ) : (
        <p className="time-budget-muted">
          这个项目里有些步骤还没有预计用时，暂时无法统计完整路线的总时长。
        </p>
      )}

      <details className="time-budget-editor">
        <summary>{budget ? "修改时间预算" : "填写时间预算"}</summary>
        <div className="time-budget-form">
          <label className="time-budget-field" htmlFor="time-budget-days">
            <span>计划投入几天</span>
            <input
              id="time-budget-days"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_PLANNED_DAYS}
              step={1}
              value={days}
              onChange={(event) => setDays(event.target.value)}
            />
          </label>
          <label className="time-budget-field" htmlFor="time-budget-minutes">
            <span>每天可用多少分钟</span>
            <input
              id="time-budget-minutes"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_DAILY_MINUTES}
              step={1}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
            />
          </label>
          <span className="time-budget-actions">
            <button type="button" className="button-secondary" onClick={handleSave}>
              保存预算
            </button>
            {budget && (
              <button type="button" className="button-secondary" onClick={handleClear}>
                清除预算
              </button>
            )}
          </span>
        </div>
        <p className="time-budget-note">
          这只是按预计用时做的估算，不代表系统已经替你排好了具体日程；也不会拆分任务或改动时长、验收与进度。
        </p>
        {message && <p className="time-budget-message">{message}</p>}
      </details>
    </div>
  );
}

function MilestoneCard({
  milestone,
  ledger,
  currentBossId,
  dailyMinutes,
  onOpenBoss,
}: {
  milestone: MilestoneDerivation;
  ledger: Ledger;
  currentBossId: string | undefined;
  /** Undefined until the user saves a budget; no session hint is shown then. */
  dailyMinutes: number | undefined;
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
          // An expanded Boss is still the same planned step, so its minutes are
          // the plan's estimate. Adding the contract's own estimate on top would
          // count the same work twice (Issue #23).
          const planned = milestone.plannedSteps.find((step) => step.contractId === contractId);
          return (
            <article className={isCurrent ? "boss-card boss-card-current" : "boss-card"} key={contractId}>
              <div className="boss-card-head">
                {isCurrent && <span className="tag tag-required">当前</span>}
                <span className={bossStatusClass[boss.status]}>{bossStatusText[boss.status]}</span>
              </div>
              <p className="boss-card-objective">{contract.objective}</p>
              <p className="muted">下一步：{nextActionSummary(ledger, contractId)}</p>
              <SessionHint minutes={planned?.estimatedMinutes} dailyMinutes={dailyMinutes} />
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
              <SessionHint minutes={step.estimatedMinutes} dailyMinutes={dailyMinutes} />
            </article>
          ))}
      </div>
    </article>
  );
}

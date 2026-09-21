"use client";

import { FailureAsset } from "@/lib/failure-ledger";
import {
  MissingRequirement,
  NextAction,
  ProgressDerivation,
} from "@/lib/progress";
import { sourceTypeText } from "./labels";

export interface ProgressPanelProps {
  progress: ProgressDerivation;
  onAccept: () => void;
  onIncubate: (failure: FailureAsset) => void;
  /** Points at the criterion that still needs evidence. */
  onSubmitEvidence: (criterionId: string) => void;
  onCompleteBoss: () => void;
}

function requirementGap(item: MissingRequirement): string {
  const sources = item.acceptedSourceTypes.map((source) => sourceTypeText[source]).join(" / ");
  return `${item.requirementId} 还缺 ${item.need - item.have} 条（${sources}）`;
}

/**
 * The single next action, rendered from the derived `nextAction` rather than
 * from component state, so it cannot disagree with the ledger.
 */
function NextActionControl({
  action,
  onAccept,
  onIncubate,
  onSubmitEvidence,
  onCompleteBoss,
}: {
  action: NextAction;
  onAccept: () => void;
  onIncubate: (failure: FailureAsset) => void;
  onSubmitEvidence: (criterionId: string) => void;
  onCompleteBoss: () => void;
}) {
  switch (action.kind) {
    case "ACCEPT_CONTRACT":
      return (
        <button type="button" onClick={onAccept}>
          接受合同，开始记录证据
        </button>
      );
    case "COMPLETE_BOSS":
      return (
        <div className="next-action">
          <button type="button" onClick={onCompleteBoss}>
            完成 Boss，导出验收报告
          </button>
        </div>
      );
    case "REVISE_CONTRACT":
      return (
        <div className="next-action">
          <p className="muted">当前合同没有足够的验收标准，无法诚实判定完成。</p>
          <button type="button" className="button-secondary" disabled>
            请先协商并补充验收标准
          </button>
        </div>
      );
    case "RESOLVE_BLOCKER":
      return (
        <div className="next-action">
          <p className="muted">
            当前无法完成：{action.blocker.description}。解除方式：{action.blocker.resolution}
          </p>
          <button type="button" className="button-secondary" disabled>
            先解除阻塞项 {action.blocker.id}
          </button>
        </div>
      );
    case "INCUBATE_FAILURE":
      return (
        <div className="next-action">
          <p className="muted">有一条未解决的失败记录：{action.failure.evidence.summary}</p>
          <button type="button" className="button-secondary" onClick={() => onIncubate(action.failure)}>
            孵化成下一个 Boss
          </button>
        </div>
      );
    case "SUBMIT_EVIDENCE":
      return (
        <div className="next-action">
          <p className="muted">
            还缺证据：{action.missing.criterionId} · {requirementGap(action.missing)}
          </p>
          <button
            type="button"
            className="button-secondary"
            onClick={() => onSubmitEvidence(action.missing.criterionId)}
          >
            去 {action.missing.criterionId} 提交证据
          </button>
        </div>
      );
  }
}

function ratio(part: number, whole: number): string {
  if (whole === 0) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

/**
 * Explainable progress, in the two axes issue #17 names.
 *
 * Both numbers are derived — the page never lets the user type a percentage.
 * Next to the numbers it lists what is done, what is missing, and what to do
 * next, which is the "what have I done / what's left / what's next" answer the
 * issue's last acceptance criterion asks to put on one screen.
 */
export function ProgressPanel({
  progress,
  onAccept,
  onIncubate,
  onSubmitEvidence,
  onCompleteBoss,
}: ProgressPanelProps) {
  return (
    <section className="progress-panel" aria-label="完成进度">
      <div className="progress-bars">
        <div className="progress-bar">
          <div className="progress-bar-head">
            <strong>产出进度</strong>
            <span>
              {progress.deliverablesDone}/{progress.deliverablesTotal} 交付物
            </span>
          </div>
          <div className="progress-track">
            <div
              className="progress-fill progress-fill-deliverable"
              style={{ width: ratio(progress.deliverablesDone, progress.deliverablesTotal) }}
            />
          </div>
        </div>
        <div className="progress-bar">
          <div className="progress-bar-head">
            <strong>通关进度</strong>
            <span>
              {progress.requiredPassed}/{progress.requiredTotal} 必需验收项
            </span>
          </div>
          <div className="progress-track">
            <div
              className="progress-fill progress-fill-criterion"
              style={{ width: ratio(progress.requiredPassed, progress.requiredTotal) }}
            />
          </div>
        </div>
      </div>

      {progress.blockers.length > 0 && (
        <p className="progress-blocker">
          当前阻塞：{progress.blockers.join("、")}。
        </p>
      )}

      {progress.missing.length > 0 && (
        <ul className="progress-missing">
          {progress.missing.map((item) => (
            <li key={`${item.criterionId}:${item.requirementId}`}>
              <code>{item.criterionId}</code>
              <span className={item.criterionRequired ? "tag tag-required" : "tag"}>
                {item.criterionRequired ? "必需" : "可选"}
              </span>
              <span>{requirementGap(item)}</span>
            </li>
          ))}
        </ul>
      )}

      {progress.unresolvedFailures > 0 && (
        <p className="progress-failures muted">
          还有 {progress.unresolvedFailures} 条未解决的失败证据沉淀在失败资产库。
        </p>
      )}

      <NextActionControl
        action={progress.nextAction}
        onAccept={onAccept}
        onIncubate={onIncubate}
        onSubmitEvidence={onSubmitEvidence}
        onCompleteBoss={onCompleteBoss}
      />
    </section>
  );
}

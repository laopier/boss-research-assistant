"use client";

import { FailureAsset } from "@/lib/failure-ledger";
import {
  MissingRequirement,
  NextAction,
  ProgressDerivation,
} from "@/lib/progress";
import { sourceTypeText, criterionLabelOrId } from "./labels";

export interface ProgressPanelProps {
  progress: ProgressDerivation;
  onAccept: () => void;
  onIncubate: (failure: FailureAsset) => void;
  /** Points at the criterion that still needs evidence. */
  onSubmitEvidence: (criterionId: string) => void;
  onAdvanceProject: () => void;
  onExportReport: () => void;
  advancing?: boolean;
}

/**
 * issue #21: the requirement's own sentence says what to bring, so it replaces
 * `requirementId` here; the id is still rendered next to the row for tracing.
 */
function requirementGap(item: MissingRequirement): string {
  const sources = item.acceptedSourceTypes.map((source) => sourceTypeText[source]).join(" / ");
  return `${item.description}；还需要 ${item.need - item.have} 份材料（可以提交：${sources}）`;
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
  onAdvanceProject,
  onExportReport,
  advancing = false,
}: {
  action: NextAction;
  onAccept: () => void;
  onIncubate: (failure: FailureAsset) => void;
  onSubmitEvidence: (criterionId: string) => void;
  onAdvanceProject: () => void;
  onExportReport: () => void;
  advancing?: boolean;
}) {
  switch (action.kind) {
    case "ACCEPT_CONTRACT":
      return (
        <button type="button" onClick={onAccept}>
          确认这一步，开始行动
        </button>
      );
    case "ADVANCE_PROJECT":
      return (
        <div className="next-action">
          <p className="muted">这一步已经完成，但整个项目还没有结束。</p>
          <button type="button" onClick={onAdvanceProject} disabled={advancing}>
            {advancing ? "正在准备下一步…" : "开始下一步"}
          </button>
          <button type="button" className="button-secondary" onClick={onExportReport}>
            下载这一步的结果记录
          </button>
        </div>
      );
    case "REVISE_CONTRACT":
      return (
        <div className="next-action">
          <p className="muted">这一步缺少明确的完成标准，暂时无法判断是否完成。</p>
          <button type="button" className="button-secondary" disabled>
            请先补充完成标准
          </button>
        </div>
      );
    case "RESOLVE_BLOCKER":
      return (
        <div className="next-action">
          <p className="muted">
            现在卡在：{action.blocker.description}。可以这样解决：{action.blocker.resolution}
          </p>
          <button type="button" className="button-secondary" disabled>
            先解决这个问题
          </button>
        </div>
      );
    case "INCUBATE_FAILURE":
      return (
        <div className="next-action">
          <p className="muted">这里记录了一个还没解决的问题：{action.failure.evidence.summary}</p>
          <button type="button" className="button-secondary" onClick={() => onIncubate(action.failure)}>
            把这个问题拆成下一步
          </button>
        </div>
      );
    case "SUBMIT_EVIDENCE": {
      // Short and repeatable: the full task sentence sits outside the button.
      const target = criterionLabelOrId(action.missing.criterionIndex, action.missing.criterionId);
      return (
        <div className="next-action">
          <p className="muted">
            还需要补充：{target} · {requirementGap(action.missing)}
          </p>
          <button
            type="button"
            className="button-secondary"
            onClick={() => onSubmitEvidence(action.missing.criterionId)}
          >
            {`提交${target}需要的材料`}
          </button>
        </div>
      );
    }
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
  onAdvanceProject,
  onExportReport,
  advancing = false,
}: ProgressPanelProps) {
  return (
    <section className="progress-panel" aria-label="完成进度">
      <div className="progress-bars">
        <div className="progress-bar">
          <div className="progress-bar-head">
            <strong>成果准备</strong>
            <span>
              {progress.deliverablesDone}/{progress.deliverablesTotal} 项成果
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
            <strong>完成检查</strong>
            <span>
              {progress.requiredPassed}/{progress.requiredTotal} 项必须完成
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
          现在卡在：{progress.blockers.join("、")}。
        </p>
      )}

      {progress.missing.length > 0 && (
        <ul className="progress-missing">
          {progress.missing.map((item) => (
            <li key={`${item.criterionId}:${item.requirementId}`}>
              <strong className="task-label">
                {criterionLabelOrId(item.criterionIndex, item.criterionId)}
              </strong>
              <span className={item.criterionRequired ? "tag tag-required" : "tag"}>
                {item.criterionRequired ? "必须" : "加分项"}
              </span>
              <span className="task-desc">{requirementGap(item)}</span>
              <code className="internal-id">{`${item.criterionId} · ${item.requirementId}`}</code>
            </li>
          ))}
        </ul>
      )}

      {progress.unresolvedFailures > 0 && (
        <p className="progress-failures muted">
          还有 {progress.unresolvedFailures} 个问题没有解决，已经保存在“踩坑记录”里。
        </p>
      )}

      <NextActionControl
        action={progress.nextAction}
        onAccept={onAccept}
        onIncubate={onIncubate}
        onSubmitEvidence={onSubmitEvidence}
        onAdvanceProject={onAdvanceProject}
        onExportReport={onExportReport}
        advancing={advancing}
      />
    </section>
  );
}

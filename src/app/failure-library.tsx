"use client";

import { FailureAsset } from "@/lib/failure-ledger";
import { sourceTypeText } from "./labels";

export interface FailureLibraryProps {
  failures: FailureAsset[];
  /** True while an incubation request is in flight. */
  busy: boolean;
  onIncubate: (failure: FailureAsset) => void;
}

function formatRecordedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The accumulated failure assets.
 *
 * This is the part of the product that the competition direction names:
 * failures are evidence-backed, they outlive the Boss that produced them, and
 * they stay in the library after being fixed so the knowledge is not thrown
 * away when the symptom disappears.
 */
export function FailureLibrary({ failures, busy, onIncubate }: FailureLibraryProps) {
  const unresolved = failures.filter((item) => !item.resolved).length;

  return (
    <section className="library">
      <div className="library-head">
        <h3>踩坑记录</h3>
        <p className="muted">
          已经记下 <strong>{failures.length}</strong> 个问题，其中 <strong>{unresolved}</strong> 个还没解决。
          修好以后记录也会保留，方便以后少走弯路。
        </p>
      </div>

      {failures.length === 0 && (
        <p className="library-empty">
          目前还没有踩坑记录。如果检查发现问题，Boss 会把它留在这里。
        </p>
      )}

      {failures.map((failure) => (
        <article className={failure.resolved ? "failure failure-resolved" : "failure"} key={failure.evidence.id}>
          <div className="failure-head">
            <span className="failure-criterion">{failure.evidence.criterionId}</span>
            <span className={failure.resolved ? "status status-pass" : "status status-fail"}>
              {failure.resolved ? "已解决" : "待解决"}
            </span>
          </div>

          <p className="failure-summary">{failure.evidence.summary}</p>

          <div className="failure-meta">
            <span>{sourceTypeText[failure.evidence.sourceType]}</span>
            <span className="failure-source">{failure.evidence.sourceName}</span>
            <code>{failure.evidence.requirementId}</code>
            <span>{formatRecordedAt(failure.evidence.recordedAt)}</span>
          </div>

          {failure.context && (
            <p className="failure-context">来自 Boss：{failure.context.objective}</p>
          )}

          <div className="failure-foot">
            <span className="muted">
              {failure.resolved
                ? "这个问题后来已经解决；原来的记录仍会保留。"
                : "可以把这个问题拆成一个更小的下一步。"}
            </span>
            <button type="button" className="button-secondary" disabled={busy} onClick={() => onIncubate(failure)}>
              {busy ? "正在拆分…" : "拆成下一步"}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

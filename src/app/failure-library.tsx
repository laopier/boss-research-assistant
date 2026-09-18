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
        <h3>失败资产库</h3>
        <p className="muted">
          已累计 <strong>{failures.length}</strong> 条失败证据，其中 <strong>{unresolved}</strong> 条尚未解决。
          已解决的失败同样保留——失败记录本身就是资产。
        </p>
      </div>

      {failures.length === 0 && (
        <p className="library-empty">
          还没有任何未通过的验收项。记录一条判定为「未通过」的证据，它就会沉淀到这里。
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
                ? "该验收项后来有了一条通过的证据；这条失败记录仍作为经验保留。"
                : "可以把它孵化成一个新的、有界的 Boss。"}
            </span>
            <button type="button" className="button-secondary" disabled={busy} onClick={() => onIncubate(failure)}>
              {busy ? "正在孵化…" : "孵化下一个 Boss"}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

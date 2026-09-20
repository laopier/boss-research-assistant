"use client";

import { useState } from "react";
import {
  EvidenceFinding,
  EvidenceRecord,
  EvidenceReviewStatus,
  MIN_OVERRIDE_REASON_LENGTH,
  OverrideDraft,
  ReviewOutcome,
  ReviewOverride,
  isAuditableOverride,
  reviewStatusForDecision,
} from "@/lib/failure-ledger";
import {
  findingText,
  findings,
  proofBoundaryHint,
  proofBoundaryText,
  reviewDecisionClass,
  reviewDecisionText,
  reviewerKindText,
  reviewStatusText,
  sourceTypeText,
} from "./labels";

export interface EvidenceReviewPanelProps {
  record: EvidenceRecord;
  /** The review the user adopted, read back from the ledger. */
  adopted: ReviewOutcome | undefined;
  /** A fresh review that has not been adopted yet, if this page produced one. */
  proposal: ReviewOutcome | undefined;
  /** The last human override of this record, if any. */
  override: ReviewOverride | undefined;
  busy: boolean;
  error: string;
  /** Present when this page still holds the submitted text for a re-review. */
  canRetry: boolean;
  onRetry: () => void;
  onAdopt: (outcome: ReviewOutcome) => void;
  onOverride: (draft: OverrideDraft, outcome: ReviewOutcome | undefined) => void;
}

/**
 * The verdict, the reason for it, and the two ways a human can respond.
 *
 * Three things are shown on purpose and in this order, because they are the
 * three questions a user actually asks: did it count? what did it find? how far
 * does it prove? `suggestedNextEvidence` then answers the fourth — "so what do
 * I do now?" — which is the step the previous build left the user stuck on.
 *
 * The distinction between `proposal` and `adopted` is the whole boundary in one
 * prop: a proposal changes nothing, and says so, until the user acts.
 */
export function EvidenceReviewPanel({
  record,
  adopted,
  proposal,
  override,
  busy,
  error,
  canRetry,
  onRetry,
  onAdopt,
  onOverride,
}: EvidenceReviewPanelProps) {
  const [overrideOpen, setOverrideOpen] = useState(false);
  const review = adopted ?? proposal;
  /**
   * An override can arrive two ways: after adopting the review, or instead of
   * adopting it. Both are human decisions, so both cases must stop saying
   * "已采纳" — otherwise the page would credit the AI with a verdict a person
   * actually made, which is the opposite of what this audit trail is for.
   */
  const overruled = override !== undefined;

  return (
    <div className="review-panel">
      {proposal && !adopted && (
        <p className="review-callout">
          这是审核建议，<strong>还没有写入判定</strong>。采纳后才会影响 {record.criterionId} 的状态。
        </p>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {review ? (
        <>
          <p className="review-headline">
            {overruled ? "审核建议（已被人工覆盖）" : adopted ? "审核结论（已采纳）" : "审核建议（未采纳）"}
          </p>
          <div className="review-verdict">
            <span className={reviewDecisionClass[review.decision]}>
              {reviewDecisionText[review.decision]}
            </span>
            <span className={`status ${findingClass(review.finding)}`}>
              判定：{findingText[review.finding]}
            </span>
            <span className="review-provenance">
              {reviewerKindText[review.reviewerKind]} · {review.promptVersion}
            </span>
          </div>

          <p className="review-rationale">{review.rationale}</p>

          <div className="review-boundary">
            <span className="review-boundary-label">证明边界</span>
            <span className="review-boundary-value">{proofBoundaryText[review.proofBoundary]}</span>
            <span className="source-type-declared">
              提交时声明：{sourceTypeText[record.sourceType]}
            </span>
            <p className="field-hint">{proofBoundaryHint[review.proofBoundary]}</p>
          </div>

          {review.suggestedNextEvidence.length > 0 && (
            <div className="review-suggestions">
              <strong>建议补充的证据</strong>
              <ul>
                {review.suggestedNextEvidence.map((item, index) => (
                  <li key={`${item.sourceType}-${index}`}>
                    <span className="suggested-source">{sourceTypeText[item.sourceType]}</span>
                    <span>{item.hint}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {override && (
            <p className="override-audit">
              人工覆盖：{reviewStatusText[override.fromStatus]} → {reviewStatusText[override.toStatus]}
              （判定 {findingText[override.fromFinding]} → {findingText[override.toFinding]}）
              <span className="muted"> · {formatMoment(override.at)} · 理由：{override.reason}</span>
            </p>
          )}

          <div className="review-actions-row">
            {!adopted && proposal && (
              <button type="button" disabled={busy} onClick={() => onAdopt(proposal)}>
                采纳这个结论
              </button>
            )}
            <button
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={() => setOverrideOpen((open) => !open)}
            >
              {overrideOpen ? "取消改判" : overruled || adopted ? "改判（人工覆盖）" : "我不认同，人工判定"}
            </button>
            {adopted && !overruled && (
              <span className="muted">
                已采纳{adopted.decision === "INCONCLUSIVE" ? "（结论为无法判断，状态保持待审核）" : ""}
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="review-actions-row">
          <span className="muted">
            这条证据还没有审核结论。提交审核后，这里会显示审核器接受了什么、依据是什么。
          </span>
          {canRetry && (
            <button type="button" className="button-secondary" disabled={busy} onClick={onRetry}>
              {busy ? "审核中…" : "重新审核这条证据"}
            </button>
          )}
        </div>
      )}

      {overrideOpen && (
        <OverrideForm
          record={record}
          review={review}
          busy={busy}
          onCancel={() => setOverrideOpen(false)}
          onConfirm={(draft) => {
            onOverride(draft, review);
            setOverrideOpen(false);
          }}
        />
      )}
    </div>
  );
}

function findingClass(finding: EvidenceFinding): string {
  if (finding === "PASS") return "status-pass";
  if (finding === "FAIL") return "status-fail";
  return "status-unknown";
}

function formatMoment(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface OverrideFormProps {
  record: EvidenceRecord;
  review: ReviewOutcome | undefined;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (draft: OverrideDraft) => void;
}

/**
 * The escape hatch, deliberately made expensive.
 *
 * A human may always overrule the reviewer — the rules in
 * `docs/contracts.zh-CN.md` are semantic, not moral, and a reviewer reading
 * pasted text is genuinely allowed to be wrong. But the override must be
 * attributable, so this form refuses to submit without a written reason and the
 * ledger keeps the result forever.
 *
 * The new status starts at whatever the review said, so changing the decision
 * is an explicit act rather than the default of clicking through.
 */
function OverrideForm({ record, review, busy, onCancel, onConfirm }: OverrideFormProps) {
  const [toStatus, setToStatus] = useState<EvidenceReviewStatus>(
    review ? reviewStatusForDecision(review.decision) : "ACCEPTED",
  );
  const [toFinding, setToFinding] = useState<EvidenceFinding>(review?.finding ?? "INCONCLUSIVE");
  const [reason, setReason] = useState("");

  const auditable = isAuditableOverride({ reason });

  return (
    <div className="override-form">
      <p className="override-warning">
        人工覆盖会把「谁在什么时候、把结论改成了什么、为什么」永久写入本地审计记录，并出现在科研历程里。
      </p>

      <div className="field-row">
        <label>
          新的审核状态
          <select
            value={toStatus}
            onChange={(event) => setToStatus(event.target.value as EvidenceReviewStatus)}
          >
            <option value="ACCEPTED">接受（计入判定）</option>
            <option value="REJECTED">拒绝（不计入判定）</option>
            <option value="PENDING">退回待审核</option>
          </select>
        </label>
        <label>
          新的判定
          <select
            value={toFinding}
            onChange={(event) => setToFinding(event.target.value as EvidenceFinding)}
          >
            {findings.map((item) => (
              <option key={item} value={item}>
                {findingText[item]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        覆盖理由（会显示在科研历程中，至少 {MIN_OVERRIDE_REASON_LENGTH} 个字）
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={200}
          placeholder="例如：审核器只看到粘贴的文本，但我已经在 CI 上跑过同一份用例，失败原因是环境缺少依赖。"
        />
      </label>

      <div className="evidence-form-footer">
        <span className="muted">
          {reason.trim().length} / {MIN_OVERRIDE_REASON_LENGTH} 字
        </span>
        <span className="actions">
          <button type="button" className="button-secondary" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            disabled={!auditable || busy}
            onClick={() =>
              onConfirm({
                evidenceId: record.id,
                toStatus,
                toFinding,
                reason,
                at: new Date().toISOString(),
              })
            }
          >
            确认覆盖
          </button>
        </span>
      </div>
    </div>
  );
}

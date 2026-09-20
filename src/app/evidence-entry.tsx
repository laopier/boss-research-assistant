"use client";

import { useState } from "react";
import { AcceptanceCriterion, EvidenceSourceType } from "@/lib/contracts";
import {
  buildReviewRequest,
  requestEvidenceReview,
  reviewErrorMessage,
} from "@/lib/evidence-review/client";
import { CONTENT_MAX_LENGTH, SOURCE_NAME_MAX_LENGTH } from "@/lib/evidence-review/types";
import {
  CriterionDerivation,
  EvidenceRecord,
  Ledger,
  OverrideDraft,
  ReviewOutcome,
  latestOverrideFor,
  reviewFor,
} from "@/lib/failure-ledger";
import { EvidenceReviewPanel } from "./evidence-review-panel";
import {
  criterionStatusClass,
  criterionStatusText,
  findingText,
  reviewStatusText,
  sourceTypeHint,
  sourceTypeText,
} from "./labels";

/** The durable part of a submission: what gets written to the ledger. */
export interface EvidenceSubmissionInput {
  requirementId: string;
  sourceType: EvidenceSourceType;
  sourceName: string;
  summary: string;
  /**
   * The pasted material that is sent for review.
   *
   * Deliberately absent from the ledger: `EvidenceRecord` mirrors the frozen
   * contract's evidence item, which has no field for raw content, and keeping
   * pasted logs on the device for the life of the demo is a privacy cost with no
   * product benefit. What survives is the reviewer's rationale.
   */
  content: string;
}

type AcceptanceRequirement = AcceptanceCriterion["evidenceRequirements"][number];

export interface EvidenceSubmitFormProps {
  criterion: AcceptanceCriterion;
  submitting: boolean;
  onSubmit: (input: EvidenceSubmissionInput) => void;
  onCancel: () => void;
}

/**
 * The submission form. It collects MATERIAL, never a verdict.
 *
 * There is no "这条证据支持什么结论" control any more, and its absence is the
 * point of this ticket. Previously the user chose 通过/未通过 themselves and then
 * accepted their own choice, so a criterion could reach PASS on two clicks and a
 * sentence. The only verdict inputs now are the reviewer's answer and an audited
 * human override.
 *
 * The form owns its own field state so that closing it discards a half-typed
 * draft, and so it can be rendered and asserted on without a DOM.
 */
export function EvidenceSubmitForm({
  criterion,
  submitting,
  onSubmit,
  onCancel,
}: EvidenceSubmitFormProps) {
  const [requirementId, setRequirementId] = useState(criterion.evidenceRequirements[0]?.id ?? "");
  const requirement: AcceptanceRequirement | undefined =
    criterion.evidenceRequirements.find((item) => item.id === requirementId) ??
    criterion.evidenceRequirements[0];
  const [sourceType, setSourceType] = useState<EvidenceSourceType>(
    requirement?.acceptedSourceTypes[0] ?? "LOG_INSPECTED",
  );
  const [sourceName, setSourceName] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");

  const canSubmit =
    !submitting &&
    Boolean(requirement) &&
    sourceName.trim().length > 0 &&
    summary.trim().length > 0 &&
    content.trim().length > 0;

  if (!requirement) {
    return (
      <p className="muted">这个验收项没有定义证据要求，因此无法提交证据。</p>
    );
  }

  return (
    <div className="evidence-form">
      <div className="field-row">
        <label>
          对应证据要求
          <select
            value={requirement.id}
            onChange={(event) => {
              const next = criterion.evidenceRequirements.find(
                (item) => item.id === event.target.value,
              );
              setRequirementId(event.target.value);
              if (next) setSourceType(next.acceptedSourceTypes[0]);
            }}
          >
            {criterion.evidenceRequirements.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          证据来源类型
          <select
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value as EvidenceSourceType)}
          >
            {requirement.acceptedSourceTypes.map((source) => (
              <option key={source} value={source}>
                {sourceTypeText[source]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="field-hint">{sourceTypeHint[sourceType]}</p>

      <label>
        来源名称
        <input
          value={sourceName}
          onChange={(event) => setSourceName(event.target.value)}
          maxLength={SOURCE_NAME_MAX_LENGTH}
          placeholder="例如 tests/test_waca.py"
        />
      </label>

      <label>
        一句话说明这条证据是什么
        <input
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          maxLength={200}
          placeholder="例如：Stage 2 收到的是 Stage 1 描述符而非 Xweak 的运行时证据"
        />
      </label>

      <label>
        粘贴内容（日志 / 代码片段 / 结果描述）
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          maxLength={CONTENT_MAX_LENGTH}
          placeholder={"例如：\n$ python tests/test_waca.py\nAssertionError: Stage 2 expected Xweak, got descriptor"}
        />
      </label>

      <p className="privacy-note">
        提交内容会发送到本应用的审核服务做判定；当服务端配置为 AI 模式（
        <code>BOSS_GENERATOR=llm</code>）时，内容会进一步发送给 DeepSeek。
        请勿粘贴密钥、个人信息或未脱敏数据。原始文本<strong>不会被保存</strong>，
        页面只保留审核结论、证明边界与理由。
      </p>

      <div className="evidence-form-footer">
        <span className="muted">
          {content.trim().length} / {CONTENT_MAX_LENGTH} 字 · 提交后进入「待审核」，
          采纳审核结论才会影响判定。
        </span>
        <span className="actions">
          <button type="button" className="button-secondary" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                requirementId: requirement.id,
                sourceType,
                sourceName: sourceName.trim(),
                summary: summary.trim(),
                content: content.trim(),
              })
            }
          >
            {submitting ? "正在审核…" : "提交并送审"}
          </button>
        </span>
      </div>
    </div>
  );
}

export interface EvidenceEntryProps {
  criterion: AcceptanceCriterion;
  derivation: CriterionDerivation;
  records: EvidenceRecord[];
  /** The whole ledger: reviews and the override log are read through its helpers. */
  ledger: Ledger;
  /** Evidence cannot be recorded before the contract is accepted (§10). */
  locked: boolean;
  /** Writes the record and returns its id; the review is requested separately. */
  onRecord: (input: EvidenceSubmissionInput) => string;
  onAdopt: (outcome: ReviewOutcome) => void;
  onOverride: (draft: OverrideDraft, outcome: ReviewOutcome | undefined) => void;
}

/**
 * Evidence submission and review for one acceptance criterion.
 *
 * The submission path is deliberately two steps that the component drives:
 * record first (so the fact of submitting survives a review outage), then
 * review, then wait for a human decision. Nothing the reviewer says is written
 * until `onAdopt` or `onOverride` is called.
 */
export function EvidenceEntry({
  criterion,
  derivation,
  records,
  ledger,
  locked,
  onRecord,
  onAdopt,
  onOverride,
}: EvidenceEntryProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** Reviews produced on this page that the user has not adopted yet. */
  const [proposals, setProposals] = useState<Record<string, ReviewOutcome>>({});
  /** The submitted text, kept in memory only, so a failed review can be retried. */
  const [attempts, setAttempts] = useState<Record<string, EvidenceSubmissionInput>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  /**
   * Sends one submission for review. Never throws: a failure becomes state on
   * the record, because the record already exists and the user has to be able to
   * see that it is still unreviewed.
   */
  async function reviewSubmission(evidenceId: string, input: EvidenceSubmissionInput) {
    const requirement = criterion.evidenceRequirements.find(
      (item) => item.id === input.requirementId,
    );
    if (!requirement) return;
    setReviewingId(evidenceId);
    setFailures((previous) => ({ ...previous, [evidenceId]: "" }));
    try {
      const submitted = await requestEvidenceReview(
        buildReviewRequest(criterion, requirement, {
          sourceType: input.sourceType,
          sourceName: input.sourceName,
          content: input.content,
        }),
      );
      setProposals((previous) => ({
        ...previous,
        [evidenceId]: {
          evidenceId,
          decision: submitted.review.decision,
          finding: submitted.review.finding,
          rationale: submitted.review.rationale,
          proofBoundary: submitted.review.proofBoundary,
          suggestedNextEvidence: submitted.review.suggestedNextEvidence,
          reviewerKind: submitted.reviewer,
          promptVersion: submitted.promptVersion,
          reviewedAt: new Date().toISOString(),
        },
      }));
    } catch (caught) {
      setFailures((previous) => ({ ...previous, [evidenceId]: reviewErrorMessage(caught) }));
    } finally {
      setReviewingId(null);
    }
  }

  async function submit(input: EvidenceSubmissionInput) {
    setSubmitting(true);
    // Recorded first, then reviewed: the ledger keeps the fact that the user
    // submitted this, so a failed review leaves a visible pending record rather
    // than silently discarding the user's work.
    const evidenceId = onRecord(input);
    setAttempts((previous) => ({ ...previous, [evidenceId]: input }));
    setOpen(false);
    await reviewSubmission(evidenceId, input);
    setSubmitting(false);
  }

  return (
    <div className="criterion">
      <span className="index">{criterion.id.replace(/^AC-?/i, "") || criterion.id}</span>

      <div>
        <span className="criterion-id">{criterion.id}</span>
        <span className={criterion.required ? "tag tag-required" : "tag"}>
          {criterion.required ? "必需" : "可选"}
        </span>
        <p className="criterion-desc">{criterion.description}</p>

        <ul className="requirement-list">
          {criterion.evidenceRequirements.map((item) => (
            <li key={item.id}>
              <code>{item.id}</code>
              <span>{item.description}</span>
              <span className="source-types">
                可接受来源：{item.acceptedSourceTypes.map((source) => sourceTypeText[source]).join(" / ")}
                ，至少 {item.minimumCount} 条
              </span>
            </li>
          ))}
        </ul>

        {records.length > 0 && (
          <div className="evidence-list">
            {records.map((record) => {
              const adopted = reviewFor(ledger, record.id);
              const proposal = proposals[record.id];
              const override = latestOverrideFor(ledger, record.id);
              return (
                <div
                  className={
                    proposal && !adopted ? "evidence-item evidence-item-attention" : "evidence-item"
                  }
                  key={record.id}
                >
                  <div className="evidence-item-head">
                    <span className="evidence-source">{sourceTypeText[record.sourceType]}</span>
                    <span className="evidence-name">{record.sourceName}</span>
                    <span className={`review review-${record.reviewStatus.toLowerCase()}`}>
                      {reviewStatusText[record.reviewStatus]}
                    </span>
                    {override && <span className="review review-overridden">人工覆盖</span>}
                  </div>
                  <p>{record.summary}</p>
                  <div className="evidence-item-foot">
                    {(adopted || record.reviewStatus !== "PENDING") && (
                      <span>判定：{findingText[record.finding]}</span>
                    )}
                    <code>{record.requirementId}</code>
                  </div>

                  <EvidenceReviewPanel
                    record={record}
                    adopted={adopted}
                    proposal={proposal}
                    override={override}
                    busy={reviewingId === record.id}
                    error={failures[record.id] ?? ""}
                    canRetry={Boolean(attempts[record.id])}
                    onRetry={() => {
                      const input = attempts[record.id];
                      if (input) void reviewSubmission(record.id, input);
                    }}
                    onAdopt={(outcome) => {
                      onAdopt(outcome);
                      setProposals((previous) => {
                        const next = { ...previous };
                        delete next[outcome.evidenceId];
                        return next;
                      });
                    }}
                    onOverride={onOverride}
                  />
                </div>
              );
            })}
          </div>
        )}

        <div className="evidence-actions">
          {locked ? (
            <span className="muted">接受合同后才能开始记录证据。</span>
          ) : open ? (
            <EvidenceSubmitForm
              criterion={criterion}
              submitting={submitting}
              onSubmit={(input) => void submit(input)}
              onCancel={() => setOpen(false)}
            />
          ) : (
            <button type="button" className="button-secondary" onClick={() => setOpen(true)}>
              提交证据
            </button>
          )}
        </div>

        <p className="derivation">
          <span className={criterionStatusClass[derivation.status]}>
            {criterionStatusText[derivation.status]}
          </span>
          <span>{derivation.reason}</span>
        </p>
      </div>

      <span className={criterionStatusClass[derivation.status]}>
        {criterionStatusText[derivation.status]}
      </span>
    </div>
  );
}

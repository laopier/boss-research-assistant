"use client";

import { useState } from "react";
import { AcceptanceCriterion, Deliverable, EvidenceSourceType } from "@/lib/contracts";
import {
  buildReviewRequest,
  requestEvidenceReview,
  reviewErrorMessage,
} from "@/lib/evidence-review/client";
import { CONTENT_MAX_LENGTH, SOURCE_NAME_MAX_LENGTH } from "@/lib/evidence-review/types";
import { artifactSourceName, combineArtifactContentsBounded } from "@/lib/artifact-reader";
import { ArtifactPanel } from "./artifact-panel";
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
  criterionLabelOrId,
  criterionStatusClass,
  criterionStatusText,
  deliverableLabel,
  findingText,
  reviewStatusText,
  shortenedDescription,
  sourceTypeHint,
  sourceTypeText,
} from "./labels";

/** The durable part of a submission: what gets written to the ledger. */
export interface EvidenceSubmissionInput {
  requirementId: string;
  sourceType: EvidenceSourceType;
  sourceName: string;
  summary: string;
  /** The deliverable this material belongs to, when the submitter named one. */
  deliverableId?: string;
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
  /** The contract's deliverables, so the submission can be linked to one. */
  deliverables?: Deliverable[];
  /** A deliverable chosen elsewhere on the page, offered as the default. */
  presetDeliverableId?: string;
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
  deliverables,
  presetDeliverableId,
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
  // The association issue #15 asks the user to declare. Optional on purpose:
  // not every piece of evidence is a deliverable (a log can stand alone), and
  // the fallback is "no link", never a guessed one.
  const [deliverableId, setDeliverableId] = useState(
    presetDeliverableId && deliverables?.some((item) => item.id === presetDeliverableId)
      ? presetDeliverableId
      : "",
  );
  // The local artifact reader (#19), shown in place of the manual fields when
  // the user prefers to hand over real files instead of pasting text.
  const [usingArtifact, setUsingArtifact] = useState(false);
  const [artifactNotice, setArtifactNotice] = useState("");

  const canSubmit =
    !submitting &&
    Boolean(requirement) &&
    sourceName.trim().length > 0 &&
    summary.trim().length > 0 &&
    content.trim().length > 0;

  if (!requirement) {
    return (
      <p className="muted">这条完成标准还没写清要检查什么，因此暂时不能提交材料。</p>
    );
  }

  // The reader hands back real files; fold them into the submission exactly as
  // a manual paste would be, with sourceType forced to ARTIFACT_INSPECTED (the
  // ceiling the review boundary already enforces) and the file list as name.
  function acceptArtifacts(files: { relativePath: string; content: string }[]) {
    const bundle = combineArtifactContentsBounded(files, CONTENT_MAX_LENGTH);
    const included = bundle.includedFiles;
    setContent(bundle.content);
    setSourceName(
      included.length > 0 ? artifactSourceName(included, SOURCE_NAME_MAX_LENGTH) : "",
    );
    setSummary(
      included.length > 0
        ? `已读取本地项目中的 ${included.length} 个文件用于内容检查`
        : "",
    );
    setSourceType("ARTIFACT_INSPECTED");
    setArtifactNotice(
      bundle.truncated || bundle.omittedCount > 0
        ? `受单次检查 ${CONTENT_MAX_LENGTH} 字限制，本次实际检查 ${included.length}/${files.length} 个文件${
            bundle.truncated ? "，最后一个文件仅送审可容纳的前半部分" : ""
          }。如需完整检查，请分批提交。`
        : `本次将送审 ${included.length} 个文件。`,
    );
    setUsingArtifact(false);
  }

  if (usingArtifact) {
    return (
      <div className="evidence-form">
        <ArtifactPanel onUse={acceptArtifacts} onCancel={() => setUsingArtifact(false)} />
      </div>
    );
  }

  return (
    <div className="evidence-form">
      <div className="field-row">
        <label>
          这份材料要证明什么
          <select
            value={requirement.id}
            onChange={(event) => {
              const next = criterion.evidenceRequirements.find(
                (item) => item.id === event.target.value,
              );
              setRequirementId(event.target.value);
              if (next) setSourceType(next.acceptedSourceTypes[0]);
              setSourceName("");
              setSummary("");
              setContent("");
              setArtifactNotice("");
            }}
          >
            {criterion.evidenceRequirements.map((item) => (
              <option key={item.id} value={item.id}>
                {`${shortenedDescription(item.description, 20)}（${item.id}）`}
              </option>
            ))}
          </select>
        </label>
        <label>
          你准备提交什么
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

      {deliverables && deliverables.length > 0 && (
        <label>
          对应哪项成果（可选）
          <select value={deliverableId} onChange={(event) => setDeliverableId(event.target.value)}>
            <option value="">（不对应某一项成果）</option>
            {deliverables.map((item, position) => (
              <option key={item.id} value={item.id}>
                {`${deliverableLabel(position + 1)} · ${shortenedDescription(item.description, 14)}`}
              </option>
            ))}
          </select>
        </label>
      )}

      <label>
        文件或结果名称
        <input
          value={sourceName}
          onChange={(event) => setSourceName(event.target.value)}
          maxLength={SOURCE_NAME_MAX_LENGTH}
          placeholder="例如 tests/test_waca.py"
        />
      </label>

      <label>
        用一句话说明这份材料是什么
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

      {requirement.acceptedSourceTypes.includes("ARTIFACT_INSPECTED") ? (
        <>
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              setArtifactNotice("");
              setUsingArtifact(true);
            }}
          >
            从本地项目读取文件…
          </button>
          {artifactNotice && (
            <p className="field-hint" role="status">
              {artifactNotice}
            </p>
          )}
        </>
      ) : (
        <p className="field-hint">
          这条完成标准不能只靠查看文件来确认，请按上方允许的材料类型提交。
        </p>
      )}

      <p className="privacy-note">
        提交内容会发送给本应用的检查服务；当你在页面中启用 DeepSeek，或服务端使用 AI 模式时，
        内容会进一步发送给 DeepSeek。
        请勿粘贴密钥、个人信息或未脱敏数据。原始文本<strong>不会被保存</strong>，
        页面只保留检查结果和理由。
      </p>

      <div className="evidence-form-footer">
        <span className="muted">
          {content.trim().length} / {CONTENT_MAX_LENGTH} 字 · 提交后会进入检查，
          采用检查结果后才会更新进度。
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
                deliverableId: deliverableId || undefined,
              })
            }
          >
            {submitting ? "正在检查…" : "提交并检查"}
          </button>
        </span>
      </div>
    </div>
  );
}

export interface EvidenceEntryProps {
  criterion: AcceptanceCriterion;
  /**
   * 1-based position in the contract's full acceptance list (issue #21). Every
   * region numbers tasks from this, so the card, the map, the deliverable card
   * and the next action all agree. Falls back to the raw id when unknown.
   */
  index?: number;
  derivation: CriterionDerivation;
  records: EvidenceRecord[];
  /** The whole ledger: reviews and the override log are read through its helpers. */
  ledger: Ledger;
  /** The contract's deliverables, offered as an optional link in the form. */
  deliverables?: Deliverable[];
  /** Evidence cannot be recorded before the contract is accepted (§10). */
  locked: boolean;
  /**
   * A request from elsewhere on the page (a deliverable card) to open this
   * criterion's form, optionally with a deliverable preselected. Render-derived
   * rather than effect-driven, so no state is set during render: the form is
   * shown while the request exists, and closing it consumes the request.
   */
  openRequest?: { deliverableId?: string };
  /** Called when the form opened by `openRequest` is closed or submitted. */
  onOpenConsumed?: () => void;
  /** Writes the record and returns its id; the review is requested separately. */
  onRecord: (input: EvidenceSubmissionInput) => string;
  onAdopt: (outcome: ReviewOutcome) => void;
  onOverride: (draft: OverrideDraft, outcome: ReviewOutcome | undefined) => void;
  /** The primary path is the single artifact form above; keep this card diagnostic-only. */
  unifiedSubmission?: boolean;
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
  index,
  derivation,
  records,
  ledger,
  deliverables,
  locked,
  openRequest,
  onOpenConsumed,
  onRecord,
  onAdopt,
  onOverride,
  unifiedSubmission = false,
}: EvidenceEntryProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** Reviews produced on this page that the user has not adopted yet. */
  const [proposals, setProposals] = useState<Record<string, ReviewOutcome>>({});
  /** The submitted text, kept in memory only, so a failed review can be retried. */
  const [attempts, setAttempts] = useState<Record<string, EvidenceSubmissionInput>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  // The form is open either because this card asked for it, or because another
  // card on the page (a deliverable) asked and pointed here. The request is not
  // copied into state — that would need an effect — it is simply rendered
  // until consumed, which closing or submitting does.
  const formOpen = !locked && (open || openRequest !== undefined);

  /** Closes the form from either source, so a consumed request cannot reopen it. */
  function closeForm() {
    setOpen(false);
    onOpenConsumed?.();
  }

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
    const deliverable = input.deliverableId
      ? deliverables?.find((item) => item.id === input.deliverableId)
      : undefined;
    setReviewingId(evidenceId);
    setFailures((previous) => ({ ...previous, [evidenceId]: "" }));
    try {
      const submitted = await requestEvidenceReview(
        buildReviewRequest(criterion, requirement, {
          sourceType: input.sourceType,
          sourceName: input.sourceName,
          content: input.content,
        }, deliverable ? { id: deliverable.id, description: deliverable.description } : undefined),
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
    closeForm();
    await reviewSubmission(evidenceId, input);
    setSubmitting(false);
  }

  return (
    <div className="criterion" id={`criterion-${criterion.id}`}>
      <div>
        <span className="criterion-label">
          {criterionLabelOrId(index, criterion.id)}
        </span>
        <span className={criterion.required ? "tag tag-required" : "tag"}>
          {criterion.required ? "必需" : "可选"}
        </span>
        <code className="internal-id">{criterion.id}</code>
        <p className="criterion-desc">{criterion.description}</p>

        <ul className="requirement-list">
          {criterion.evidenceRequirements.map((item) => (
            <li key={item.id}>
              <span className="task-desc">{item.description}</span>
              <code className="internal-id">{item.id}</code>
              <span className="source-types">
                可以提交：{item.acceptedSourceTypes.map((source) => sourceTypeText[source]).join(" / ")}
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

        {!unifiedSubmission && <div className="evidence-actions">
          {locked ? (
            <span className="muted">确认这一步后才能提交材料。</span>
          ) : formOpen ? (
            <EvidenceSubmitForm
              // Remount when the request targets a different deliverable, so a
              // preset from a deliverable card replaces (not merges with) a
              // half-typed manual draft.
              key={openRequest?.deliverableId ?? "manual"}
              criterion={criterion}
              deliverables={deliverables}
              presetDeliverableId={openRequest?.deliverableId}
              submitting={submitting}
              onSubmit={(input) => void submit(input)}
              onCancel={closeForm}
            />
          ) : (
            <button type="button" className="button-secondary" onClick={() => setOpen(true)}>
              提交材料
            </button>
          )}
        </div>}

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

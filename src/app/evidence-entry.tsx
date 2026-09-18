"use client";

import { useState } from "react";
import { AcceptanceCriterion, EvidenceSourceType } from "@/lib/contracts";
import {
  CriterionDerivation,
  EvidenceFinding,
  EvidenceRecord,
  EvidenceReviewStatus,
} from "@/lib/failure-ledger";
import {
  criterionStatusClass,
  criterionStatusText,
  findingText,
  findings,
  reviewStatusText,
  sourceTypeHint,
  sourceTypeText,
} from "./labels";

export interface EvidenceDraftInput {
  requirementId: string;
  sourceType: EvidenceSourceType;
  sourceName: string;
  summary: string;
  finding: EvidenceFinding;
}

export interface EvidenceEntryProps {
  criterion: AcceptanceCriterion;
  derivation: CriterionDerivation;
  records: EvidenceRecord[];
  /** Evidence cannot be recorded before the contract is accepted (§10). */
  locked: boolean;
  onRecord: (input: EvidenceDraftInput) => void;
  onReview: (evidenceId: string, reviewStatus: EvidenceReviewStatus) => void;
}

/**
 * Evidence entry and review for one acceptance criterion.
 *
 * Recording is deliberately explicit about `finding` and about review: a record
 * starts as PENDING and only affects the criterion once accepted, because
 * docs/contracts.zh-CN.md §8 separates "the system accepted this evidence" from
 * "the evidence says it passed".
 */
export function EvidenceEntry({
  criterion,
  derivation,
  records,
  locked,
  onRecord,
  onReview,
}: EvidenceEntryProps) {
  const [open, setOpen] = useState(false);
  const [requirementId, setRequirementId] = useState(criterion.evidenceRequirements[0]?.id ?? "");
  const requirement =
    criterion.evidenceRequirements.find((item) => item.id === requirementId) ??
    criterion.evidenceRequirements[0];
  const [sourceType, setSourceType] = useState<EvidenceSourceType>(
    requirement?.acceptedSourceTypes[0] ?? "LOG_INSPECTED",
  );
  const [sourceName, setSourceName] = useState("");
  const [summary, setSummary] = useState("");
  const [finding, setFinding] = useState<EvidenceFinding>("PASS");

  const canSubmit = summary.trim().length > 0 && sourceName.trim().length > 0 && !locked;

  function submit() {
    if (!canSubmit || !requirement) return;
    onRecord({
      requirementId: requirement.id,
      sourceType,
      sourceName: sourceName.trim(),
      summary: summary.trim(),
      finding,
    });
    setSourceName("");
    setSummary("");
    setOpen(false);
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
            {records.map((record) => (
              <div className="evidence-item" key={record.id}>
                <div className="evidence-item-head">
                  <span className="evidence-source">{sourceTypeText[record.sourceType]}</span>
                  <span className="evidence-name">{record.sourceName}</span>
                  <span className={`review review-${record.reviewStatus.toLowerCase()}`}>
                    {reviewStatusText[record.reviewStatus]}
                  </span>
                </div>
                <p>{record.summary}</p>
                <div className="evidence-item-foot">
                  <span>判定：{findingText[record.finding]}</span>
                  <code>{record.requirementId}</code>
                  {record.reviewStatus === "PENDING" && (
                    <span className="review-actions">
                      <button type="button" className="button-mini" onClick={() => onReview(record.id, "ACCEPTED")}>
                        接受
                      </button>
                      <button type="button" className="button-mini" onClick={() => onReview(record.id, "REJECTED")}>
                        拒绝
                      </button>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="evidence-actions">
          {locked ? (
            <span className="muted">接受合同后才能开始记录证据。</span>
          ) : open ? (
            <div className="evidence-form">
              <div className="field-row">
                <label>
                  对应证据要求
                  <select
                    value={requirement?.id ?? ""}
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
                    {(requirement?.acceptedSourceTypes ?? []).map((source) => (
                      <option key={source} value={source}>
                        {sourceTypeText[source]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="field-hint">{sourceTypeHint[sourceType]}</p>

              <div className="field-row">
                <label>
                  来源名称
                  <input
                    value={sourceName}
                    onChange={(event) => setSourceName(event.target.value)}
                    placeholder="例如 tests/test_waca.py"
                  />
                </label>
                <label>
                  这条证据支持什么结论
                  <select
                    value={finding}
                    onChange={(event) => setFinding(event.target.value as EvidenceFinding)}
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
                证据摘要
                <textarea
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  placeholder="例如：forward hook 显示 Stage 2 实际接收到的是 Stage 1 的描述符，不是 Xweak"
                />
              </label>

              <div className="evidence-form-footer">
                <span className="muted">提交后进入「待审核」，接受后才会影响判定。</span>
                <span className="actions">
                  <button type="button" className="button-secondary" onClick={() => setOpen(false)}>
                    取消
                  </button>
                  <button type="button" disabled={!canSubmit} onClick={submit}>
                    记录证据
                  </button>
                </span>
              </div>
            </div>
          ) : (
            <button type="button" className="button-secondary" onClick={() => setOpen(true)}>
              记录证据
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

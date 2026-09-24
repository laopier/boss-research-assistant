"use client";

import { ChangeEvent, useMemo, useState } from "react";

import { BossContract } from "@/lib/contracts";
import {
  buildReviewRequest,
  requestEvidenceReview,
  reviewErrorDetail,
} from "@/lib/evidence-review/client";
import {
  CONTENT_MAX_LENGTH,
  SOURCE_NAME_MAX_LENGTH,
} from "@/lib/evidence-review/types";
import { ReviewOutcome } from "@/lib/failure-ledger";
import { EvidenceSubmissionInput } from "./evidence-entry";

interface BatchEvidencePanelProps {
  contract: BossContract;
  locked: boolean;
  onRecord: (criterionId: string, input: EvidenceSubmissionInput) => string;
  onAdopt: (outcome: ReviewOutcome) => void;
}

interface BatchResult {
  criterionId: string;
  requirementId: string;
  state: "PASS" | "FAIL" | "INCONCLUSIVE" | "ERROR";
  detail: string;
}

/**
 * User-facing submission is artifact-centric, even though the ledger remains
 * criterion-centric. One file is fanned out internally to every requirement
 * that accepts static artifact inspection; the user does not repeat the same
 * upload or manually map the same document four times.
 */
export function BatchEvidencePanel({
  contract,
  locked,
  onRecord,
  onAdopt,
}: BatchEvidencePanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [results, setResults] = useState<BatchResult[]>([]);

  const targets = useMemo(
    () =>
      contract.acceptanceCriteria.flatMap((criterion, criterionIndex) =>
        criterion.evidenceRequirements
          .filter((requirement) => requirement.acceptedSourceTypes.includes("ARTIFACT_INSPECTED"))
          .map((requirement) => ({
            criterion,
            requirement,
            deliverable:
              contract.deliverables.length === 1
                ? contract.deliverables[0]
                : contract.deliverables[criterionIndex],
          })),
      ),
    [contract],
  );

  const coveredCriteria = new Set(targets.map((target) => target.criterion.id)).size;

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setError("");
    setResults([]);
  }

  async function submitOnce() {
    if (!file || busy || locked) return;
    setBusy(true);
    setError("");
    setResults([]);

    let content: string;
    try {
      content = (await file.text()).trim();
    } catch {
      setError("无法读取这个文件，请确认它是文本格式后重试。");
      setBusy(false);
      return;
    }

    if (!content) {
      setError("文件内容为空，无法送审。");
      setBusy(false);
      return;
    }
    if (content.length > CONTENT_MAX_LENGTH) {
      setError(`文件共 ${content.length} 字，当前单次审核上限为 ${CONTENT_MAX_LENGTH} 字。请先压缩说明后再提交。`);
      setBusy(false);
      return;
    }

    const sourceName = file.name.slice(0, SOURCE_NAME_MAX_LENGTH);
    setProgress({ done: 0, total: targets.length });
    const nextResults: BatchResult[] = [];

    for (const [index, target] of targets.entries()) {
      const input: EvidenceSubmissionInput = {
        requirementId: target.requirement.id,
        sourceType: "ARTIFACT_INSPECTED",
        sourceName,
        summary: `统一提交的研究产物：${sourceName}`,
        content,
        deliverableId: target.deliverable?.id,
      };
      const evidenceId = onRecord(target.criterion.id, input);
      try {
        const submitted = await requestEvidenceReview(
          buildReviewRequest(
            target.criterion,
            target.requirement,
            {
              sourceType: input.sourceType,
              sourceName: input.sourceName,
              content: input.content,
            },
            target.deliverable
              ? { id: target.deliverable.id, description: target.deliverable.description }
              : undefined,
          ),
        );
        const outcome: ReviewOutcome = {
          evidenceId,
          decision: submitted.review.decision,
          finding: submitted.review.finding,
          rationale: submitted.review.rationale,
          proofBoundary: submitted.review.proofBoundary,
          suggestedNextEvidence: submitted.review.suggestedNextEvidence,
          reviewerKind: submitted.reviewer,
          promptVersion: submitted.promptVersion,
          reviewedAt: new Date().toISOString(),
        };
        onAdopt(outcome);
        nextResults.push({
          criterionId: target.criterion.id,
          requirementId: target.requirement.id,
          state: submitted.review.finding,
          detail: submitted.review.rationale,
        });
      } catch (caught) {
        nextResults.push({
          criterionId: target.criterion.id,
          requirementId: target.requirement.id,
          state: "ERROR",
          detail: reviewErrorDetail(caught),
        });
      }
      setProgress({ done: index + 1, total: targets.length });
      setResults([...nextResults]);
    }

    setBusy(false);
  }

  if (targets.length === 0) return null;

  return (
    <section id="batch-evidence" className="batch-evidence" aria-label="统一提交研究产物">
      <div>
        <p className="eyebrow">一次提交 · 多项核查</p>
        <h3>提交最终产物</h3>
        <p className="muted">
          上传一份文件即可。系统会在后台用同一份产物核查 {coveredCriteria} 项验收标准，
          不需要逐项重复提交。
        </p>
      </div>

      <div className="batch-upload">
        <input
          type="file"
          accept=".md,.txt,.tex,.json,.yaml,.yml,.py,.csv"
          disabled={locked || busy}
          onChange={chooseFile}
          aria-label="选择最终产物文件"
        />
        <button type="button" disabled={locked || busy || !file} onClick={() => void submitOnce()}>
          {busy ? `正在核查 ${progress.done}/${progress.total}…` : "提交一次，审核全部标准"}
        </button>
      </div>

      <p className="privacy-note">
        文件内容会发送给当前配置的 AI 审核服务；原文不写入本地账本，只保留文件名、审核结论与理由。
      </p>
      {locked && <p className="muted">先接受合同，才能提交最终产物。</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {results.length > 0 && (
        <div className="batch-results" aria-live="polite">
          <strong>核查结果</strong>
          {results.map((result) => (
            <div className="batch-result" key={`${result.criterionId}:${result.requirementId}`}>
              <span className={`status status-${result.state === "PASS" ? "pass" : result.state === "FAIL" || result.state === "ERROR" ? "fail" : "unknown"}`}>
                {result.state === "PASS" ? "通过" : result.state === "FAIL" ? "未通过" : result.state === "ERROR" ? "审核失败" : "信息不足"}
              </span>
              <div>
                <strong>{result.criterionId}</strong>
                <p>{result.detail}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

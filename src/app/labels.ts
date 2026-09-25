import {
  AssistanceMode,
  BossStatus,
  CriterionStatus,
  Deliverable,
  EvidenceSourceType,
} from "@/lib/contracts";
import type { ReviewDecision } from "@/lib/evidence-review/types";
import { EvidenceFinding, EvidenceReviewStatus } from "@/lib/failure-ledger";

import type { ReviewerKind } from "@/lib/evidence-review/client";

/**
 * UI copy tables.
 *
 * The left-hand values are owned by `schemas/boss-contract.v0.schema.json` and
 * must never be renamed here. The Chinese copy for Boss status, criterion
 * status, evidence finding and review status is frozen in
 * `docs/product/mvp0-acceptance.md`; the rest follows the same register.
 */

export const criterionStatusText: Record<CriterionStatus, string> = {
  UNKNOWN: "还没检查",
  PASS: "通过",
  FAIL: "未通过",
};

export const criterionStatusClass: Record<CriterionStatus, string> = {
  UNKNOWN: "status status-unknown",
  PASS: "status status-pass",
  FAIL: "status status-fail",
};

export const bossStatusText: Record<BossStatus, string> = {
  DRAFT: "待开始",
  ACTIVE: "进行中",
  PARTIAL: "部分完成",
  CLEAR: "已完成",
  BLOCKED: "受阻",
};

export const bossStatusClass: Record<BossStatus, string> = {
  DRAFT: "status status-unknown",
  ACTIVE: "status status-progress",
  PARTIAL: "status status-progress",
  CLEAR: "status status-pass",
  BLOCKED: "status status-fail",
};

export const deliverableStatusText: Record<Deliverable["status"], string> = {
  NOT_STARTED: "未开始",
  IN_PROGRESS: "进行中",
  DONE: "已完成",
};

/**
 * Derived status chips. `IN_PROGRESS` gets its own colour rather than reusing
 * the unknown grey: "someone has started" and "nothing has happened" are the
 * two facts issue #15 most wants the page to stop collapsing.
 */
export const deliverableStatusClass: Record<Deliverable["status"], string> = {
  NOT_STARTED: "status status-unknown",
  IN_PROGRESS: "status status-progress",
  DONE: "status status-pass",
};

/**
 * Evidence source copy carries the proof boundary from docs/contracts.zh-CN.md
 * §6, because the difference between "the platform ran it" and "the user says
 * they ran it" is the point of the four-way split.
 */
export const sourceTypeText: Record<EvidenceSourceType, string> = {
  USER_REPORTED: "你的说明",
  ARTIFACT_INSPECTED: "已查看文件",
  LOG_INSPECTED: "已查看运行结果",
  AUTO_VERIFIED: "系统亲自检查",
};

export const sourceTypeHint: Record<EvidenceSourceType, string> = {
  USER_REPORTED: "只能说明你这样描述过，还不能确认实际结果",
  ARTIFACT_INSPECTED: "能确认文件里写了什么，还不能确认运行结果",
  LOG_INSPECTED: "能确认运行记录显示了什么，但系统没有亲自运行",
  AUTO_VERIFIED: "只有系统实际运行检查时才会出现",
};

export const assistanceModeText: Record<AssistanceMode, string> = {
  AI_OFF: "不借助 AI",
  COACH: "教练式提示",
  COLLABORATE: "协作完成",
  AGENT: "委托执行",
};

export const findingText: Record<EvidenceFinding, string> = {
  PASS: "通过",
  FAIL: "未通过",
  INCONCLUSIVE: "无法判断",
};

export const reviewStatusText: Record<EvidenceReviewStatus, string> = {
  PENDING: "等待检查",
  ACCEPTED: "可以采用",
  REJECTED: "不能采用",
};

export const findings: EvidenceFinding[] = ["PASS", "FAIL", "INCONCLUSIVE"];

/**
 * The review verdict's own vocabulary. `decision` answers "may this count?",
 * `finding` answers "what does it show?" — see docs/contracts.zh-CN.md §8.
 */
export const reviewDecisionText: Record<ReviewDecision, string> = {
  ACCEPTED: "可以采用",
  REJECTED: "不能采用",
  INCONCLUSIVE: "无法判断",
};

export const reviewDecisionClass: Record<ReviewDecision, string> = {
  ACCEPTED: "status status-pass",
  REJECTED: "status status-fail",
  INCONCLUSIVE: "status status-unknown",
};

export const reviewerKindText: Record<ReviewerKind, string> = {
  MOCK: "本地规则检查",
  AI: "AI 检查（DeepSeek）",
};

/**
 * What the reviewer was actually able to look at, which is not the same as the
 * source the submitter declared.
 *
 * DUPLICATE ON PURPOSE: `evidence-review/validation.ts` exports the identical
 * table as `PROOF_BOUNDARY_TEXT`, but that module imports Ajv and the JSON
 * schema and must never reach the browser bundle. `src/test/web-components.test.tsx`
 * asserts the two tables are equal, so the copy cannot drift silently.
 */
export const proofBoundaryText: Record<EvidenceSourceType, string> = {
  USER_REPORTED: "你的说明",
  ARTIFACT_INSPECTED: "文件内容",
  LOG_INSPECTED: "运行结果",
  AUTO_VERIFIED: "系统实测",
};

export const proofBoundaryHint: Record<EvidenceSourceType, string> = {
  USER_REPORTED: "Boss 只看到了你的说明，还不能确认实际结果。",
  ARTIFACT_INSPECTED: "Boss 看过文件内容，但还不能确认它运行正确。",
  LOG_INSPECTED: "Boss 看过运行记录，但没有在这里亲自运行。",
  AUTO_VERIFIED: "系统亲自运行并检查了结果。粘贴文字不能达到这一层。",
};

// ---------------------------------------------------------------------------
// issue #21: readable labels instead of internal ids
// ---------------------------------------------------------------------------

/**
 * Short labels for the things a new user is asked to act on.
 *
 * The number is the 1-based position of the criterion or deliverable in the
 * FULL contract, never in a filtered or derived list, so every region of the
 * page numbers the same task identically and a country lane that is also
 * required cannot be renumbered by another country's filter. Nothing here
 * maps a particular generated id to particular Chinese: the ids differ per
 * generated Boss, so the label comes from the position alone and the internal
 * id stays visible next to it for tracing.
 */
export function criterionLabel(index: number): string {
  return `完成标准 ${index}`;
}

export function deliverableLabel(index: number): string {
  return `成果 ${index}`;
}

/** True when `index` really came from a position in the contract. */
export function hasIndex(index: number | undefined): index is number {
  return typeof index === "number" && Number.isFinite(index) && index > 0;
}

/**
 * Places where internal ids remain the only stable name (fixtures, callers
 * that hold an id but no contract) fall back to the id itself rather than
 * inventing a number.
 */
export function criterionLabelOrId(index: number | undefined, criterionId: string): string {
  return hasIndex(index) ? criterionLabel(index) : criterionId;
}

/**
 * The full description is what tells a newcomer what the task is, but it must
 * not become a button. Controls that cannot wrap — `<option>`, chips — get a
 * shortened form and rely on the neighbouring card for the whole sentence.
 */
export function shortenedDescription(description: string | undefined, limit = 16): string {
  const text = description?.trim() ?? "";
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

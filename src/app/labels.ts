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
  UNKNOWN: "待验证",
  PASS: "通过",
  FAIL: "未通过",
};

export const criterionStatusClass: Record<CriterionStatus, string> = {
  UNKNOWN: "status status-unknown",
  PASS: "status status-pass",
  FAIL: "status status-fail",
};

export const bossStatusText: Record<BossStatus, string> = {
  DRAFT: "草稿",
  ACTIVE: "进行中",
  PARTIAL: "部分完成",
  CLEAR: "已完成",
  BLOCKED: "受阻",
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
  USER_REPORTED: "用户陈述",
  ARTIFACT_INSPECTED: "已检查产物",
  LOG_INSPECTED: "已检查日志",
  AUTO_VERIFIED: "平台自动验证",
};

export const sourceTypeHint: Record<EvidenceSourceType, string> = {
  USER_REPORTED: "只证明用户做过该陈述，不能单独证明运行结果",
  ARTIFACT_INSPECTED: "证明代码里写了什么，不能证明运行时行为正确",
  LOG_INSPECTED: "证明日志报告了什么；平台并未执行该命令",
  AUTO_VERIFIED: "仅当平台亲自执行了隔离验证时使用",
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
  PENDING: "待审核",
  ACCEPTED: "已接受",
  REJECTED: "已拒绝",
};

export const findings: EvidenceFinding[] = ["PASS", "FAIL", "INCONCLUSIVE"];

/**
 * The review verdict's own vocabulary. `decision` answers "may this count?",
 * `finding` answers "what does it show?" — see docs/contracts.zh-CN.md §8.
 */
export const reviewDecisionText: Record<ReviewDecision, string> = {
  ACCEPTED: "接受",
  REJECTED: "拒绝",
  INCONCLUSIVE: "无法判断",
};

export const reviewDecisionClass: Record<ReviewDecision, string> = {
  ACCEPTED: "status status-pass",
  REJECTED: "status status-fail",
  INCONCLUSIVE: "status status-unknown",
};

export const reviewerKindText: Record<ReviewerKind, string> = {
  MOCK: "规则审核（离线）",
  AI: "AI 审核（DeepSeek）",
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
  USER_REPORTED: "用户陈述",
  ARTIFACT_INSPECTED: "成果内容",
  LOG_INSPECTED: "运行日志",
  AUTO_VERIFIED: "平台执行",
};

export const proofBoundaryHint: Record<EvidenceSourceType, string> = {
  USER_REPORTED: "审核器只看到了一句陈述，因此只能证明「用户声称做过」。",
  ARTIFACT_INSPECTED: "审核器看到了提交的成果内容，并不能证明它在运行时正确。",
  LOG_INSPECTED: "审核器看到了提交的运行日志；平台本身没有执行该命令。",
  AUTO_VERIFIED: "平台亲自执行了隔离验证。粘贴的文本永远达不到这一层。",
};

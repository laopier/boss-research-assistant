import {
  AssistanceMode,
  BossStatus,
  CriterionStatus,
  Deliverable,
  EvidenceSourceType,
} from "@/lib/contracts";
import { EvidenceFinding, EvidenceReviewStatus } from "@/lib/failure-ledger";

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

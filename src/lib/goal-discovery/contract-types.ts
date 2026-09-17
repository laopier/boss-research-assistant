/**
 * TypeScript projections of `schemas/boss-contract.v0.schema.json`.
 *
 * The JSON Schema is the only machine-readable authority. These types mirror
 * it 1:1 so that generated contracts stay structurally compatible without
 * importing Ajv types at every call site. When the Schema changes, these
 * types must change in the same commit (lead approval required).
 */

export const CONTRACT_SCHEMA_VERSION = "boss-contract.v0" as const;

export type EvidenceSourceType =
  | "USER_REPORTED"
  | "ARTIFACT_INSPECTED"
  | "LOG_INSPECTED"
  | "AUTO_VERIFIED";

export type Finding = "PASS" | "FAIL" | "INCONCLUSIVE";

export type ReviewStatus = "PENDING" | "ACCEPTED" | "REJECTED";

/** Criterion-level status. Only these three values exist for criteria. */
export type CriterionStatus = "UNKNOWN" | "PASS" | "FAIL";

/** Boss-level status. Derived, never a criterion status. */
export type BossStatus = "DRAFT" | "ACTIVE" | "PARTIAL" | "CLEAR" | "BLOCKED";

export type DeliverableStatus = "NOT_STARTED" | "IN_PROGRESS" | "DONE";

export type AssistanceMode = "AI_OFF" | "COACH" | "COLLABORATE" | "AGENT";

export type RecordKind = "LIVE" | "DEMO_FIXTURE";

export interface Deliverable {
  id: string;
  description: string;
  status: DeliverableStatus;
}

export interface EvidenceRequirement {
  id: string;
  description: string;
  acceptedSourceTypes: EvidenceSourceType[];
  minimumCount: number;
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
  required: boolean;
  status: CriterionStatus;
  evidenceRequirements: EvidenceRequirement[];
}

export interface ScopeGuard {
  inScope: string[];
  outOfScope: string[];
  newBossPolicy: "CREATE_NEW_BOSS";
}

export interface EvidenceItem {
  id: string;
  criterionId: string;
  requirementId: string;
  sourceType: EvidenceSourceType;
  sourceName: string;
  summary: string;
  finding: Finding;
  reviewStatus: ReviewStatus;
}

export interface Blocker {
  id: string;
  description: string;
  affectedCriteria: string[];
  resolution: string;
}

export interface ChangeRecord {
  revision: number;
  changedAt: string;
  changedBy: string;
  reason: string;
  changes: Array<{ path: string; before: unknown; after: unknown }>;
}

export interface BossContractJson {
  schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  recordKind: RecordKind;
  revision: number;
  id: string;
  title: string;
  rawGoal: string;
  objective: string;
  deadline: string | null;
  deliverables: Deliverable[];
  acceptanceCriteria: AcceptanceCriterion[];
  scopeGuard: ScopeGuard;
  known: string[];
  unknowns: string[];
  assumptions: string[];
  estimatedMinutes: number;
  assistanceMode: AssistanceMode;
  status: BossStatus;
  evidenceItems: EvidenceItem[];
  blockers: Blocker[];
  changeHistory: ChangeRecord[];
}

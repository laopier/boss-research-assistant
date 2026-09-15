export const CONTRACT_SCHEMA_VERSION = "boss-contract.v0" as const;

export type AssistanceMode = "AI_OFF" | "COACH" | "COLLABORATE" | "AGENT";
export type BossStatus = "DRAFT" | "ACTIVE" | "PARTIAL" | "CLEAR" | "BLOCKED";
export type CriterionStatus = "UNKNOWN" | "PASS" | "FAIL";
export type EvidenceSourceType =
  | "USER_REPORTED"
  | "ARTIFACT_INSPECTED"
  | "LOG_INSPECTED"
  | "AUTO_VERIFIED";

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

export interface Deliverable {
  id: string;
  description: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "DONE";
}

export interface EvidenceItem {
  id: string;
  criterionId: string;
  requirementId: string;
  sourceType: EvidenceSourceType;
  sourceName: string;
  summary: string;
  finding: "PASS" | "FAIL" | "INCONCLUSIVE";
  reviewStatus: "PENDING" | "ACCEPTED" | "REJECTED";
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

export interface BossContract {
  schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  recordKind: "LIVE" | "DEMO_FIXTURE";
  revision: number;
  id: string;
  title: string;
  rawGoal: string;
  objective: string;
  deadline: string | null;
  deliverables: Deliverable[];
  acceptanceCriteria: AcceptanceCriterion[];
  scopeGuard: {
    inScope: string[];
    outOfScope: string[];
    newBossPolicy: "CREATE_NEW_BOSS";
  };
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

export interface GenerateBossContractRequest {
  schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  goal: string;
}

export interface GenerateBossContractResponse {
  contract: BossContract;
  generation: "MOCK" | "AI";
}

export interface ApiErrorResponse {
  error: { code: "INVALID_REQUEST" | "INTERNAL_ERROR"; message: string };
}

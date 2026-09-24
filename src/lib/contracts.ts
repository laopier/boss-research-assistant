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
  /** User-selected local text used only while generating this contract. */
  projectContext?: ProjectContextInput;
  /** First Boss only: ask the server to outline the whole project as well. */
  includeProjectPlan?: boolean;
}

export interface ProjectContextInput {
  sourceName: string;
  fileNames: string[];
  content: string;
}

export const PROJECT_PLAN_SCHEMA_VERSION = "project-plan.v1" as const;

/** A future Boss-sized unit. Only the current unit has a contract initially. */
export interface PlannedStepDraft {
  id: string;
  title: string;
  objective: string;
  estimatedMinutes: number;
}

export interface PlannedMilestoneDraft {
  id: string;
  title: string;
  steps: PlannedStepDraft[];
}

/** Coarse, revisable project outline generated together with the first Boss. */
export interface ProjectPlanDraft {
  schemaVersion: typeof PROJECT_PLAN_SCHEMA_VERSION;
  milestones: PlannedMilestoneDraft[];
  assumptions: string[];
}

export interface GenerateBossContractResponse {
  contract: BossContract;
  generation: "MOCK" | "AI";
  /** Present only when the first-Boss request asked for a global outline. */
  projectPlan?: ProjectPlanDraft;
}

export interface ApiErrorResponse {
  error: { code: "INVALID_REQUEST" | "INTERNAL_ERROR"; message: string };
}

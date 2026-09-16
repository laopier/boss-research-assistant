/**
 * Deterministic mock generator.
 *
 * Used for offline development (BOSS_GENERATOR=mock) and as the Web slice's
 * stand-in before live model calls. Produces a contract that passes the full
 * two-layer validation with zero warnings — the same bar the LLM generator
 * must clear — so downstream code never sees a degenerate object.
 *
 * Determinism: the contract shape depends only on the trimmed goal via a
 * 32-bit FNV-1a hash. Same goal in, byte-identical contract out.
 */
import { BossContractJson } from "./contract-types";
import { assertGoalValid, ContractGenerator, GenerateOptions, GenerationError } from "./generator";

/** 32-bit FNV-1a hash, hex-encoded. */
export function hashGoal(goal: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < goal.length; i++) {
    hash ^= goal.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function pick<T>(items: readonly T[], hash: string, salt: number): T {
  const value = parseInt(hash.slice(salt % 4, (salt % 4) + 4) || "0", 16) || salt;
  return items[value % items.length];
}

export function buildMockContract(goal: string): BossContractJson {
  const trimmed = assertGoalValid(goal);
  const hash = hashGoal(trimmed);
  const id = `boss-goal-${hash}`;

  return {
    schemaVersion: "boss-contract.v0",
    recordKind: "LIVE",
    revision: 1,
    id,
    title: "Define a bounded first step for the submitted goal",
    rawGoal: trimmed,
    objective:
      "Turn the submitted goal into one concrete, verifiable step and produce the artifacts that describe it, so that the next session can start working without re-interpreting the goal.",
    deadline: null,
    deliverables: [
      {
        id: "DEL-1",
        description: "A short written restatement of the goal as one bounded step with an observable output",
        status: "NOT_STARTED",
      },
      {
        id: "DEL-2",
        description: "A checklist of evidence sources that would prove the step is done",
        status: "NOT_STARTED",
      },
    ],
    acceptanceCriteria: [
      {
        id: "AC-1",
        description: "The restatement names one bounded step, one observable output, and a time budget.",
        required: true,
        status: "UNKNOWN",
        evidenceRequirements: [
          {
            id: "REQ-1-RESTATEMENT",
            description: "Inspect the submitted restatement document for the step, the output, and the time budget.",
            acceptedSourceTypes: ["ARTIFACT_INSPECTED"],
            minimumCount: 1,
          },
        ],
      },
      {
        id: "AC-2",
        description: "The evidence checklist maps each claim to an inspectable artifact, log, or user report.",
        required: true,
        status: "UNKNOWN",
        evidenceRequirements: [
          {
            id: "REQ-2-CHECKLIST",
            description: "Inspect the checklist for at least one mapped evidence source per claim.",
            acceptedSourceTypes: ["ARTIFACT_INSPECTED"],
            minimumCount: 1,
          },
        ],
      },
    ],
    scopeGuard: {
      inScope: [
        "Restating the submitted goal as one bounded step",
        "Listing the evidence that would prove the step is done",
      ],
      outOfScope: [
        "Executing the research work itself",
        "Reading repositories, running code, or judging evidence quality",
      ],
      newBossPolicy: "CREATE_NEW_BOSS",
    },
    known: [
      "The user submitted a raw goal and expects a bounded next step",
      "The goal language is preserved verbatim in rawGoal",
    ],
    unknowns: [
      "Which prior experience the user has with this kind of goal",
      "Which concrete artifacts the user can realistically produce first",
    ],
    assumptions: [
      "The user can spend at least one focused session on the first step",
    ],
    estimatedMinutes: pick([30, 45, 60, 90], hash, 1),
    assistanceMode: "COACH",
    status: "DRAFT",
    evidenceItems: [],
    blockers: [],
    changeHistory: [],
  };
}

export class MockContractGenerator implements ContractGenerator {
  async generate(goal: string, options?: GenerateOptions): Promise<BossContractJson> {
    if (options?.seed !== undefined && options.seed.trim() === "") {
      throw new GenerationError("INPUT_REJECTED", "seed must be non-empty when provided");
    }
    return buildMockContract(goal);
  }
}

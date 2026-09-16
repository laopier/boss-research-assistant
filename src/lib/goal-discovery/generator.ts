/**
 * Generator-facing surface for the Goal Discovery adapter.
 *
 * A `ContractGenerator` turns a raw user goal into a Boss contract that
 * passes `validateContract`. Implementations must NOT return partial
 * objects or fall back to demo fixtures on failure — failures throw
 * `GenerationError` and the caller maps them to HTTP responses.
 */
import { BossContractJson } from "./contract-types";
import { GOAL_MAX_LENGTH as MAX_GOAL_LENGTH } from "./validation";

export const GOAL_MAX_LENGTH = MAX_GOAL_LENGTH;

export type GenerationErrorCode =
  | "INPUT_REJECTED"
  | "INVALID_OUTPUT"
  | "CONFIG_ERROR"
  | "TRANSPORT_ERROR"
  | "GENERATION_FAILED";

export class GenerationError extends Error {
  constructor(
    public readonly code: GenerationErrorCode,
    message: string,
    public readonly diagnostics: string[] = [],
  ) {
    super(message);
    this.name = "GenerationError";
  }
}

export interface GenerateOptions {
  /** Deterministic id/name used by the mock generator for reproducibility. */
  seed?: string;
}

export interface ContractGenerator {
  /** Generates a validated contract or throws `GenerationError`. */
  generate(goal: string, options?: GenerateOptions): Promise<BossContractJson>;
}

export function assertGoalValid(goal: string): string {
  const trimmed = goal.trim();
  if (trimmed.length === 0)
    throw new GenerationError("INPUT_REJECTED", "goal must contain at least 1 character after trimming");
  if (trimmed.length > GOAL_MAX_LENGTH)
    throw new GenerationError("INPUT_REJECTED", `goal must contain at most ${GOAL_MAX_LENGTH} characters after trimming, got ${trimmed.length}`);
  return trimmed;
}

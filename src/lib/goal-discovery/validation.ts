/**
 * Two-layer validation for AI-generated Boss contracts.
 *
 * Layer 1 (`validateAgainstSchema`): JSON Schema 2020-12 with format
 * assertions enabled (`ajv-formats`). Without format assertions a value like
 * `deadline: "null"` silently passes — that exact defect was found in
 * `examples/ai/literature-reading.json`, so assertions are mandatory here.
 *
 * Layer 2 (`validateSemantics`): S1–S16. The Schema and the semantic layer
 * intentionally overlap (defense in depth): the Schema blocks structural
 * violations cheaply, the semantic layer re-checks them so callers that
 * validate a hand-built object without the Schema still get correct results.
 *
 *   REJECT (S1–S11)  — the contract must not reach the Web.
 *   WARN   (S12–S16) — suspicious but repairable; surfaced to the repair
 *                      prompt but does not reject on its own.
 *
 * `validateContract` runs the full pipeline for the Goal Discovery adapter:
 * input guard → Schema → semantics, short-circuiting on the first failure.
 */
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import schemaJson from "../../../schemas/boss-contract.v0.schema.json";
import { BossContractJson } from "./contract-types";

export const GOAL_MAX_LENGTH = 500;
export const MAX_ESTIMATED_MINUTES = 8 * 60; // one working day

export type ValidationPhase = "GOAL_DISCOVERY" | "GENERAL";

export interface ValidationDiagnostic {
  rule: string;
  severity: "ERROR" | "WARNING";
  path: string;
  message: string;
}

export interface ValidationOutcome {
  valid: boolean;
  diagnostics: ValidationDiagnostic[];
}

/** (id, title, objective) triple identifying a repository demo fixture. */
export interface FixtureSignature {
  id: string;
  title: string;
  objective: string;
}

export interface ValidationOptions {
  phase?: ValidationPhase;
  knownFixtureSignatures?: readonly FixtureSignature[];
}

export type ContractValidationOutcome =
  | { outcome: "CONTRACT"; contract: BossContractJson; diagnostics: ValidationDiagnostic[] }
  | { outcome: "INPUT_REJECTED"; diagnostics: ValidationDiagnostic[] }
  | { outcome: "INVALID_OUTPUT"; diagnostics: ValidationDiagnostic[] };

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const schemaValidate = ajv.compile(schemaJson);

function reject(rule: string, path: string, message: string): ValidationDiagnostic {
  return { rule, severity: "ERROR", path, message };
}

function warn(rule: string, path: string, message: string): ValidationDiagnostic {
  return { rule, severity: "WARNING", path, message };
}

/** Layer 1: structural validation against the authoritative JSON Schema. */
export function validateAgainstSchema(doc: unknown): ValidationOutcome {
  const ok = schemaValidate(doc);
  if (ok) return { valid: true, diagnostics: [] };
  const diagnostics: ValidationDiagnostic[] = [];
  for (const err of schemaValidate.errors ?? []) {
    diagnostics.push(
      reject("SCHEMA", err.instancePath || "/", err.message ?? "schema violation"),
    );
  }
  return { valid: false, diagnostics };
}

function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes].sort();
}

/**
 * Layer 2: semantic rules. `phase: "GOAL_DISCOVERY"` enforces the initial
 * state invariants for freshly generated LIVE contracts; `phase: "GENERAL"`
 * validates cross-reference integrity and status derivation for contracts
 * that may legitimately carry evidence (fixtures, Stage 2+ records).
 */
export function validateSemantics(
  doc: BossContractJson,
  options: ValidationOptions = {},
): ValidationOutcome {
  const phase = options.phase ?? "GOAL_DISCOVERY";
  const diagnostics: ValidationDiagnostic[] = [];

  // S1 — unique ids within each namespace.
  const deliverableDupes = findDuplicates(doc.deliverables.map((d) => d.id));
  if (deliverableDupes.length > 0)
    diagnostics.push(reject("S1", "/deliverables", `duplicate deliverable ids: ${deliverableDupes.join(", ")}`));
  const criterionDupes = findDuplicates(doc.acceptanceCriteria.map((c) => c.id));
  if (criterionDupes.length > 0)
    diagnostics.push(reject("S1", "/acceptanceCriteria", `duplicate criterion ids: ${criterionDupes.join(", ")}`));
  const requirementIds = doc.acceptanceCriteria.flatMap((c) =>
    c.evidenceRequirements.map((r) => r.id),
  );
  const requirementDupes = findDuplicates(requirementIds);
  if (requirementDupes.length > 0)
    diagnostics.push(reject("S1", "/acceptanceCriteria", `duplicate requirement ids: ${requirementDupes.join(", ")}`));
  const evidenceDupes = findDuplicates(doc.evidenceItems.map((e) => e.id));
  if (evidenceDupes.length > 0)
    diagnostics.push(reject("S1", "/evidenceItems", `duplicate evidence ids: ${evidenceDupes.join(", ")}`));

  // S2–S4 — every required criterion carries a usable requirement.
  for (const criterion of doc.acceptanceCriteria) {
    if (criterion.required && criterion.evidenceRequirements.length === 0)
      diagnostics.push(reject("S2", `/acceptanceCriteria/${criterion.id}`, "required criterion has no evidence requirement"));
    for (const requirement of criterion.evidenceRequirements) {
      if (requirement.acceptedSourceTypes.length === 0)
        diagnostics.push(reject("S3", `/acceptanceCriteria/${criterion.id}/${requirement.id}`, "empty acceptedSourceTypes"));
      if (requirement.minimumCount < 1)
        diagnostics.push(reject("S4", `/acceptanceCriteria/${criterion.id}/${requirement.id}`, "minimumCount < 1"));
    }
  }

  // S5/S6 — evidence must reference an existing (criterion, requirement) pair
  // with an accepted source type.
  const requirementIndex = new Map<string, Set<string>>();
  for (const criterion of doc.acceptanceCriteria) {
    const ids = requirementIndex.get(criterion.id) ?? new Set<string>();
    for (const requirement of criterion.evidenceRequirements) ids.add(requirement.id);
    requirementIndex.set(criterion.id, ids);
  }
  const requirementById = new Map<string, { acceptedSourceTypes: string[]; criterionId: string }>();
  for (const criterion of doc.acceptanceCriteria) {
    for (const requirement of criterion.evidenceRequirements) {
      requirementById.set(requirement.id, {
        acceptedSourceTypes: requirement.acceptedSourceTypes,
        criterionId: criterion.id,
      });
    }
  }
  for (const evidence of doc.evidenceItems) {
    const allowed = requirementIndex.get(evidence.criterionId);
    if (!allowed || !allowed.has(evidence.requirementId)) {
      diagnostics.push(reject("S5", `/evidenceItems/${evidence.id}`, `dangling reference (${evidence.criterionId}, ${evidence.requirementId})`));
      continue;
    }
    const requirement = requirementById.get(evidence.requirementId);
    if (requirement && !requirement.acceptedSourceTypes.includes(evidence.sourceType)) {
      diagnostics.push(reject("S6", `/evidenceItems/${evidence.id}`, `sourceType ${evidence.sourceType} not accepted by ${evidence.requirementId}`));
    }
  }

  if (phase === "GENERAL") {
    // S7 — Boss status derivation vs criterion truth.
    // BLOCKED > CLEAR (all required PASS) > PARTIAL (any required PASS) > ACTIVE.
    const hasBlocker = doc.blockers.length > 0;
    const required = doc.acceptanceCriteria.filter((c) => c.required);
    const allPass = required.length > 0 && required.every((c) => c.status === "PASS");
    const anyPass = required.some((c) => c.status === "PASS");
    const expected = hasBlocker ? "BLOCKED" : allPass ? "CLEAR" : anyPass ? "PARTIAL" : "ACTIVE";
    const acceptedCount = doc.evidenceItems.filter((e) => e.reviewStatus === "ACCEPTED").length;
    if (doc.status === "PARTIAL" || doc.status === "CLEAR" || doc.recordKind === "LIVE") {
      if (doc.status !== expected && doc.status !== "DRAFT") {
        diagnostics.push(reject("S7", "/status", `status=${doc.status} but derivation says ${expected}`));
      }
      if (doc.status !== "DRAFT" && acceptedCount === 0 && (doc.status === "PARTIAL" || doc.status === "CLEAR")) {
        diagnostics.push(reject("S7", "/status", `status=${doc.status} with zero accepted evidence`));
      }
    }
    return { valid: !diagnostics.some((d) => d.severity === "ERROR"), diagnostics };
  }

  // ---- Goal Discovery initial-state invariants (fresh LIVE generation) ----

  // S8 — fixture plagiarism guard. A generated contract whose (id, title,
  // objective) triple matches a known demo fixture is a disguised fixture
  // replay, not a genuine generation for the user's goal.
  for (const signature of options.knownFixtureSignatures ?? []) {
    if (doc.id === signature.id && doc.title === signature.title && doc.objective === signature.objective) {
      diagnostics.push(
        reject("S8", "/", `output matches known fixture ${signature.id}; generate a contract for the user's goal instead`),
      );
    }
  }

  // S9 — no invented history: empty evidence/blockers/changeHistory, revision 1.
  if (doc.evidenceItems.length > 0)
    diagnostics.push(reject("S9", "/evidenceItems", "goal discovery must not include evidenceItems"));
  if (doc.blockers.length > 0)
    diagnostics.push(reject("S9", "/blockers", "goal discovery must not include blockers"));
  if (doc.changeHistory.length > 0)
    diagnostics.push(reject("S9", "/changeHistory", "goal discovery must not include changeHistory"));
  if (doc.revision !== 1)
    diagnostics.push(reject("S9", "/revision", `goal discovery revision must be 1, got ${doc.revision}`));

  // S10 — deliverables start untouched.
  for (const deliverable of doc.deliverables) {
    if (deliverable.status !== "NOT_STARTED")
      diagnostics.push(reject("S10", `/deliverables/${deliverable.id}`, `new deliverable must be NOT_STARTED, got ${deliverable.status}`));
  }

  // S11 — criteria start UNKNOWN (never PASS/FAIL at generation time).
  for (const criterion of doc.acceptanceCriteria) {
    if (criterion.status !== "UNKNOWN")
      diagnostics.push(reject("S11", `/acceptanceCriteria/${criterion.id}`, `goal discovery criterion must be UNKNOWN, got ${criterion.status}`));
  }

  // S12 — unknowns and assumptions must not overlap.
  const unknownSet = new Set(doc.unknowns);
  for (const assumption of doc.assumptions) {
    if (unknownSet.has(assumption))
      diagnostics.push(warn("S12", "/assumptions", `same text in unknowns and assumptions: ${assumption}`));
  }

  // S13 — bounded effort: at most one working day.
  if (doc.estimatedMinutes > MAX_ESTIMATED_MINUTES)
    diagnostics.push(warn("S13", "/estimatedMinutes", `estimatedMinutes=${doc.estimatedMinutes} exceeds one working day (${MAX_ESTIMATED_MINUTES})`));

  // S14 — generated contracts are LIVE, not demo fixtures.
  if (doc.recordKind !== "LIVE")
    diagnostics.push(warn("S14", "/recordKind", `generated contract must be LIVE, got ${doc.recordKind}`));

  // S15 — a newly generated Boss is DRAFT until the user accepts it
  // (lead decision Q3, 2026-09-16).
  if (doc.status !== "DRAFT")
    diagnostics.push(warn("S15", "/status", `newly generated Boss starts as DRAFT, got ${doc.status}`));

  // S16 — the scope boundary must be stated.
  if (doc.scopeGuard.inScope.length === 0)
    diagnostics.push(warn("S16", "/scopeGuard/inScope", "inScope is empty; a generated contract should state its boundary"));

  return { valid: !diagnostics.some((d) => d.severity === "ERROR"), diagnostics };
}

/**
 * Full Goal Discovery pipeline. Order matters and short-circuits:
 *   1. input guard (goal length)      → INPUT_REJECTED
 *   2. JSON Schema                    → INVALID_OUTPUT
 *   3. semantic rules (S1–S16)        → INVALID_OUTPUT (ERRORs only)
 */
export function validateContract(
  goal: string,
  doc: unknown,
  options: ValidationOptions = {},
): ContractValidationOutcome {
  const trimmed = goal.trim();
  if (trimmed.length === 0 || trimmed.length > GOAL_MAX_LENGTH) {
    return {
      outcome: "INPUT_REJECTED",
      diagnostics: [
        reject("INPUT", "/goal", `goal must contain between 1 and ${GOAL_MAX_LENGTH} characters after trimming, got ${trimmed.length}`),
      ],
    };
  }

  const schemaOutcome = validateAgainstSchema(doc);
  if (!schemaOutcome.valid) {
    return { outcome: "INVALID_OUTPUT", diagnostics: schemaOutcome.diagnostics };
  }

  const semanticOutcome = validateSemantics(doc as BossContractJson, {
    phase: "GOAL_DISCOVERY",
    knownFixtureSignatures: options.knownFixtureSignatures,
  });
  if (!semanticOutcome.valid) {
    return { outcome: "INVALID_OUTPUT", diagnostics: semanticOutcome.diagnostics };
  }

  return {
    outcome: "CONTRACT",
    contract: doc as BossContractJson,
    diagnostics: semanticOutcome.diagnostics,
  };
}

/** Render diagnostics into a compact, bounded string for repair prompts / logs. */
export function formatDiagnostics(diagnostics: ValidationDiagnostic[], maxChars = 2000): string {
  const lines = diagnostics.map(
    (d) => `[${d.severity}] ${d.rule} ${d.path}: ${d.message}`,
  );
  let output = lines.join("\n");
  if (output.length > maxChars) {
    const truncated = lines.length;
    output = `${output.slice(0, maxChars)}\n... (${truncated} diagnostics, truncated at ${maxChars} chars)`;
  }
  return output;
}

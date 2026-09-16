/**
 * Validation layer tests: Schema regression, format-assertion regression
 * lock, semantic rules S1–S16 (REJECT and WARN), phase behaviour, pipeline
 * short-circuiting, and diagnostic formatting.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import { BossContractJson } from "../lib/goal-discovery/contract-types";
import { buildMockContract } from "../lib/goal-discovery/mock-generator";
import {
  formatDiagnostics,
  validateAgainstSchema,
  validateContract,
  validateSemantics,
} from "../lib/goal-discovery/validation";

const repoRoot = resolve(__dirname, "../..");

function loadFixture(relativePath: string): BossContractJson {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), "utf-8")) as BossContractJson;
}

const fixtures: Array<[string, BossContractJson]> = [
  ["examples/waca-se-boss.json", loadFixture("examples/waca-se-boss.json")],
  ["examples/ai/waca.json", loadFixture("examples/ai/waca.json")],
  ["examples/ai/literature-reading.json", loadFixture("examples/ai/literature-reading.json")],
  ["examples/ai/dataset-investigation.json", loadFixture("examples/ai/dataset-investigation.json")],
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// Schema layer
// ---------------------------------------------------------------------------

test("all four demo fixtures pass the JSON Schema (regression)", () => {
  for (const [name, doc] of fixtures) {
    const outcome = validateAgainstSchema(doc);
    assert.ok(outcome.valid, `${name}: ${formatDiagnostics(outcome.diagnostics)}`);
  }
});

test("format assertions are enabled: deadline \"null\" string is rejected (D1 regression lock)", () => {
  const doc = clone(fixtures.find(([n]) => n.includes("literature-reading"))![1]) as unknown as Record<string, unknown>;
  doc.deadline = "null";
  const outcome = validateAgainstSchema(doc);
  assert.equal(outcome.valid, false);
  assert.ok(outcome.diagnostics.some((d) => d.rule === "SCHEMA" && d.message.includes("date-time")));
});

test("missing required top-level field is rejected", () => {
  const doc = clone(fixtures[1][1]) as unknown as Record<string, unknown>;
  delete doc.scopeGuard;
  const outcome = validateAgainstSchema(doc);
  assert.equal(outcome.valid, false);
});

test("additional top-level property is rejected", () => {
  const doc = clone(fixtures[1][1]) as unknown as Record<string, unknown>;
  doc.extraField = "no";
  const outcome = validateAgainstSchema(doc);
  assert.equal(outcome.valid, false);
});

// ---------------------------------------------------------------------------
// Semantic layer — GENERAL phase (fixtures carry evidence / Stage 2 states)
// ---------------------------------------------------------------------------

test("all four fixtures pass GENERAL-phase semantics (waca-se PARTIAL derivation is legal)", () => {
  for (const [name, doc] of fixtures) {
    const outcome = validateSemantics(doc, { phase: "GENERAL" });
    assert.ok(outcome.valid, `${name}: ${formatDiagnostics(outcome.diagnostics)}`);
    assert.equal(outcome.diagnostics.length, 0, `${name}: unexpected warnings`);
  }
});

test("GENERAL phase: status PARTIAL with zero accepted evidence is rejected (S7)", () => {
  const doc = clone(fixtures[0][1]);
  for (const evidence of doc.evidenceItems) evidence.reviewStatus = "REJECTED";
  const outcome = validateSemantics(doc, { phase: "GENERAL" });
  assert.equal(outcome.valid, false);
  assert.ok(outcome.diagnostics.some((d) => d.rule === "S7"));
});

test("GENERAL phase: status CLEAR while a required criterion is FAIL is rejected (S7)", () => {
  const doc = clone(fixtures[0][1]);
  doc.status = "CLEAR";
  const outcome = validateSemantics(doc, { phase: "GENERAL" });
  assert.equal(outcome.valid, false);
  assert.ok(outcome.diagnostics.some((d) => d.rule === "S7"));
});

// ---------------------------------------------------------------------------
// Semantic layer — GOAL_DISCOVERY phase (initial state invariants)
// ---------------------------------------------------------------------------

const base = () => buildMockContract("我想复现一篇论文，但不知道从哪里开始。");

test("mock contract passes GOAL_DISCOVERY semantics with zero warnings", () => {
  const outcome = validateSemantics(base());
  assert.ok(outcome.valid, formatDiagnostics(outcome.diagnostics));
  assert.equal(outcome.diagnostics.length, 0);
});

test("S1: duplicate deliverable / criterion / requirement ids are rejected", () => {
  const doc = base();
  doc.deliverables.push(clone(doc.deliverables[0]));
  let outcome = validateSemantics(doc);
  assert.ok(!outcome.valid && outcome.diagnostics.some((d) => d.rule === "S1" && d.path.startsWith("/deliverables")));

  const doc2 = base();
  const copy = clone(doc2.acceptanceCriteria[0]);
  copy.id = "AC-2-COPY";
  // requirement ids must be re-issued too, otherwise the duplicate belongs to S1 as well
  copy.evidenceRequirements[0].id = "REQ-COPY";
  doc2.acceptanceCriteria.push(copy);
  outcome = validateSemantics(doc2);
  assert.ok(outcome.valid, "distinct criterion + requirement ids should stay valid");

  const doc3 = base();
  doc3.acceptanceCriteria.push(clone(doc3.acceptanceCriteria[0]));
  outcome = validateSemantics(doc3);
  assert.ok(!outcome.valid && outcome.diagnostics.some((d) => d.rule === "S1" && d.path.startsWith("/acceptanceCriteria")));
});

test("S2: required criterion without evidence requirements is rejected", () => {
  const doc = base();
  doc.acceptanceCriteria[0].evidenceRequirements = [];
  const outcome = validateSemantics(doc);
  assert.ok(!outcome.valid && outcome.diagnostics.some((d) => d.rule === "S2"));
});

test("S3/S4: empty acceptedSourceTypes and minimumCount 0 are rejected", () => {
  const doc = base();
  doc.acceptanceCriteria[0].evidenceRequirements[0].acceptedSourceTypes = [];
  let outcome = validateSemantics(doc);
  assert.ok(!outcome.valid && outcome.diagnostics.some((d) => d.rule === "S3"));

  const doc2 = base();
  doc2.acceptanceCriteria[0].evidenceRequirements[0].minimumCount = 0;
  outcome = validateSemantics(doc2);
  assert.ok(!outcome.valid && outcome.diagnostics.some((d) => d.rule === "S4"));
});

test("S5: dangling evidence reference is rejected", () => {
  const doc = base();
  doc.evidenceItems.push({
    id: "EV-1",
    criterionId: "AC-DOES-NOT-EXIST",
    requirementId: "REQ-DOES-NOT-EXIST",
    sourceType: "ARTIFACT_INSPECTED",
    sourceName: "notes.md",
    summary: "smoke",
    finding: "PASS",
    reviewStatus: "ACCEPTED",
  });
  const outcome = validateSemantics(doc);
  assert.ok(outcome.diagnostics.some((d) => d.rule === "S5"));
});

test("S6: evidence sourceType outside accepted set is rejected", () => {
  const doc = base();
  doc.evidenceItems.push({
    id: "EV-1",
    criterionId: doc.acceptanceCriteria[0].id,
    requirementId: doc.acceptanceCriteria[0].evidenceRequirements[0].id,
    sourceType: "AUTO_VERIFIED",
    sourceName: "platform",
    summary: "claims platform verification",
    finding: "PASS",
    reviewStatus: "ACCEPTED",
  });
  const outcome = validateSemantics(doc);
  assert.ok(outcome.diagnostics.some((d) => d.rule === "S6"));
});

test("S8: output matching a known fixture signature is rejected", () => {
  const signature = { id: "boss-waca-se-demo", title: "whatever", objective: "whatever" };
  const doc = base();
  doc.id = signature.id;
  doc.title = signature.title;
  doc.objective = signature.objective;
  const outcome = validateSemantics(doc, { knownFixtureSignatures: [signature] });
  assert.ok(!outcome.valid && outcome.diagnostics.some((d) => d.rule === "S8"));
});

test("S8: same id alone does not trigger (title/objective must match too)", () => {
  const signature = { id: "boss-waca-se-demo", title: "whatever", objective: "whatever" };
  const doc = base();
  doc.id = signature.id;
  const outcome = validateSemantics(doc, { knownFixtureSignatures: [signature] });
  assert.ok(!outcome.diagnostics.some((d) => d.rule === "S8"));
});

test("S9: invented evidence / blockers / changeHistory / revision are rejected", () => {
  const doc = base();
  doc.evidenceItems.push({
    id: "EV-1",
    criterionId: doc.acceptanceCriteria[0].id,
    requirementId: doc.acceptanceCriteria[0].evidenceRequirements[0].id,
    sourceType: "ARTIFACT_INSPECTED",
    sourceName: "notes.md",
    summary: "smoke",
    finding: "PASS",
    reviewStatus: "ACCEPTED",
  });
  let outcome = validateSemantics(doc);
  assert.ok(!outcome.valid && outcome.diagnostics.some((d) => d.rule === "S9" && d.path === "/evidenceItems"));

  const doc2 = base();
  doc2.blockers.push({ id: "BLK-1", description: "x", affectedCriteria: ["AC-1"], resolution: "y" });
  outcome = validateSemantics(doc2);
  assert.ok(outcome.diagnostics.some((d) => d.rule === "S9" && d.path === "/blockers"));

  const doc3 = base();
  doc3.changeHistory.push({
    revision: 2,
    changedAt: "2026-09-16T00:00:00Z",
    changedBy: "tester",
    reason: "smoke",
    changes: [{ path: "/title", before: "a", after: "b" }],
  });
  outcome = validateSemantics(doc3);
  assert.ok(outcome.diagnostics.some((d) => d.rule === "S9" && d.path === "/changeHistory"));

  const doc4 = base();
  doc4.revision = 2;
  outcome = validateSemantics(doc4);
  assert.ok(outcome.diagnostics.some((d) => d.rule === "S9" && d.path === "/revision"));
});

test("S10: deliverable not NOT_STARTED is rejected", () => {
  const doc = base();
  doc.deliverables[0].status = "DONE";
  const outcome = validateSemantics(doc);
  assert.ok(!outcome.valid && outcome.diagnostics.some((d) => d.rule === "S10"));
});

test("S11: criterion not UNKNOWN is rejected", () => {
  const doc = base();
  doc.acceptanceCriteria[0].status = "PASS";
  const outcome = validateSemantics(doc);
  assert.ok(!outcome.valid && outcome.diagnostics.some((d) => d.rule === "S11"));
});

// ---------------------------------------------------------------------------
// WARN rules S12–S16 (do not reject on their own)
// ---------------------------------------------------------------------------

test("S12: unknowns overlapping assumptions warns but stays valid", () => {
  const doc = base();
  doc.assumptions.push(doc.unknowns[0]);
  const outcome = validateSemantics(doc);
  assert.ok(outcome.valid);
  assert.ok(outcome.diagnostics.some((d) => d.rule === "S12"));
});

test("S13: estimatedMinutes above one working day warns but stays valid", () => {
  const doc = base();
  doc.estimatedMinutes = 481;
  const outcome = validateSemantics(doc);
  assert.ok(outcome.valid);
  assert.ok(outcome.diagnostics.some((d) => d.rule === "S13"));
});

test("S14: recordKind DEMO_FIXTURE warns but stays valid", () => {
  const doc = base();
  doc.recordKind = "DEMO_FIXTURE";
  const outcome = validateSemantics(doc);
  assert.ok(outcome.valid);
  assert.ok(outcome.diagnostics.some((d) => d.rule === "S14"));
});

test("S15: status other than DRAFT warns but stays valid (Q3 decision)", () => {
  const doc = base();
  doc.status = "ACTIVE";
  const outcome = validateSemantics(doc);
  assert.ok(outcome.valid);
  assert.ok(outcome.diagnostics.some((d) => d.rule === "S15"));
});

test("S16: empty inScope warns but stays valid", () => {
  const doc = base();
  doc.scopeGuard.inScope = [];
  const outcome = validateSemantics(doc);
  assert.ok(outcome.valid);
  assert.ok(outcome.diagnostics.some((d) => d.rule === "S16"));
});

// ---------------------------------------------------------------------------
// Pipeline (validateContract)
// ---------------------------------------------------------------------------

test("validateContract accepts a valid goal + mock contract", () => {
  const outcome = validateContract("我想复现一篇论文，但不知道从哪里开始。", base());
  assert.equal(outcome.outcome, "CONTRACT");
});

test("validateContract rejects an empty goal before touching the document", () => {
  const outcome = validateContract("   ", base());
  assert.equal(outcome.outcome, "INPUT_REJECTED");
});

test("validateContract rejects a goal over 500 characters", () => {
  const outcome = validateContract("复".repeat(501), base());
  assert.equal(outcome.outcome, "INPUT_REJECTED");
});

test("validateContract short-circuits on Schema failure (no semantic rules run)", () => {
  const doc = base() as unknown as Record<string, unknown>;
  doc.estimatedMinutes = "not-a-number";
  const outcome = validateContract("合法目标", doc);
  assert.equal(outcome.outcome, "INVALID_OUTPUT");
  assert.ok(outcome.diagnostics.every((d) => d.rule === "SCHEMA"));
});

test("validateContract reports semantic errors after Schema passes", () => {
  const doc = base();
  doc.status = "CLEAR"; // would trigger S15 WARN only... use a REJECT mutation instead
  doc.acceptanceCriteria[0].status = "PASS"; // S11
  const outcome = validateContract("合法目标", doc);
  assert.equal(outcome.outcome, "INVALID_OUTPUT");
  assert.ok(outcome.diagnostics.some((d) => d.rule === "S11"));
});

// ---------------------------------------------------------------------------
// formatDiagnostics
// ---------------------------------------------------------------------------

test("formatDiagnostics truncates long output and keeps the count", () => {
  const diagnostics = Array.from({ length: 100 }, (_, i) => ({
    rule: "SCHEMA",
    severity: "ERROR" as const,
    path: `/very/long/path/number/${i}`,
    message: "x".repeat(100),
  }));
  const text = formatDiagnostics(diagnostics, 500);
  assert.ok(text.length < 700);
  assert.ok(text.includes("truncated"));
  assert.ok(text.includes("100 diagnostics"));
});

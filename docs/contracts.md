# Boss Contract v0

The Web and AI workstreams must use
[`schemas/boss-contract.v0.schema.json`](../schemas/boss-contract.v0.schema.json)
as the stable MVP interface. The fixed WACA-SE fixture lives in
[`examples/waca-se-boss.json`](../examples/waca-se-boss.json).

`recordKind` separates real contracts (`LIVE`) from synthetic competition
fixtures (`DEMO_FIXTURE`). Evidence inside a demo fixture must never be shown as
verification of a real user's artifact.

## Authority

- The user supplies the raw goal, deadline, and assistance mode.
- The AI proposes the bounded objective, deliverables, acceptance criteria,
  scope guard, known facts, unknowns, assumptions, and estimate.
- The system owns IDs, evidence provenance, review results, and derived status.
- The user accepts the contract before execution begins.

## Status Layers

Criterion status is one of `UNKNOWN`, `PASS`, or `FAIL`:

- `UNKNOWN`: sufficient evidence is not available.
- `PASS`: every evidence requirement has enough accepted passing evidence.
- `FAIL`: accepted evidence demonstrates that the criterion is not satisfied.

Boss status is separate:

- `DRAFT`: the contract has not been accepted.
- `ACTIVE`: execution has started, but no required criterion has passed.
- `PARTIAL`: at least one required criterion has passed, but not all required
  criteria pass.
- `CLEAR`: every criterion with `required: true` passes. Optional failures do
  not prevent `CLEAR`.
- `BLOCKED`: an unresolved external dependency prevents meaningful progress or
  verification. Affected criteria remain `UNKNOWN` and the blocker is recorded.

## Evidence Rules

- `USER_REPORTED` records a user's claim. It cannot satisfy a requirement that
  demands inspected or verified execution.
- `ARTIFACT_INSPECTED` means the system inspected source code or an artifact.
- `LOG_INSPECTED` means the system inspected an execution log supplied by the
  user.
- `AUTO_VERIFIED` means the platform performed isolated verification itself. It
  must never be emitted for a pasted or merely inspected log.

Each criterion owns one or more `evidenceRequirements`. Every requirement lists
acceptable source types and a minimum count, preventing unrelated evidence from
being reused across criteria or proving more than its provenance permits.

An `EvidenceItem` has two independent conclusions:

- `finding`: what it says (`PASS`, `FAIL`, or `INCONCLUSIVE`).
- `reviewStatus`: whether it is valid (`PENDING`, `ACCEPTED`, or `REJECTED`).

## Freeze and Revision Rule

Fields such as `required` are editable while the Boss is `DRAFT`. After the
contract is accepted, scope and acceptance semantics are frozen. A later change
must increment `revision` and append a `changeHistory` entry with the time,
actor, reason, and before/after values. Schedule pressure can be context, but is
not sufficient justification for silently weakening a failed requirement.

If a request falls outside `scopeGuard`, preserve the current Boss and create a
new related Boss instead of expanding the active contract.

## Understanding Check Boundary

Understanding Check scheduling and capability results remain part of the MVP,
but they are deliberately not embedded in Boss Contract v0. They will use a
separate contract linked by `bossId`, so project completion cannot silently
promote a capability to `OWNED`.

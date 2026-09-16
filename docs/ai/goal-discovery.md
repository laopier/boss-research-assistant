# Goal Discovery Adapter

## Purpose

The Goal Discovery adapter turns a vague research intention into one bounded,
reviewable `boss-contract.v0` contract. It gives the Web and future AI runtime a
single shared boundary for objectives, deliverables, acceptance criteria,
scope, and evidence requirements.

MVP-0 defines this boundary and provides deterministic fixtures. It does not
call a live model. A future model integration must replace the mock generator
behind the existing API without introducing a competing contract shape.

## Input and Output

The adapter receives the same request used by `POST /api/contracts/generate`:

```json
{
  "schemaVersion": "boss-contract.v0",
  "goal": "I want to reproduce a paper, but I do not know where to begin."
}
```

`goal` is trimmed and must contain between 1 and 500 characters. The adapter
returns the existing API response shape:

```json
{
  "generation": "AI",
  "contract": {
    "schemaVersion": "boss-contract.v0",
    "recordKind": "LIVE",
    "...": "all remaining fields follow the canonical JSON Schema"
  }
}
```

The submitted goal is preserved in `contract.rawGoal`. Repository examples use
`recordKind: "DEMO_FIXTURE"`; a real generated contract uses `LIVE`.

## Generation Rules

- `schemas/boss-contract.v0.schema.json` is the only authoritative contract.
- Convert the vague goal into a bounded objective with observable outputs.
- Deliverables describe artifacts or results, not unobservable mental states.
- Every required acceptance criterion has at least one evidence requirement.
- A newly generated deliverable starts as `NOT_STARTED`.
- A newly generated criterion starts as `UNKNOWN`.
- A newly generated Boss starts as DRAFT; it becomes ACTIVE only after the user accepts the contract (lead decision, 2026-09-16).
- Goal Discovery does not fabricate evidence. `evidenceItems` and
  `changeHistory` start empty.
- Put confirmed facts in `known`, unresolved facts in `unknowns`, and temporary
  working premises in `assumptions`.
- Keep `UNKNOWN` distinct from evidence findings (`PASS`, `FAIL`,
  `INCONCLUSIVE`) and review states (`PENDING`, `ACCEPTED`, `REJECTED`).
- Do not add status values, rename fields, or silently weaken a required
  criterion to make an output validate.
- Work outside `scopeGuard.inScope` must become a new Boss according to
  `CREATE_NEW_BOSS`.

## Validation

Before an AI-generated contract reaches the Web, the adapter performs these
checks in order:

1. Parse the model output as one JSON object.
2. Validate it against `schemas/boss-contract.v0.schema.json`.
3. Confirm that criterion, requirement, deliverable, and evidence IDs are
   unique within the contract.
4. Confirm that every required criterion contains at least one non-empty
   evidence requirement with an allowed source type.
5. Confirm that every evidence item references an existing criterion and its
   corresponding requirement.
6. Enforce the initial-state rules: no invented evidence, no pre-completed
   deliverables, and no criterion marked `PASS` or `FAIL` during Goal Discovery.

Schema validation proves structural compatibility. The semantic checks prevent
a structurally valid contract from claiming unsupported progress or evidence.

## Retry and Fallback

The adapter allows at most two generation attempts: the original attempt and
one repair attempt.

If the first output is invalid, do not return it to the Web. Send the validation
errors, the original goal, and the required schema version back to the model,
then request one complete replacement JSON object. The repair attempt must
preserve the user's intent and may not remove required criteria merely to pass
validation.

If the repair attempt also fails, return an `INTERNAL_ERROR` response and no
contract. Never return a partial object, silently substitute the WACA fixture,
or mark criteria as passed. Validation diagnostics may be recorded for
development after removing sensitive user content; the user-facing response
should remain concise and suggest retrying.

## Demo Fixtures

The adapter is represented by three deterministic examples:

| Fixture | Scenario | Initial state |
| --- | --- | --- |
| `examples/ai/waca.json` | Bounded WACA-SE module reproduction | `ACTIVE` |
| `examples/ai/literature-reading.json` | Guided IR-drop paper reading | `ACTIVE` |
| `examples/ai/dataset-investigation.json` | Pre-training IR-drop dataset audit | `ACTIVE` |

All fixtures use `recordKind: "DEMO_FIXTURE"`, conform to Boss Contract v0,
and contain no accepted evidence at Goal Discovery time.

## Deferred from MVP-0

Live model calls, prompt-provider selection, local evidence reading,
Understanding Check scheduling, authentication, persistence, and databases are
outside this issue.

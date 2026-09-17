# AI: prepare the Goal Discovery adapter against Boss Contract v0

**Owner: AI workflow owner**

## Goal

Define the future model boundary from a vague goal to the existing `boss-contract.v0` contract without adding a competing schema or a live model call to MVP-0.

## File Boundary

- `docs/ai/**`
- New fixtures under `examples/ai/**`
- Propose schema changes in the Issue before editing `schemas/**`

## Tasks

- Review the current request and response boundary in `docs/api-contract.md`.
- Prepare three valid contract examples: WACA, literature reading, and dataset investigation.
- Document validation failures and retry behavior for malformed model output.
- Confirm every required criterion has at least one evidence requirement.

## Acceptance

- Every fixture validates against `schemas/boss-contract.v0.schema.json`.
- No fixture introduces additional status values or renamed fields.
- `UNKNOWN` remains distinct from evidence findings and review status.

## Suggested Branch

`ai/goal-discovery-fixtures`

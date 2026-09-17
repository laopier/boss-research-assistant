# Boss MVP-0 Technical Architecture

## Decision

MVP-0 uses one Next.js application for the page and a thin Route Handler. The browser sends a vague goal to the local endpoint, which currently returns the repository's fixed WACA-SE fixture. This preserves a real request, error, and rendering path without introducing a model, database, or scheduler.

```text
Goal input page
    │ POST /api/contracts/generate
    ▼
Request boundary and validation
    │
    ▼
examples/waca-se-boss.json
    │ Boss Contract v0
    ▼
Contract and Evidence Map view
```

## Shared Contract

The canonical data definition remains `schemas/boss-contract.v0.schema.json`. The Web code in `src/lib/contracts.ts` mirrors that schema for TypeScript only and must not evolve independently.

The mock generator changes only `rawGoal` in the fixed fixture. It does not invent a second Boss Contract shape.

## Ownership Boundaries

- Web owns `src/app/**`, browser interaction, request states, and rendering.
- AI workflow will replace the mock generator behind the existing request boundary and must return data valid against the canonical JSON Schema.
- The team lead owns the schema, fixture semantics, and integration acceptance.

## Deferred Work

Real model calls, Local Evidence reading, Understanding Check scheduling, authentication, and databases are outside MVP-0.

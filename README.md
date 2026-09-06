# Boss Research Assistant

Boss is an evidence-driven research training assistant for novice researchers.
It turns vague research intentions into bounded tasks, reviews user-authorized
local evidence, records the level of AI assistance, and schedules delayed
understanding checks.

## Competition Positioning

- Track: AI + Academic Research Assistant
- Focus: Failure Experience Accumulation and Incubation Assistant
- Initial submission deadline: 2026-09-26 23:59 (Asia/Shanghai)

## Core Loop

1. Goal Discovery from a vague research intention and supplied materials.
2. Generation of one bounded Boss Contract.
3. Evidence collection through user-authorized local files and logs.
4. Criterion-level review as `PASS`, `FAIL`, or `UNKNOWN`.
5. Explicit recording of the highest AI assistance level.
6. A delayed Understanding Check that updates capability separately from
   project progress.

## MVP Scope

- Online Web demo.
- Goal Discovery and a structured Boss Contract.
- One active Boss workspace and Evidence Map.
- Read-only Local Evidence Bridge with explicit user confirmation.
- Assistance modes: AI Off, Coach, Collaborate, and Agent.
- Persistent Understanding Check scheduling and reminders.
- Separate project and capability progress.
- A fixed WACA-SE demonstration case.

See [docs/product-brief.md](docs/product-brief.md),
[docs/contracts.md](docs/contracts.md), and
[docs/collaboration.md](docs/collaboration.md).

## Status

Product definition and technical probes. The runtime stack and LearnBuddy
integration method remain open decisions.

## License

MIT

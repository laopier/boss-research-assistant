# Shared Contract Draft

The Web and AI workstreams must agree on these structures before feature work
is integrated. Field names are provisional until the first technical probes
are reviewed.

## BossContract

```text
id
objective
deadline
acceptanceCriteria[]
scopeGuard[]
known[]
unknowns[]
assumptions[]
estimatedMinutes
assistanceMode
status
```

## EvidenceItem

```text
id
criterionId
sourceType
fileName
summary
status
confidence
reviewMessage
```

Allowed evidence source types initially include `USER_REPORTED`,
`ARTIFACT_INSPECTED`, and `LOG_INSPECTED`. `AUTO_VERIFIED` must not be emitted
until the platform actually performs an isolated verification.

## UnderstandingCheck

```text
id
bossId
capabilityIds[]
scheduledAt
mode
status
result
```

## Status Rule

A Boss remains active if any required criterion is `FAIL` or `UNKNOWN`. Project
completion must not automatically promote capability to `OWNED`.

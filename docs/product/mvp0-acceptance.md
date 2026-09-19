# MVP-0 Product Acceptance

## Purpose

This document freezes the product truth for the WACA MVP-0 demonstration and
records the acceptance procedure independently from the Web and AI
implementations. A successful build alone does not make the product accepted;
the expected user flow must also work on a computer that did not implement the
feature.

## Frozen Demo Truth

The canonical source is `examples/waca-se-boss.json`.

- User input: `我想复现 WACA 论文，但不知道从哪里开始。`
- API generation mode: `MOCK`
- Contract record kind: `DEMO_FIXTURE`
- Boss status: `PARTIAL`
- Assistance mode: `COACH`
- Estimated duration: 90 minutes
- Visible badge: `模拟数据`

The objective is to implement a bounded WACA-SE module and verify that Stage 2
learns from the weak-feature tensor produced by Stage 1. MVP-0 deliberately
narrows the vague goal to the attention module instead of claiming a complete
paper reproduction.

The expected criterion truth is fixed as follows:

| Criterion | Expected status | Product meaning |
| --- | --- | --- |
| AC-1 | `PASS` | Shape, output finiteness, and gradient finiteness were verified. |
| AC-2 | `FAIL` | Stage 2 used the wrong input instead of `Xweak`. |
| AC-3 | `PASS` | Stage 1 and Stage 2 shared one MLP instance. |
| AC-4 | `UNKNOWN` | The optional attention-mask visualization has not been verified. |

The demo must not convert this result to `CLEAR`. Passing numerical smoke tests
does not override the accepted semantic failure recorded for AC-2.

The frozen MVP-0 minimum includes the goal input, mock request path, Contract
rendering, Acceptance Criteria, and an Evidence Map. The current product also
contains a browser-local evidence and failure loop as an additive extension.
Live AI calls, Local Evidence Bridge, Understanding Check scheduling,
authentication, and server-side databases remain outside this acceptance scope.

## Product Status Copy

### Boss status

| Contract value | Chinese copy |
| --- | --- |
| `DRAFT` | 草稿 |
| `ACTIVE` | 进行中 |
| `PARTIAL` | 部分完成 |
| `CLEAR` | 已完成 |
| `BLOCKED` | 受阻 |

### Acceptance criterion status

| Contract value | Chinese copy |
| --- | --- |
| `UNKNOWN` | 待验证 |
| `PASS` | 通过 |
| `FAIL` | 未通过 |

### Evidence finding and review status

| Contract value | Chinese copy |
| --- | --- |
| `INCONCLUSIVE` | 无法判断 |
| `PENDING` | 待审核 |
| `ACCEPTED` | 已接受 |
| `REJECTED` | 已拒绝 |

`NOT_RUN` is permitted only in this document as the execution state of the
external acceptance procedure. It is not a Boss Contract value and must not be
returned by the API or stored in a criterion.

## Acceptance Preconditions

- Use a computer or clean checkout that did not implement the Web slice.
- Test the reviewed revision of `web/mvp0-goal-contract` or its merged revision
  on `main`.
- Install Node.js 20 or later and pnpm 11.
- Follow the repository README without undocumented setup steps.

## Acceptance Procedure

1. Clone or freshly check out the reviewed repository revision.
2. Follow the README to install locked dependencies and start the application.
3. Open `http://localhost:3000`.
4. Confirm that the page loads without an application error.
5. Enter the frozen WACA goal and select `载入 WACA 演示案例`.
6. Confirm that the result is visibly marked as simulated data.
7. Confirm that the objective, metadata, four criteria, and Evidence Map are
   displayed.
8. Confirm the expected `PASS / FAIL / PASS / UNKNOWN` criterion sequence.
9. Confirm that an empty goal cannot be submitted.
10. Repeat the core flow in a narrow viewport and confirm that content remains
    readable and operable.

## Acceptance Checklist

- [ ] A fresh checkout can be installed by following only the README.
- [ ] `pnpm lint` completes successfully.
- [ ] `pnpm build` completes successfully.
- [ ] The application starts and the home page loads.
- [ ] A non-empty goal can be submitted.
- [ ] The result displays the `模拟数据` badge.
- [ ] The expected objective and Boss metadata are visible.
- [ ] AC-1, AC-2, AC-3, and AC-4 display the frozen statuses.
- [ ] The Evidence Map is visible and keeps each item attached to its criterion.
- [ ] An empty goal cannot be submitted.
- [ ] An API error is presented to the user rather than silently ignored.
- [ ] The core flow remains usable in a narrow viewport.
- [ ] No live AI or Local Evidence access occurs during the demo.

## Acceptance Record

- Status: `NOT_RUN`
- Tester: `TBD`
- Date: `TBD`
- Tested revision: `TBD`
- Operating system: `TBD`
- Node version: `TBD`
- pnpm version: `TBD`
- Dependency installation time: `TBD`
- Application startup time: `TBD`
- Desktop result: `TBD`
- Narrow-viewport result: `TBD`
- Problems found: `TBD`
- Final result: `TBD`

The status may change to `PASS` only after every required checklist item has
observable evidence. Any failed required item keeps the acceptance result at
`FAIL` or `PARTIAL` until it is corrected and re-tested.

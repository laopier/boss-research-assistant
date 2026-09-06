# Boss MVP Product Brief

## User and Problem

The primary user is an undergraduate with basic programming ability who is
starting paper reproduction but cannot yet translate a vague intention into a
reliable research plan.

Conventional AI coding tools optimize for artifact completion. They do not
reliably distinguish a working artifact from user understanding, and they can
hide semantic errors behind successful execution or correct tensor shapes.

## Product Promise

Boss lowers the cost of beginning and continuing a research task. It discovers
the next bounded goal, maps acceptance criteria to evidence, records how much
AI assistance was used, and revisits important capabilities after a delay.

## Demonstration Scenario

The user wants to reproduce WACA but does not know where to begin. Goal
Discovery eventually activates a bounded WACA-SE implementation Boss. The
submitted code runs and preserves shape but incorrectly reuses Stage 1
information in Stage 2. Boss marks the semantic criterion as failed, provides
a Coach-level direction, and does not clear the task until the evidence map is
complete. A delayed transfer question later updates capability independently
from project completion.

## Required MVP

1. Vague-goal intake with a small number of adaptive questions.
2. One active Boss Contract with criteria, scope guard, unknowns, and estimate.
3. Read-only local file selection, filtering, preview, and change snapshots.
4. Evidence review with provenance and criterion-level status.
5. Assistance-mode selection and provenance recording.
6. Persistent Understanding Check scheduling.
7. Project-progress and capability-progress views.

## Non-goals

- Executing arbitrary user repositories on the server.
- Automating all stages of scientific research.
- IDE extensions or native desktop clients.
- Complex multi-project scheduling.
- Email, calendar, or messaging notifications.
- Full multi-tenant research-team permissions.

## Important Unknowns

- Whether LearnBuddy must be integrated at runtime or used as the designated
  development assistant only.
- The final Web and backend stack.
- The available model interface and quota.
- Whether browser-directory access is sufficient for the judging environment;
  a folder-upload fallback remains required.

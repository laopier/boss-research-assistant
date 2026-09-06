# Team Collaboration

## Ownership

- Team lead: product decisions, shared contracts, integration acceptance,
  demonstration fixture, presentation, and final submission.
- Web owner: Web experience, Local Evidence Bridge, persistence, compatibility
  fallback, and deployment.
- AI workflow owner: Goal Discovery, structured contract generation, evidence
  review, assistance policy, understanding checks, and evaluation fixtures.

Ownership will be adjusted after each member reports current skills and daily
availability.

## Git Workflow

- `main` must remain demonstrable.
- Work on short feature branches.
- Open a pull request for integration.
- At least one teammate reviews each pull request.
- Never commit secrets, private research data, model weights, or dependencies.
- Integrate at least once per day.

Suggested first branches:

```text
feat/local-evidence
feat/ai-workflow
feat/product-shell
```

## First Technical Probes

1. Local Evidence: select a directory in a Chromium browser, read permitted
   text files, filter excluded paths, and display a review preview.
2. AI Workflow: turn a vague goal into valid structured Boss Contract data and
   expose unresolved unknowns instead of inventing them.
3. Product Shell: navigate through the five demo views using fixed WACA data.

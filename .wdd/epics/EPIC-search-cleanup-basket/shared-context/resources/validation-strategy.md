---
id: EPIC-search-cleanup-basket-RESOURCE-validation-strategy
kind: shared_context_resource
epic: EPIC-search-cleanup-basket
resource: validation-strategy
updated_at: 2026-06-14
---

# Shared Context Resource: Validation Strategy

## Purpose

Define how task workers, reviewers, and the epic validator should prove the
Search cleanup basket epic is complete.

## Summary

Use focused validation per task, then run broader repository checks and a manual
browser pass after integration.

## Focused Validation By Area

Backend service:

```bash
npm test -- tests/integration/entity-service.test.ts
```

REST endpoint:

```bash
npm test -- tests/contract/rest-api.test.ts
```

UI API/client:

```bash
npm --prefix ui run test -- --run src/lib/api.test.ts
```

Search UI/basket components:

```bash
npm --prefix ui run test -- --run <focused-ui-test-file>
npm --prefix ui run typecheck
```

## Broad Validation Before Epic Completion

Choose the broad command set according to changed areas and time available:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

At minimum, final validation should include full typecheck and the focused
backend/REST/UI tests touched by this epic. If broad tests are blocked by local
environment constraints, record the exact blocker in task evidence and epic
validation notes.

## Manual Browser Validation

Use the Search page in the local app:

1. Search or browse entities.
2. Select multiple visible result cards with checkboxes.
3. Use shift-click to select a visible range.
4. Use select-all-loaded.
5. Add selected entities to the cleanup basket.
6. Navigate away or reload and confirm basket persistence.
7. Open the review drawer.
8. Remove one basket item and clear/re-add as needed.
9. Archive reviewed IDs.
10. Confirm successful archived IDs leave visible results when archived rows
    are hidden.
11. Confirm failed IDs remain in the drawer with messages if a partial failure
    is simulated or naturally occurs.

## Completion Checks

- No hard-delete UI or API path was added.
- No query-level archive path was added.
- Backend returns partial results for expected failures.
- UI removes archived IDs from visible state and basket.
- UI keeps failed IDs with messages.
- Existing single-delete behavior still works.
- Archived entities remain recoverable through existing archived visibility
  behavior.

## Durable Memory

### Manual Evidence Needed

- Source task: epic start context
- Source PR/branch: current controller worktree
- Status: pending future validation
- Summary: Manual browser validation should cover persistence across reload and
  the complete select-add-review-archive flow.
- Why it matters: UI unit tests can miss cross-component persistence and layout
  behavior in the real Search page.
- Affected files or areas: Search page, cleanup drawer, API client, backend
  archive endpoint.
- Follow-up implications: The final epic PR should include manual validation
  notes if browser verification is possible.

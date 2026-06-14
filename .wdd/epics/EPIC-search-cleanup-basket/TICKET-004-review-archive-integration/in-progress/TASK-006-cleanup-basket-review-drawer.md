---
id: TASK-006-cleanup-basket-review-drawer
kind: task
epic: EPIC-search-cleanup-basket
ticket: TICKET-004-review-archive-integration
wave: WAVE-003
slug: cleanup-basket-review-drawer
title: Cleanup Basket Review Drawer
status: in_progress
depends_on:
  - TASK-002-rest-bulk-archive-endpoint
  - TASK-003-ui-bulk-archive-api-client
  - TASK-004-cleanup-basket-state
conflict_domains:
  - ui/src/components/CleanupBasketDrawer.tsx
  - ui/src/components/CleanupBasketDrawer.test.tsx
  - ui/src/hooks/useCleanupBasket.ts
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-006-cleanup-basket-review-drawer
worker_worktree: /Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-006-cleanup-basket-review-drawer
worktree_status: pending_creation
pr: null
current_gate: worktree_pending
branch_freshness: current_at_activation
verification:
  - npm --prefix ui run test -- --run src/components/CleanupBasketDrawer.test.tsx
  - npm --prefix ui run typecheck
---

# TASK-006-cleanup-basket-review-drawer: Cleanup Basket Review Drawer

## Status

in_progress

## Parent Ticket

TICKET-004-review-archive-integration

## Wave

WAVE-003

## Objective

Build a cleanup basket review drawer component that displays basket summaries,
allows item removal/clear, archives reviewed IDs through the UI API client, and
surfaces partial failures.

## Scope

- Included:
  - Drawer component.
  - Counts by type/status/visibility.
  - Scrollable item list with preview metadata.
  - Remove one item and clear basket controls.
  - Final archive action.
  - Success and partial failure UI states.
  - Focused drawer tests.
- Excluded:
  - SearchPage final integration.
  - Backend endpoint changes.
  - Search result selection.

## Non-Scope

- Do not add hard delete language or behavior.
- Do not implement query-level archive.

## Relevant Context

### Local Context

- `ui/src/hooks/useCleanupBasket.ts`
- `ui/src/lib/api.ts`
- `ui/src/components/SearchPage.tsx`
- existing modal/drawer styling in UI components

### Shared Context References

- `../../shared-context/index.md`
- `../../shared-context/resources/architecture.md`
- `../../shared-context/resources/api-contract.md`
- `../../shared-context/resources/discovered-conventions.md`
- `../../shared-context/resources/testing-strategy.md`

## Likely Files / Areas

- `ui/src/components/CleanupBasketDrawer.tsx`
- `ui/src/components/CleanupBasketDrawer.test.tsx`
- `ui/src/hooks/useCleanupBasket.ts`

## Dependencies

- `TASK-002-rest-bulk-archive-endpoint`
- `TASK-003-ui-bulk-archive-api-client`
- `TASK-004-cleanup-basket-state`

Dependency status:

- `TASK-002-rest-bulk-archive-endpoint` is done and merged into
  `codex/epic/search-cleanup-basket` in local merge commit `47e4423`.
- `TASK-003-ui-bulk-archive-api-client` is done and merged into
  `codex/epic/search-cleanup-basket` in local merge commit `a593403`.
- `TASK-004-cleanup-basket-state` is done and merged into
  `codex/epic/search-cleanup-basket` in local merge commit `a593403`.
- Use `api.bulkArchiveEntities(ids)` for the final reviewed archive action and
  `useCleanupBasket` archive-result helpers for success/failure updates.

## Conflict Domains

- cleanup basket drawer component
- basket state archive-result application

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-006-cleanup-basket-review-drawer

## Worker Worktree

/Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-006-cleanup-basket-review-drawer

Status: pending creation by controller before worker dispatch.

## PR / Patch Reference

None yet.

## RED-GREEN TDD Plan

### RED

Add failing drawer tests for count summaries, remove item, clear basket, archive
success cleanup callback, and partial failure retention/error display.

### GREEN

Implement the drawer component against the basket hook/API client contract.

### REFACTOR

Keep the drawer props explicit so SearchPage integration remains small in the
next task.

## Implementation Notes

- Worker must inspect named files before broad discovery.
- Worker must start in the assigned worktree path provided by the controller.
- Worker must confirm this task file and current orchestration state exist in
  the assigned worktree before editing.
- Worker must not switch branches in the controller checkout.
- Worker must stay within this task scope.
- Worker must not start dependent tasks.

## Durable Memory Notes To Consider

- Record any drawer API/prop contract that affects final integration.
- Preserve archive-only language; do not introduce hard-delete or query-level
  archive controls.

## Task-Level Definition of Done

- [ ] Objective is complete.
- [ ] Verification evidence is recorded.
- [ ] No unresolved P1/P2 review findings remain.
- [ ] Shared-context updates, if any, are proposed for controller reconciliation.

## Validation Steps

- `npm --prefix ui run test -- --run src/components/CleanupBasketDrawer.test.tsx`
- `npm --prefix ui run typecheck`

## Verification Evidence

- Not run yet.

## Review Feedback

### P1

- None.

### P2

- None.

### P3

- None.

## Completion Notes

- None yet.

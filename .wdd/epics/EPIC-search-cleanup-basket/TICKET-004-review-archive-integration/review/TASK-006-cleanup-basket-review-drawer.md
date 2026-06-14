---
id: TASK-006-cleanup-basket-review-drawer
kind: task
epic: EPIC-search-cleanup-basket
ticket: TICKET-004-review-archive-integration
wave: WAVE-003
slug: cleanup-basket-review-drawer
title: Cleanup Basket Review Drawer
status: review
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
worktree_status: verified
pr: null
worker_thread_id: 019ec631-30c7-7d21-82d4-1ac079ab603b
current_gate: worker_ready_for_review
branch_freshness: current_at_dispatch
verification:
  - npm --prefix ui run test -- --run src/components/CleanupBasketDrawer.test.tsx
  - npm --prefix ui run typecheck
---

# TASK-006-cleanup-basket-review-drawer: Cleanup Basket Review Drawer

## Status

review

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

Status: verified by controller.

Worker: Arendt (`019ec631-30c7-7d21-82d4-1ac079ab603b`).

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

- [x] Objective is complete.
- [x] Verification evidence is recorded.
- [x] No unresolved P1/P2 review findings remain.
- [x] Shared-context updates, if any, are proposed for controller reconciliation.

## Validation Steps

- `npm --prefix ui run test -- --run src/components/CleanupBasketDrawer.test.tsx`
- `npm --prefix ui run typecheck`

## Verification Evidence

- Setup: initial `npm --prefix ui run test -- --run
  src/components/CleanupBasketDrawer.test.tsx` could not start because UI
  dependencies were not installed in this task worktree (`vitest: command not
  found`); `npm --prefix ui ci` completed successfully from the existing
  lockfile.
- RED: after dependency install, the focused drawer test first failed because
  `ui/src/components/CleanupBasketDrawer.tsx` did not exist.
- RED: after adding a compile stub, `npm --prefix ui run test -- --run
  src/components/CleanupBasketDrawer.test.tsx` failed as expected with 5
  behavior failures for missing drawer summaries, remove, clear, archive
  success cleanup, and partial-failure retention UI.
- GREEN: `npm --prefix ui run test -- --run
  src/components/CleanupBasketDrawer.test.tsx` passed: 1 test file, 5 tests.
- Final validation: `npm --prefix ui run test -- --run
  src/components/CleanupBasketDrawer.test.tsx` passed: 1 test file, 5 tests.
- Final validation: `npm --prefix ui run typecheck` passed with
  `tsc --noEmit`.
- Final validation: `git diff --check` passed.

## Review Feedback

### P1

- None.

### P2

- None.

### P3

- None.

## Completion Notes

- Added `CleanupBasketDrawer` with explicit props for TASK-007 integration:
  `api`, `items`, `onArchiveResult`, `onRemoveItem`, `onClear`, and `onClose`.
- The archive action calls `api.bulkArchiveEntities` with reviewed basket IDs
  and delegates successful/failed basket state updates to the existing
  `useCleanupBasket` archive-result helper through `onArchiveResult`.
- The drawer displays count summaries by type, status, and visibility; a
  scrollable item list with preview metadata; remove and clear controls;
  archive-only success messaging; and partial-failure retention with
  per-item error messages.
- Did not wire the drawer into `SearchPage`, change backend/API routes, add
  hard delete behavior, or implement query-level archive.
- Shared-context update proposed for controller reconciliation: TASK-007 should
  wire this drawer by passing `useCleanupBasket`'s `items`, `remove`, `clear`,
  and `applyArchiveResult` helpers plus the existing `api` client; visible
  SearchPage result cleanup after archive remains TASK-007 scope.
- Final gate: ready for controller review.

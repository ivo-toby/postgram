---
id: TASK-005-search-result-selection
kind: task
epic: EPIC-search-cleanup-basket
ticket: TICKET-003-search-selection
wave: WAVE-002
slug: search-result-selection
title: Search Result Selection
status: in_progress
depends_on:
  - TASK-004-cleanup-basket-state
conflict_domains:
  - ui/src/components/SearchPage.tsx
  - ui/src/components/SearchPage.test.tsx
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-005-search-result-selection
worker_worktree: /Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-005-search-result-selection
worktree_status: verified
pr: null
worker_thread_id: 019ec61b-5ecc-7293-be12-93dfe9846204
current_gate: worker_dispatched
branch_freshness: current_at_dispatch
verification:
  - npm --prefix ui run test -- --run src/components/SearchPage.test.tsx
  - npm --prefix ui run typecheck
---

# TASK-005-search-result-selection: Search Result Selection

## Status

in_progress

## Parent Ticket

TICKET-003-search-selection

## Wave

WAVE-002

## Objective

Add checkbox selection, select-all-loaded, shift-click visible range selection,
and an add-to-basket action bar to Search results while preserving normal
detail navigation.

## Scope

- Included:
  - Result card checkbox UI.
  - Selected IDs and last-selection-anchor state.
  - Shift-click visible range selection.
  - Select-all-loaded behavior.
  - Add selected snapshots to cleanup basket.
  - Clear current selection.
  - Tests for click behavior and selection flows.
- Excluded:
  - Review drawer.
  - Final archive mutation.
  - Backend/API work.

## Non-Scope

- Do not make card body clicks toggle selection.
- Do not add query-level archive controls.

## Relevant Context

### Local Context

- `ui/src/components/SearchPage.tsx`
- `ui/src/components/TasksPage.tsx`
- `ui/src/components/tasks/BulkActionBar.tsx`
- `ui/src/components/TasksPage.test.tsx`

### Shared Context References

- `../../shared-context/index.md`
- `../../shared-context/resources/architecture.md`
- `../../shared-context/resources/discovered-conventions.md`
- `../../shared-context/resources/testing-strategy.md`

## Likely Files / Areas

- `ui/src/components/SearchPage.tsx`
- `ui/src/components/SearchPage.test.tsx`
- Optional focused component/helper files for selection bar or selection logic.

## Dependencies

- `TASK-004-cleanup-basket-state`

Dependency status:

- `TASK-004-cleanup-basket-state` is done and merged into
  `codex/epic/search-cleanup-basket` in local merge commit `a593403`.
- Use `useCleanupBasket`, `createCleanupBasketItem`, and related basket state
  helpers from `ui/src/hooks/useCleanupBasket.ts`.

## Conflict Domains

- `ui/src/components/SearchPage.tsx`
- Search result card UI and state

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-005-search-result-selection

## Worker Worktree

/Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-005-search-result-selection

Status: verified by controller.

Worker: Erdos (`019ec61b-5ecc-7293-be12-93dfe9846204`).

## PR / Patch Reference

None yet.

## RED-GREEN TDD Plan

### RED

Add failing UI tests for checkbox toggling without opening detail, card body
opening detail, shift-click range selection, select-all-loaded, and add
selected to basket.

### GREEN

Wire SearchPage selection state to ResultCard checkboxes and the basket hook,
using current visible result order for ranges.

### REFACTOR

Extract a selection helper or action bar component if it keeps SearchPage
readable.

## Implementation Notes

- Worker must inspect named files before broad discovery.
- Worker must start in the assigned worktree path provided by the controller.
- Worker must confirm this task file and current orchestration state exist in
  the assigned worktree before editing.
- Worker must not switch branches in the controller checkout.
- Worker must stay within this task scope.
- Worker must not start dependent tasks.

## Durable Memory Notes To Consider

- Record any final shift-click anchor behavior if it differs from current
  planning assumptions.

## Task-Level Definition of Done

- [ ] Objective is complete.
- [ ] Verification evidence is recorded.
- [ ] No unresolved P1/P2 review findings remain.
- [ ] Shared-context updates, if any, are proposed for controller reconciliation.

## Validation Steps

- `npm --prefix ui run test -- --run src/components/SearchPage.test.tsx`
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

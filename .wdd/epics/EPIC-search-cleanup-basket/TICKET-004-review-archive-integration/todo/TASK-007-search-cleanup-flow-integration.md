---
id: TASK-007-search-cleanup-flow-integration
kind: task
epic: EPIC-search-cleanup-basket
ticket: TICKET-004-review-archive-integration
wave: WAVE-004
slug: search-cleanup-flow-integration
title: Search Cleanup Flow Integration
status: todo
depends_on:
  - TASK-002-rest-bulk-archive-endpoint
  - TASK-005-search-result-selection
  - TASK-006-cleanup-basket-review-drawer
conflict_domains:
  - ui/src/components/SearchPage.tsx
  - ui/src/components/SearchPage.test.tsx
  - ui/src/components/CleanupBasketDrawer.tsx
  - tests/contract/rest-api.test.ts
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-007-search-cleanup-flow-integration
worker_worktree: null
worktree_status: unassigned
pr: null
current_gate: not_started
branch_freshness: unknown
verification:
  - npm --prefix ui run test -- --run src/components/SearchPage.test.tsx
  - npm --prefix ui run typecheck
  - npm test -- tests/contract/rest-api.test.ts
---

# TASK-007-search-cleanup-flow-integration: Search Cleanup Flow Integration

## Status

todo

## Parent Ticket

TICKET-004-review-archive-integration

## Wave

WAVE-004

## Objective

Wire the complete Search cleanup basket flow together, update final tests, and
record manual/browser validation evidence.

## Scope

- Included:
  - Search header basket button/count.
  - Open/close review drawer from SearchPage.
  - Archive success removes archived IDs from visible results, fetched detail,
    current selection, and basket state.
  - Partial failures remain in basket.
  - Final focused tests across the integrated flow.
  - Manual/browser validation notes in task evidence.
- Excluded:
  - New backend semantics.
  - Hard delete.
  - Query-level archive.

## Non-Scope

- Do not add broad UI redesign beyond what is necessary to integrate the
  cleanup basket workflow.

## Relevant Context

### Local Context

- `ui/src/components/SearchPage.tsx`
- `ui/src/components/CleanupBasketDrawer.tsx`
- `ui/src/hooks/useCleanupBasket.ts`
- `ui/src/lib/api.ts`
- `tests/contract/rest-api.test.ts`

### Shared Context References

- `../../shared-context/index.md`
- `../../shared-context/resources/architecture.md`
- `../../shared-context/resources/api-contract.md`
- `../../shared-context/resources/discovered-conventions.md`
- `../../shared-context/resources/testing-strategy.md`
- `../../shared-context/resources/validation-strategy.md`

## Likely Files / Areas

- `ui/src/components/SearchPage.tsx`
- `ui/src/components/SearchPage.test.tsx`
- `ui/src/components/CleanupBasketDrawer.tsx`
- validation evidence in this task file

## Dependencies

- `TASK-002-rest-bulk-archive-endpoint`
- `TASK-005-search-result-selection`
- `TASK-006-cleanup-basket-review-drawer`

Dependency status:

- `TASK-002-rest-bulk-archive-endpoint` is done and merged into
  `codex/epic/search-cleanup-basket` in local merge commit `47e4423`.
- `TASK-005-search-result-selection` is done and merged into
  `codex/epic/search-cleanup-basket` in local merge commit `0f1c3f1`.
- `TASK-006-cleanup-basket-review-drawer` is planned for WAVE-003 and remains
  required before this final integration task starts.
- SearchPage selection already owns checkbox/select-all-loaded/shift-click and
  add-selected-to-basket behavior; final integration should preserve those
  interactions while adding the review drawer entry point and archive cleanup.

## Conflict Domains

- `ui/src/components/SearchPage.tsx`
- Search cleanup flow state
- final manual/browser validation

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-007-search-cleanup-flow-integration

## Worker Worktree

None assigned yet. The controller must create or verify an isolated worktree for
this task before dispatching a repository-writing worker, then provide that path
to the worker.

## PR / Patch Reference

None yet.

## RED-GREEN TDD Plan

### RED

Add or extend failing SearchPage tests for full flow behavior: basket count,
drawer opening, successful archive cleanup, and partial failure retention.

### GREEN

Integrate selection, basket hook, drawer, and API client into SearchPage and
remove archived IDs through existing result-state helpers.

### REFACTOR

Keep SearchPage readable by extracting any final local helper/component that
has grown beyond a small inline role.

## Implementation Notes

- Worker must inspect named files before broad discovery.
- Worker must start in the assigned worktree path provided by the controller.
- Worker must confirm this task file and current orchestration state exist in
  the assigned worktree before editing.
- Worker must not switch branches in the controller checkout.
- Worker must stay within this task scope.
- Worker must not start dependent tasks.

## Durable Memory Notes To Consider

- Record final browser/manual validation findings if they affect future cleanup
  workflow work.
- Preserve archive-only language and retain failed basket items with messages
  after partial failures.

## Task-Level Definition of Done

- [ ] Objective is complete.
- [ ] Verification evidence is recorded.
- [ ] No unresolved P1/P2 review findings remain.
- [ ] Shared-context updates, if any, are proposed for controller reconciliation.

## Validation Steps

- `npm --prefix ui run test -- --run src/components/SearchPage.test.tsx`
- `npm --prefix ui run typecheck`
- `npm test -- tests/contract/rest-api.test.ts`
- Manual/browser validation from
  `../../shared-context/resources/validation-strategy.md`

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

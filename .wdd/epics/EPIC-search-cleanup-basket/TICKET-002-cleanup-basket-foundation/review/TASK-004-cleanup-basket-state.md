---
id: TASK-004-cleanup-basket-state
kind: task
epic: EPIC-search-cleanup-basket
ticket: TICKET-002-cleanup-basket-foundation
wave: WAVE-001
slug: cleanup-basket-state
title: Cleanup Basket State
status: review
depends_on: []
conflict_domains:
  - ui/src/hooks/useCleanupBasket.ts
  - ui/src/hooks/useCleanupBasket.test.ts
  - ui/src/lib/types.ts
assigned_model_class: implementationSimple
review_model_class: review
branch: codex/task/TASK-004-cleanup-basket-state
worker_worktree: /Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-004-cleanup-basket-state
worktree_status: verified
pr: null
worker_thread_id: 019ec5db-dcf3-7cd2-90b5-44ce10a46b67
current_gate: no_pr
branch_freshness: current_at_dispatch
verification:
  - npm --workspace ui run test -- --run ui/src/hooks/useCleanupBasket.test.ts
  - npm --workspace ui run typecheck
---

# TASK-004-cleanup-basket-state: Cleanup Basket State

## Status

review

## Parent Ticket

TICKET-002-cleanup-basket-foundation

## Wave

WAVE-001

## Objective

Create a reusable cleanup basket state layer with localStorage persistence,
API-key-scoped storage keying, item dedupe, malformed-storage tolerance, and
archive-result application helpers.

## Scope

- Included:
  - Basket item type with display snapshot fields.
  - Versioned localStorage key using an API-key fingerprint.
  - Add, remove, clear, mark-failed, and remove-archived behavior.
  - Tests for dedupe, persistence, malformed storage, and archive result
    application.
- Excluded:
  - SearchPage checkbox UI.
  - Review drawer component.
  - Backend route.

## Non-Scope

- Do not store raw API key in the basket storage key.
- Do not treat basket snapshots as authoritative entity data.

## Relevant Context

### Local Context

- `ui/src/App.tsx`
- `ui/src/hooks/useQueue.test.ts` for hook test style
- `ui/src/lib/types.ts`

### Shared Context References

- `../../shared-context/index.md`
- `../../shared-context/resources/architecture.md`
- `../../shared-context/resources/discovered-conventions.md`
- `../../shared-context/resources/testing-strategy.md`

## Likely Files / Areas

- `ui/src/hooks/useCleanupBasket.ts`
- `ui/src/hooks/useCleanupBasket.test.ts`
- `ui/src/lib/types.ts`

## Dependencies

- None.

## Conflict Domains

- cleanup basket hook/types
- localStorage persistence behavior

## Assigned Model Class

implementationSimple

## Branch

codex/task/TASK-004-cleanup-basket-state

## Worker Worktree

Assigned path:
`/Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-004-cleanup-basket-state`

Status: verified.

Worker: Kant (`019ec5db-dcf3-7cd2-90b5-44ce10a46b67`).

## PR / Patch Reference

None yet.

## RED-GREEN TDD Plan

### RED

Add failing hook/helper tests for initial load, malformed storage, dedupe,
remove, clear, successful archive cleanup, and failed archive retention.

### GREEN

Implement the hook/helper with guarded localStorage reads/writes and stable
basket item updates.

### REFACTOR

Extract pure reducer/helper functions if that makes the tests clearer and keeps
React hook code small.

## Implementation Notes

- Worker must inspect named files before broad discovery.
- Worker must start in the assigned worktree path provided by the controller.
- Worker must confirm this task file and current orchestration state exist in
  the assigned worktree before editing.
- Worker must not switch branches in the controller checkout.
- Worker must stay within this task scope.
- Worker must not start dependent tasks.

## Durable Memory Notes To Consider

- Record final storage-key format if it differs from the shared context.

## Task-Level Definition of Done

- [x] Objective is complete.
- [x] Verification evidence is recorded.
- [x] No unresolved P1/P2 review findings remain.
- [x] Shared-context updates, if any, are proposed for controller reconciliation.

## Validation Steps

- `npm --workspace ui run test -- --run ui/src/hooks/useCleanupBasket.test.ts`
- `npm --workspace ui run typecheck`

## Verification Evidence

- RED: `npm --prefix ui run test -- --run src/hooks/useCleanupBasket.test.ts`
  failed before implementation with 8 behavioral failures after a compile-only
  hook stub was added. The first test-only run failed earlier because
  `ui/src/hooks/useCleanupBasket.ts` did not exist.
- GREEN: `npm --prefix ui run test -- --run src/hooks/useCleanupBasket.test.ts`
  passed: 1 test file, 8 tests.
- GREEN: `npm --prefix ui run typecheck` passed.
- Controller-specified validation caveat:
  `npm --workspace ui run test -- --run ui/src/hooks/useCleanupBasket.test.ts`
  and `npm --workspace ui run typecheck` both failed before execution with
  `No workspaces found: --workspace=ui`; the root `package.json` does not
  declare `ui` as an npm workspace. Equivalent `npm --prefix ui ...` commands
  above were used for validation.

## Review Feedback

### P1

- None.

### P2

- None.

### P3

- None.

## Completion Notes

- Added `ui/src/hooks/useCleanupBasket.ts` with display-snapshot basket items,
  versioned API-key-scoped localStorage keying, guarded malformed-storage reads,
  ID dedupe, add/remove/clear/mark-failed/remove-archived behavior, and archive
  result application helpers.
- Storage key format is `pgm_cleanup_basket:v1:<api-key-fingerprint>` and does
  not include the raw API key.
- Added `ui/src/hooks/useCleanupBasket.test.ts` covering storage keying,
  persisted load, malformed storage recovery, dedupe, remove/clear, failed
  marking, and successful/failed archive result application.
- Shared-context update needed: none required. Controller may optionally record
  the exact storage-key format in task findings for downstream UI workers.

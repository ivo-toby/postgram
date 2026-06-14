---
id: TASK-001-bulk-archive-service
kind: task
epic: EPIC-search-cleanup-basket
ticket: TICKET-001-backend-bulk-archive
wave: WAVE-001
slug: bulk-archive-service
title: Bulk Archive Service
status: done
depends_on: []
conflict_domains:
  - src/services/entity-service.ts
  - tests/integration/entity-service.test.ts
  - src/auth/**
  - src/util/audit.ts
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-001-bulk-archive-service
worker_worktree: /Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-001-bulk-archive-service
worktree_status: verified
pr: local-merge:a593403
worker_thread_id: 019ec5db-dc36-7c70-8e8d-a34629d5c1da
current_gate: merged
branch_freshness: current_at_merge
verification:
  - npm test -- tests/integration/entity-service.test.ts
---

# TASK-001-bulk-archive-service: Bulk Archive Service

## Status

done

## Parent Ticket

TICKET-001-backend-bulk-archive

## Wave

WAVE-001

## Objective

Implement and test `bulkArchiveEntities` in `src/services/entity-service.ts`
with explicit ID dedupe, per-entity delete access checks, soft archive
semantics, audit entries, and partial failure reporting.

## Scope

- Included:
  - Service-layer input/result types as needed.
  - Server-side ID dedupe.
  - Existing delete/type/visibility access checks per entity.
  - `status = 'archived'` mutation for allowed IDs.
  - Audit entry per archived entity using operation `delete`.
  - Integration tests for allowed, duplicate, missing, and inaccessible IDs.
- Excluded:
  - REST route or Zod schema.
  - UI API client.
  - Query-level archive.

## Non-Scope

- Do not change existing `softDeleteEntity` behavior except for safe helper
  extraction that preserves current semantics.

## Relevant Context

### Local Context

- `src/services/entity-service.ts`
- `tests/integration/entity-service.test.ts`
- `src/auth/key-service.ts`
- `src/util/audit.ts`
- `src/util/errors.ts`

### Shared Context References

- `../../shared-context/index.md`
- `../../shared-context/resources/architecture.md`
- `../../shared-context/resources/api-contract.md`
- `../../shared-context/resources/discovered-conventions.md`
- `../../shared-context/resources/testing-strategy.md`

## Likely Files / Areas

- `src/services/entity-service.ts`
- `tests/integration/entity-service.test.ts`

## Dependencies

- None.

## Conflict Domains

- `src/services/entity-service.ts`
- `tests/integration/entity-service.test.ts`
- auth/delete semantics
- audit behavior

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-001-bulk-archive-service

## Worker Worktree

Assigned path:
`/Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-001-bulk-archive-service`

Status: verified.

Worker: Gauss (`019ec5db-dc36-7c70-8e8d-a34629d5c1da`).

## PR / Patch Reference

None yet.

## RED-GREEN TDD Plan

### RED

Add failing integration tests for `bulkArchiveEntities` covering successful
archive, duplicate ID dedupe, missing ID failure, inaccessible visibility/type
failure, and audit entries.

### GREEN

Implement the service with sequential per-ID processing, existing access
helpers, `status = 'archived'`, and mixed `archived` / `failed` result arrays.

### REFACTOR

Extract small shared helpers only if they reduce duplication with
`softDeleteEntity` without changing its behavior.

## Implementation Notes

- Worker must inspect named files before broad discovery.
- Worker must start in the assigned worktree path provided by the controller.
- Worker must confirm this task file and current orchestration state exist in
  the assigned worktree before editing.
- Worker must not switch branches in the controller checkout.
- Worker must stay within this task scope.
- Worker must not start dependent tasks.

## Durable Memory Notes To Consider

- Record any changed delete/audit semantics in shared context.

## Task-Level Definition of Done

- [x] Objective is complete.
- [x] Verification evidence is recorded.
- [x] No unresolved P1/P2 review findings remain.
- [x] Shared-context updates, if any, are proposed for controller reconciliation.

## Validation Steps

- `npm test -- tests/integration/entity-service.test.ts`

## Verification Evidence

- RED: `npm test -- tests/integration/entity-service.test.ts` failed before
  implementation with 2 expected failures:
  `(0 , bulkArchiveEntities) is not a function`.
- GREEN: `npm test -- tests/integration/entity-service.test.ts` passed:
  1 test file, 13 tests.
- Additional: `npm run typecheck` passed.
- Additional: `git diff --check` passed.
- Review: Halley (`019ec5eb-3863-7422-8c2e-6111a0749619`) returned
  `REVIEW_PASS` with no P1/P2/P3 findings.
- Controller verification after merge: `npm test --
  tests/integration/entity-service.test.ts` passed on
  `codex/epic/search-cleanup-basket` at `a593403`: 1 test file, 13 tests.
- Merge: task branch merged into epic branch in local merge commit `a593403`.

## Review Feedback

### P1

- None.

### P2

- None.

### P3

- None.

## Completion Notes

- Added `bulkArchiveEntities` service API with exported input/result types.
- Deduplicates explicit IDs in stable input order before mutation.
- Reuses the same archive helper from `softDeleteEntity` for delete scope,
  type access, visibility access, `status = 'archived'`, and `delete` audit
  entries.
- Returns mixed `archived` and `failed` arrays for per-ID missing or
  inaccessible entities while leaving failed entities unmodified.
- Added integration coverage for successful archive, duplicate IDs, missing
  IDs, type and visibility failures, audit entries, and missing delete scope.
- Shared-context update needed: none.
- Final gate: merged into `codex/epic/search-cleanup-basket`.

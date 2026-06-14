---
id: TASK-001-bulk-archive-service
kind: task
epic: EPIC-search-cleanup-basket
ticket: TICKET-001-backend-bulk-archive
wave: WAVE-001
slug: bulk-archive-service
title: Bulk Archive Service
status: in_progress
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
pr: null
worker_thread_id: 019ec5db-dc36-7c70-8e8d-a34629d5c1da
current_gate: no_pr
branch_freshness: current_at_dispatch
verification:
  - npm test -- tests/integration/entity-service.test.ts
---

# TASK-001-bulk-archive-service: Bulk Archive Service

## Status

in_progress

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

- [ ] Objective is complete.
- [ ] Verification evidence is recorded.
- [ ] No unresolved P1/P2 review findings remain.
- [ ] Shared-context updates, if any, are proposed for controller reconciliation.

## Validation Steps

- `npm test -- tests/integration/entity-service.test.ts`

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

---
id: TICKET-001-backend-bulk-archive
kind: ticket
epic: EPIC-search-cleanup-basket
slug: backend-bulk-archive
title: Backend Bulk Archive
status: in_progress
task_count: 2
depends_on: []
conflict_domains:
  - src/services/entity-service.ts
  - src/transport/rest.ts
  - tests/integration/entity-service.test.ts
  - tests/contract/rest-api.test.ts
adapter_links:
  github_issue: null
---

# Backend Bulk Archive

## Summary

Add the backend service and REST contract that archives reviewed explicit
entity IDs with per-ID access checks and partial failure reporting.

## Objective

Provide a tested backend bulk archive-by-IDs operation for the Search cleanup
basket UI.

## Scope

- Included:
  - `bulkArchiveEntities` service behavior.
  - `POST /api/entities/bulk/archive`.
  - Request validation for UUID IDs and max batch size.
  - Backend service and REST contract tests.
- Excluded:
  - UI basket state.
  - Search page selection.
  - Hard delete or query-level archive.

## Non-Scope

- Do not add MCP or CLI bulk archive.
- Do not change existing single-delete semantics except shared helper extraction
  needed for code reuse.

## Shared Context References

- `../shared-context/index.md`
- `../shared-context/resources/architecture.md`
- `../shared-context/resources/api-contract.md`
- `../shared-context/resources/discovered-conventions.md`
- `../shared-context/resources/testing-strategy.md`

## Task Inventory

| Task | Status | Wave | Summary |
|------|--------|------|---------|
| TASK-001-bulk-archive-service | done | WAVE-001 | Add service-layer bulk archive with tests |
| TASK-002-rest-bulk-archive-endpoint | todo | WAVE-002 | Add REST route, validation, and contract tests |

## Dependencies

- Depends on: none.
- Blocks: UI review/archive integration.

## Conflict Domains

- `src/services/entity-service.ts`
- `src/transport/rest.ts`
- `tests/integration/entity-service.test.ts`
- `tests/contract/rest-api.test.ts`

## Validation Expectations

- `npm test -- tests/integration/entity-service.test.ts`
- `npm test -- tests/contract/rest-api.test.ts`

## Review Focus

- Authorization and visibility/type access behavior.
- Partial failure shape.
- Audit entries.
- No hard-delete path.
- No query-level archive path.

## Completion Criteria

- [ ] All child tasks have resolved review and verification gates.
- [ ] Shared context updates were reconciled.
- [ ] Ticket status matches child task state.

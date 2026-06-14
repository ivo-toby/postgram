---
id: TICKET-002-cleanup-basket-foundation
kind: ticket
epic: EPIC-search-cleanup-basket
slug: cleanup-basket-foundation
title: Cleanup Basket Foundation
status: in_progress
task_count: 2
depends_on: []
conflict_domains:
  - ui/src/lib/api.ts
  - ui/src/lib/api.test.ts
  - ui/src/hooks/useCleanupBasket.ts
  - ui/src/hooks/useCleanupBasket.test.ts
adapter_links:
  github_issue: null
---

# Cleanup Basket Foundation

## Summary

Add the UI API client helper and persistent cleanup basket state layer that
later Search UI tasks can consume.

## Objective

Create reusable frontend foundations for bulk archive calls and localStorage
basket persistence without coupling them directly to SearchPage layout.

## Scope

- Included:
  - Typed `bulkArchiveEntities(ids)` UI API helper.
  - API client test coverage.
  - Basket state/hook with localStorage persistence and dedupe.
  - Basket reducer tests, including malformed localStorage handling.
- Excluded:
  - Search result card checkboxes.
  - Review drawer UI.
  - Backend service or REST route implementation.

## Non-Scope

- Do not implement SearchPage integration in this ticket except exporting
  usable APIs/components for later tasks.

## Shared Context References

- `../shared-context/index.md`
- `../shared-context/resources/architecture.md`
- `../shared-context/resources/api-contract.md`
- `../shared-context/resources/discovered-conventions.md`
- `../shared-context/resources/testing-strategy.md`

## Task Inventory

| Task | Status | Wave | Summary |
|------|--------|------|---------|
| TASK-003-ui-bulk-archive-api-client | in_progress | WAVE-001 | Add UI API client method and tests |
| TASK-004-cleanup-basket-state | in_progress | WAVE-001 | Add persistent basket state/hook and tests |

## Dependencies

- Depends on: none.
- Blocks: Search selection, review drawer, and final integration.

## Conflict Domains

- `ui/src/lib/api.ts`
- `ui/src/lib/api.test.ts`
- `ui/src/hooks/useCleanupBasket.ts`
- `ui/src/hooks/useCleanupBasket.test.ts`
- `ui/src/lib/types.ts`

## Validation Expectations

- `npm --workspace ui run test -- --run ui/src/lib/api.test.ts`
- Focused UI hook/reducer test command for the basket state file.
- `npm --workspace ui run typecheck`

## Review Focus

- API endpoint shape matches shared contract.
- Basket localStorage key does not store raw API key in the key name.
- Malformed localStorage does not break Search rendering.
- Basket items dedupe by ID.

## Completion Criteria

- [ ] All child tasks have resolved review and verification gates.
- [ ] Shared context updates were reconciled.
- [ ] Ticket status matches child task state.

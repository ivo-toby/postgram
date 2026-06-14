---
id: TICKET-004-review-archive-integration
kind: ticket
epic: EPIC-search-cleanup-basket
slug: review-archive-integration
title: Review Drawer And Archive Integration
status: planned
task_count: 2
depends_on:
  - TICKET-001-backend-bulk-archive
  - TICKET-002-cleanup-basket-foundation
  - TICKET-003-search-selection
conflict_domains:
  - ui/src/components/SearchPage.tsx
  - ui/src/components/CleanupBasketDrawer.tsx
  - ui/src/components/CleanupBasketDrawer.test.tsx
  - ui/src/components/SearchPage.test.tsx
adapter_links:
  github_issue: null
---

# Review Drawer And Archive Integration

## Summary

Add the cleanup basket review drawer and wire the complete select, review,
archive, success cleanup, and failure retention flow into the Search page.

## Objective

Complete the user-facing cleanup workflow and validate it end to end.

## Scope

- Included:
  - Cleanup basket review drawer.
  - Counts by type/status/visibility.
  - Item removal and clear basket.
  - Final archive action through `api.bulkArchiveEntities`.
  - Successful archive cleanup in Search state.
  - Failed item retention with messages.
  - Focused tests and manual/browser validation notes.
- Excluded:
  - Backend endpoint implementation.
  - Query-level archive.
  - Hard delete.

## Non-Scope

- Do not add new global navigation surfaces beyond a Search header basket
  button/count.

## Shared Context References

- `../shared-context/index.md`
- `../shared-context/resources/architecture.md`
- `../shared-context/resources/api-contract.md`
- `../shared-context/resources/discovered-conventions.md`
- `../shared-context/resources/testing-strategy.md`
- `../shared-context/resources/validation-strategy.md`

## Task Inventory

| Task | Status | Wave | Summary |
|------|--------|------|---------|
| TASK-006-cleanup-basket-review-drawer | todo | WAVE-003 | Add review drawer component and archive action tests |
| TASK-007-search-cleanup-flow-integration | todo | WAVE-004 | Integrate complete flow and run final validation |

## Dependencies

- Depends on:
  - TICKET-001-backend-bulk-archive (done through WAVE-002)
  - TICKET-002-cleanup-basket-foundation (done through WAVE-001)
  - TICKET-003-search-selection (done through WAVE-002)
- Blocks:
  - Epic validation.

## Conflict Domains

- `ui/src/components/SearchPage.tsx`
- `ui/src/components/CleanupBasketDrawer.tsx`
- `ui/src/components/CleanupBasketDrawer.test.tsx`
- `ui/src/components/SearchPage.test.tsx`

## Validation Expectations

- Focused drawer/SearchPage component tests.
- `npm --prefix ui run typecheck`
- Focused backend/REST/UI tests from dependencies if integration changes their
  contracts.
- Manual/browser pass from validation strategy.

## Review Focus

- The archive button communicates archive-only behavior.
- Success removes archived IDs from visible UI state.
- Partial failures remain visible and retryable.
- Drawer is usable on desktop and mobile layouts.

## Completion Criteria

- [ ] All child tasks have resolved review and verification gates.
- [ ] Shared context updates were reconciled.
- [ ] Ticket status matches child task state.

---
id: TICKET-003-search-selection
kind: ticket
epic: EPIC-search-cleanup-basket
slug: search-selection
title: Search Result Selection
status: done
task_count: 1
depends_on:
  - TICKET-002-cleanup-basket-foundation
conflict_domains:
  - ui/src/components/SearchPage.tsx
  - ui/src/components/SearchPage.test.tsx
adapter_links:
  github_issue: null
---

# Search Result Selection

## Summary

Add checkbox, select-all-loaded, shift-click range selection, and an
add-to-basket action bar to Search results while preserving normal card detail
navigation.

## Objective

Let users quickly select loaded search results and add them to the cleanup
basket.

## Scope

- Included:
  - Checkbox selection on result cards.
  - Select-all-loaded for current visible results.
  - Shift-click visible range selection.
  - Selected-count action bar.
  - Add selected entities to basket and clear selection.
  - Focused component/helper tests.
- Excluded:
  - Review drawer.
  - Final archive mutation.
  - Backend API work.

## Non-Scope

- Do not add query-level archive.
- Do not make card body clicks toggle selection.

## Shared Context References

- `../shared-context/index.md`
- `../shared-context/resources/architecture.md`
- `../shared-context/resources/discovered-conventions.md`
- `../shared-context/resources/testing-strategy.md`

## Task Inventory

| Task | Status | Wave | Summary |
|------|--------|------|---------|
| TASK-005-search-result-selection | done | WAVE-002 | Add Search result selection and selected action bar |

## Dependencies

- Depends on:
  - TICKET-002-cleanup-basket-foundation
- Blocks:
  - TICKET-004-review-archive-integration

## Conflict Domains

- `ui/src/components/SearchPage.tsx`
- `ui/src/components/SearchPage.test.tsx`
- Search result card UI

## Validation Expectations

- Focused SearchPage/component tests for selection behavior.
- `npm --prefix ui run typecheck`

## Review Focus

- Checkbox clicks do not open detail.
- Card body clicks still open detail.
- Shift-click range uses current visible result order.
- Select-all-loaded affects loaded visible results only.

## Completion Criteria

- [x] All child tasks have resolved review and verification gates.
- [x] Shared context updates were reconciled.
- [x] Ticket status matches child task state.

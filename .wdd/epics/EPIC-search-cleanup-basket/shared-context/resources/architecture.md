---
id: EPIC-search-cleanup-basket-RESOURCE-architecture
kind: shared_context_resource
epic: EPIC-search-cleanup-basket
resource: architecture
updated_at: 2026-06-14
---

# Shared Context Resource: Architecture

## Purpose

Orient workers on the current and target architecture for the Search cleanup
basket feature.

## Summary

This epic adds a UI-collected cleanup basket and a backend-authorized bulk
archive endpoint. The UI can collect entity IDs aggressively, but the backend
must authorize and archive each ID.

## Current Architecture

Search UI:

- `ui/src/components/SearchPage.tsx` owns search filters, semantic/list
  fetches, result rendering, selected detail state, and single-entity delete
  state updates.
- `ResultCard` and `DetailPanel` are local subcomponents in `SearchPage.tsx`.
- Single delete calls `api.deleteEntity(entity.id)` from the detail panel and
  removes the entity from visible results via `removeEntity`.
- Search results can come from semantic search (`api.searchEntities`) or list
  browse (`api.listEntities`).
- Semantic mode fetches up to `SEMANTIC_MAX = 50`; browse mode pages with
  `PAGE_SIZE = 20` and infinite scroll.

Backend:

- `src/services/entity-service.ts` implements `softDeleteEntity` by requiring
  delete scope, fetching the entity, checking type and visibility access, and
  setting `status = 'archived'`.
- `src/transport/rest.ts` registers `DELETE /api/entities/:id` and maps service
  entities into snake_case REST payloads.
- REST request validation uses Zod schemas near the top of `rest.ts`.
- Audit entries are written through `appendAuditEntry`.

UI API:

- `ui/src/lib/api.ts` has typed methods wrapping REST calls and common
  unauthorized handling.
- The active API key is stored in localStorage under `pgm_api_key` by
  `ui/src/App.tsx`.

## Target Architecture

Backend target:

- Add `bulkArchiveEntities(pool, auth, { ids })` in
  `src/services/entity-service.ts`.
- Add `POST /api/entities/bulk/archive` in `src/transport/rest.ts`.
- Request shape: `{ "ids": ["uuid-1", "uuid-2"] }`.
- Response shape: `{ archived: [{ id }], failed: [{ id, code, message }] }`.
- Use the same archive semantics as `softDeleteEntity`: `status = 'archived'`.
- Return partial results for expected per-ID failures.

Frontend target:

- Add `api.bulkArchiveEntities(ids)` to `ui/src/lib/api.ts`.
- Add a cleanup basket state layer, preferably as a focused hook.
- Add selection helpers for checkbox, select-all-loaded, and shift-click
  visible range selection.
- Add a selected-results action bar.
- Add a review drawer for basket counts, item removal, clear basket, final
  archive, success cleanup, and failure retention.

## Data Flow

1. Search/list loads visible result items.
2. User toggles result checkboxes.
3. Shift-click selection uses the current visible result order.
4. User adds selected result snapshots to the cleanup basket.
5. Basket persists in localStorage with a versioned API-key-scoped key.
6. User opens review drawer and confirms archive.
7. UI sends basket IDs to the backend bulk archive endpoint.
8. Backend archives authorized IDs and returns archived/failed lists.
9. UI removes archived IDs from visible results, fetched detail, selected IDs,
   and basket.
10. UI keeps failed IDs in the basket with error messages.

## Architectural Risks

- Avoid turning `SearchPage.tsx` into a monolith. Extract hooks/components when
  they isolate real state or UI complexity.
- Avoid trusting basket snapshots for backend behavior. Snapshots are display
  data only.
- Avoid all-or-nothing bulk archive semantics; the product contract expects
  partial success.
- Avoid query-level archive affordances in this epic.

## Durable Memory

### Approved Search Cleanup Basket Design

- Source task: epic start context
- Source PR/branch: current controller worktree
- Status: confirmed
- Summary: Approved design is persistent UI cleanup basket, explicit-ID backend
  bulk archive, review drawer, archive-only soft delete, and partial failure
  reporting.
- Why it matters: Future tasks should not introduce hard delete or query-level
  archive while implementing this epic.
- Affected files or areas: Search UI, UI API client, entity service, REST
  transport, entity/REST/UI tests.
- Follow-up implications: Query-level cleanup requires a separate design with
  dry-run preview and stronger confirmations.

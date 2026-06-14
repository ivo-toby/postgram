# Search Cleanup Basket - Design Spec

**Date:** 2026-06-14
**Status:** Approved

---

## Overview

Add a cleanup workflow to the Postgram Search page so stale memories,
unwanted interactions, duplicate persons, and other unwanted entities can be
collected from search results and archived in one reviewed action.

The feature is intentionally archive-only. It does not add hard delete and it
does not archive by query. Search remains the discovery surface; the cleanup
basket is the explicit review surface; the backend remains the authority for
what can actually be archived.

---

## Goals

- Make it fast to collect many entities from the current Search UI.
- Support checkbox selection, select-all-loaded, and shift-click range
  selection in visible result order.
- Let cleanup span multiple searches through a persistent basket.
- Require a review drawer before any bulk archive mutation.
- Archive selected entities through a backend bulk-by-IDs endpoint with per-ID
  authorization and partial failure reporting.
- Keep archived entities recoverable through existing archived visibility
  behavior.

## Non-Goals

- No permanent hard delete.
- No archive-all-current-query or archive-all-filter-matches action.
- No MCP or CLI bulk archive command in the first implementation.
- No graph edge deletion or cleanup beyond existing soft-delete behavior.
- No changes to semantic search scoring or list pagination behavior.
- No new entity status taxonomy.

---

## Current Context

`ui/src/components/SearchPage.tsx` already owns search filters, semantic/list
loading, result cards, selected detail state, and single-entity deletion from
the detail panel. Single delete calls `DELETE /api/entities/:id`, and the
backend implements that as a soft delete by setting `status = 'archived'`.

The Tasks page has a useful precedent for selection and partial bulk failure
handling in `ui/src/components/TasksPage.tsx` and
`ui/src/components/tasks/BulkActionBar.tsx`, but the Search cleanup workflow
needs a persistent basket because cleanup often spans several searches.

The UI stores the active API key in `localStorage` as `pgm_api_key`. The cleanup
basket can use that context to derive a local storage key and avoid obvious
cross-login basket bleed in the same browser.

---

## User Experience

Search result cards gain checkbox selection without replacing normal result
navigation:

- Clicking the card body still opens the entity detail panel.
- Clicking the checkbox toggles that result.
- Shift-clicking a checkbox selects the range between the last checkbox action
  and the clicked result, using the currently visible result order.
- A select-all-loaded checkbox selects or clears the currently loaded results.
- Selection is page-local and represents visible/loaded results only.

When at least one result is selected, a compact selection bar appears near the
search header or result list:

- `N selected`
- `Add to cleanup basket`
- `Clear selection`

Adding to the basket stores lightweight entity snapshots and deduplicates by
entity ID. The current selection clears after a successful add.

A basket button/count remains visible in the Search header. Opening it shows a
review drawer. The drawer includes:

- Total basket count.
- Counts by entity type.
- Counts by status.
- Counts by visibility.
- Scrollable entity list with type, status, visibility, updated date, tags, and
  content preview.
- Remove-one and clear-basket actions.
- Final `Archive N entities` action.

After successful archive:

- Archived IDs are removed from the current search results and fetched detail
  item if present.
- Archived IDs are removed from the basket.
- The basket is cleared when all items archived successfully.
- Failed items remain in the basket with an error marker and message.

---

## Basket Persistence

The cleanup basket persists in `localStorage`, scoped to the current browser
and active API key context.

Use a versioned key, such as:

```text
pgm_cleanup_basket_v1:<api-key-fingerprint>
```

The fingerprint is only a local collision-avoidance detail, not a security
boundary. A simple deterministic client-side hash of the current API key is
enough because the API key itself is already stored locally by the app.

Basket items store only display snapshots needed for review:

```ts
type CleanupBasketItem = {
  id: string;
  type: string;
  content: string | null;
  status: string | null;
  visibility: string;
  owner: string | null;
  tags: string[];
  updated_at: string;
  added_at: string;
  error?: string;
};
```

The basket reducer should tolerate malformed storage by dropping invalid
entries and preserving only items with a usable ID. It should not block Search
page rendering if localStorage fails.

---

## Backend API

Add an explicit-ID bulk archive endpoint:

```http
POST /api/entities/bulk/archive
Content-Type: application/json

{ "ids": ["uuid-1", "uuid-2"] }
```

Response:

```json
{
  "archived": [{ "id": "uuid-1" }],
  "failed": [
    {
      "id": "uuid-2",
      "code": "FORBIDDEN",
      "message": "Entity not found or not deletable"
    }
  ]
}
```

Request behavior:

- Validate `ids` as a non-empty array of UUID strings.
- Cap the batch size at 500 IDs.
- Deduplicate IDs server-side while preserving stable reporting.
- Require `delete` scope before mutation.
- Apply existing type and visibility access checks per entity.
- Archive by setting `status = 'archived'`, matching current single delete.
- Write one audit entry per archived entity. Use operation `delete` to remain
  consistent with current soft-delete audit vocabulary unless audit reporting
  needs a separate `bulk_archive` operation later.
- Return partial results instead of failing the whole batch for expected per-ID
  failures.

Expected per-ID failures include missing entity, forbidden entity, invalid
state, and unexpected service error. The API should avoid revealing more detail
than existing recall/delete behavior reveals to the authenticated caller.

---

## Service Design

Add a service function named `bulkArchiveEntities` in
`src/services/entity-service.ts`, rather than looping over the HTTP
single-delete endpoint from the UI.

Suggested shape:

```ts
type BulkArchiveResult = {
  archived: Array<{ id: string }>;
  failed: Array<{ id: string; code: string; message: string }>;
};
```

The service can share the same access rules as `softDeleteEntity`:

- Fetch each entity by ID.
- Require delete access.
- Check type access.
- Check visibility access.
- Update allowed entities to `status = 'archived'`.
- Append one audit entry per archived entity.

The implementation may process IDs sequentially in one service call for clearer
per-ID error isolation. It does not need all-or-nothing transaction semantics,
because the UX and API intentionally support partial success.

If performance becomes a problem later, the service can be optimized with a
bulk fetch and per-row access filtering, but the first version should optimize
for correctness and audit clarity.

---

## Frontend Architecture

Keep `SearchPage.tsx` from absorbing all new behavior directly. Extract focused
units where useful:

- `useCleanupBasket` hook for reducer, localStorage persistence, dedupe, and
  archive-result application.
- `CleanupBasketDrawer` component for review and final archive.
- `SearchSelectionBar` component for selected-count, add-to-basket, and clear
  actions.
- Small selection helpers for shift-click range selection and select-all-loaded
  behavior.

`SearchPage` still coordinates data flow:

1. Search/list loading produces visible result items.
2. Selection state tracks visible selected IDs and last checkbox action.
3. `Add selected` maps selected IDs to current result entity snapshots and adds
   them to the cleanup basket.
4. `CleanupBasketDrawer` calls `api.bulkArchiveEntities(ids)` after final
   confirmation.
5. Successful archived IDs are removed from results, fetched detail, selected
   IDs, and basket state.
6. Failed IDs remain in the basket with error details.

`ui/src/lib/api.ts` gets a typed method:

```ts
bulkArchiveEntities(ids: string[]): Promise<{
  archived: Array<{ id: string }>;
  failed: Array<{ id: string; code: string; message: string }>;
}>
```

---

## Error Handling

Selection and basket errors should be recoverable:

- If localStorage read fails, start with an empty basket and continue.
- If localStorage write fails, keep in-memory basket state and show a concise
  warning.
- Duplicate adds are ignored and should not be counted as failures.
- If a basket item is no longer returned by search, it can still be reviewed
  and archived by ID.

Archive errors are partial:

- Successful IDs are removed from current UI state.
- Failed IDs remain in the review drawer.
- The drawer reports `Archived X entities. Y failed.`
- Each failed item shows its error message.
- The user can remove failed items, retry, or clear the basket.

Unauthorized responses continue to use the existing API client logout behavior.

---

## Testing Plan

Backend:

- Unit or integration coverage for `bulkArchiveEntities`.
- Deduplicates duplicate IDs.
- Archives allowed entities.
- Rejects inaccessible type/visibility combinations.
- Reports missing IDs as failures without failing the whole batch.
- Writes audit entries for archived entities.

REST contract:

- `POST /api/entities/bulk/archive` validates body shape and UUIDs.
- Requires delete scope.
- Enforces max batch size.
- Returns mixed archived/failed results.
- Leaves failed entities unmodified.

Frontend:

- Basket reducer dedupes IDs and persists to localStorage.
- Malformed localStorage payload is tolerated.
- Checkbox toggles selection without opening detail.
- Shift-click selects a visible range.
- Select-all-loaded affects only loaded visible results.
- Add-to-basket stores entity snapshots and clears selection.
- Review drawer removes one item and clears all.
- Successful archive removes archived IDs from basket and visible results.
- Partial archive failure leaves failed items in basket with messages.

Manual/browser pass:

- Search for entities.
- Select several visible results with checkbox and shift-click.
- Add selected entities to the basket.
- Navigate away or reload and confirm the basket persists.
- Open review drawer, remove one item, archive the rest.
- Confirm archived entities disappear when archived entities are hidden.
- Confirm failed archive items remain visible in the drawer.

---

## Rollout Scope

Ship this as one cohesive Search cleanup feature. Do not add query-level archive
or hard delete during this work. If query-level cleanup becomes useful later,
design it separately with dry-run counts, stronger confirmations, and a backend
preview endpoint.

The implementation should be split so backend API work and frontend basket work
can be tested independently, then integrated in the Search page.

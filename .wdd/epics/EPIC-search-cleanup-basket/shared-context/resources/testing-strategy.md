---
id: EPIC-search-cleanup-basket-RESOURCE-testing-strategy
kind: shared_context_resource
epic: EPIC-search-cleanup-basket
resource: testing-strategy
updated_at: 2026-06-14
---

# Shared Context Resource: Testing Strategy

## Purpose

Guide workers on expected tests for backend, REST, UI API, basket state, Search
selection, and review drawer behavior.

## Summary

This epic has enough auth/delete risk to require backend and REST tests, plus
enough UI state to require component/helper coverage. Use focused tests during
tasks, then broaden before epic validation.

## Backend Tests

Likely file: `tests/integration/entity-service.test.ts`.

Cover `bulkArchiveEntities`:

- Archives allowed entities and returns their IDs in `archived`.
- Deduplicates duplicate IDs.
- Reports missing IDs in `failed`.
- Reports type/visibility inaccessible IDs in `failed`.
- Leaves failed entities unmodified.
- Writes audit entries for archived entities.
- Does not require all-or-nothing transaction semantics.

Use existing helpers:

- `createTestDatabase`
- `resetTestDatabase`
- `seedApiKey`
- `storeEntity`
- `makeAuthContext` style local helper

## REST Contract Tests

Likely file: `tests/contract/rest-api.test.ts`.

Cover `POST /api/entities/bulk/archive`:

- Requires auth and delete scope.
- Validates body shape.
- Validates UUID IDs.
- Rejects empty ID arrays.
- Enforces max batch size of 500.
- Returns mixed archived/failed response.
- Does not mutate failed IDs.

Follow existing Hono `app.request(...)` patterns.

## UI API Tests

Likely file: `ui/src/lib/api.test.ts`.

Run focused UI API tests from the repository root with:

```bash
npm --prefix ui run test -- --run src/lib/api.test.ts
```

Cover:

- `bulkArchiveEntities(['id-1', 'id-2'])` POSTs to
  `/api/entities/bulk/archive`.
- Sends JSON body `{ ids: [...] }`.
- Includes authorization and content-type headers.
- Returns typed archived/failed payload.

## UI Component / Helper Tests

Likely new or existing files:

- `ui/src/components/SearchPage.test.tsx`
- `ui/src/components/CleanupBasketDrawer.test.tsx`
- `ui/src/hooks/useCleanupBasket.test.ts`
- pure helper tests if selection logic is extracted.

Run focused UI helper/component checks from the repository root with
`npm --prefix ui`, for example:

```bash
npm --prefix ui run test -- --run src/hooks/useCleanupBasket.test.ts
npm --prefix ui run typecheck
```

Cover:

- Basket reducer dedupes IDs.
- Basket persists to localStorage and tolerates malformed localStorage.
- Checkbox toggles selection without opening detail.
- Shift-click selects visible ranges.
- Select-all-loaded affects only loaded visible results.
- Add-to-basket stores entity snapshots and clears current selection.
- Review drawer removes one item and clears all.
- Successful archive removes archived IDs from basket and visible results.
- Partial failure leaves failed items in basket with error messages.

## Test Data Notes

Use realistic entity snapshots containing:

- `id`
- `type`
- `content`
- `status`
- `visibility`
- `owner`
- `tags`
- `updated_at`

Do not rely on generated embeddings or graph expansion for cleanup basket UI
tests.

## Durable Memory

### Verification Expectations

- Source task: epic start context
- Source PR/branch: current controller worktree
- Status: confirmed
- Summary: Backend auth/delete behavior and UI localStorage/selection behavior
  both need tests before integration is considered complete.
- Why it matters: This feature can archive many entities; tests must prove both
  safety gates and partial failure UX.
- Affected files or areas: backend integration tests, REST contract tests, UI
  API tests, Search component tests, basket hook/helper tests.
- Follow-up implications: If workers split UI state into hooks/helpers, prefer
  unit tests for pure state and component tests for user flows.

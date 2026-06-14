---
id: EPIC-search-cleanup-basket-RESOURCE-api-contract
kind: shared_context_resource
epic: EPIC-search-cleanup-basket
resource: api-contract
updated_at: 2026-06-14
---

# Shared Context Resource: API Contract

## Purpose

Pin the bulk archive API contract for backend, REST, and UI API workers.

## Summary

The feature archives explicit entity IDs only. The UI sends reviewed basket IDs
to one backend endpoint. The backend validates the request, applies delete
scope plus per-entity access checks, archives authorized IDs, and returns mixed
success/failure results.

## REST Endpoint

```http
POST /api/entities/bulk/archive
Content-Type: application/json

{ "ids": ["uuid-1", "uuid-2"] }
```

## Response Shape

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

## Request Rules

- `ids` must be a non-empty array.
- Each ID must match the existing UUID regex convention from `rest.ts`.
- Maximum request size is 500 IDs.
- Server deduplicates IDs before mutation.
- Expected failures are per-ID and should not fail the whole batch.

## Backend Semantics

- Require delete scope before mutation.
- For each entity, apply existing type and visibility checks.
- Archive by setting `status = 'archived'`.
- Use audit operation `delete` for consistency with existing soft delete.
- Avoid leaking more detail than existing recall/delete behavior.

## UI Client Contract

`ui/src/lib/api.ts` should expose:

```ts
bulkArchiveEntities(ids: string[]): Promise<{
  archived: Array<{ id: string }>;
  failed: Array<{ id: string; code: string; message: string }>;
}>
```

The UI should treat `archived` IDs as successful and remove them from local
results and basket state. The UI should keep `failed` IDs in the basket with
messages.

## Non-Contract

- No hard delete.
- No query-level archive.
- No archive by filter.
- No MCP/CLI tool in this epic.

## Durable Memory

### Contract Decision

- Source task: WDD planning
- Source PR/branch: controller worktree
- Status: confirmed
- Summary: Bulk archive is an explicit-ID REST contract with partial
  archived/failed response.
- Why it matters: UI tasks can code against this contract without waiting for
  route implementation details, while backend tasks preserve delete authority.
- Affected files or areas: `src/services/entity-service.ts`,
  `src/transport/rest.ts`, `ui/src/lib/api.ts`, related tests.
- Follow-up implications: Query-level archive needs a separate preview contract
  and is out of scope.

# Archived Entity Visibility — Design Spec

**Date:** 2026-04-26
**Status:** Approved

## Problem

Archived entities (soft-deleted via `status = 'archived'`) are currently visible by default in all UI views, and returned by `GET /api/entities` and `GET /api/tasks`. Only the search service already excludes them. This causes noise — archived items represent intentionally retired data and should be hidden unless explicitly requested.

## Goal

- Exclude archived entities from all default list/search results across all transports (REST, MCP, CLI, UI)
- Provide an explicit opt-in flag at each layer to include archived items when needed
- Add a `pgm-admin purge` command to permanently delete archived entities (with embeddings and edges), with filtering options

## Approach: Service Layer Default Exclusion (Option A)

Business logic lives in the service layer. All transports pass the flag through; no transport-specific duplication.

---

## Section 1: Service Layer

**File:** `src/services/entity-service.ts`

- Add `includeArchived?: boolean` to `ListEntitiesOptions` interface (default `false`)
- Modify `listEntities()` SQL WHERE clause: when `includeArchived` is false/absent, add `AND (status IS DISTINCT FROM 'archived')`
- Add `includeArchived?: boolean` to task list options (same default and SQL pattern)

**File:** `src/services/search-service.ts`

- Add `includeArchived?: boolean` to search options (default `false`)
- Make the existing hardcoded `WHERE e.status IS DISTINCT FROM 'archived'` conditional on this flag

---

## Section 2: REST API

**File:** `src/transport/rest.ts`

- `GET /api/entities` — add `include_archived` query param (boolean string, default `false`); parse and pass to `listEntities()`
- `GET /api/tasks` — add `include_archived` query param (same pattern)
- `POST /api/search` — add `include_archived` body field (boolean, default `false`); pass to `searchEntities()`

No breaking changes. Callers that omit the flag get the new default (archived excluded).

---

## Section 3: MCP Server

**File:** `src/transport/mcp.ts`

- `search` tool — add optional `include_archived: boolean` input field (default `false`); pass to `searchEntities()`
- `task_list` tool — add optional `include_archived: boolean` input field (default `false`); pass to `listTasks()`

---

## Section 4: CLI (`pgm`)

**File:** `cli/src/pgm.ts`

- `pgm list` — add `--include-archived` flag (boolean, off by default); pass as `include_archived=true` query param when set
- `pgm search` — add `--include-archived` flag; pass in request body
- `pgm task list` — add `--include-archived` flag; pass as `include_archived=true` query param when set

---

## Section 5: UI

**File:** `ui/src/components/SearchPage.tsx` (and `ProjectorPage.tsx` if it has its own entity fetch)

- Remove `'archived'` from the `ALL_STATUSES` array (and thus from the status filter chips)
- Add a **"Show archived"** checkbox in the filter panel, below the status chips
- Unchecked by default; when unchecked, requests omit `include_archived` (or pass `false`)
- When checked, requests pass `include_archived: true` — archived items are shown *in addition to* whatever status filter chips are active, not replacing them
- Applies to both the search/list view and the graph/projector view

---

## Section 6: `pgm-admin purge`

**File:** `src/cli/admin/pgm-admin.ts`

New command: `pgm-admin purge [options]`

### Flags

| Flag | Description |
|------|-------------|
| `--type <type>` | Limit purge to a specific entity type |
| `--older-than <duration>` | Only purge archived items where `updated_at` is older than this (e.g. `30d`, `7d`) |
| `--owner <owner>` | Limit to a specific owner namespace |
| `--dry-run` | Print count and a sample; make no changes |

### Execution (non-dry-run)

1. Query `entities` WHERE `status = 'archived'` AND filters applied
2. For each matched entity (in a transaction):
   - DELETE from `embeddings` WHERE `entity_id = id`
   - DELETE from `edges` WHERE `source_id = id` OR `target_id = id`
   - DELETE from `entities` WHERE `id = id`
3. Print final count of permanently deleted entities

Uses direct DB access (same pattern as `reembed`/`reextract` admin commands), not the HTTP API.

### Duration parsing

`--older-than` accepts a duration string with `d` (days) or `w` (weeks) — e.g. `30d`, `7d`, `4w` — parsed into a PostgreSQL interval for the `updated_at < NOW() - INTERVAL` condition. Month (`m`) is intentionally excluded to avoid minutes/months ambiguity.

---

## Out of Scope

- No pagination changes
- No change to how `DELETE /api/entities/:id` works (still soft-deletes to archived)
- No change to extraction/reembed exclusion logic (already excludes archived)
- No UI for `purge` — admin CLI only

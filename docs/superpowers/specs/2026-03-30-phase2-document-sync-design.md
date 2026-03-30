# Phase 2: Document Sync — Design Spec

**Date:** 2026-03-30
**Scope:** Push-based document sync from local markdown repos into postgram
**Migration:** `003_document_sync.sql`

---

## Overview

Sync local directories of markdown files into postgram as `document` entities. The CLI walks the filesystem, computes SHA-256 hashes, and sends a full manifest to the server. The server diffs against stored state and creates, updates, or archives entities accordingly. The existing enrichment worker handles chunking and embedding — documents become searchable via the same hybrid search as any other entity.

**Key decisions:**
- Markdown files only (`.md`) for Phase 2
- Full repo sync (no partial `--path` filter)
- SHA-256 of raw file content (no git dependency)
- Full manifest comparison — server diffs, CLI is stateless
- MCP support via `sync_push` and `sync_status` tools

---

## Schema

New `document_sources` table tracking which files are synced from which repo.

```sql
CREATE TABLE document_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  repo        text NOT NULL,
  path        text NOT NULL,
  sha         text NOT NULL,
  last_synced timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'current' CHECK (sync_status IN ('current', 'stale', 'error')),

  UNIQUE (repo, path)
);

CREATE INDEX idx_document_sources_repo ON document_sources (repo);
CREATE INDEX idx_document_sources_entity_id ON document_sources (entity_id);
```

**Design notes:**
- `UNIQUE (repo, path)` prevents duplicate tracking of the same file
- `ON DELETE CASCADE` cleans up document_sources when an entity is deleted
- `entity_id` links to an entity with `type = 'document'`
- `sha` is the SHA-256 hex digest of raw file content
- `sync_status`: `current` (SHA matches), `stale` (file deleted from disk), `error` (sync failed)

**Relationship to existing tables:**
```
document_sources.entity_id → entities.id ← chunks.entity_id
```
Documents are entities. Chunks are created by the enrichment worker. No FK from chunks to document_sources needed.

---

## Sync Service

New `src/services/sync-service.ts` with two functions.

### `syncManifest`

```typescript
type SyncManifestInput = {
  repo: string;
  files: Array<{ path: string; sha: string; content: string }>;
};

type SyncResult = {
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
};

function syncManifest(
  pool: Pool,
  auth: AuthContext,
  input: SyncManifestInput
): ServiceResult<SyncResult>
```

**Logic (single transaction):**

1. Require `write` and `delete` scopes on the auth context.
2. Fetch all existing `document_sources` rows for the given `repo`.
3. Build a map of `path → { entity_id, sha }` from the existing rows.
4. Iterate incoming files:
   - **Path not in DB (new):** Insert entity (type=document, visibility=shared, metadata includes repo+path, content=file content). Insert document_sources row. Count as `created`.
   - **Path in DB, SHA differs (changed):** Fetch current entity version, update entity content via entity-service (passes current version for optimistic locking, triggers enrichment_status=pending and enrichment_attempts=0). Update document_sources SHA + last_synced + sync_status=current. Count as `updated`.
   - **Path in DB, SHA matches (unchanged):** Touch last_synced. Count as `unchanged`.
5. Find paths in DB that are not in the incoming manifest (deleted from disk):
   - Soft-delete the entity (status=archived).
   - Set document_sources sync_status=stale.
   - Count as `deleted`.
6. Audit log: `sync.complete` with repo name and counts.
7. Return `{ created, updated, unchanged, deleted }`.

**Entity metadata for synced documents:**
```json
{
  "repo": "personal-notes",
  "path": "ideas/project-alpha.md",
  "title": "Project Alpha"
}
```
Title is extracted from the first `# heading` in the markdown content, or the filename without extension if no heading found.

### `getSyncStatus`

```typescript
type SyncStatusEntry = {
  path: string;
  sha: string;
  syncStatus: string;
  lastSynced: string;
  entityId: string;
};

function getSyncStatus(
  pool: Pool,
  auth: AuthContext,
  repo: string
): ServiceResult<SyncStatusEntry[]>
```

Returns all tracked files for a repo. Used by the CLI for dry-run mode and by the `sync_status` MCP tool.

---

## REST Endpoints

### `POST /api/sync`

Triggers a sync operation.

**Request:**
```json
{
  "repo": "personal-notes",
  "files": [
    { "path": "ideas/project-alpha.md", "sha": "a1b2c3...", "content": "# Project Alpha\n..." },
    { "path": "notes/2026-03-30.md", "sha": "d4e5f6...", "content": "Today I learned..." }
  ]
}
```

**Response:** `200 OK`
```json
{
  "created": 3,
  "updated": 1,
  "unchanged": 12,
  "deleted": 0
}
```

**Validation:** `repo` required, non-empty. `files` required, array. Each file must have `path`, `sha`, `content` as non-empty strings.

**Auth:** Requires `write` and `delete` scopes.

### `GET /api/sync/status/:repo`

Returns current sync state for a repo.

**Response:** `200 OK`
```json
{
  "repo": "personal-notes",
  "files": [
    { "path": "ideas/project-alpha.md", "sha": "a1b2c3...", "syncStatus": "current", "lastSynced": "2026-03-30T10:00:00Z", "entityId": "550e8400-..." },
    { "path": "old-file.md", "sha": "x9y8z7...", "syncStatus": "stale", "lastSynced": "2026-03-29T08:00:00Z", "entityId": "661f9511-..." }
  ]
}
```

**Auth:** Requires `read` scope.

---

## MCP Tools

### `sync_push`

```typescript
{
  name: "sync_push",
  description: "Sync a document repository. Sends a manifest of files with content and SHA-256 hashes. Creates new documents, updates changed ones, archives deleted ones.",
  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string", description: "Repository identifier (e.g. 'personal-notes')" },
      files: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            sha: { type: "string" },
            content: { type: "string" }
          },
          required: ["path", "sha", "content"]
        }
      }
    },
    required: ["repo", "files"]
  }
}
// Returns: { created, updated, unchanged, deleted }
```

### `sync_status`

```typescript
{
  name: "sync_status",
  description: "Get the sync status of a document repository. Returns tracked files with paths, SHA hashes, and sync status.",
  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string", description: "Repository identifier" }
    },
    required: ["repo"]
  }
}
// Returns: { repo, files: [{ path, sha, syncStatus, lastSynced, entityId }] }
```

---

## CLI: `pgm sync`

```bash
pgm sync ~/Documents/personal-notes
pgm sync ~/Documents/cf-notes --repo cf-notes --quiet
pgm sync ~/Documents/personal-notes --dry-run
```

| Flag | Default | Description |
|------|---------|-------------|
| `--repo <name>` | Directory basename | Repo identifier stored in document_sources |
| `--quiet` | false | Suppress output (for cron) |
| `--dry-run` | false | Show what would change without syncing |
| `--json` | false | JSON output |

**CLI logic:**
1. Walk `<repo-path>` recursively for `*.md` files (skip hidden dirs like `.git`, `node_modules`).
2. For each file: read content, compute `crypto.createHash('sha256').update(content).digest('hex')`.
3. **Dry-run mode:** Fetch `GET /api/sync/status/:repo`, diff locally, print summary without syncing.
4. **Normal mode:** Send full manifest to `POST /api/sync`, print summary.

**Output:**
```
Synced personal-notes: 3 created, 1 updated, 12 unchanged, 0 deleted
```

**Quiet mode:** No output on success. Non-zero exit code on failure.

**Cron usage:**
```bash
*/30 * * * * PGM_API_URL=https://postgram.example.com PGM_API_KEY=pgm-... /usr/local/bin/pgm sync ~/Documents/personal-notes --quiet
```

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/db/migrations/003_document_sync.sql` | document_sources table |
| Create | `src/services/sync-service.ts` | syncManifest, getSyncStatus |
| Modify | `src/transport/rest.ts` | POST /api/sync, GET /api/sync/status/:repo |
| Modify | `src/transport/mcp.ts` | sync_push, sync_status tools |
| Modify | `src/cli/pgm.ts` | sync command |
| Modify | `src/cli/client.ts` | syncRepo, getSyncStatus methods |
| Create | `tests/unit/sync-manifest.test.ts` | Manifest diff logic, title extraction |
| Create | `tests/integration/sync-service.test.ts` | Full sync lifecycle |
| Modify | `tests/contract/rest-api.test.ts` | Sync endpoints |
| Modify | `tests/contract/mcp-tools.test.ts` | Sync MCP tools |
| Modify | `tests/integration/cli-pgm.test.ts` | pgm sync command |

---

## Testing Strategy

- **Unit tests:** SHA-256 computation, manifest diff classification (new/changed/unchanged/deleted), title extraction from markdown
- **Integration tests:** sync-service full lifecycle — initial sync creates entities + document_sources rows, re-sync with file changes updates content and resets enrichment, re-sync with file removal archives entity and sets sync_status=stale
- **Contract tests:** REST POST /api/sync returns correct counts, GET /api/sync/status/:repo returns file list; MCP sync_push and sync_status parity with REST
- **CLI test:** pgm sync against a temp directory with markdown files, verify round-trip; dry-run mode shows diff without changing state

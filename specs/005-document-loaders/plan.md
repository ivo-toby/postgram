# Implementation Plan: Document Loaders

Read `spec.md` first. This plan gives the design decisions that the tasks share.

## 1. Source material

The old branch is `origin/claude/pluggable-document-loaders-TsAd6`. Read a file from it with:

```bash
git show "origin/claude/pluggable-document-loaders-TsAd6:src/types/loader.ts"
```

Copy these modules and their unit tests, then adapt them to this plan:

| Old file | New file | Change |
| --- | --- | --- |
| `src/types/loader.ts` | same | Add `'document'` to `AttachmentKind`. Add optional `filename` to the `localPath` input. |
| `src/services/loaders/accept.ts` | same | None expected. |
| `src/services/loaders/registry.ts` | same | Add a method that returns all accepted MIME types and extensions of enabled loaders. |
| `src/services/loaders/in-process-importer.ts` | same | Resolve the package from a list of root directories, in order. |
| `src/services/loaders/sidecar-client.ts` | same | None expected. |
| `src/services/loaders/build-registry.ts` | same | Pass the root directories. |
| `src/types/postgram-config.ts` | `src/types/loaders-config.ts` | Remove `attachmentsDir`. Make `pluginsDir` optional. |
| `src/services/loaders/config-loader.ts` | same | If no path is set, return the built-in default configuration. |
| `src/services/loaders/flatten.ts` | `src/services/loaders/render.ts` | Keep only the block to text rendering. Add page markers and transcript time stamps. Remove chunk drafts. |
| `src/services/loaders/attachment-store.ts` | same | See section 4. |

Do not copy `persist.ts`, `document-ingest-service.ts`, the migration, or the changes to `index.ts`, `rest.ts`, `mcp.ts` and `enrichment-worker.ts`. The tasks rewrite them.

The old code uses a different Prettier style (trailing commas). Format copied files with the repository configuration.

## 2. Data model

Migration file: `src/db/migrations/019_document_loaders.sql`.

```sql
ALTER TABLE entities
  ADD COLUMN mime_type text,
  ADD COLUMN loading_status text
    CHECK (loading_status IN ('pending', 'running', 'completed', 'failed')),
  ADD COLUMN loading_error text,
  ADD COLUMN loading_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN loader_name text;

CREATE INDEX idx_entities_loading_status
  ON entities (loading_status)
  WHERE loading_status IS NOT NULL;

CREATE TABLE attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('original', 'derived')),
  ref         text NOT NULL,
  kind        text NOT NULL
    CHECK (kind IN ('document', 'image', 'audio', 'video', 'binary')),
  mime_type   text NOT NULL,
  filename    text,
  byte_size   bigint NOT NULL CHECK (byte_size >= 0),
  sha256      text NOT NULL,
  storage_uri text NOT NULL,
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, ref)
);

CREATE INDEX idx_attachments_entity_id ON attachments (entity_id);
CREATE INDEX idx_attachments_sha256 ON attachments (sha256);
CREATE UNIQUE INDEX idx_attachments_one_original
  ON attachments (entity_id)
  WHERE role = 'original';
```

The original attachment has `ref = 'original'`. A derived attachment uses the `ref` that the loader gives.

## 3. Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `LOADERS_ENABLED` | `false` | Turns on ingest, the loading stage and the attachment endpoints. |
| `LOADERS_CONFIG_PATH` | not set | Path to a loader configuration file. If not set, the built-in default applies. |
| `ATTACHMENTS_DIR` | `/var/lib/postgram/attachments` | Root of the attachment store. |
| `INGEST_MAX_BYTES` | `52428800` | Largest accepted upload. |
| `LOADER_TIMEOUT_MS` | `600000` | Timeout of one loader call. A sidecar entry can set a shorter `timeoutMs`. |

The built-in default configuration registers one loader:

```json
{
  "version": 1,
  "loaders": [
    {
      "kind": "in-process",
      "name": "pdf",
      "package": "@ivotoby/postgram-loader-pdf",
      "accepts": { "mimeTypes": ["application/pdf"], "extensions": [".pdf"] }
    }
  ]
}
```

Package resolution order for an in-process loader:

1. If the configuration file sets `pluginsDir`, that directory.
2. The server application root. First-party loaders are npm workspace packages, so they resolve from there in development and in the Docker image.

## 3a. Loader selection

One function selects the loader for the ingest endpoint and for the worker: `resolveByTypeOrName({ mimeType, filename })`.

1. Remove parameters from the MIME type and make it lowercase.
2. If the type is not empty and not `application/octet-stream`, match on the MIME type only. If a loader matches, the effective type is the given type.
3. If step 2 gives no match, match on the file extension only. The effective type is then the first concrete MIME type of the selected loader.

The entity stores the effective type in `mime_type`.

## 3b. Loader output rules

The host passes each loader result through `parseLoaderResult`. An invalid result is an error. This applies to in-process loaders and to sidecars. A sidecar cannot return an attachment as a file path. It sends attachment bytes as base64.

## 4. Attachment store

`FilesystemAttachmentStore` in `src/services/loaders/attachment-store.ts`:

- `put(bytes)` writes to `<root>/<sha[0..2]>/<sha>` and returns `{ sha256, byteSize, storageUri }`. Write to a temporary name in the same directory, then rename. If the target exists with the same size, skip the write.
- `resolvePath(storageUri)` returns the local path. It accepts only the key pattern below.
- `openReadStream(storageUri)` returns a readable stream.
- `listFiles()` yields `{ sha256, path }` for garbage collection.
- `remove(sha256)` deletes one file.
- `removeStaleTempFiles(olderThanMs)` deletes temporary files that a crash left behind.

`storage_uri` is a relative key: `<first 2 hex chars>/<sha256>`. It has no absolute path, so the store root can move.

## 5. Ingest service

File: `src/services/document-ingest-service.ts`. Function: `ingestDocument(auth, input, deps)`.

Steps:

1. Require the `write` scope. Apply the same type and visibility checks as `storeEntity`. Resolve the owner the same way as `storeEntity`.
2. Resolve the effective MIME type. If the given type is empty or `application/octet-stream`, map the file extension through the registry.
3. Resolve the loader. If none matches, return an error that the transport maps to `415`.
4. Compute the SHA-256 of the bytes.
5. Open a transaction. Take `pg_advisory_xact_lock` on a hash of `ingest:<sha256>`.
6. Look for an existing entity: an `original` attachment with this SHA-256 whose entity has the same owner and visibility and is not archived.
7. If one exists, return it with `status: 'exists'`. If its `loading_status` is `failed` and its attempts are used up, set it to `pending` with zero attempts first.
8. If none exists, write the file to the store. Insert the entity and the attachment row. Commit.
9. Write the same audit log entry kind that `storeEntity` writes, with operation `document.ingest`.

The inserted entity: `type = 'document'`, `content = NULL`, `source = 'ingest'`, `mime_type`, `loading_status = 'pending'`, `enrichment_status = NULL`, `metadata.title`, `metadata.filename`.

## 6. REST endpoints

All in `src/transport/rest.ts`. If `LOADERS_ENABLED` is true, register all three routes. If it is false, register only the ingest route, and that route answers `503`.

| Route | Result |
| --- | --- |
| `POST /api/documents/ingest` | `202` created, `200` exists, `413`, `415`, `503` |
| `GET /api/entities/:id/attachments` | `{ attachments: [...] }` |
| `GET /api/attachments/:id/content` | The bytes |

Use the `bodyLimit` middleware from `hono/body-limit` for the size limit.

An attachment in a response has: `id`, `entity_id`, `role`, `ref`, `kind`, `mime_type`, `filename`, `byte_size`, `sha256`, `created_at`. It does not include `storage_uri`.

For `Content-Disposition`, use `attachment` with an ASCII fallback name and an RFC 5987 `filename*` value.

If the error code set has no value for `413`, `415` or `503`, add the values and map them in the error handler.

## 7. Worker loading stage

In `src/services/enrichment-worker.ts`, add `processNextLoadingEntity` and call it in `runOnce` before the enrichment loop. If the worker options contain no registry or no attachment store, the stage does nothing.

Claim query conditions:

```sql
loading_status = 'pending'
OR (loading_status = 'failed' AND loading_attempts < 3
    AND updated_at < now() - interval '5 minutes')
OR (loading_status = 'running'
    AND updated_at < now() - interval '15 minutes')
```

After the claim:

1. Read the `original` attachment. Build a `localPath` input.
2. Resolve the loader. If none matches, mark the row `failed` with `no_loader`.
3. Call `load` with a timeout signal. Race the call against the timeout, because an in-process loader can ignore the signal.
4. Store derived attachments. Render the blocks to text.
5. In one transaction: set `content`, merge loader metadata into `metadata.loader`, set `loader_name`, set `loading_status = 'completed'`, clear the error. If the text is not empty, set `enrichment_status = 'pending'`. If the text is empty, set `enrichment_status = 'completed'`.
6. On an error: set `loading_status = 'failed'`, increase `loading_attempts`, and store `<loader name>: <message>`.

Loader metadata must not overwrite `metadata.title` or `metadata.filename`. Store it under `metadata.loader`.

## 8. PDF loader package

Directory: `packages/loader-pdf`. Package name: `@ivotoby/postgram-loader-pdf`. It is private and is a workspace of the root package.

- Follow the build setup of the `cli` workspace.
- Use a pure JavaScript PDF text library with a permissive license and no native code. `unpdf` is the first candidate. Make sure that the license is compatible with the license of this repository.
- The package must not import from the server `src` directory at run time. Copy the few contract types it needs, or use `import type`.

## 9. Docker

- `Dockerfile`: build the loader package and include it in the final image so that the workspace link resolves.
- `docker-compose.yml`: pass the five variables and add a named volume at `ATTACHMENTS_DIR`. The directory must be writable by the `node` user.
- Update `.env.example` and the README configuration table.

## 10. Test strategy

Follow red/green TDD: write a failing test, then the code.

- Unit tests in `tests/unit` for the pure modules.
- Integration tests in `tests/integration` for the migration, the ingest service and the worker stage. They use the Postgres test container helper in `tests/helpers/postgres.ts`.
- Contract tests in `tests/contract` for the REST routes.
- One end-to-end integration test. It ingests a real PDF fixture through the real PDF loader. It runs the worker with the deterministic embedding service and finds the text with search.

Each task finishes with `npm run typecheck`, `npm run lint` and the related tests green. The last task runs the full suite.

# Feature Specification: Document Loaders

**Feature branch**: `005-document-loaders`
**Created**: 2026-11-12
**Status**: Approved for implementation
**Replaces**: PR #38 (`specs/003-pluggable-document-loaders` on branch `claude/pluggable-document-loaders-TsAd6`)

## 1. Why

Postgram stores text only. A PDF, an image, a voice note or a Word file must be converted to text outside the system before you can store it.

This feature adds a loader plugin structure. A loader is a plugin that converts one file format to text. A client uploads a file, the server keeps the original, and a loader converts it. The text then goes through the existing chunk, embed and extract pipeline.

The long-term goal is a native Mac share target that sends documents to Postgram. This feature builds the server side that such a client needs. The Mac client is a separate feature.

## 2. Relation to PR #38

PR #38 designed and partly built this. Its design is kept: the `DocumentLoader` contract, the typed block output, in-process loaders and sidecar loaders. Its self-contained modules are copied. Its integration code is rewritten for current main.

These parts of PR #38 change:

| PR #38 | This feature | Reason |
| --- | --- | --- |
| Uploads stored as `<random>.bin` in an uploads folder that is never cleaned | The upload is written once, to the attachment store, as the original attachment | No temporary files. The original stays available. |
| Filename is lost | Filename and title are kept | A share target needs them. |
| No way to download an attachment | List and download endpoints | A client must be able to get the original back. |
| `block_kind` and `block_metadata` columns on `chunks`, never filled | No chunk columns. Page and time markers are written into the text. | Chunks are rebuilt from `entities.content` on each re-embed, so chunk columns do not survive. |
| URL ingest with a global unique index on `source_uri` | No URL ingest. File uploads only. | The index leaked entity ids between owners. Server-side URL fetch is a request forgery risk. The browser extension already clips pages. |
| Admin endpoints guarded by the `delete` scope | No admin endpoints | Main has a separate admin authentication system. Loader administration in the admin UI is a follow-up. |
| MCP `document_ingest` tool with base64 input | A `pgm ingest <file>` CLI command | Base64 through MCP is slow and costs context tokens. |
| No loaders | One first-party loader: PDF | Proves the structure end to end. |
| Migration `008`, spec `003` | Migration `019`, spec `005` | The old numbers are in use on main. |

## 3. Scope

### In scope

1. The loader contract and the registry, copied from PR #38 and adapted.
2. An attachment store on the local filesystem and an `attachments` table.
3. `POST /api/documents/ingest` for multipart file uploads.
4. Endpoints to list and download the attachments of an entity.
5. A loading stage in the enrichment worker, before chunking.
6. A first-party PDF loader as a separate package, `packages/loader-pdf`.
7. A `pgm ingest <file>` command in the CLI.
8. Docker, environment and documentation updates.

### Out of scope

- The Mac share client.
- URL ingest.
- Loaders for images, audio, Word and Pages. See section 9.
- Loader access to the server's LLM and embedding providers. See section 9.
- Loader administration in the admin UI.
- An MCP ingest tool.
- Attachment display in the web UI.
- Multimodal embeddings.
- Object storage (S3) for attachments.

## 4. User stories

### Story 1: Ingest a PDF (P1)

You upload a PDF. You get an entity id back at once. A short time later the document text is searchable.

Acceptance, with the PDF loader registered:

1. When you POST a PDF to `/api/documents/ingest`, the response status is `202`. The body is `{ id, status: "created", loading_status: "pending" }`.
2. When the worker runs, `loading_status` becomes `completed`. The `content` column holds the extracted text with page markers.
3. After embedding, `enrichment_status` is `completed`.
4. When you search for a phrase from page 3, the entity is in the results.
5. When you list the attachments of the entity, you get one attachment with role `original`. It has the uploaded filename, MIME type, size and SHA-256.
6. When you download that attachment, the bytes equal the uploaded file.

### Story 2: Idempotent re-ingest (P1)

You share the same file twice. You get the same entity back and no duplicate.

Acceptance, after a first ingest of a file:

1. When the same owner uploads identical bytes with the same visibility, the response status is `200`. The body has `status: "exists"` and the first entity id.
2. When a different owner uploads identical bytes, the server creates a new entity.
3. When the first entity is archived and you upload the same bytes, the server creates a new entity.

### Story 3: Clear failures (P1)

Acceptance:

1. If no loader accepts the MIME type or the file extension, the response status is `415`. The server creates no entity and no file. The response lists the accepted MIME types and extensions.
2. If the file is larger than `INGEST_MAX_BYTES`, the response status is `413`.
3. If loaders are not enabled, the response status is `503`.
4. If a loader throws on a corrupt file, `loading_status` becomes `failed`. The `loading_error` column holds the loader name and the message. The server keeps the original attachment.
5. The worker tries a failed row again after 5 minutes, up to 3 attempts.
6. If the server stops while a row is `running`, the worker claims the row again after 15 minutes.
7. If a loader returns no text, `loading_status` is `completed`, `content` stays null, and `enrichment_status` is `completed`.

### Story 4: Operator adds a loader (P2)

Acceptance:

1. If a loader package is in the plugins directory and has an entry in the loader configuration file, the server registers it at start. The start log lists it.
2. If a loader package fails to import, the server still starts. The log shows the failure, and the other loaders work.
3. If the configuration file has a sidecar entry, the server registers the sidecar through the sidecar client.

### Story 5: Ingest from the command line (P2)

Acceptance, with a configured CLI:

1. When you run `pgm ingest report.pdf`, the CLI uploads the file. It prints the entity id and the status.
2. With `--wait`, the CLI polls the entity. It stops after loading and enrichment finish or fail. On failure, the exit code is not zero.

## 5. Functional requirements

### Loader contract

- **FR-1**: A loader exports an object with `name`, `version`, `accepts` and `load(input, ctx)`. The types live in `src/types/loader.ts`.
- **FR-2**: `load` returns a `LoaderResult`: `documentType`, ordered `blocks`, optional `attachments`, optional `metadata`.
- **FR-3**: A loader does not write to the database. The host owns persistence.
- **FR-4**: The registry selects the enabled loader with the highest priority whose `accepts` matches the MIME type or the file extension. Configuration order breaks a tie.
- **FR-5**: The host passes the stored original to the loader as a `localPath` input with the MIME type and the filename.

### Text rendering

- **FR-6**: The host renders blocks to Markdown text and stores it in `entities.content`.
- **FR-7**: When the `page` value in block metadata changes, the host writes a line `[page N]` before the block.
- **FR-8**: A transcript block renders as `[mm:ss] speaker: text`. The speaker part is optional. For one hour or more the format is `[h:mm:ss]`.
- **FR-9**: Heading, code and table blocks render as Markdown. An image block contributes its OCR text, or its caption, or its alt text.

### Persistence

- **FR-10**: Migration `019_document_loaders.sql` adds these nullable columns to `entities`: `mime_type`, `loading_status` (`pending`, `running`, `completed`, `failed`), `loading_error`, `loader_name`. It adds `loading_attempts integer NOT NULL DEFAULT 0`. Existing rows keep `loading_status` null.
- **FR-11**: The migration creates the `attachments` table. See `plan.md` for the columns.
- **FR-12**: Attachment files are content-addressed: `<ATTACHMENTS_DIR>/<first 2 hex chars>/<sha256>`. The same bytes are stored once on disk.
- **FR-13**: Each ingested entity has exactly one attachment with role `original`. Attachments that a loader returns have role `derived`.
- **FR-14**: Deleting an entity deletes its attachment rows (cascade). `pgm-admin attachments gc` deletes files that no row references.
- **FR-15**: The entity gets `type = 'document'`, `metadata.title` (the given title, or the filename), `metadata.filename` and `source = 'ingest'`.

### API

- **FR-16**: `POST /api/documents/ingest` accepts `multipart/form-data` with a required `file` part. Optional fields: `title`, `mime_type`, `visibility`, `owner`, `tags` (comma-separated), `metadata` (JSON object).
- **FR-17**: The endpoint requires the `write` scope and applies the same visibility and type checks as `POST /api/entities`.
- **FR-18**: The endpoint resolves the loader before it stores anything. If the client sends `application/octet-stream` or no type, the host uses the file extension.
- **FR-19**: The endpoint returns at once. Loading runs in the worker.
- **FR-20**: `GET /api/entities/:id/attachments` lists attachments. `GET /api/attachments/:id/content` streams the bytes with `Content-Type`, `Content-Length` and a safe `Content-Disposition`. Both require the `read` scope and apply the same access checks as reading the entity.
- **FR-21**: If they are set, entity responses include `mime_type`, `loading_status`, `loading_error` and `loader_name`.
- **FR-22**: The stored filename is metadata only. The host never uses it as a filesystem path.

### Worker

- **FR-23**: The pipeline order is load, chunk and embed, extract.
- **FR-24**: The worker claims a loading row in a short transaction with `FOR UPDATE SKIP LOCKED` and sets it to `running`. It does not hold a lock during the loader call.
- **FR-25**: Each loader call has a timeout. The default is `LOADER_TIMEOUT_MS`. A sidecar entry can set its own.
- **FR-26**: After a successful load with text, the worker sets `enrichment_status = 'pending'`.
- **FR-27**: Each loader call writes one structured log line: loader, entity id, MIME type, bytes in, text characters out, attachments out, duration, status.

### Configuration

- **FR-28**: `LOADERS_ENABLED` (default `false`) turns the feature on.
- **FR-29**: `LOADERS_CONFIG_PATH` points to the loader configuration file. The Docker image contains a default file that registers the PDF loader.
- **FR-30**: `ATTACHMENTS_DIR`, `INGEST_MAX_BYTES` (default 50 MB) and `LOADER_TIMEOUT_MS` (default 10 minutes) are environment variables.
- **FR-31**: A loader that fails to register does not stop the server.
- **FR-32**: The Docker setup gets the new variables and a volume for attachments, in the same change that adds them.

### PDF loader

- **FR-33**: `packages/loader-pdf` is a separate package with its own dependencies. The server core gets no PDF dependency.
- **FR-34**: The loader returns one text block per page with `metadata.page`. It sets `metadata.pageCount`. If the PDF has a title, the loader sets `metadata.pdfTitle`.
- **FR-35**: The loader stops at `maxPages` (option, default 500) and records `metadata.truncated = true`.
- **FR-36**: A PDF with no text layer returns no blocks. OCR is a follow-up.

## 6. Security

- An in-process loader runs with the full rights of the server process. Install only packages that you trust. The documentation says this.
- Uploaded files are untrusted. The host limits the size. The loader call has a timeout. The PDF loader has a page limit.
- The download endpoint sets `X-Content-Type-Options: nosniff` and `Content-Disposition: attachment`.
- The idempotency check is scoped to owner and visibility, so one owner cannot learn that another owner holds a file.

## 7. Success criteria

- A PDF upload becomes a searchable document without a manual step.
- All existing tests pass without changes to their expectations.
- The server core has no new runtime dependency.
- With `LOADERS_ENABLED=false`, behavior is the same as before this feature.

## 8. Known limits

- An in-process loader runs on the server event loop. During the parse of a large PDF, other requests can be slow.
- The upload is read into memory. The size limit bounds this.
- The loader configuration is a file. A change needs a restart.

## 9. Follow-ups

1. Give loaders access to the configured providers through the loader context. Then build API loaders: OCR for images and scanned PDFs, and transcription for audio.
2. A Word loader.
3. The Mac share client. Convert Pages documents to PDF on the Mac before upload.
4. Loader administration and attachment display in the admin UI and web UI.
5. An MCP tool that returns attachment metadata.

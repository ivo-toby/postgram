# Feature Specification: Pluggable Document Loaders

**Feature Branch**: `003-pluggable-document-loaders`
**Created**: 2026-05-07
**Status**: Proposal — Draft for discussion
**Input**: User request: "Ingest other types of documents (PDFs, images, audio, video, YouTube, Word, etc.) as pluggable npm packages dropped into a mounted folder and registered in postgram config. Think about output format, multimodality, conversion (docker containers per plugin?)."

## 1. Why

Today postgram only ingests text. `entities.content` is `text`, `chunks.content` is `text`, embeddings are text embeddings. The sync pipeline (`src/services/sync-service.ts:1`) reads files and pushes their raw bytes as a `string` into `storeEntity`. Anything that isn't already plain text — PDFs, scanned images, podcasts, meeting recordings, YouTube links, Word docs, HTML pages — has to be converted *outside* the system before it can be stored.

This proposal makes the ingestion pipeline pluggable so:

- A user can install a loader as an npm package, drop it into a mounted directory, register it in `postgram.config.json`, and ingest a new file type — without rebuilding the postgram image.
- Heavyweight, non-JS converters (Whisper for audio, ffmpeg+OCR for video, Tesseract for scanned PDFs) can run as **sidecar Docker containers** that postgram talks to over HTTP, while lightweight pure-JS loaders run in-process.
- The output format is rich enough to express multimodal content (text + images + audio segments + video frames) while remaining backwards-compatible with the current text-only chunking/embedding pipeline.

## 2. Scope

### In scope

1. A **`DocumentLoader` plugin contract** for in-process JS/TS loaders.
2. A **sidecar conversion protocol** (HTTP, JSON over stdin/stdout, or gRPC — see research.md) for non-JS converters running as separate containers.
3. A **`postgram.config.json`** file (loaded alongside env vars) that registers loaders, maps them to MIME types / URL schemes / file extensions, and configures sidecar endpoints.
4. A **mounted plugins directory** (`/etc/postgram/plugins` by default) where users `npm install` loader packages.
5. A **normalised output format** (`LoaderResult` with typed `Block[]`) that the enrichment worker consumes before chunking.
6. **Database schema** additions: an `attachments` table for binary media, a `blocks` representation on chunks (or a new table), and `mime_type` / `source_uri` columns on `entities`.
7. **Backwards compatibility**: existing text-only ingestion continues to work unchanged. The default loader for `text/plain` and `text/markdown` is the current pipeline.
8. **A reference set of first-party loaders** packaged separately so users can opt in:
   - `@postgram/loader-pdf` (in-process, pdf-parse / pdfjs)
   - `@postgram/loader-html` (in-process, readability + turndown)
   - `@postgram/loader-docx` (in-process, mammoth)
   - `@postgram/loader-youtube` (in-process, youtube-transcript)
   - `@postgram/loader-whisper` (sidecar, whisper.cpp)
   - `@postgram/loader-ocr` (sidecar, Tesseract / PaddleOCR)
   - `@postgram/loader-video` (sidecar, ffmpeg keyframes + Whisper transcript)

### Out of scope (this feature)

- **Multimodal embeddings** (CLIP, voyage-multimodal-3). Phase 1 converts everything to text and uses the existing text-embedding pipeline. The data model leaves room for a future `embedding_modality` column and an attachments → image-embedding path; that's a separate spec.
- **Streaming ingestion**. A loader processes one document end-to-end and returns a result; we don't stream partial results into chunks.
- **Plugin marketplace / signing / sandboxing beyond Docker isolation.** Sidecars run in their own containers; in-process loaders run with full Node trust (same as installing any npm dep). We document the trust model but don't ship a vm2-style sandbox.
- **Automatic loader discovery from URLs**. A user (or the sync service) provides a content-type hint or extension; we don't auto-sniff the entire web.

## 3. User Scenarios

### User Story 1 — Install a PDF loader and ingest a PDF (Priority: P1)

As an operator, I run postgram in Docker. I want to add PDF support without rebuilding the image.

**Why P1**: This is the headline use case. If this works end-to-end the rest of the formats fall out by repetition.

**Independent Test**: Mount an empty plugins directory, `npm install @postgram/loader-pdf` into it, add an entry to `postgram.config.json`, restart postgram, POST a PDF to a new `/v1/documents/ingest` endpoint, observe a document entity with extracted text and per-page block metadata, then search for a phrase from page 3 and get the entity back with the matching chunk.

**Acceptance Scenarios**:

1. **Given** `/etc/postgram/plugins/node_modules/@postgram/loader-pdf` exists and is registered in config under `mimeTypes: ["application/pdf"]`, **When** a user POSTs a PDF binary to `/v1/documents/ingest` with `content-type: application/pdf`, **Then** postgram routes the bytes through the PDF loader, persists an `entity` of `type=document` with `mime_type=application/pdf` and `source_uri` echoed back, and creates one or more chunks containing extracted text with `metadata.page` set.
2. **Given** a PDF entity is stored, **When** the enrichment worker has finished, **Then** `enrichment_status=completed`, `chunks` are populated and embedded, and `attachments` rows exist for any extracted images (with `attachments.entity_id` linking back).
3. **Given** the PDF loader throws on a corrupt file, **When** ingestion runs, **Then** the entity is stored with `enrichment_status=failed` and `enrichment_error` contains the loader name plus message; the bytes are retained so a retry can succeed after fixing the loader.
4. **Given** no loader is registered for a posted MIME type, **When** a user attempts to ingest, **Then** the API responds `415 Unsupported Media Type` with a list of registered loaders, and no entity is created.

---

### User Story 2 — Add an audio loader running as a sidecar container (Priority: P1)

As an operator, I want to transcribe podcasts and meeting recordings. Whisper is a Python/C++ workload, not a JS package. I'd rather not embed it inside the postgram process.

**Why P1**: This validates the **sidecar conversion** half of the design — the part the user explicitly asked about (Docker containers for each plugin).

**Independent Test**: Add a `postgram-loader-whisper` service to `docker-compose.yml`. Register it in `postgram.config.json` as a `sidecar` loader for `audio/*`. POST an mp3, observe a document entity, observe chunks containing transcript segments with `metadata.start_seconds` / `metadata.end_seconds`, and a single attachment row pointing at the original mp3 stored on disk.

**Acceptance Scenarios**:

1. **Given** a Whisper sidecar container is running and reachable at `http://loader-whisper:8080`, and is registered in config as `{ kind: "sidecar", endpoint: "http://loader-whisper:8080", mimeTypes: ["audio/mpeg", "audio/wav", "audio/mp4"] }`, **When** a user uploads an mp3, **Then** postgram POSTs the bytes (or a pre-signed local path) to `POST /load` on the sidecar, awaits a `LoaderResult`, and persists transcript blocks as chunks with timestamp metadata.
2. **Given** the sidecar is unreachable, **When** ingestion runs, **Then** the entity is stored with `enrichment_status=failed`, `enrichment_error` includes `sidecar_unreachable: <name>`, and the worker retries up to the configured backoff.
3. **Given** an audio file is over the configured `maxBytes` for the sidecar, **When** a user attempts ingestion, **Then** the API responds `413 Payload Too Large` with the configured limit; no sidecar call is made.

---

### User Story 3 — Ingest a YouTube link (Priority: P2)

As a user, I want to paste a YouTube URL into the `recall`/CLI and have postgram fetch the transcript and ingest it as a document.

**Why P2**: Demonstrates URL-scheme routing (not just MIME types) and validates that loaders can take a `URL` instead of bytes. Lower priority than file uploads because it's easy to work around manually.

**Acceptance Scenarios**:

1. **Given** `@postgram/loader-youtube` is installed and registered for `urlSchemes: ["https"], urlPatterns: ["youtube.com/watch", "youtu.be/"]`, **When** a user POSTs `{ url: "https://youtu.be/..." }` to `/v1/documents/ingest`, **Then** the loader fetches the transcript, returns a `LoaderResult` with text blocks tagged by `start_seconds`, and a `metadata.youtube_id` is preserved on the entity.
2. **Given** the same URL is ingested twice, **When** the second ingest runs, **Then** the system detects the duplicate via `source_uri` uniqueness and returns the existing entity ID with `status: "exists"`.

---

### User Story 4 — Operator inspects what's loaded and disables a misbehaving loader (Priority: P2)

As an operator, I want a health/status view of registered loaders and a way to disable one without editing config and restarting.

**Why P2**: Important for operability but not blocking initial functionality.

**Acceptance Scenarios**:

1. **Given** three loaders are registered, **When** an admin calls `GET /v1/admin/loaders`, **Then** the response lists each loader with `name`, `kind` (in-process | sidecar), `version`, `mimeTypes`, `urlPatterns`, `enabled`, and (for sidecars) a `health` field reflecting the last probe.
2. **Given** a sidecar starts failing, **When** an admin calls `POST /v1/admin/loaders/whisper/disable`, **Then** subsequent ingests for matching MIME types respond `415` until re-enabled, and existing pending entities for that type are not retried.

---

## 4. Functional Requirements

### Loader contract (in-process)

- **FR-1**: A loader package MUST export a default object satisfying `DocumentLoader` (see `contracts/loader-protocol.md`): `{ name, version, accepts, load }`.
- **FR-2**: `accepts` MUST declare zero or more `mimeTypes`, `extensions`, and `urlPatterns`. The plugin host picks the highest-priority loader whose `accepts` matches; ties are broken by config order.
- **FR-3**: `load(input, ctx)` MUST return a `LoaderResult` with normalised `blocks: Block[]`, optional `attachments: AttachmentDraft[]`, and `metadata: Record<string, unknown>`.
- **FR-4**: Loaders MUST be pure functions w.r.t. their inputs except for I/O explicitly granted via `ctx` (a `fetch`, a `tmpDir`, a `logger`, a configured `httpProxy`).
- **FR-5**: Loaders MUST NOT write to the database directly. The plugin host owns persistence.

### Sidecar contract

- **FR-6**: Sidecars MUST expose `POST /load` accepting `multipart/form-data` (one file part `file`, one `application/json` part `meta`) and respond with a `LoaderResult` JSON body.
- **FR-7**: Sidecars MUST expose `GET /healthz` returning `200` when ready and `503` otherwise. The plugin host probes every `healthCheckIntervalMs` (default 30s).
- **FR-8**: Sidecars MUST advertise their `accepts` via `GET /manifest`, returning the same shape as the in-process `accepts`. The host validates this against the user's config at registration time.
- **FR-9**: Communication with sidecars MUST occur over a private Docker network. A `sharedSecret` header MAY be configured; in homelab default deployments it isn't required because the network is private.
- **FR-10**: The host MUST enforce `maxBytes`, `timeoutMs`, and `concurrency` per sidecar from config.

### Plugin discovery & registration

- **FR-11**: At startup, postgram MUST read `postgram.config.json` from `POSTGRAM_CONFIG_PATH` (default `/etc/postgram/postgram.config.json`).
- **FR-12**: For each loader entry of `kind: "in-process"`, the host MUST `import()` the package from the configured `pluginsDir` (default `/etc/postgram/plugins`) using a Node `--experimental-vm-modules`-friendly resolver. The host adds `pluginsDir/node_modules` to its module resolution.
- **FR-13**: For each loader entry of `kind: "sidecar"`, the host MUST hit `GET /manifest` at startup, log the loader's reported version, and warn (not fail) if the manifest disagrees with the user's local config.
- **FR-14**: Loader registration failures MUST NOT prevent the rest of postgram from starting. Failed loaders are listed in the `/v1/admin/loaders` health endpoint with `status: "load_failed"` and a reason.

### Output format

- **FR-15**: A `LoaderResult` MUST include `documentType`, `blocks`, `metadata`, and optionally `attachments`. `blocks` is an ordered array of typed `Block` values (see `contracts/loader-protocol.md`).
- **FR-16**: The enrichment worker MUST flatten `LoaderResult.blocks` into existing `chunks` rows: textual blocks (`text`, `heading`, `code`, `table` rendered as Markdown, `transcript`) become chunk content; non-text blocks (`image`, `audio`, `video`) become `attachments` rows AND optionally contribute their `caption`/`ocrText`/`transcript` as a sibling text chunk so they appear in search.
- **FR-17**: Each chunk MUST carry `metadata` echoed from its source block (e.g. `{ page: 3 }` for PDFs, `{ start_seconds: 124.2, end_seconds: 137.8 }` for audio/video). This is additive to the existing chunks schema.

### Persistence & schema

- **FR-18**: A new `attachments` table stores binary media keyed by `entity_id`: `(id, entity_id, kind, mime_type, byte_size, storage_uri, sha256, metadata jsonb, created_at)`. `storage_uri` points to the configured object store (filesystem path under `/var/postgram/attachments/<sha>` by default; S3-compatible URI when configured).
- **FR-19**: `entities` gains `mime_type text` and `source_uri text` columns (nullable, indexed). Existing rows are unaffected; defaults are NULL.
- **FR-20**: `chunks` gains `block_kind text` (default `'text'`) and `block_metadata jsonb` (default `'{}'`). Existing rows get the defaults via a backfill migration.
- **FR-21**: A unique index on `entities (source_uri) WHERE source_uri IS NOT NULL` makes "ingest the same URL twice" an idempotent upsert.

### Configuration

- **FR-22**: `postgram.config.json` is the authoritative loader registry. Env vars continue to drive embedding/extraction config; loaders aren't shoe-horned into env vars because their config is structured.
- **FR-23**: A schema for `postgram.config.json` MUST be published (Zod, generated to JSON Schema). The CLI gains `pgm-admin config validate` to check a config file before deploy.
- **FR-24**: Hot reload is **not** supported in v1. Adding a loader requires restarting the postgram service. (Sidecars themselves can be restarted independently; their HTTP endpoint is what postgram talks to.)

### API

- **FR-25**: A new endpoint `POST /v1/documents/ingest` accepts:
   - `multipart/form-data` with `file` + optional `metadata` JSON part — for binary uploads.
   - `application/json` with `{ url: string, metadata?: object }` — for URL-based loaders.
   - `application/json` with `{ content: string, contentType: string, metadata?: object }` — for raw inline content (back-compat with the current store path).
- **FR-26**: The endpoint returns `202 Accepted` with `{ id, enrichment_status: "pending" }`. Loading happens in the enrichment worker, not on the request thread, so a slow Whisper transcription doesn't tie up an HTTP connection.
- **FR-27**: A new MCP tool `document_ingest` MUST mirror the REST endpoint with the same input shape and return the same shape. Bytes over MCP are base64-encoded.

### Worker integration

- **FR-28**: The enrichment worker MUST run loading **before** chunking. New pipeline order: `load → chunk → embed → extract`. Today it's `chunk → embed → extract`. For entities ingested via the legacy path (already-text `content`), loading is a no-op identity step.
- **FR-29**: Loading is its own retry-able stage: a new `loading_status` column on `entities` (`pending | running | completed | failed | skipped`), parallel to the existing `enrichment_status`. Backoff matches existing extraction retry policy.
- **FR-30**: Sidecar calls happen inside the worker, not the HTTP handler, so `concurrency` is bounded by the existing single-threaded poll loop. Multi-worker scale-out is a future concern.

### Operations & observability

- **FR-31**: Each loader call MUST emit a structured log line: `{ loader, kind, entity_id, mime_type, bytes_in, blocks_out, attachments_out, duration_ms, status }`.
- **FR-32**: Sidecar reachability is exposed via `/healthz` aggregation: postgram's own `/health` MUST report `degraded` if any registered loader has been unhealthy for more than `unhealthyThresholdMs` (default 5 minutes). The deployment can be `healthy` even if a loader is down — postgram itself still works for the formats whose loaders are alive.
- **FR-33**: Per-loader counters (calls, errors, p95 duration) MUST be exposed via the existing logger; a `/metrics` endpoint is out of scope for this spec.

## 5. Success Criteria

- A user can ingest a PDF, an MP3, and a YouTube URL after installing three loader packages and editing `postgram.config.json` once. No code changes, no image rebuilds.
- Existing text-only ingestion paths (`/v1/store`, `syncManifest`, MCP `store`) continue to pass their current test suite without modification.
- Adding a loader adds zero hard dependencies to postgram core's `package.json`. Loaders are purely opt-in.
- A failing loader (in-process throw or sidecar 500) does not crash postgram and does not block ingestion of other formats.
- The schema migration is forward-only and reversible (down migration drops the new columns/tables).

## 6. Open Questions

1. **Object store for attachments.** Filesystem path under a Docker volume is the simplest default. Should the spec also support an S3-compatible backend in v1, or defer? Recommendation: filesystem-only in v1 with a `storage_uri` indirection that makes S3 a config swap later.
2. **Loader trust model.** In-process loaders run with full Node privileges. Worth shipping a `requirePluginsSignature` config flag that checks `package.json#publishConfig` against a list of trusted publishers? Or accept the same trust posture as `npm install` itself?
3. **De-duplication of chunks across attachments.** If a PDF contains the same image on every page (logo), should we store one attachment row or N? Recommendation: dedupe by `sha256`; attachments table has a UNIQUE constraint on `(entity_id, sha256)`.
4. **Per-loader extraction overrides.** Should a video loader be able to specify "use a vision LLM for extraction on these blocks"? Recommendation: out of scope for v1; route everything through the existing text-extraction pipeline.
5. **Streaming sidecar protocol.** A 2-hour podcast transcribed synchronously is fine over HTTP if the timeout is generous, but might want SSE streaming later. Recommendation: spec v1 as request/response; reserve a `streaming: true` capability flag in the manifest for a future spec.

See `research.md` for the detailed reasoning behind the design choices in this spec, and `contracts/loader-protocol.md` for concrete TypeScript interfaces and example loaders.

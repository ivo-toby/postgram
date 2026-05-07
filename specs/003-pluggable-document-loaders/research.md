# Research: Pluggable Document Loaders

Context for the design choices in `spec.md`. The user explicitly asked to think through output format, multimodality, conversion strategy, and the docker-container-per-plugin question — that's what this document covers.

## 1. The conversion question: in-process vs sidecar containers

The user asked "docker containers for each plugin?". The honest answer is **both, with a clear split**. A blanket "every loader is a container" is overkill for half the formats; "everything is a JS package" excludes the formats users care about most (audio, OCR).

### Two tiers

| Tier | When | How it runs | Examples |
|------|------|-------------|----------|
| **In-process** | Pure JS / no native deps that don't already exist in the postgram image | `import()`'d from the mounted plugins dir, runs in the worker | PDF text (`pdf-parse`), HTML (`@mozilla/readability` + `turndown`), DOCX (`mammoth`), Markdown, JSON, CSV, YouTube transcripts (`youtube-transcript`), RSS |
| **Sidecar** | Heavy native binaries, GPU work, non-JS runtimes, things you don't want in postgram's image | Separate Docker container on the same compose network. postgram talks to it over HTTP. | Whisper (audio→text), Tesseract / PaddleOCR (image→text), ffmpeg-based video frame extraction, Pandoc, headless-browser HTML rendering |

### Why this split is right

- **Image size and startup time stay sane.** If we packed Whisper, ffmpeg, Tesseract and Chromium into the postgram image to handle the long tail of formats, the image would be ~3GB. Most users wanting a homelab knowledge store don't need any of that. Sidecars stay opt-in.
- **Language flexibility for free.** A sidecar is just a container with `POST /load`. It can be Python (Whisper), Rust (`fastembed`), Go (anything), or a Bash script wrapping a CLI. No N-API headaches, no bridging to JS.
- **Failure isolation.** A native binary OOMing or segfaulting in a sidecar is a 503 to postgram — recoverable. The same crash inside the worker process is fatal.
- **GPU access works cleanly.** Whisper-large or vision models need a GPU. Sidecar gets `deploy.resources.reservations.devices` for GPUs in compose; postgram itself doesn't care.
- **Independent versioning and resource limits.** Each sidecar has its own image tag, its own `deploy.resources.limits.memory`, its own restart policy.

### What we lose with sidecars

- One extra HTTP round-trip per document. For a 30-minute audio file the transcription cost dominates anyway; the round-trip is rounding error.
- A multipart upload of a 1GB video is awkward. The spec mitigates this by allowing the host to pass a `localPath` instead of bytes when the sidecar shares a volume mount with postgram. Both run in the same compose network and can mount the same `./uploads` volume. The host writes once, the sidecar reads once.

### Why not use only npm and write Whisper bindings

Whisper.cpp does have Node bindings. Three problems:
1. The native build differs per CPU; users who can `npm install` a JS package can't always compile a CUDA-enabled native module.
2. Loading whisper-large into the postgram process means postgram now holds a 3GB model in RAM whether or not anyone's transcribing audio.
3. The bindings are second-class compared to upstream Python; new model versions land later.

A separate container avoids all three.

### Why not "everything as a sidecar"

For pure-JS formats (PDF text, HTML, DOCX), running each in its own container means: each container is a Node image carrying its own runtime, gets its own memory budget, costs an HTTP round-trip per ingest, and adds another moving part to compose. PDFs go through a 5MB JS dependency that adds ~20ms of startup; not worth a container. The complexity should match the workload.

## 2. Plugin distribution: a mounted `node_modules` directory

The user described "install an npm package in a folder that's mounted to the container". That maps cleanly to:

- A bind-mounted directory on the host, e.g. `/srv/postgram/plugins`, mounted into the container at `/etc/postgram/plugins`.
- That directory contains a `package.json` and `node_modules`. The user runs `npm install @postgram/loader-pdf` *on the host* (or via `pgm-admin loader install`) and the result becomes visible to the container without rebuilding the image.
- postgram adds `/etc/postgram/plugins/node_modules` to its module resolution at startup and `import()`s each loader by package name.

### Why a directory, not a registry call at runtime

- **Reproducibility.** The plugins dir is part of the user's deployment; it can be checked into infra-as-code. Pulling from a registry on every boot is fragile in a homelab.
- **No outbound dep at boot.** Postgram should boot offline if its DB is up.
- **Clear trust boundary.** "What's installed here?" → `ls /etc/postgram/plugins/node_modules`.

### Why this isn't more dangerous than current ops

Installing an in-process loader is exactly as risky as adding any npm dep. Users already install `pg`, `openai`, `argon2`. The same supply-chain considerations apply. We don't add a vm2-style sandbox in v1; the sidecar tier exists for users who want isolation.

## 3. Output format: typed blocks, not raw text

Today the pipeline is: `entity.content (string) → split on whitespace → chunks (string)`. To support PDFs with pages, audio with timestamps, video with frame captions, that's not enough — we lose structure.

### Proposal: `LoaderResult.blocks: Block[]`

```ts
type Block =
  | { kind: 'text';      text: string;  metadata?: Record<string, unknown> }
  | { kind: 'heading';   level: 1|2|3|4|5|6; text: string; metadata?: ... }
  | { kind: 'code';      language?: string; text: string; metadata?: ... }
  | { kind: 'table';     rows: string[][]; caption?: string; metadata?: ... }
  | { kind: 'transcript'; text: string; startSeconds: number; endSeconds: number; speaker?: string }
  | { kind: 'image';     attachmentRef: string; alt?: string; ocrText?: string; caption?: string }
  | { kind: 'audio';     attachmentRef: string; durationSeconds: number }
  | { kind: 'video';     attachmentRef: string; durationSeconds: number; thumbnailRef?: string };
```

`metadata` can carry per-block hints like `{ page: 3 }`, `{ youtube_id: ..., chapter: 2 }`, `{ slide: 12 }`.

### Why typed blocks instead of "just markdown"

We considered: "every loader returns Markdown, the pipeline is unchanged". Tempting but lossy:
- Page numbers, timestamps, speaker tags, OCR-vs-original-text provenance — all turn into either fragile inline syntax or comments, then have to be re-parsed during chunking and search.
- Image captions and OCR text need to be embedded *separately* from the image bytes. Markdown forces them inline.
- Chunks need to expose `metadata` like `{ page: 3, start_seconds: 124.2 }` to be useful at retrieval time. Blocks carry that data structurally.

### How blocks map to the existing `chunks` table

The enrichment worker flattens blocks into chunks using simple rules:

- `text`, `heading`, `code`, `transcript` → one chunk per block (subject to size limits — long blocks are still split by the existing chunking-service). `block_metadata` is set from the block's metadata.
- `table` → rendered as Markdown text into a single chunk; original `rows` preserved in `block_metadata.tableRows`.
- `image`, `audio`, `video` → one row in `attachments` plus, *if* the loader supplied `ocrText` / `caption` / `transcript`, a sibling text chunk so the media surfaces in BM25/vector search.

This keeps the search path identical to today: chunks are still text, embeddings are still text. The new structure is *additive* and the old code paths don't change.

## 4. Multimodality: convert-to-text now, multimodal-embed later

This is the trickiest call. Two reasonable directions:

**A. Text-only retrieval.** All non-text content gets converted to text by the loader (transcript, OCR, vision-model caption). Existing pgvector + text-embedding pipeline stays exactly as is. Multimodal at *capture* time, unimodal at *retrieve* time.

**B. Multimodal retrieval.** Store image/audio/video embeddings alongside text embeddings (CLIP for images, voyage-multimodal-3 across modalities). At search time, embed the query with the same multimodal model and search over the union.

### Recommendation: A in v1, leave the door open for B

Reasons:
1. **B requires picking a multimodal embedder and deciding how to merge scores across modalities.** That's a separate research project — embedding model choice, vector dim mismatches, score normalisation. Worth its own spec.
2. **A captures most of the value cheaply.** Text chunks from a Whisper transcript or a PDF's OCR are searchable with the embedding stack we already have. A user searching "the part of the standup where we discussed the database migration" gets the right transcript chunk.
3. **The data model in this spec doesn't preclude B.** `chunks` already has `embedding`. Adding `embedding_image vector(N)` later, plus an `embedding_modality` column on a future `media_embeddings` table, is non-breaking.
4. **The cost asymmetry favours A.** Image embeddings are ~10x cheaper to compute than transcription, and almost no homelab user has a real "find the screenshot of X" use case. The format that matters most (audio) is best served by transcription anyway, because retrieval over a podcast wants *which 30 seconds said this*, not *which podcast feels similar*.

### What we still need to design for

- `attachments.storage_uri` and a small "fetch attachment" API so a UI can render the image referenced by an `image` block.
- `block.attachmentRef` is a stable handle the loader supplies (typically a sha256 hex string); the host resolves the ref to the persisted attachment row.

## 5. The plugin manifest: `postgram.config.json`

Why a JSON file, not env vars:

- Loader config is structured (per-loader `mimeTypes`, `urlPatterns`, `endpoint`, `timeoutMs`, `maxBytes`). Cramming it into env vars is painful and unrooted.
- It's a natural place for future top-level config that doesn't fit env vars (entity-type registry, custom search profiles).
- It can be schema-validated with Zod and round-tripped through `pgm-admin config validate`, which means typos surface at boot, not at first ingest.

Env vars stay as the source of truth for secrets and connection strings (DATABASE_URL, OPENAI_API_KEY) — those don't belong in a checked-in JSON file.

### Example `postgram.config.json`

```json
{
  "version": 1,
  "pluginsDir": "/etc/postgram/plugins",
  "attachmentsDir": "/var/postgram/attachments",
  "loaders": [
    {
      "name": "pdf",
      "kind": "in-process",
      "package": "@postgram/loader-pdf",
      "accepts": {
        "mimeTypes": ["application/pdf"],
        "extensions": [".pdf"]
      },
      "options": { "extractImages": true, "ocr": false }
    },
    {
      "name": "whisper",
      "kind": "sidecar",
      "endpoint": "http://loader-whisper:8080",
      "accepts": {
        "mimeTypes": ["audio/mpeg", "audio/wav", "audio/mp4", "audio/x-m4a"]
      },
      "timeoutMs": 600000,
      "maxBytes": 524288000,
      "concurrency": 1,
      "transport": {
        "mode": "shared-volume",
        "hostPath": "/var/postgram/uploads",
        "sidecarPath": "/uploads"
      }
    },
    {
      "name": "youtube",
      "kind": "in-process",
      "package": "@postgram/loader-youtube",
      "accepts": {
        "urlPatterns": [
          "^https?://(www\\.)?youtube\\.com/watch",
          "^https?://youtu\\.be/"
        ]
      }
    }
  ]
}
```

## 6. Sidecar communication: HTTP vs gRPC vs stdin/stdout

We considered three patterns:

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **HTTP + multipart** | Trivially debuggable (`curl`), every language has a server lib, plays well with Docker networking | Multipart is awkward for very large files; HTTP timeouts need tuning | **Pick this** |
| **gRPC streaming** | Native streaming for large files and partial transcripts | Requires a `.proto`, harder for users to write a one-off Bash sidecar | Defer |
| **`docker run --rm` per call (stdin/stdout)** | No long-running process; trivial scaling-down | Cold-start cost on every ingest (esp. for model loaders that take seconds to warm up); requires postgram to have docker-in-docker access | Reject |

HTTP wins because (a) we can pass either bytes or a `localPath` via shared volume to handle big files, (b) the sidecar process stays warm so model loading happens once, and (c) any user who can write a Flask app can write a sidecar.

The shared-volume escape hatch ("don't actually upload — read this path") is the one optimisation that matters for the audio/video case. Compose makes shared volumes free.

## 7. Comparable prior art

- **LangChain / LlamaIndex `DocumentLoader`s.** Same name, same idea, but they live inside the framework's process. We crib their *interface shape* (`load() → Document[]`) but layer on the in-process-vs-sidecar split because we run as a service, not a script.
- **Unstructured.io.** A dedicated document-conversion service. We could have made postgram depend on it directly; instead the **sidecar tier** of this spec lets a user run Unstructured (or anything else) as a sidecar without baking it in. Ours stays AGPL-clean and lets users opt out.
- **Apache Tika.** The classic "throw any file at it, get text out" daemon. A `tika` sidecar is a one-line config entry under this design.
- **n8n / Zapier-style integrations.** Their "drop a community node into a folder" model is exactly what the user described. n8n proves it works in production.

## 8. Tradeoffs we're explicitly accepting

- **No streaming results in v1.** A 4-hour podcast either transcribes within the configured timeout or fails and retries. We don't surface partial transcript blocks as they arrive. SSE/streaming is reserved as a future loader capability.
- **No sandbox for in-process loaders.** Same trust posture as `npm install`. Users who want isolation use the sidecar tier.
- **No automatic loader install.** `pgm-admin loader install <pkg>` is a thin wrapper around `npm install`; we don't fetch from a custom registry or verify signatures. (Open question in spec.md.)
- **One worker, sequential loading.** Today's enrichment worker is a single in-process polling loop. We don't scale loading horizontally; a slow Whisper run blocks other documents in the queue. Multi-worker scaling is a separate spec.
- **No multimodal embeddings.** Discussed in §4; deliberate choice.

## 9. What this proposal does *not* answer

- The exact migration path for existing entities ingested as text (the answer is "they keep working unchanged because `loading_status='skipped'` for them") — implementation detail for the plan.md.
- The CLI ergonomics for `pgm-admin loader install / list / disable` — UX for the implementation phase.
- The MCP transport for binary content beyond base64 — a known limitation we accept.
- Whether sync (`syncManifest`) should auto-route through loaders by file extension — yes, but the routing rules need a separate small spec because `path → loader` is conceptually distinct from `mimeType → loader`.

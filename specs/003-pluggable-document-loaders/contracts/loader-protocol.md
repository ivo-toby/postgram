# Contract: Loader Protocol

Concrete interfaces for the two loader tiers and the plugin manifest. These are illustrative — the production code will live under `src/services/loaders/` once this spec is approved.

## 1. Shared types

```ts
// src/types/loader.ts (proposed)

export interface DocumentLoader {
  /** Stable identifier, lowercase kebab-case. Matches the config `name`. */
  readonly name: string;
  /** SemVer of the loader package. Surface in /v1/admin/loaders. */
  readonly version: string;
  /** What inputs this loader claims. The host picks the highest-priority match. */
  readonly accepts: AcceptDescriptor;
  /** Optional. Higher number wins when multiple loaders match. Default 0. */
  readonly priority?: number;
  /** Convert input bytes/URL into a normalised LoaderResult. */
  load(input: LoaderInput, ctx: LoaderContext): Promise<LoaderResult>;
}

export interface AcceptDescriptor {
  mimeTypes?: string[];        // e.g. ["application/pdf"]
  extensions?: string[];        // e.g. [".pdf"]
  urlPatterns?: string[];       // RegExp source strings, matched against full URL
}

export type LoaderInput =
  | { kind: 'bytes'; bytes: Uint8Array; mimeType: string; filename?: string;
      sourceUri?: string }
  | { kind: 'url';   url: string; mimeType?: string }
  | { kind: 'localPath'; path: string; mimeType: string; sourceUri?: string };

export interface LoaderContext {
  /** Per-request scratch dir; cleaned up after load() resolves. */
  readonly tmpDir: string;
  /** Plugin host's logger, scoped with { loader, entity_id }. */
  readonly logger: Logger;
  /** Bounded fetch — respects host-configured proxy + timeout. */
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /** Loader-specific options passed through from postgram.config.json. */
  readonly options: Record<string, unknown>;
  /** Abort signal — fires when timeoutMs is hit. */
  readonly signal: AbortSignal;
}

export interface LoaderResult {
  documentType: string;                 // free-form, e.g. "pdf", "audio", "youtube"
  blocks: Block[];
  attachments?: AttachmentDraft[];      // referenced by `attachmentRef` in blocks
  metadata?: Record<string, unknown>;   // top-level entity metadata (title, author, etc.)
}

export type Block =
  | TextBlock | HeadingBlock | CodeBlock | TableBlock
  | TranscriptBlock | ImageBlock | AudioBlock | VideoBlock;

export interface TextBlock      { kind: 'text';       text: string; metadata?: BlockMeta }
export interface HeadingBlock   { kind: 'heading';    level: 1|2|3|4|5|6; text: string; metadata?: BlockMeta }
export interface CodeBlock      { kind: 'code';       text: string; language?: string; metadata?: BlockMeta }
export interface TableBlock     { kind: 'table';      rows: string[][]; caption?: string; metadata?: BlockMeta }
export interface TranscriptBlock{ kind: 'transcript'; text: string; startSeconds: number; endSeconds: number;
                                  speaker?: string; metadata?: BlockMeta }
export interface ImageBlock     { kind: 'image';      attachmentRef: string;
                                  alt?: string; ocrText?: string; caption?: string; metadata?: BlockMeta }
export interface AudioBlock     { kind: 'audio';      attachmentRef: string; durationSeconds: number;
                                  metadata?: BlockMeta }
export interface VideoBlock     { kind: 'video';      attachmentRef: string; durationSeconds: number;
                                  thumbnailRef?: string; metadata?: BlockMeta }

export type BlockMeta = Record<string, unknown> & {
  page?: number;                  // PDF, slide deck
  startSeconds?: number;          // audio/video
  endSeconds?: number;
  youtubeId?: string;
  chapter?: string | number;
  source?: 'ocr' | 'native' | 'asr' | 'caption-model';
};

export interface AttachmentDraft {
  /** Stable handle referenced by blocks. Conventionally the sha256 hex of `bytes`. */
  ref: string;
  kind: 'image' | 'audio' | 'video' | 'binary';
  mimeType: string;
  /** Either inline bytes OR a path inside the loader's tmpDir / shared-volume sidecarPath. */
  source: { kind: 'bytes'; bytes: Uint8Array } | { kind: 'path'; path: string };
  metadata?: Record<string, unknown>;
}
```

## 2. In-process loader example: `@postgram/loader-pdf`

```ts
// packages/loader-pdf/src/index.ts
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import pdfParse from 'pdf-parse';
import type { DocumentLoader, LoaderResult, Block, AttachmentDraft } from 'postgram-loader-sdk';

const loader: DocumentLoader = {
  name: 'pdf',
  version: '0.1.0',
  accepts: {
    mimeTypes: ['application/pdf'],
    extensions: ['.pdf'],
  },
  async load(input, ctx) {
    if (input.kind === 'url') {
      const res = await ctx.fetch(input.url, { signal: ctx.signal });
      input = { kind: 'bytes', bytes: new Uint8Array(await res.arrayBuffer()),
                mimeType: 'application/pdf', sourceUri: input.url };
    }
    const bytes = input.kind === 'bytes' ? Buffer.from(input.bytes)
                                          : await readFileAsBuffer(input.path);
    const parsed = await pdfParse(bytes);

    const blocks: Block[] = [];
    const attachments: AttachmentDraft[] = [];

    // pdf-parse returns a single text blob; a real loader would walk the
    // page tree to attach `metadata.page`. Sketch only.
    for (const [i, pageText] of splitByPage(parsed.text).entries()) {
      blocks.push({ kind: 'text', text: pageText, metadata: { page: i + 1 } });
    }

    return {
      documentType: 'pdf',
      blocks,
      attachments,
      metadata: {
        title: parsed.info?.Title ?? input.kind === 'bytes' ? input.filename : undefined,
        pageCount: parsed.numpages,
        author: parsed.info?.Author,
      },
    };
  },
};
export default loader;
```

## 3. Sidecar HTTP contract: Whisper example

A minimal Python sidecar that the host can talk to. Postgram only requires three endpoints:

```
GET  /healthz   → 200 {"status":"ok"} | 503
GET  /manifest  → 200 { name, version, accepts: AcceptDescriptor, capabilities: {...} }
POST /load      → 200 LoaderResult JSON | 4xx | 5xx
```

`POST /load` accepts `multipart/form-data`:
- `file`: the document bytes (omitted if `transport: shared-volume` is configured — see §5)
- `meta`: an `application/json` part containing `{ filename?, mimeType, sourceUri?, options }`

When a `shared-volume` transport is configured, `meta` carries `{ localPath, mimeType, options }` and no `file` part is sent — the sidecar reads the path off the shared mount.

### Sketch: a Whisper sidecar

```python
# loader-whisper/server.py
from fastapi import FastAPI, File, UploadFile, Form
import whisper, json, hashlib, os

app = FastAPI()
model = whisper.load_model(os.environ.get("WHISPER_MODEL", "small"))

@app.get("/healthz")
def healthz(): return {"status": "ok"}

@app.get("/manifest")
def manifest():
    return {
      "name": "whisper",
      "version": "0.1.0",
      "accepts": {"mimeTypes": ["audio/mpeg", "audio/wav", "audio/mp4", "audio/x-m4a"]},
      "capabilities": {"streaming": False, "sharedVolume": True},
    }

@app.post("/load")
async def load(file: UploadFile = File(None), meta: str = Form(...)):
    m = json.loads(meta)
    audio_path = m["localPath"] if "localPath" in m else _spool(file)
    result = model.transcribe(audio_path, word_timestamps=False)

    blocks = [{
      "kind": "transcript",
      "text": seg["text"].strip(),
      "startSeconds": seg["start"],
      "endSeconds":   seg["end"],
      "metadata":     {"source": "asr"},
    } for seg in result["segments"]]

    sha = _sha256_file(audio_path)
    return {
      "documentType": "audio",
      "blocks": blocks,
      "attachments": [{
        "ref": sha, "kind": "audio", "mimeType": m["mimeType"],
        "source": {"kind": "path", "path": audio_path},
        "metadata": {"durationSeconds": result.get("duration")}
      }],
      "metadata": {"language": result.get("language")},
    }
```

### Postgram-side sidecar client (sketch)

```ts
// src/services/loaders/sidecar-client.ts (proposed)
export class SidecarLoaderClient implements DocumentLoader {
  constructor(private readonly cfg: SidecarLoaderConfig) {}

  get name() { return this.cfg.name; }
  get version() { return this.cachedManifest?.version ?? 'unknown'; }
  get accepts() { return this.cfg.accepts; }

  async load(input: LoaderInput, ctx: LoaderContext): Promise<LoaderResult> {
    const form = new FormData();
    if (this.cfg.transport?.mode === 'shared-volume' && input.kind !== 'url') {
      const localPath = await this.materialiseToSharedVolume(input);
      form.append('meta', new Blob([JSON.stringify({
        localPath, mimeType: mimeOf(input), options: this.cfg.options,
      })], { type: 'application/json' }));
    } else {
      form.append('file', new Blob([await bytesOf(input)]));
      form.append('meta', new Blob([JSON.stringify({
        filename: filenameOf(input), mimeType: mimeOf(input),
        sourceUri: sourceUriOf(input), options: this.cfg.options,
      })], { type: 'application/json' }));
    }
    const res = await fetch(`${this.cfg.endpoint}/load`, {
      method: 'POST', body: form, signal: ctx.signal,
    });
    if (!res.ok) throw new SidecarError(this.cfg.name, res.status, await res.text());
    return await res.json() as LoaderResult;
  }
}
```

## 4. Plugin host: registration & dispatch

```ts
// src/services/loaders/registry.ts (proposed)
export interface LoaderRegistry {
  resolve(input: LoaderInput): DocumentLoader | undefined;
  list(): LoaderHealthInfo[];
  disable(name: string): void;
  enable(name: string): void;
}

export async function buildRegistry(
  cfg: PostgramConfig,
  logger: Logger,
): Promise<LoaderRegistry> {
  const loaders: DocumentLoader[] = [];
  for (const entry of cfg.loaders) {
    try {
      if (entry.kind === 'in-process') {
        const mod = await importFromPlugins(cfg.pluginsDir, entry.package);
        const loader = mod.default as DocumentLoader;
        validate(loader, entry);
        loaders.push(loader);
      } else {
        const client = new SidecarLoaderClient(entry);
        await client.probeManifest();   // fail-soft
        loaders.push(client);
      }
    } catch (err) {
      logger.error({ entry: entry.name, err }, 'loader registration failed');
      // continue — failed loaders are reported via /v1/admin/loaders
    }
  }
  return new InMemoryRegistry(loaders);
}
```

Resolution order, given a `LoaderInput`:

1. Filter loaders whose `accepts` matches (`mimeType` ∈ `mimeTypes`, or `extension` ∈ `extensions`, or URL matches one of `urlPatterns`).
2. Sort by `priority` descending, then by config order.
3. Pick the first. No fallthrough — if a higher-priority loader throws, the document fails; we don't silently fall back to a less-specific loader.

## 5. Worker integration sketch

The enrichment worker gains a loading stage that runs before chunking:

```ts
// src/services/enrichment-worker.ts (modified)
async function processOne(entity: Entity) {
  if (entity.loading_status === 'pending') {
    const loader = registry.resolve(inputFromEntity(entity));
    if (!loader) {
      await markLoadingFailed(entity.id, 'no_loader');
      return;
    }
    try {
      const result = await loader.load(inputFromEntity(entity), buildCtx(entity));
      await persistLoaderResult(entity.id, result);
      await setLoadingStatus(entity.id, 'completed');
    } catch (err) {
      await setLoadingStatus(entity.id, 'failed', String(err));
      return;
    }
  }
  // existing chunk/embed/extract pipeline runs against the (possibly newly
  // populated) blocks/chunks
}
```

`inputFromEntity` reads `mime_type`, `source_uri`, and either inline `content` or a stored attachment path off the entity row.

`persistLoaderResult` writes `attachments`, then flattens `blocks` into `chunks` rows with `block_kind` and `block_metadata` set, then leaves the `enrichment_status` machinery to pick up from there.

## 6. Postgram config schema (Zod)

```ts
// src/types/postgram-config.ts (proposed)
export const PostgramConfigSchema = z.object({
  version: z.literal(1),
  pluginsDir: z.string().default('/etc/postgram/plugins'),
  attachmentsDir: z.string().default('/var/postgram/attachments'),
  loaders: z.array(LoaderConfigSchema),
});

export const LoaderConfigSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('in-process'),
    name: z.string(),
    package: z.string(),                   // npm package specifier
    accepts: AcceptDescriptorSchema,
    priority: z.number().int().default(0),
    options: z.record(z.unknown()).default({}),
    enabled: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal('sidecar'),
    name: z.string(),
    endpoint: z.string().url(),
    accepts: AcceptDescriptorSchema,
    priority: z.number().int().default(0),
    timeoutMs: z.number().int().positive().default(120_000),
    maxBytes: z.number().int().positive().default(100 * 1024 * 1024),
    concurrency: z.number().int().positive().default(1),
    healthCheckIntervalMs: z.number().int().positive().default(30_000),
    transport: z.object({
      mode: z.enum(['multipart', 'shared-volume']).default('multipart'),
      hostPath: z.string().optional(),
      sidecarPath: z.string().optional(),
    }).default({ mode: 'multipart' }),
    options: z.record(z.unknown()).default({}),
    sharedSecret: z.string().optional(),
    enabled: z.boolean().default(true),
  }),
]);
```

## 7. Test surface

- **Contract tests** for the in-process protocol: a fake loader that returns a known `LoaderResult` exercises the host's resolution, persistence, and chunk-flattening logic.
- **Contract tests** for the sidecar protocol: a stub HTTP server (`testcontainers` or just `http.createServer`) exercises timeout, 5xx retry, manifest mismatch, shared-volume vs multipart paths.
- **Schema tests** for `postgram.config.json` covering the discriminated union, default fill-in, and the auto-generated JSON schema.
- **Migration tests** verifying the new columns/tables and the unique index on `entities.source_uri`.
- **Smoke test** wiring `@postgram/loader-pdf` end-to-end against a tiny test PDF in CI.

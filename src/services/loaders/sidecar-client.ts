import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import {
  createLoaderResultSchema,
  parseLoaderResultWith,
  type DocumentLoader,
  type LoaderContext,
  type LoaderInput,
  type LoaderResult
} from '../../types/loader.js';
import type { SidecarLoaderConfig } from '../../types/loaders-config.js';

/**
 * Talks to a sidecar container that exposes the loader HTTP contract:
 *
 *   GET  /manifest  → 200 { name, version, accepts }
 *   POST /load      → 200 LoaderResult JSON | 4xx | 5xx
 *
 * Request transport, set by `transport.mode`:
 *
 * - 'multipart' (default): the bytes are uploaded as form-data next to a
 *   `meta` JSON part.
 * - 'shared-volume': the host passes a path. The file lives under
 *   `transport.hostPath` on the host and under `transport.sidecarPath` in the
 *   container. The host sends the translated path in `meta.localPath` and
 *   uploads nothing. A localPath input is required, and it must be inside
 *   `hostPath`.
 *
 * The response is untrusted. It is read with a size cap (`maxResponseBytes`)
 * and validated like any loader output. Attachment bytes travel as base64:
 * `source: { kind: 'base64', data }`. A `path` source is rejected, because the
 * path would be opened on the host.
 *
 * A call ends on `ctx.signal`, and also on `timeoutMs` when it is configured.
 */
export class SidecarLoaderClient implements DocumentLoader {
  private readonly cfg: SidecarLoaderConfig;
  private cachedManifestVersion: string | undefined;

  constructor(cfg: SidecarLoaderConfig) {
    this.cfg = cfg;
  }

  get name(): string {
    return this.cfg.name;
  }

  get version(): string {
    return this.cachedManifestVersion ?? 'unknown';
  }

  get accepts(): DocumentLoader['accepts'] {
    return this.cfg.accepts;
  }

  get priority(): number {
    return this.cfg.priority;
  }

  /**
   * Probe `/manifest` once at startup. Returns null when the sidecar answers
   * with an error status or an unusable body. Network errors reject.
   */
  async probeManifest(signal?: AbortSignal): Promise<SidecarManifest | null> {
    const capCtl = new AbortController();
    const res = await this.fetchSidecar('/manifest', {
      method: 'GET',
      signal: AbortSignal.any(
        signal ? [signal, capCtl.signal] : [capCtl.signal]
      )
    });
    if (!res.ok) return null;
    let json: unknown;
    try {
      json = JSON.parse(
        new TextDecoder().decode(
          await readCapped(res, MANIFEST_MAX_BYTES, 'manifest', () =>
            capCtl.abort()
          )
        )
      );
    } catch {
      return null;
    }
    const parsed = manifestSchema.safeParse(json);
    if (!parsed.success) return null;
    if (parsed.data.version !== undefined) {
      this.cachedManifestVersion = parsed.data.version;
    }
    return parsed.data;
  }

  async load(input: LoaderInput, ctx: LoaderContext): Promise<LoaderResult> {
    const useSharedVolume = this.cfg.transport.mode === 'shared-volume';
    const meta = buildMeta(input, this.cfg);
    const body = await buildRequestBody({
      input,
      meta,
      cfg: this.cfg,
      useSharedVolume
    });

    const headers: Record<string, string> = {};
    if (this.cfg.sharedSecret) {
      headers['x-postgram-secret'] = this.cfg.sharedSecret;
    }

    // Aborted by us when the response grows past `maxResponseBytes`.
    const capCtl = new AbortController();
    const signals: AbortSignal[] = [ctx.signal, capCtl.signal];
    if (this.cfg.timeoutMs !== undefined) {
      signals.push(AbortSignal.timeout(this.cfg.timeoutMs));
    }
    const signal = AbortSignal.any(signals);
    // Do not start a request that is already cancelled (fetch would still
    // pump the multipart body and leave an unhandled rejection behind).
    signal.throwIfAborted();
    const res = await this.fetchSidecar('/load', {
      method: 'POST',
      body,
      headers,
      signal
    });

    if (!res.ok) {
      const text = await safeText(res, () => capCtl.abort());
      throw new SidecarError(this.cfg.name, res.status, text || res.statusText);
    }

    const raw = await readCapped(
      res,
      this.cfg.maxResponseBytes,
      this.cfg.name,
      () => capCtl.abort()
    );
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(raw));
    } catch (err) {
      throw new Error(
        `sidecar ${this.cfg.name}: response is not valid JSON (${err instanceof Error ? err.message : String(err)})`
      );
    }
    return parseLoaderResultWith(wireResultSchema, json) as LoaderResult;
  }

  private async fetchSidecar(
    pathname: string,
    init: RequestInit
  ): Promise<Response> {
    const url = `${this.cfg.endpoint.replace(/\/$/, '')}${pathname}`;
    return await fetch(url, init);
  }
}

export type SidecarManifest = {
  name?: string | undefined;
  version?: string | undefined;
  accepts?: DocumentLoader['accepts'] | undefined;
};

const manifestSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  accepts: z
    .object({
      mimeTypes: z.array(z.string()).optional(),
      extensions: z.array(z.string()).optional()
    })
    .optional()
});

const MANIFEST_MAX_BYTES = 64 * 1024;
const ERROR_BODY_MAX_BYTES = 64 * 1024;

const BASE64_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * The only attachment source a sidecar may send: base64 inside the JSON,
 * converted to bytes for the host.
 */
const wireSourceSchema = z
  .object({
    kind: z.literal('base64'),
    data: z.string().regex(BASE64_RE, 'data must be valid base64')
  })
  .transform((s) => ({
    kind: 'bytes' as const,
    bytes: new Uint8Array(Buffer.from(s.data, 'base64'))
  }));

const wireResultSchema = createLoaderResultSchema(wireSourceSchema);

export class SidecarError extends Error {
  readonly loader: string;
  readonly status: number;
  constructor(loader: string, status: number, body: string) {
    super(`sidecar ${loader} returned ${status}: ${truncate(body, 500)}`);
    this.name = 'SidecarError';
    this.loader = loader;
    this.status = status;
  }
}

function buildMeta(
  input: LoaderInput,
  cfg: SidecarLoaderConfig
): Record<string, unknown> {
  const meta: Record<string, unknown> = { options: cfg.options };
  if (input.filename) meta.filename = input.filename;
  meta.mimeType = input.mimeType;
  if (input.sourceUri) meta.sourceUri = input.sourceUri;
  if (cfg.transport.mode === 'shared-volume') {
    meta.localPath = sidecarPathFor(input, cfg);
  }
  return meta;
}

/**
 * Translate a host path to the path the container sees. The path must be
 * inside `hostPath` (compared on path segments, so `/data/att` does not
 * contain `/data/attachments2`) and not `hostPath` itself.
 */
function sidecarPathFor(input: LoaderInput, cfg: SidecarLoaderConfig): string {
  if (cfg.transport.mode !== 'shared-volume') {
    throw new Error('sidecarPathFor called without shared-volume transport');
  }
  if (input.kind !== 'localPath') {
    throw new Error(
      `sidecar ${cfg.name}: shared-volume transport requires a localPath input; the host must write the bytes to the shared volume first`
    );
  }
  const hostPath = path.resolve(cfg.transport.hostPath ?? '');
  const relative = path.relative(hostPath, path.resolve(input.path));
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `sidecar ${cfg.name}: path ${input.path} is outside the shared volume ${hostPath}`
    );
  }
  const sidecarPath = (cfg.transport.sidecarPath ?? '').replace(/\/+$/, '');
  return `${sidecarPath}/${relative.split(path.sep).join('/')}`;
}

async function buildRequestBody(opts: {
  input: LoaderInput;
  meta: Record<string, unknown>;
  cfg: SidecarLoaderConfig;
  useSharedVolume: boolean;
}): Promise<FormData> {
  const form = new FormData();
  form.append(
    'meta',
    new Blob([JSON.stringify(opts.meta)], { type: 'application/json' }),
    'meta.json'
  );

  if (opts.useSharedVolume) {
    return form;
  }

  let bytes: Uint8Array;
  if (opts.input.kind === 'bytes') {
    bytes = opts.input.bytes;
    assertWithinMaxBytes(bytes.byteLength, opts.cfg);
  } else {
    // Check the size before reading so a huge file is never loaded.
    assertWithinMaxBytes((await stat(opts.input.path)).size, opts.cfg);
    bytes = new Uint8Array(await readFile(opts.input.path));
  }
  const filename = opts.input.filename ?? 'file.bin';
  // Force a fresh ArrayBuffer copy so the Blob constructor accepts it under
  // strict TS (Uint8Array<ArrayBufferLike> -> Uint8Array<ArrayBuffer>).
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  form.append('file', new Blob([buf], { type: opts.input.mimeType }), filename);
  return form;
}

function assertWithinMaxBytes(size: number, cfg: SidecarLoaderConfig): void {
  if (size > cfg.maxBytes) {
    throw new Error(
      `sidecar ${cfg.name}: payload ${size} bytes exceeds maxBytes ${cfg.maxBytes}`
    );
  }
}

/**
 * Read a response body up to `max` bytes. As soon as the declared
 * content-length or the bytes read exceed it, `abort` is called (it aborts
 * the request, which tears the connection down) and the read fails.
 */
async function readCapped(
  res: Response,
  max: number,
  label: string,
  abort: () => void
): Promise<Uint8Array> {
  const tooLarge = () => {
    abort();
    return new Error(
      `sidecar ${label}: response exceeds maxResponseBytes ${max}`
    );
  };
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw tooLarge();
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) throw tooLarge();
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

async function safeText(res: Response, abort: () => void): Promise<string> {
  try {
    return new TextDecoder().decode(
      await readCapped(res, ERROR_BODY_MAX_BYTES, 'error body', abort)
    );
  } catch {
    return '';
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

import { readFile } from 'node:fs/promises';

import type {
  DocumentLoader,
  LoaderContext,
  LoaderInput,
  LoaderResult,
} from '../../types/loader.js';
import type { SidecarLoaderConfig } from '../../types/postgram-config.js';

/**
 * Talks to a sidecar Docker container that exposes the loader HTTP contract:
 *
 *   GET  /healthz   → 200 | 503
 *   GET  /manifest  → 200 { name, version, accepts }
 *   POST /load      → 200 LoaderResult JSON | 4xx | 5xx
 *
 * Two transport modes:
 *
 * - 'multipart' (default): bytes are uploaded as form-data alongside a
 *   `meta` JSON part.
 * - 'shared-volume': the host writes the bytes to `transport.hostPath`,
 *   the sidecar reads them from `transport.sidecarPath`. Avoids multipart
 *   uploads of multi-GB media.
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

  /** Probe `/manifest` once at startup. Failure is non-fatal; the registry
   * surfaces it via the loader's status. */
  async probeManifest(signal?: AbortSignal): Promise<SidecarManifest | null> {
    const init: RequestInit = { method: 'GET' };
    if (signal) init.signal = signal;
    const res = await this.fetchSidecar('/manifest', init);
    if (!res.ok) return null;
    const json = (await res.json()) as Partial<SidecarManifest>;
    if (typeof json.version === 'string') {
      this.cachedManifestVersion = json.version;
    }
    return json as SidecarManifest;
  }

  async healthz(signal?: AbortSignal): Promise<boolean> {
    try {
      const init: RequestInit = { method: 'GET' };
      if (signal) init.signal = signal;
      const res = await this.fetchSidecar('/healthz', init);
      return res.ok;
    } catch {
      return false;
    }
  }

  async load(input: LoaderInput, ctx: LoaderContext): Promise<LoaderResult> {
    const meta = buildMeta(input, this.cfg);
    const useSharedVolume =
      this.cfg.transport.mode === 'shared-volume' && input.kind !== 'url';

    const body = await buildRequestBody({
      input,
      meta,
      cfg: this.cfg,
      useSharedVolume,
    });

    const headers: Record<string, string> = {};
    if (this.cfg.sharedSecret) {
      headers['x-postgram-secret'] = this.cfg.sharedSecret;
    }

    const timeout = AbortSignal.timeout(this.cfg.timeoutMs);
    const signal = mergeSignals(ctx.signal, timeout);

    const res = await this.fetchSidecar('/load', {
      method: 'POST',
      body,
      headers,
      signal,
    });

    if (!res.ok) {
      const text = await safeText(res);
      throw new SidecarError(
        this.cfg.name,
        res.status,
        text || res.statusText,
      );
    }

    const result = (await res.json()) as LoaderResult;
    return result;
  }

  private async fetchSidecar(
    pathname: string,
    init: RequestInit,
  ): Promise<Response> {
    const url = `${this.cfg.endpoint.replace(/\/$/, '')}${pathname}`;
    return await fetch(url, init);
  }
}

export type SidecarManifest = {
  name?: string;
  version?: string;
  accepts?: DocumentLoader['accepts'];
  capabilities?: { streaming?: boolean; sharedVolume?: boolean };
};

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
  cfg: SidecarLoaderConfig,
): Record<string, unknown> {
  const useSharedVolume =
    cfg.transport.mode === 'shared-volume' && input.kind !== 'url';

  const base: Record<string, unknown> = {
    options: cfg.options,
  };

  if (input.kind === 'bytes') {
    if (input.filename) base.filename = input.filename;
    base.mimeType = input.mimeType;
    if (input.sourceUri) base.sourceUri = input.sourceUri;
  } else if (input.kind === 'url') {
    base.url = input.url;
    if (input.mimeType) base.mimeType = input.mimeType;
  } else {
    base.mimeType = input.mimeType;
    if (input.sourceUri) base.sourceUri = input.sourceUri;
  }

  if (useSharedVolume) {
    base.localPath = sidecarPathFor(input, cfg);
  }
  return base;
}

function sidecarPathFor(
  input: LoaderInput,
  cfg: SidecarLoaderConfig,
): string {
  if (cfg.transport.mode !== 'shared-volume') {
    throw new Error('sidecarPathFor called without shared-volume transport');
  }
  if (input.kind === 'localPath') {
    // Translate hostPath prefix to sidecarPath so the container sees its path.
    const hostPrefix = cfg.transport.hostPath ?? '';
    const sidecarPrefix = cfg.transport.sidecarPath ?? '';
    if (hostPrefix && input.path.startsWith(hostPrefix)) {
      return sidecarPrefix + input.path.slice(hostPrefix.length);
    }
    return input.path;
  }
  // For bytes input, the host is expected to have already materialised them
  // under the shared volume; the path is communicated via meta.localPath set
  // upstream. Falls through to undefined to make that bug loud.
  throw new Error(
    'shared-volume transport requires a localPath input; the host must materialise bytes first',
  );
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
    'meta.json',
  );

  if (opts.useSharedVolume) {
    return form;
  }

  if (opts.input.kind === 'url') {
    return form;
  }

  const bytes: Uint8Array =
    opts.input.kind === 'bytes'
      ? opts.input.bytes
      : new Uint8Array(await readFile(opts.input.path));
  if (bytes.byteLength > opts.cfg.maxBytes) {
    throw new Error(
      `sidecar ${opts.cfg.name}: payload ${bytes.byteLength} bytes exceeds maxBytes ${opts.cfg.maxBytes}`,
    );
  }
  const filename =
    opts.input.kind === 'bytes'
      ? (opts.input.filename ?? 'file.bin')
      : 'file.bin';
  const mime = opts.input.mimeType;
  // Force a fresh ArrayBuffer copy so the Blob constructor accepts it under
  // strict TS (Uint8Array<ArrayBufferLike> -> Uint8Array<ArrayBuffer>).
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  form.append('file', new Blob([buf], { type: mime }), filename);
  return form;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function mergeSignals(
  a: AbortSignal,
  b: AbortSignal,
): AbortSignal {
  // Node 22 has AbortSignal.any; fall back to manual chaining for older runtimes.
  const anyFn = (AbortSignal as unknown as {
    any?: (signals: AbortSignal[]) => AbortSignal;
  }).any;
  if (typeof anyFn === 'function') return anyFn([a, b]);
  const ctl = new AbortController();
  const onAbort = (sig: AbortSignal) => {
    if (!ctl.signal.aborted) ctl.abort(sig.reason);
  };
  a.addEventListener('abort', () => onAbort(a));
  b.addEventListener('abort', () => onAbort(b));
  if (a.aborted) ctl.abort(a.reason);
  if (b.aborted) ctl.abort(b.reason);
  return ctl.signal;
}

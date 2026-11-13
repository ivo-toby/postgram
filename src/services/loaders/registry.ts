import type {
  DocumentLoader,
  LoaderInput,
  LoaderResolutionError
} from '../../types/loader.js';
import type { LoaderConfig } from '../../types/loaders-config.js';

import {
  matchesExtension,
  matchesMimeType,
  normalizeMimeType
} from './accept.js';

/** Per-loader runtime state. */
export type LoaderHealth = {
  name: string;
  kind: 'in-process' | 'sidecar';
  version: string;
  enabled: boolean;
  status: 'ok' | 'load_failed';
  reason?: string;
};

export type RegisteredLoader = {
  loader: DocumentLoader;
  config: LoaderConfig;
  enabled: boolean;
  status: LoaderHealth['status'];
  reason?: string;
};

export type FailedLoader = {
  config: LoaderConfig;
  reason: string;
};

export type Resolution =
  | { ok: true; entry: RegisteredLoader; mimeType: string }
  | { ok: false; error: LoaderResolutionError };

const OCTET_STREAM = 'application/octet-stream';

/**
 * Holds the registered loaders and dispatches an input to the matching one.
 * Ingest and the worker both resolve through `resolveByTypeOrName`, so they
 * cannot disagree.
 */
export class LoaderRegistry {
  private readonly loaders: RegisteredLoader[];
  private readonly failed: FailedLoader[];

  constructor(loaders: RegisteredLoader[], failed: FailedLoader[] = []) {
    this.loaders = loaders;
    this.failed = failed;
  }

  /** Resolve a loader input with the same rule as `resolveByTypeOrName`. */
  resolve(input: LoaderInput): Resolution {
    const filename =
      input.filename ?? (input.kind === 'localPath' ? input.path : undefined);
    return this.resolveByTypeOrName({ mimeType: input.mimeType, filename });
  }

  /**
   * Matching rule: MIME type first, extension as fallback.
   *
   *  1. The MIME type loses its parameters (`;...`) and is trimmed and
   *     lowercased.
   *  2. If it is informative (not empty, not `application/octet-stream`),
   *     loaders are matched on MIME type alone. A match wins, and the
   *     effective type is the given type.
   *  3. Otherwise, or if no loader matched the type, loaders are matched on
   *     the filename extension alone. The effective type is then the first
   *     concrete (non-wildcard) MIME type of the resolved loader, else
   *     `application/octet-stream`.
   *
   * Within a pass the highest `priority` wins, then configuration order.
   */
  resolveByTypeOrName(query: {
    mimeType?: string | undefined;
    filename?: string | undefined;
  }): Resolution {
    const mime = normalizeMimeType(query.mimeType);
    if (mime !== '' && mime !== OCTET_STREAM) {
      const hit = this.pick((l) => matchesMimeType(l.config.accepts, mime));
      if (hit) return { ok: true, entry: hit, mimeType: mime };
    }
    const filename = query.filename;
    if (filename) {
      const hit = this.pick((l) =>
        matchesExtension(l.config.accepts, filename)
      );
      if (hit) {
        const concrete = hit.config.accepts.mimeTypes?.find(
          (m) => !m.includes('*')
        );
        return {
          ok: true,
          entry: hit,
          mimeType: concrete ? normalizeMimeType(concrete) : OCTET_STREAM
        };
      }
    }
    return {
      ok: false,
      error: {
        code: 'no_loader',
        reason: `mime=${mime || '(none)'} filename=${filename ?? '(none)'}`
      }
    };
  }

  /**
   * MIME types and extensions accepted by enabled loaders that loaded
   * successfully. Deduplicated (extensions compared case-insensitively) in
   * registration order.
   */
  acceptedTypes(): { mimeTypes: string[]; extensions: string[] } {
    const mimeTypes: string[] = [];
    const extensions: string[] = [];
    for (const l of this.usable()) {
      for (const m of l.config.accepts.mimeTypes ?? []) {
        if (!mimeTypes.includes(m)) mimeTypes.push(m);
      }
      for (const e of l.config.accepts.extensions ?? []) {
        const lower = e.toLowerCase();
        if (!extensions.includes(lower)) extensions.push(lower);
      }
    }
    return { mimeTypes, extensions };
  }

  list(): LoaderHealth[] {
    const ok = this.loaders.map((l): LoaderHealth => {
      const base: LoaderHealth = {
        name: l.config.name,
        kind: l.config.kind,
        version: l.loader.version,
        enabled: l.enabled,
        status: l.status
      };
      return l.reason !== undefined ? { ...base, reason: l.reason } : base;
    });
    const failed = this.failed.map(
      (f): LoaderHealth => ({
        name: f.config.name,
        kind: f.config.kind,
        version: 'unknown',
        enabled: false,
        status: 'load_failed',
        reason: f.reason
      })
    );
    return [...ok, ...failed];
  }

  private usable(): RegisteredLoader[] {
    return this.loaders.filter((l) => l.enabled && l.status !== 'load_failed');
  }

  /** First usable loader matching `test`: highest priority, then config order. */
  private pick(
    test: (l: RegisteredLoader) => boolean
  ): RegisteredLoader | null {
    let best: RegisteredLoader | null = null;
    for (const l of this.usable()) {
      if (!test(l)) continue;
      if (
        best === null ||
        (l.config.priority ?? 0) > (best.config.priority ?? 0)
      )
        best = l;
    }
    return best;
  }
}

import type {
  DocumentLoader,
  LoaderInput,
  LoaderResolutionError,
} from '../../types/loader.js';
import type { LoaderConfig } from '../../types/postgram-config.js';

import { accepts } from './accept.js';

/** Per-loader runtime state. */
export type LoaderHealth = {
  name: string;
  kind: 'in-process' | 'sidecar';
  version: string;
  enabled: boolean;
  status: 'ok' | 'load_failed' | 'unhealthy';
  reason?: string;
};

export type RegisteredLoader = {
  loader: DocumentLoader;
  config: LoaderConfig;
  /** Mutable runtime state: enable/disable at runtime via admin endpoints. */
  enabled: boolean;
  status: LoaderHealth['status'];
  reason?: string;
};

export type FailedLoader = {
  config: LoaderConfig;
  reason: string;
};

/**
 * Holds the registered loaders and dispatches an input to the matching one.
 *
 * Resolution order:
 *   1. Filter to enabled loaders whose `accepts` matches.
 *   2. Sort by `config.priority` desc, then by registration order.
 *   3. First wins. We do not silently fall through on errors — a higher-
 *      priority loader's failure surfaces to the caller.
 */
export class LoaderRegistry {
  private readonly loaders: RegisteredLoader[];
  private readonly failed: FailedLoader[];

  constructor(loaders: RegisteredLoader[], failed: FailedLoader[] = []) {
    this.loaders = loaders;
    this.failed = failed;
  }

  resolve(
    input: LoaderInput,
  ):
    | { ok: true; entry: RegisteredLoader }
    | { ok: false; error: LoaderResolutionError } {
    const candidates = this.loaders
      .filter((l) => l.enabled && l.status !== 'load_failed')
      .filter((l) => accepts(l.config.accepts, input));

    if (candidates.length === 0) {
      return {
        ok: false,
        error: {
          code: 'no_loader',
          reason: describeInput(input),
        },
      };
    }

    // Stable sort: registration order is preserved within the same priority.
    const sorted = [...candidates]
      .map((l, idx) => ({ l, idx }))
      .sort((a, b) => {
        const pa = a.l.config.priority ?? 0;
        const pb = b.l.config.priority ?? 0;
        if (pa !== pb) return pb - pa;
        return a.idx - b.idx;
      })
      .map(({ l }) => l);

    return { ok: true, entry: sorted[0]! };
  }

  list(): LoaderHealth[] {
    const ok = this.loaders.map((l): LoaderHealth => {
      const base: LoaderHealth = {
        name: l.config.name,
        kind: l.config.kind,
        version: l.loader.version,
        enabled: l.enabled,
        status: l.status,
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
        reason: f.reason,
      }),
    );
    return [...ok, ...failed];
  }

  setEnabled(name: string, enabled: boolean): boolean {
    const entry = this.loaders.find((l) => l.config.name === name);
    if (!entry) return false;
    entry.enabled = enabled;
    return true;
  }
}

function describeInput(input: LoaderInput): string {
  if (input.kind === 'url') return `url=${input.url}`;
  if (input.kind === 'localPath')
    return `localPath mime=${input.mimeType}`;
  return `bytes mime=${input.mimeType}`;
}

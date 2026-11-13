import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { DocumentLoader } from '../../types/loader.js';
import type { InProcessLoaderConfig } from '../../types/loaders-config.js';

const RESOLVE_CONTRACT =
  'a loader package must be resolvable with CommonJS conditions: give it a `main` field, or an `exports` entry with a "default" or "require" condition (an `exports` map with only an "import" condition is not found)';

/**
 * Resolve and `import()` a loader package. `roots` is an ordered list of
 * directories that look like a Node project root (a `package.json` with the
 * loader installed under its `node_modules`, or reachable by parent
 * directory lookup). The first root that resolves the package wins.
 *
 * Contract for loader packages: the host resolves with `require.resolve`
 * rooted at `<root>/package.json`, so the package must be resolvable with
 * CommonJS conditions. Give it a `main` field, or an `exports` entry with a
 * `"default"` or `"require"` condition. A package whose `exports` map has
 * only an `"import"` condition cannot be found and fails with an error that
 * says so. The package may be ESM; the resolved file is loaded with
 * `import()`. It must export a `DocumentLoader` as default or as `loader`.
 *
 * The loader object is used as is. It is never modified, so a frozen export
 * works. A mismatch between `loader.name` and the configured name is the
 * caller's business (`buildRegistry` logs it).
 */
export async function importInProcessLoader(
  roots: string[],
  cfg: InProcessLoaderConfig
): Promise<DocumentLoader> {
  if (roots.length === 0) {
    throw new Error(
      `loader '${cfg.name}': cannot resolve package '${cfg.package}': no root directories to search`
    );
  }
  let resolved: string | undefined;
  let hitExportsMiss = false;
  const failures: string[] = [];
  for (const root of roots) {
    const req = createRequire(path.resolve(root, 'package.json'));
    try {
      resolved = req.resolve(cfg.package);
      break;
    } catch (err) {
      if ((err as { code?: string }).code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
        hitExportsMiss = true;
      }
      failures.push(`${root} (${errorMessage(err).split('\n')[0]})`);
    }
  }
  if (resolved === undefined) {
    throw new Error(
      `loader '${cfg.name}': cannot resolve package '${cfg.package}' from any root, tried in order: ${failures.join('; ')}` +
        (hitExportsMiss ? `. Note: ${RESOLVE_CONTRACT}` : '')
    );
  }
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(resolved).href)) as Record<
      string,
      unknown
    >;
  } catch (err) {
    throw new Error(
      `loader '${cfg.name}': failed to import package '${cfg.package}' (${resolved}): ${errorMessage(err)}`
    );
  }
  const candidate = pickLoaderExport(mod);
  if (!candidate) {
    throw new Error(
      `loader '${cfg.name}': package '${cfg.package}' did not export a DocumentLoader (expected default or named 'loader')`
    );
  }
  return candidate;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function pickLoaderExport(
  mod: Record<string, unknown>
): DocumentLoader | undefined {
  const candidates: unknown[] = [
    mod.default,
    (mod.default as { default?: unknown } | undefined)?.default,
    mod.loader
  ];
  for (const c of candidates) {
    if (isLoaderShape(c)) return c;
  }
  return undefined;
}

function isLoaderShape(value: unknown): value is DocumentLoader {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === 'string' &&
    typeof v.version === 'string' &&
    typeof v.accepts === 'object' &&
    v.accepts !== null &&
    typeof v.load === 'function'
  );
}

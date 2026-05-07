import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { DocumentLoader } from '../../types/loader.js';
import type { InProcessLoaderConfig } from '../../types/postgram-config.js';

/**
 * Resolve and `import()` a loader package from `pluginsDir`. The mounted
 * plugins directory is expected to look like a typical Node project root —
 * a `package.json` with the loader installed under its `node_modules`.
 *
 * We try a CommonJS `require.resolve` rooted at `pluginsDir/package.json`
 * (which is what `npm install`'s tree resolution understands) and convert
 * the resolved file path to a `file://` URL for ESM `import()`.
 */
export async function importInProcessLoader(
  pluginsDir: string,
  cfg: InProcessLoaderConfig,
): Promise<DocumentLoader> {
  const resolveRoot = path.resolve(pluginsDir, 'package.json');
  const req = createRequire(resolveRoot);
  let resolved: string;
  try {
    resolved = req.resolve(cfg.package);
  } catch (err) {
    throw new Error(
      `loader '${cfg.name}': cannot resolve package '${cfg.package}' from ${pluginsDir} (${(err as Error).message})`,
    );
  }
  const url = pathToFileURL(resolved).href;
  const mod = (await import(url)) as Record<string, unknown>;
  const candidate = pickLoaderExport(mod);
  if (!candidate) {
    throw new Error(
      `loader '${cfg.name}': package '${cfg.package}' did not export a DocumentLoader (expected default or named 'loader')`,
    );
  }
  validateLoaderShape(cfg.name, candidate);
  return candidate;
}

function pickLoaderExport(
  mod: Record<string, unknown>,
): DocumentLoader | undefined {
  const candidates: unknown[] = [
    mod.default,
    (mod.default as { default?: unknown } | undefined)?.default,
    mod.loader,
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

function validateLoaderShape(
  configName: string,
  loader: DocumentLoader,
): void {
  if (loader.name !== configName) {
    // Not fatal — the config name is what postgram dispatches by — but worth
    // surfacing because it usually means the user mis-registered the loader.
    // We attach the mismatch to the loader for the admin endpoint to surface.
    Object.assign(loader, { __nameMismatch: true });
  }
}

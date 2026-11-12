import { fileURLToPath } from 'node:url';

import type pino from 'pino';

import type { LoadersConfig } from '../../types/loaders-config.js';

import { importInProcessLoader } from './in-process-importer.js';
import {
  LoaderRegistry,
  type FailedLoader,
  type RegisteredLoader
} from './registry.js';
import { SidecarLoaderClient } from './sidecar-client.js';

/**
 * Server application root: three levels above this file, which is the
 * repository root for both `src/` (tsx) and `dist/` (compiled) layouts.
 */
const DEFAULT_APP_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const MANIFEST_PROBE_TIMEOUT_MS = 5_000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type BuildRegistryDeps = {
  /** Application root searched after `pluginsDir`. */
  appRoot?: string;
  importer?: typeof importInProcessLoader;
  /** Factory so tests can substitute a fake. */
  sidecarFactory?: (
    cfg: ConstructorParameters<typeof SidecarLoaderClient>[0]
  ) => SidecarLoaderClient;
};

/**
 * Build the LoaderRegistry from a parsed `LoadersConfig`. Each entry is
 * registered independently, so one loader that fails to import (or a sidecar
 * that cannot be set up) does not block the others and never throws out of
 * this function. Failed entries are recorded with their reason and show up in
 * `registry.list()` as `load_failed`. An unreachable sidecar is not a
 * failure: it is registered and its manifest probe is only logged.
 */
export async function buildRegistry(
  cfg: LoadersConfig,
  logger: pino.Logger,
  deps: BuildRegistryDeps = {}
): Promise<LoaderRegistry> {
  const importer = deps.importer ?? importInProcessLoader;
  const sidecarFactory =
    deps.sidecarFactory ?? ((c) => new SidecarLoaderClient(c));

  const roots = [
    ...(cfg.pluginsDir ? [cfg.pluginsDir] : []),
    deps.appRoot ?? DEFAULT_APP_ROOT
  ];
  const ok: RegisteredLoader[] = [];
  const failed: FailedLoader[] = [];

  for (const entry of cfg.loaders) {
    if (!entry.enabled) {
      logger.info(
        { loader: entry.name },
        'loader disabled in config; skipping'
      );
      continue;
    }

    try {
      if (entry.kind === 'in-process') {
        const loader = await importer(roots, entry);
        if (loader.name !== entry.name) {
          logger.warn(
            {
              loader: entry.name,
              loaderReportedName: loader.name,
              package: entry.package
            },
            'loader reports a different name than the configured one; the configured name is used'
          );
        }
        ok.push({
          loader,
          config: entry,
          enabled: true,
          status: 'ok'
        });
        logger.info(
          {
            loader: entry.name,
            version: loader.version,
            package: entry.package
          },
          'in-process loader registered'
        );
      } else {
        const client = sidecarFactory(entry);
        const manifest = await client
          .probeManifest(AbortSignal.timeout(MANIFEST_PROBE_TIMEOUT_MS))
          .catch((err: unknown) => {
            logger.warn(
              { loader: entry.name, err: errorMessage(err) },
              'sidecar manifest probe failed (loader still registered)'
            );
            return null;
          });
        ok.push({
          loader: client,
          config: entry,
          enabled: true,
          status: 'ok'
        });
        logger.info(
          {
            loader: entry.name,
            endpoint: entry.endpoint,
            version: manifest?.version ?? 'unknown'
          },
          'sidecar loader registered'
        );
      }
    } catch (err) {
      const reason = errorMessage(err);
      failed.push({ config: entry, reason });
      logger.error(
        { loader: entry.name, kind: entry.kind, reason },
        'loader registration failed'
      );
    }
  }

  return new LoaderRegistry(ok, failed);
}

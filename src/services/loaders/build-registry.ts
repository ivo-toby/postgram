import type pino from 'pino';

import type { PostgramConfig } from '../../types/postgram-config.js';

import { importInProcessLoader } from './in-process-importer.js';
import {
  LoaderRegistry,
  type FailedLoader,
  type RegisteredLoader,
} from './registry.js';
import { SidecarLoaderClient } from './sidecar-client.js';

export type BuildRegistryDeps = {
  importer?: typeof importInProcessLoader;
  /** Factory so tests can substitute a fake. */
  sidecarFactory?: (cfg: ConstructorParameters<typeof SidecarLoaderClient>[0]) =>
    SidecarLoaderClient;
};

/**
 * Build the LoaderRegistry from a parsed `PostgramConfig`. Each entry is
 * registered independently — one loader's failure to import or its sidecar's
 * unreachability does not block the others. Failed entries are recorded so
 * the admin endpoint can surface them.
 */
export async function buildRegistry(
  cfg: PostgramConfig,
  logger: pino.Logger,
  deps: BuildRegistryDeps = {},
): Promise<LoaderRegistry> {
  const importer = deps.importer ?? importInProcessLoader;
  const sidecarFactory =
    deps.sidecarFactory ?? ((c) => new SidecarLoaderClient(c));

  const ok: RegisteredLoader[] = [];
  const failed: FailedLoader[] = [];

  for (const entry of cfg.loaders) {
    if (!entry.enabled) {
      logger.info({ loader: entry.name }, 'loader disabled in config; skipping');
      continue;
    }

    try {
      if (entry.kind === 'in-process') {
        const loader = await importer(cfg.pluginsDir, entry);
        ok.push({
          loader,
          config: entry,
          enabled: true,
          status: 'ok',
        });
        logger.info(
          { loader: entry.name, version: loader.version, package: entry.package },
          'in-process loader registered',
        );
      } else {
        const client = sidecarFactory(entry);
        const manifest = await client
          .probeManifest()
          .catch((err: unknown) => {
            logger.warn(
              { loader: entry.name, err: (err as Error).message },
              'sidecar manifest probe failed (loader still registered)',
            );
            return null;
          });
        ok.push({
          loader: client,
          config: entry,
          enabled: true,
          status: 'ok',
        });
        logger.info(
          {
            loader: entry.name,
            endpoint: entry.endpoint,
            version: manifest?.version ?? 'unknown',
          },
          'sidecar loader registered',
        );
      }
    } catch (err) {
      const reason = (err as Error).message ?? String(err);
      failed.push({ config: entry, reason });
      logger.error(
        { loader: entry.name, kind: entry.kind, reason },
        'loader registration failed',
      );
    }
  }

  return new LoaderRegistry(ok, failed);
}

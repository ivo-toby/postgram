import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Pool } from 'pg';

import { FilesystemAttachmentStore } from '../../src/services/loaders/attachment-store.js';
import {
  LoaderRegistry,
  type RegisteredLoader
} from '../../src/services/loaders/registry.js';
import type { DocumentLoader } from '../../src/types/loader.js';
import type { InProcessLoaderConfig } from '../../src/types/loaders-config.js';

/** A real registry holding one in-memory loader that accepts PDF and text. */
export function createFakeRegistry(): LoaderRegistry {
  const accepts = {
    mimeTypes: ['application/pdf', 'text/plain'],
    extensions: ['.pdf', '.txt']
  };
  const loader: DocumentLoader = {
    name: 'fake',
    version: '0.0.1',
    accepts,
    load: () => Promise.resolve({ documentType: 'fake', blocks: [] })
  };
  const config = {
    kind: 'in-process' as const,
    name: 'fake',
    package: '@x/fake',
    accepts,
    priority: 0,
    options: {},
    enabled: true
  } as InProcessLoaderConfig;
  const entry: RegisteredLoader = {
    loader,
    config,
    enabled: true,
    status: 'ok'
  };
  return new LoaderRegistry([entry]);
}

export type TempStore = {
  root: string;
  store: FilesystemAttachmentStore;
  cleanup: () => Promise<void>;
};

/**
 * Wait until some backend of the current database is blocked on the ingest
 * advisory lock of `sha256` (see `lockIngestSha`). Matching the exact key keeps
 * an unrelated waiting lock from satisfying the test.
 */
export async function waitForBlockedIngestLock(
  pool: Pool,
  sha256: string,
  timeoutMs = 30_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ n: string }>(
      `
        SELECT count(*)::text AS n
        FROM pg_locks l
        WHERE l.locktype = 'advisory'
          AND NOT l.granted
          AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND ((l.classid::bigint << 32) | l.objid::bigint)
              = hashtext('ingest:' || $1::text)::bigint
      `,
      [sha256]
    );
    if (Number(result.rows[0]!.n) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`nothing waited on the ingest lock of ${sha256}`);
}

export async function createTempStore(): Promise<TempStore> {
  const root = await mkdtemp(path.join(tmpdir(), 'pgm-attachments-'));
  return {
    root,
    store: new FilesystemAttachmentStore(root),
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

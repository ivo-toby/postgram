import { pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import { Pool as PgPool } from 'pg';

import { readTalonThreads } from './reader.js';
import { transformTalonMemoryItem } from './transformer.js';

export type MigrationSummary = {
  dryRun: boolean;
  threadsProcessed: number;
  imported: number;
  skippedExisting: number;
  skippedEmpty: number;
  skippedEmbeddingRefs: number;
};

export type MigrationOptions = {
  sqlitePath: string;
  apiBaseUrl: string;
  apiKey: string;
  pool: Pool;
  dryRun?: boolean | undefined;
  threadId?: string | undefined;
  batchSize?: number | undefined;
  skipEmbeddings?: boolean | undefined;
  fetchImpl?: typeof fetch | undefined;
};

type ExistingEntity = {
  metadata?: Record<string, unknown> | null;
};

type EntityListResponse = {
  items?: ExistingEntity[];
  total?: number;
};

type CreatedEntityResponse = {
  entity?: {
    id?: string;
  };
};

function getFetchImplementation(
  fetchImpl?: typeof fetch | undefined
): typeof fetch {
  if (fetchImpl) {
    return fetchImpl;
  }

  if (typeof globalThis.fetch !== 'function') {
    throw new Error('Fetch is not available in this environment');
  }

  return globalThis.fetch.bind(globalThis);
}

function getExistingKey(metadata: Record<string, unknown> | null | undefined) {
  const threadId =
    typeof metadata?.talon_thread_id === 'string'
      ? metadata.talon_thread_id
      : null;
  const talonId =
    typeof metadata?.talon_id === 'string' ? metadata.talon_id : null;

  if (!threadId || !talonId) {
    return null;
  }

  return `${threadId}:${talonId}`;
}

async function fetchExistingTalonEntities(
  apiBaseUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch
): Promise<Map<string, Set<string>>> {
  const existing = new Map<string, Set<string>>();
  const pageSize = 100;
  let offset = 0;

  for (;;) {
    const url = new URL('/api/entities', apiBaseUrl);
    url.searchParams.set('type', 'memory');
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('offset', String(offset));

    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to list existing entities: ${response.status}`);
    }

    const body = (await response.json()) as EntityListResponse;
    const items = body.items ?? [];

    for (const item of items) {
      const key = getExistingKey(item.metadata);
      if (!key) {
        continue;
      }

      const separatorIndex = key.indexOf(':');
      if (separatorIndex < 0) {
        continue;
      }

      const threadId = key.slice(0, separatorIndex);
      const talonId = key.slice(separatorIndex + 1);
      const threadEntries = existing.get(threadId) ?? new Set<string>();
      threadEntries.add(talonId);
      existing.set(threadId, threadEntries);
    }

    if (items.length < pageSize) {
      break;
    }

    offset += items.length;
  }

  return existing;
}

async function disableUpdatedAtTrigger(
  pool: Pool,
  entityId: string,
  createdAt: string,
  updatedAt: string
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('ALTER TABLE entities DISABLE TRIGGER trg_entities_updated_at');
    await client.query(
      `
        UPDATE entities
        SET created_at = $1,
            updated_at = $2
        WHERE id = $3
      `,
      [createdAt, updatedAt, entityId]
    );
  } finally {
    await client.query('ALTER TABLE entities ENABLE TRIGGER trg_entities_updated_at');
    client.release();
  }
}

async function postTalonEntity(
  options: MigrationOptions,
  payload: TalonPostPayload
): Promise<string> {
  const fetchImpl = getFetchImplementation(options.fetchImpl);
  const url = new URL('/api/entities', options.apiBaseUrl);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Failed to create entity: ${response.status}`);
  }

  const body = (await response.json()) as CreatedEntityResponse;
  const entityId = body.entity?.id;

  if (!entityId) {
    throw new Error('Migration response did not include an entity id');
  }

  return entityId;
}

type TalonPostPayload = {
  type: 'memory';
  content: string;
  visibility: 'shared';
  tags: string[];
  metadata: Record<string, unknown>;
};

export async function migrateTalon(
  options: MigrationOptions
): Promise<MigrationSummary> {
  const fetchImpl = getFetchImplementation(options.fetchImpl);
  const { threads, skippedEmbeddingRefs } = readTalonThreads(options.sqlitePath, {
    threadId: options.threadId
  });
  const existing = await fetchExistingTalonEntities(
    options.apiBaseUrl,
    options.apiKey,
    fetchImpl
  );

  const summary: MigrationSummary = {
    dryRun: options.dryRun ?? false,
    threadsProcessed: 0,
    imported: 0,
    skippedExisting: 0,
    skippedEmpty: 0,
    skippedEmbeddingRefs
  };

  for (const thread of threads) {
    summary.threadsProcessed += 1;
    const importedInThread = existing.get(thread.threadId) ?? new Set<string>();

    for (const row of thread.items) {
      const transformed = transformTalonMemoryItem(row);
      if (!transformed) {
        summary.skippedEmpty += 1;
        continue;
      }

      if (importedInThread.has(transformed.talonId)) {
        summary.skippedExisting += 1;
        continue;
      }

      if (summary.dryRun) {
        continue;
      }

      const entityId = await postTalonEntity(options, transformed.entity);
      await disableUpdatedAtTrigger(
        options.pool,
        entityId,
        transformed.createdAt,
        transformed.updatedAt
      );
      summary.imported += 1;
    }
  }

  return summary;
}

async function main(): Promise<void> {
  const [sqlitePath, ...argv] = process.argv.slice(2);

  if (!sqlitePath) {
    throw new Error('Usage: migrate-talon <sqlite-path> [--dry-run] [--thread <id>]');
  }

  let dryRun = false;
  let threadId: string | undefined;
  let apiBaseUrl: string | undefined;
  let apiKey: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '--thread') {
      threadId = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--api-url') {
      apiBaseUrl = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--api-key') {
      apiKey = argv[index + 1];
      index += 1;
      continue;
    }
  }

  if (!apiBaseUrl) {
    apiBaseUrl = process.env.PGM_API_URL ?? 'http://127.0.0.1:3000';
  }

  if (!apiKey) {
    apiKey = process.env.PGM_API_KEY ?? '';
  }

  if (!apiKey) {
    throw new Error('Missing API key. Pass --api-key or set PGM_API_KEY.');
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL for migration CLI.');
  }

  const pool = new PgPool({ connectionString: databaseUrl });

  const summary = await migrateTalon({
    sqlitePath,
    apiBaseUrl,
    apiKey,
    pool,
    dryRun,
    threadId
  });

  console.log(JSON.stringify(summary, null, 2));
  await pool.end();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

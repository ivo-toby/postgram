import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createKey } from '../../src/auth/key-service.js';
import { createApp } from '../../src/index.js';
import { migrateTalon } from '../../src/migrate-talon/index.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

type TalonMemorySeed = {
  id: string;
  threadId: string;
  type: 'fact' | 'summary' | 'note' | 'embedding_ref';
  content: string;
  embeddingRef: string | null;
  metadata: string;
  createdAt: number;
  updatedAt: number;
};

function createTalonSqliteFile(rows: TalonMemorySeed[]): {
  sqlitePath: string;
  cleanup: () => void;
} {
  const tempDir = mkdtempSync(join(tmpdir(), 'postgram-talon-'));
  const sqlitePath = join(tempDir, 'talon.db');
  const db = new DatabaseSync(sqlitePath);

  db.exec(`
    CREATE TABLE memory_items (
      id TEXT,
      thread_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding_ref TEXT,
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (thread_id, id)
    )
  `);

  const insert = db.prepare(`
    INSERT INTO memory_items (
      id,
      thread_id,
      type,
      content,
      embedding_ref,
      metadata,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const row of rows) {
    insert.run(
      row.id,
      row.threadId,
      row.type,
      row.content,
      row.embeddingRef,
      row.metadata,
      row.createdAt,
      row.updatedAt
    );
  }

  db.close();

  return {
    sqlitePath,
    cleanup: () => {
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function createAppFetch(app: ReturnType<typeof createApp>): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    return app.fetch(request);
  };
}

async function createAuthorizedMigrationContext(database: TestDatabase) {
  const created = (await createKey(database.pool, {
    name: `talon-${crypto.randomUUID()}`,
    scopes: ['read', 'write'],
    allowedVisibility: ['shared']
  }))._unsafeUnwrap();

  return {
    app: createApp({
      pool: database.pool
    }),
    apiKey: created.plaintextKey
  };
}

async function listMemoryEntities(
  app: ReturnType<typeof createApp>,
  apiKey: string
): Promise<{
  total: number;
  items: Array<{
    id: string;
    content: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }>;
}> {
  const response = await app.request('/api/entities?type=memory&limit=100', {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  expect(response.status).toBe(200);
  return (await response.json()) as {
    total: number;
    items: Array<{
      id: string;
      content: string | null;
      metadata: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    }>;
  };
}

describe('Talon migration', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('dry-runs without writing and reports the items that would migrate', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await resetTestDatabase(database.pool);

    const source = createTalonSqliteFile([
      {
        id: 'fact-1',
        threadId: 'thread-1',
        type: 'fact',
        content: 'Postgres powers the knowledge store',
        embeddingRef: null,
        metadata: '{"topic":"architecture"}',
        createdAt: 1710000000000,
        updatedAt: 1710000600000
      },
      {
        id: 'summary-1',
        threadId: 'thread-1',
        type: 'summary',
        content: 'Use pgvector for semantic search',
        embeddingRef: null,
        metadata: '{"topic":"summary"}',
        createdAt: 1710001000000,
        updatedAt: 1710001600000
      },
      {
        id: 'note-1',
        threadId: 'thread-2',
        type: 'note',
        content: 'Keep migration idempotent',
        embeddingRef: null,
        metadata: 'not-json',
        createdAt: 1710002000000,
        updatedAt: 1710002600000
      },
      {
        id: 'ref-1',
        threadId: 'thread-2',
        type: 'embedding_ref',
        content: 'skip me',
        embeddingRef: 'chroma://ref-1',
        metadata: '{}',
        createdAt: 1710003000000,
        updatedAt: 1710003600000
      }
    ]);

    try {
      const { app, apiKey } = await createAuthorizedMigrationContext(database);
      const result = await migrateTalon({
        sqlitePath: source.sqlitePath,
        apiBaseUrl: 'http://postgram.test',
        apiKey,
        pool: database.pool,
        dryRun: true,
        fetchImpl: createAppFetch(app)
      });

      expect(result).toMatchObject({
        dryRun: true,
        imported: 0,
        skippedEmbeddingRefs: 1,
        skippedExisting: 0,
        skippedEmpty: 0,
        threadsProcessed: 2
      });

      const listed = await listMemoryEntities(app, apiKey);
      expect(listed.total).toBe(0);
      expect(listed.items).toEqual([]);
    } finally {
      source.cleanup();
    }
  }, 120_000);

  it('preserves timestamps and reruns without duplicating thread imports', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await resetTestDatabase(database.pool);

    const source = createTalonSqliteFile([
      {
        id: 'fact-1',
        threadId: 'thread-1',
        type: 'fact',
        content: 'Postgres powers the knowledge store',
        embeddingRef: null,
        metadata: '{"topic":"architecture"}',
        createdAt: 1710000000000,
        updatedAt: 1710000600000
      },
      {
        id: 'summary-1',
        threadId: 'thread-1',
        type: 'summary',
        content: 'Use pgvector for semantic search',
        embeddingRef: null,
        metadata: '{"topic":"summary"}',
        createdAt: 1710001000000,
        updatedAt: 1710001600000
      },
      {
        id: 'note-1',
        threadId: 'thread-2',
        type: 'note',
        content: 'Keep migration idempotent',
        embeddingRef: null,
        metadata: 'not-json',
        createdAt: 1710002000000,
        updatedAt: 1710002600000
      },
      {
        id: 'ref-1',
        threadId: 'thread-2',
        type: 'embedding_ref',
        content: 'skip me',
        embeddingRef: 'chroma://ref-1',
        metadata: '{}',
        createdAt: 1710003000000,
        updatedAt: 1710003600000
      }
    ]);

    try {
      const { app, apiKey } = await createAuthorizedMigrationContext(database);
      const firstRun = await migrateTalon({
        sqlitePath: source.sqlitePath,
        apiBaseUrl: 'http://postgram.test',
        apiKey,
        pool: database.pool,
        threadId: 'thread-1',
        fetchImpl: createAppFetch(app)
      });

      expect(firstRun).toMatchObject({
        imported: 2,
        skippedEmbeddingRefs: 0,
        skippedExisting: 0,
        threadsProcessed: 1
      });

      const afterPartial = await listMemoryEntities(app, apiKey);
      expect(afterPartial.total).toBe(2);
      expect(afterPartial.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            content: 'Postgres powers the knowledge store',
            created_at: new Date(1710000000000).toISOString(),
            updated_at: new Date(1710000600000).toISOString(),
            metadata: expect.objectContaining({
              topic: 'architecture',
              talon_id: 'fact-1',
              talon_thread_id: 'thread-1',
              namespace: 'facts'
            })
          }),
          expect.objectContaining({
            content: 'Use pgvector for semantic search',
            created_at: new Date(1710001000000).toISOString(),
            updated_at: new Date(1710001600000).toISOString(),
            metadata: expect.objectContaining({
              topic: 'summary',
              talon_id: 'summary-1',
              talon_thread_id: 'thread-1',
              namespace: 'summaries'
            })
          })
        ])
      );

      const secondRun = await migrateTalon({
        sqlitePath: source.sqlitePath,
        apiBaseUrl: 'http://postgram.test',
        apiKey,
        pool: database.pool,
        fetchImpl: createAppFetch(app)
      });

      expect(secondRun).toMatchObject({
        imported: 1,
        skippedExisting: 2,
        skippedEmbeddingRefs: 1,
        threadsProcessed: 2
      });

      const afterRerun = await listMemoryEntities(app, apiKey);
      expect(afterRerun.total).toBe(3);
      expect(afterRerun.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            content: 'Keep migration idempotent',
            created_at: new Date(1710002000000).toISOString(),
            updated_at: new Date(1710002600000).toISOString(),
            metadata: expect.objectContaining({
              talon_id: 'note-1',
              talon_thread_id: 'thread-2',
              namespace: 'notes'
            })
          })
        ])
      );
    } finally {
      source.cleanup();
    }
  }, 120_000);
});

import { Pool } from 'pg';
import { GenericContainer, Wait } from 'testcontainers';

import { runMigrations } from '../../src/db/migrate.js';
import type { Scope } from '../../src/auth/types.js';
import type { EntityType, Visibility } from '../../src/types/entities.js';

export type TestDatabase = {
  pool: Pool;
  close: () => Promise<void>;
};

async function waitForPostgres(pool: Pool): Promise<void> {
  const maxAttempts = 30;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 500);
      });
    }
  }
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const container = await new GenericContainer('pgvector/pgvector:pg17')
    .withEnvironment({
      POSTGRES_DB: 'postgram',
      POSTGRES_USER: 'postgram',
      POSTGRES_PASSWORD: 'postgram'
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage('database system is ready to accept connections')
    )
    .start();

  const pool = new Pool({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    database: 'postgram',
    user: 'postgram',
    password: 'postgram'
  });

  await waitForPostgres(pool);
  await runMigrations(pool);

  return {
    pool,
    close: async () => {
      await pool.end();
      await container.stop();
    }
  };
}

export async function resetTestDatabase(pool: Pool): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE
      audit_log,
      chunks,
      attachments,
      document_sources,
      edges,
      entities,
      api_keys,
      embedding_models
    RESTART IDENTITY CASCADE
  `);

  await pool.query(`
    INSERT INTO embedding_models (
      name,
      provider,
      dimensions,
      chunk_size,
      chunk_overlap,
      is_active
    )
    VALUES (
      'text-embedding-3-small',
      'openai',
      1536,
      300,
      100,
      true
    )
  `);
}

export async function seedApiKey(
  pool: Pool,
  input: {
    id: string;
    name: string;
    scopes?: Scope[];
    allowedTypes?: EntityType[] | null;
    allowedVisibility?: Visibility[];
  }
): Promise<void> {
  await pool.query(
    `
      INSERT INTO api_keys (
        id,
        name,
        key_hash,
        key_prefix,
        scopes,
        allowed_types,
        allowed_visibility,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, true)
    `,
    [
      input.id,
      input.name,
      'test-hash',
      input.name.slice(0, 8),
      input.scopes ?? ['read', 'write', 'delete'],
      input.allowedTypes ?? null,
      input.allowedVisibility ?? ['personal', 'work', 'shared']
    ]
  );
}

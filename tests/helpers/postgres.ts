import { Pool } from 'pg';
import { GenericContainer, Wait } from 'testcontainers';

import { runMigrations } from '../../src/db/migrate.js';

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

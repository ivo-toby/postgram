import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createPool } from '../../src/db/pool.js';
import { createTestDatabase, type TestDatabase } from '../helpers/postgres.js';

describe('createPool backend termination', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('survives termination of both an idle and a checked-out backend', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const logger = { error: vi.fn(), warn: vi.fn() };
    const pool = createPool(database.connectionString, logger);
    let released = false;

    // Check out a client first so the pool.query below has to open a second
    // connection, which then sits idle in the pool.
    const held = await pool.connect();

    try {
      const heldPid = (
        await held.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      ).rows[0]?.pid;
      const idlePid = (
        await pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      ).rows[0]?.pid;

      expect(heldPid).toBeDefined();
      expect(idlePid).toBeDefined();
      expect(idlePid).not.toBe(heldPid);
      expect(pool.idleCount).toBe(1);

      // Terminate from the helper's pool and target only the pool under test.
      // The helper pool has no error listener, so terminating its idle clients
      // would crash the run for reasons unrelated to createPool.
      await database.pool.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid = ANY($1::int[])',
        [[heldPid, idlePid]]
      );

      // Both clients report the disconnect through the client-level listener;
      // the idle one also reaches the pool-level listener.
      await vi.waitFor(
        () => {
          expect(logger.warn.mock.calls.length).toBeGreaterThanOrEqual(2);
          expect(logger.error).toHaveBeenCalledTimes(1);
        },
        { timeout: 5_000 }
      );
      expect(logger.warn).toHaveBeenCalledWith(
        { err: expect.any(Error) as unknown as Error },
        'PostgreSQL client connection error'
      );
      expect(logger.error).toHaveBeenCalledWith(
        { err: expect.any(Error) as unknown as Error },
        'Unexpected error on idle PostgreSQL client'
      );
      expect(pool.idleCount).toBe(0);

      await expect(held.query('SELECT 1')).rejects.toThrow();
      expect(() => {
        held.release();
      }).not.toThrow();
      released = true;

      const fresh = await pool.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid'
      );
      expect([heldPid, idlePid]).not.toContain(fresh.rows[0]?.pid);
      expect(pool.totalCount).toBe(1);
    } finally {
      if (!released) {
        held.release(true);
      }
      await pool.end();
    }
  }, 120_000);
});

import { describe, expect, it, vi } from 'vitest';
import { createPool } from '../../src/db/pool.js';

describe('createPool', () => {
  it('registers an error listener that handles idle client errors without crashing', async () => {
    const errorLog = vi.fn();
    const logger = { error: errorLog };
    const pool = createPool('postgres://postgram:secret@localhost:5432/postgram', logger);

    try {
      expect(pool.listenerCount('error')).toBeGreaterThan(0);

      const testError = new Error('terminating connection due to administrator command');
      expect(() => {
        pool.emit('error', testError);
      }).not.toThrow();

      expect(errorLog).toHaveBeenCalledWith(
        { err: testError },
        'Unexpected error on idle PostgreSQL client'
      );
    } finally {
      await pool.end();
    }
  });

  it('falls back to console.error when no logger is supplied', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pool = createPool('postgres://postgram:secret@localhost:5432/postgram');

    try {
      const testError = new Error('terminating connection due to administrator command');
      expect(() => {
        pool.emit('error', testError);
      }).not.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Unexpected error on idle PostgreSQL client:',
        testError
      );
    } finally {
      consoleSpy.mockRestore();
      await pool.end();
    }
  });
});

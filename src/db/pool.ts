import { Pool } from 'pg';

export function createPool(
  connectionString: string,
  logger?: { error: (obj: unknown, msg?: string) => void }
): Pool {
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 20
  });

  pool.on('error', (err) => {
    // Idle client errors happen when PostgreSQL shuts down, restarts, or closes idle sockets.
    // pg-pool automatically closes and purges the client from the pool.
    // Without this listener, Node.js emits an unhandled error and terminates the process.
    if (logger) {
      logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
    } else {
      console.error('Unexpected error on idle PostgreSQL client:', err);
    }
  });

  return pool;
}

export async function checkDatabaseHealth(pool: Pool): Promise<'connected' | 'disconnected'> {
  try {
    await pool.query('SELECT 1');
    return 'connected';
  } catch {
    return 'disconnected';
  }
}

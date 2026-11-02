import { Pool } from 'pg';

export type PoolLogger = {
  error: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
};

export function createPool(
  connectionString: string,
  logger?: PoolLogger
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

  pool.on('connect', (client) => {
    // pg-pool only listens for errors while a client is idle. A checked-out client that
    // loses its connection emits 'error' on the client itself, which crashes the process
    // without this listener. The client becomes unqueryable and pg-pool discards it on
    // release(). Idle errors also reach the pool listener above, so this one logs at warn.
    client.on('error', (err) => {
      if (logger) {
        logger.warn({ err }, 'PostgreSQL client connection error');
      } else {
        console.warn('PostgreSQL client connection error:', err);
      }
    });
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


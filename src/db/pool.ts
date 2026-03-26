import { Pool } from 'pg';

export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString
  });
}

export async function checkDatabaseHealth(pool: Pool): Promise<'connected' | 'disconnected'> {
  try {
    await pool.query('SELECT 1');
    return 'connected';
  } catch {
    return 'disconnected';
  }
}

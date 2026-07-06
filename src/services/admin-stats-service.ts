import type { Pool } from 'pg';

export type AdminStats = {
  entityCounts: Record<string, number>;
  chunkCount: number;
  keyCount: number;
  databaseSizeBytes: number;
  uptimeSeconds: number;
};

export async function getAdminStats(
  pool: Pool,
  input: {
    actorAdminUserId: string;
  }
): Promise<AdminStats> {
  const [
    entityCountsResult,
    chunkCountResult,
    keyCountResult,
    databaseSizeResult,
    uptimeResult
  ] = await Promise.all([
    pool.query<{ type: string; count: string }>(
      `
        SELECT type, count(*)::text AS count
        FROM entities
        GROUP BY type
        ORDER BY type ASC
      `
    ),
    pool.query<{ count: string }>('SELECT count(*)::text AS count FROM chunks'),
    pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM api_keys'
    ),
    pool.query<{ size: string }>(
      'SELECT pg_database_size(current_database())::text AS size'
    ),
    pool.query<{ uptime: string }>(
      'SELECT EXTRACT(EPOCH FROM now() - pg_postmaster_start_time())::text AS uptime'
    )
  ]);

  await pool.query(
    `
      INSERT INTO audit_log (
        api_key_id,
        admin_user_id,
        operation,
        entity_id,
        details
      )
      VALUES (NULL, $1, 'stats.view', NULL, '{}')
    `,
    [input.actorAdminUserId]
  );

  return {
    entityCounts: Object.fromEntries(
      entityCountsResult.rows.map((row) => [
        row.type,
        Number.parseInt(row.count, 10)
      ])
    ),
    chunkCount: Number.parseInt(chunkCountResult.rows[0]?.count ?? '0', 10),
    keyCount: Number.parseInt(keyCountResult.rows[0]?.count ?? '0', 10),
    databaseSizeBytes: Number.parseInt(
      databaseSizeResult.rows[0]?.size ?? '0',
      10
    ),
    uptimeSeconds: Math.floor(Number(uptimeResult.rows[0]?.uptime ?? '0'))
  };
}

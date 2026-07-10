import type { Pool } from 'pg';

import type { AuthContext } from '../auth/types.js';
import { getQueueStatus, type QueueStatus } from './queue-service.js';

export type AdminHealthDiagnostics = {
  status: 'ok' | 'degraded';
  postgres: 'connected';
  embeddingModel: string | null;
};

export type AdminEmbeddingModelDiagnostics = {
  id: string;
  name: string;
  provider: string;
  dimensions: number;
  chunkSize: number;
  chunkOverlap: number;
  isActive: boolean;
  createdAt: string;
};

export type AdminConfigStatusDiagnostics = {
  settings: {
    total: number;
    byState: Record<string, number>;
    byClassification: Record<string, number>;
    byValidationStatus: Record<string, number>;
  };
  secrets: {
    totalConfigured: number;
    byPurpose: Record<string, number>;
    byValidationStatus: Record<string, number>;
  };
};

type EmbeddingModelRow = {
  id: string;
  name: string;
  provider: string;
  dimensions: number;
  chunk_size: number;
  chunk_overlap: number;
  is_active: boolean;
  created_at: Date;
};

type CountRow = {
  bucket: string;
  count: string;
};

const ADMIN_DIAGNOSTICS_AUTH: AuthContext = {
  apiKeyId: null,
  keyName: 'admin-diagnostics',
  clientId: null,
  scopes: ['read'],
  allowedTypes: null,
  allowedVisibility: ['personal', 'work', 'shared']
};

function toCountMap(rows: CountRow[]): Record<string, number> {
  return Object.fromEntries(
    rows.map((row) => [row.bucket, Number.parseInt(row.count, 10)])
  );
}

export async function getAdminHealthDiagnostics(
  pool: Pool
): Promise<AdminHealthDiagnostics> {
  const result = await pool.query<{ name: string }>(
    `
      SELECT name
      FROM embedding_models
      WHERE is_active = true
      LIMIT 1
    `
  );

  return {
    status: 'ok',
    postgres: 'connected',
    embeddingModel: result.rows[0]?.name ?? null
  };
}

export async function getAdminQueueDiagnostics(
  pool: Pool,
  options: {
    extractionEnabled?: boolean | undefined;
  } = {}
): Promise<QueueStatus> {
  return getQueueStatus(pool, ADMIN_DIAGNOSTICS_AUTH, {
    ...(options.extractionEnabled !== undefined
      ? { extractionEnabled: options.extractionEnabled }
      : {})
  });
}

export async function listAdminEmbeddingModels(
  pool: Pool
): Promise<AdminEmbeddingModelDiagnostics[]> {
  const result = await pool.query<EmbeddingModelRow>(
    `
      SELECT
        id,
        name,
        provider,
        dimensions,
        chunk_size,
        chunk_overlap,
        is_active,
        created_at
      FROM embedding_models
      ORDER BY created_at DESC
    `
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    provider: row.provider,
    dimensions: row.dimensions,
    chunkSize: row.chunk_size,
    chunkOverlap: row.chunk_overlap,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString()
  }));
}

export async function getAdminConfigStatusDiagnostics(
  pool: Pool
): Promise<AdminConfigStatusDiagnostics> {
  const [
    settingsTotal,
    settingsByState,
    settingsByClassification,
    settingsByValidationStatus,
    secretsTotal,
    secretsByPurpose,
    secretsByValidationStatus
  ] = await Promise.all([
    pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM admin_runtime_settings'
    ),
    pool.query<CountRow>(
      `
        SELECT state AS bucket, COUNT(*)::text AS count
        FROM admin_runtime_settings
        GROUP BY state
        ORDER BY state ASC
      `
    ),
    pool.query<CountRow>(
      `
        SELECT classification AS bucket, COUNT(*)::text AS count
        FROM admin_runtime_settings
        GROUP BY classification
        ORDER BY classification ASC
      `
    ),
    pool.query<CountRow>(
      `
        SELECT validation_status AS bucket, COUNT(*)::text AS count
        FROM admin_runtime_settings
        GROUP BY validation_status
        ORDER BY validation_status ASC
      `
    ),
    pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM admin_runtime_secrets'
    ),
    pool.query<CountRow>(
      `
        SELECT purpose AS bucket, COUNT(*)::text AS count
        FROM admin_runtime_secrets
        GROUP BY purpose
        ORDER BY purpose ASC
      `
    ),
    pool.query<CountRow>(
      `
        SELECT validation_status AS bucket, COUNT(*)::text AS count
        FROM admin_runtime_secrets
        GROUP BY validation_status
        ORDER BY validation_status ASC
      `
    )
  ]);

  return {
    settings: {
      total: Number.parseInt(settingsTotal.rows[0]?.count ?? '0', 10),
      byState: toCountMap(settingsByState.rows),
      byClassification: toCountMap(settingsByClassification.rows),
      byValidationStatus: toCountMap(settingsByValidationStatus.rows)
    },
    secrets: {
      totalConfigured: Number.parseInt(secretsTotal.rows[0]?.count ?? '0', 10),
      byPurpose: toCountMap(secretsByPurpose.rows),
      byValidationStatus: toCountMap(secretsByValidationStatus.rows)
    }
  };
}

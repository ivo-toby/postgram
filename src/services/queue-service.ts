import type { Pool } from 'pg';

import type { AuthContext } from '../auth/types.js';

export type QueueFailure = {
  id: string;
  type: string;
  kind: 'enrichment' | 'extraction';
  error: string;
  path: string | null;
  updatedAt: string;
};

export type QueueStatus = {
  embedding: {
    pending: number;
    completed: number;
    failed: number;
    retry_eligible: number;
    oldest_pending_secs: number | null;
  };
  extraction: {
    pending: number;
    completed: number;
    failed: number;
  } | null;
  failures?: QueueFailure[];
};

type QueueRow = {
  embedding_pending: string;
  embedding_completed: string;
  embedding_failed: string;
  embedding_retry_eligible: string;
  oldest_pending_secs: string | null;
  extraction_pending: string;
  extraction_completed: string;
  extraction_failed: string;
  extraction_any: string;
};

type FailureRow = {
  id: string;
  type: string;
  kind: 'enrichment' | 'extraction';
  error: string;
  metadata: Record<string, unknown> | null;
  updated_at: Date;
};

// Counts and failure details are scoped to the calling key's allowed types
// and visibility — a restricted key must not see aggregate counts or failure
// messages for entities it cannot otherwise read.
export async function getQueueStatus(
  pool: Pool,
  auth: AuthContext,
  options: { includeFailures?: boolean; failureLimit?: number } = {}
): Promise<QueueStatus> {
  const allowedTypes = auth.allowedTypes;
  const allowedVisibility = auth.allowedVisibility;

  const countsResult = await pool.query<QueueRow>(
    `
      SELECT
        COUNT(*) FILTER (WHERE enrichment_status = 'pending')::text                                                                         AS embedding_pending,
        COUNT(*) FILTER (WHERE enrichment_status = 'completed')::text                                                                       AS embedding_completed,
        COUNT(*) FILTER (WHERE enrichment_status = 'failed')::text                                                                          AS embedding_failed,
        COUNT(*) FILTER (WHERE enrichment_status = 'failed' AND enrichment_attempts < 3 AND updated_at < now() - interval '5 minutes')::text AS embedding_retry_eligible,
        EXTRACT(EPOCH FROM now() - MIN(updated_at) FILTER (WHERE enrichment_status = 'pending'))::text                                      AS oldest_pending_secs,
        COUNT(*) FILTER (WHERE extraction_status = 'pending')::text                                                                         AS extraction_pending,
        COUNT(*) FILTER (WHERE extraction_status = 'completed')::text                                                                       AS extraction_completed,
        COUNT(*) FILTER (WHERE extraction_status = 'failed')::text                                                                          AS extraction_failed,
        COUNT(*) FILTER (WHERE extraction_status IS NOT NULL)::text                                                                         AS extraction_any
      FROM entities
      WHERE content IS NOT NULL
        AND ($1::text[] IS NULL OR type = ANY($1))
        AND visibility = ANY($2)
    `,
    [allowedTypes, allowedVisibility]
  );

  const row = countsResult.rows[0];
  const extractionEnabled = row ? Number(row.extraction_any) > 0 : false;

  const status: QueueStatus = {
    embedding: {
      pending: Number(row?.embedding_pending ?? 0),
      completed: Number(row?.embedding_completed ?? 0),
      failed: Number(row?.embedding_failed ?? 0),
      retry_eligible: Number(row?.embedding_retry_eligible ?? 0),
      oldest_pending_secs:
        row?.oldest_pending_secs !== null && row?.oldest_pending_secs !== undefined
          ? Math.round(Number(row.oldest_pending_secs))
          : null
    },
    extraction: extractionEnabled
      ? {
          pending: Number(row?.extraction_pending ?? 0),
          completed: Number(row?.extraction_completed ?? 0),
          failed: Number(row?.extraction_failed ?? 0)
        }
      : null
  };

  if (options.includeFailures) {
    const limit = options.failureLimit ?? 20;
    const failuresResult = await pool.query<FailureRow>(
      `
        SELECT id, type, kind, error, metadata, updated_at
        FROM (
          SELECT id, type, 'enrichment'::text AS kind, enrichment_error AS error, metadata, updated_at, visibility
          FROM entities
          WHERE enrichment_status = 'failed' AND enrichment_error IS NOT NULL
          UNION ALL
          SELECT id, type, 'extraction'::text AS kind, extraction_error AS error, metadata, updated_at, visibility
          FROM entities
          WHERE extraction_status = 'failed' AND extraction_error IS NOT NULL
        ) AS failures
        WHERE ($1::text[] IS NULL OR type = ANY($1))
          AND visibility = ANY($2)
        ORDER BY updated_at DESC
        LIMIT $3
      `,
      [allowedTypes, allowedVisibility, limit]
    );

    status.failures = failuresResult.rows.map((r) => {
      const rawPath =
        r.metadata && typeof r.metadata === 'object' ? r.metadata['path'] : null;
      return {
        id: r.id,
        type: r.type,
        kind: r.kind,
        error: r.error,
        path: typeof rawPath === 'string' ? rawPath : null,
        updatedAt: r.updated_at.toISOString()
      };
    });
  }

  return status;
}

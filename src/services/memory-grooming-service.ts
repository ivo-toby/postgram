import { ResultAsync } from 'neverthrow';
import type { Pool } from 'pg';

import type { ServiceResult } from '../types/common.js';
import { AppError, ErrorCode } from '../util/errors.js';

export type GroomingCandidate = {
  id: string;
  content: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type GroomingPreview = {
  eligible: GroomingCandidate[];
};

function toAppError(error: unknown, fallbackMessage: string): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(ErrorCode.INTERNAL, fallbackMessage, {
      cause: error.message
    });
  }

  return new AppError(ErrorCode.INTERNAL, fallbackMessage);
}

export function previewSessionContextGrooming(
  pool: Pool,
  input: { clientId: string; now: Date; limit: number }
): ServiceResult<GroomingPreview> {
  return ResultAsync.fromPromise(
    (async () => {
      const result = await pool.query<{
        id: string;
        content: string | null;
        metadata: Record<string, unknown>;
        created_at: Date;
      }>(
        `
          SELECT id, content, metadata, created_at
          FROM entities
          WHERE type = 'memory'
            AND status IS DISTINCT FROM 'archived'
            AND metadata->>'memory_role' = 'session_context'
            AND metadata #>> '{session_scope,client_id}' = $1
            AND metadata->>'promoted_to' IS NULL
            AND (
              (metadata->>'groom_after')::timestamptz <= $2
              OR created_at <= $2::timestamptz - interval '7 days'
            )
          ORDER BY created_at ASC
          LIMIT $3
        `,
        [input.clientId, input.now.toISOString(), input.limit]
      );

      return {
        eligible: result.rows.map((row) => ({
          id: row.id,
          content: row.content,
          metadata: row.metadata,
          createdAt: row.created_at.toISOString()
        }))
      };
    })(),
    (error) => toAppError(error, 'Failed to preview memory grooming')
  );
}

// Distilled promotion intentionally starts as a later operation. Archival and
// dry-run preview establish the Postgram-owned grooming boundary first.
export function groomSessionContext(
  pool: Pool,
  input: {
    clientId: string;
    now: Date;
    mode: 'archive';
    dryRun: boolean;
    confirm: boolean;
    limit: number;
  }
): ServiceResult<{ archived: number; dryRun: boolean }> {
  return ResultAsync.fromPromise(
    (async () => {
      if (!input.dryRun && !input.confirm) {
        throw new AppError(ErrorCode.VALIDATION, '--yes is required outside dry-run');
      }

      const preview = await previewSessionContextGrooming(pool, input);
      if (preview.isErr()) {
        throw preview.error;
      }

      const ids = preview.value.eligible.map((candidate) => candidate.id);
      if (input.dryRun || ids.length === 0) {
        return { archived: 0, dryRun: input.dryRun };
      }

      await pool.query(
        `
          UPDATE entities
          SET status = 'archived'
          WHERE id = ANY($1::uuid[])
        `,
        [ids]
      );

      return { archived: ids.length, dryRun: false };
    })(),
    (error) => toAppError(error, 'Failed to groom session context')
  );
}

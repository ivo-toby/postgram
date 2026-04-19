import type { Pool, PoolClient } from 'pg';

import { AppError, ErrorCode } from '../../util/errors.js';
import type { EmbeddingProviderConfig } from './providers.js';

async function writeAuditRow(
  executor: Pool | PoolClient,
  operation: string,
  details: Record<string, unknown>
): Promise<void> {
  await executor.query(
    `
      INSERT INTO audit_log (
        api_key_id,
        operation,
        entity_id,
        details
      )
      VALUES (NULL, $1, NULL, $2)
    `,
    [operation, details]
  );
}

export type DimensionMismatch = {
  message: string;
  details: {
    configured: {
      provider: string;
      model: string;
      dimensions: number;
    };
    activeModel: {
      id: string;
      provider: string;
      name: string;
      dimensions: number;
    } | null;
  };
};

export type ConfiguredEmbeddingIdentity = {
  provider: string;
  model: string;
  dimensions: number;
};

/**
 * Compare configured embedding identity (provider + model + dimensions) against
 * the active embedding_models row. Returns null when they agree, or a mismatch
 * payload when they disagree (including when no active row exists, or when the
 * dimension matches but provider/model do not — same-dimension switches across
 * providers produce incompatible embedding spaces).
 */
export async function assertEmbeddingDimensionAgreement(
  pool: Pool,
  configured: ConfiguredEmbeddingIdentity
): Promise<DimensionMismatch | null> {
  const result = await pool.query<{
    id: string;
    name: string;
    provider: string;
    dimensions: number;
  }>(
    `
      SELECT id, name, provider, dimensions
      FROM embedding_models
      WHERE is_active = true
      LIMIT 1
    `
  );

  const active = result.rows[0];
  const fixHint = `run 'pgm-admin embeddings migrate --target-dimensions ${configured.dimensions} --yes'`;

  if (!active) {
    return {
      message: `embedding identity mismatch: configured=${describeConfigured(configured)} active_model=none — ${fixHint}`,
      details: { configured, activeModel: null }
    };
  }

  const matches =
    active.dimensions === configured.dimensions &&
    active.provider === configured.provider &&
    active.name === configured.model;

  if (matches) {
    return null;
  }

  return {
    message:
      `embedding identity mismatch: configured=${describeConfigured(configured)} ` +
      `active_model=(provider=${active.provider} name=${active.name} dimensions=${active.dimensions}) — ${fixHint}`,
    details: {
      configured,
      activeModel: {
        id: active.id,
        provider: active.provider,
        name: active.name,
        dimensions: active.dimensions
      }
    }
  };
}

function describeConfigured(c: ConfiguredEmbeddingIdentity): string {
  return `(provider=${c.provider} name=${c.model} dimensions=${c.dimensions})`;
}

export type RunMigrateInput = {
  pool: Pool;
  providerConfig: EmbeddingProviderConfig;
  targetDimensions: number;
  dryRun: boolean;
  yes: boolean;
  chunkSize?: number;
  chunkOverlap?: number;
};

export type MigrateReport = {
  dryRun: boolean;
  previous: {
    modelId: string | null;
    provider: string | null;
    name: string | null;
    dimensions: number | null;
  };
  target: {
    provider: string;
    name: string;
    dimensions: number;
  };
  effects: {
    chunksDiscarded: number;
    entitiesMarkedPending: number;
  };
  newModelId: string | null;
  elapsedMs: number;
};

export class MigrateRefusal extends Error {
  exitCode: 64 | 65;

  constructor(message: string, exitCode: 64 | 65) {
    super(message);
    this.name = 'MigrateRefusal';
    this.exitCode = exitCode;
  }
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // ignore
  }
}

async function readPreviousActive(pool: Pool): Promise<{
  modelId: string | null;
  provider: string | null;
  name: string | null;
  dimensions: number | null;
}> {
  const result = await pool.query<{
    id: string;
    name: string;
    provider: string;
    dimensions: number;
  }>(
    `
      SELECT id, name, provider, dimensions
      FROM embedding_models
      WHERE is_active = true
      LIMIT 1
    `
  );

  const row = result.rows[0];
  if (!row) {
    return { modelId: null, provider: null, name: null, dimensions: null };
  }
  return {
    modelId: row.id,
    provider: row.provider,
    name: row.name,
    dimensions: row.dimensions
  };
}

async function countAffected(pool: Pool): Promise<{
  chunks: number;
  entities: number;
}> {
  const chunkRes = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM chunks'
  );
  const entityRes = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM entities WHERE content IS NOT NULL'
  );
  return {
    chunks: Number(chunkRes.rows[0]?.count ?? '0'),
    entities: Number(entityRes.rows[0]?.count ?? '0')
  };
}

export async function runMigrate(input: RunMigrateInput): Promise<MigrateReport> {
  const started = Date.now();
  const { pool, providerConfig, targetDimensions, dryRun, yes } = input;

  if (providerConfig.dimensions !== targetDimensions) {
    throw new MigrateRefusal(
      `config/flag mismatch: EMBEDDING_DIMENSIONS resolves to ${providerConfig.dimensions} but --target-dimensions is ${targetDimensions}. Align env and flag before retrying.`,
      65
    );
  }

  if (!dryRun && !yes) {
    throw new MigrateRefusal(
      'refusing to migrate without --yes (destructive: discards existing chunks). Pass --dry-run to preview, or --yes to proceed.',
      64
    );
  }

  const previous = await readPreviousActive(pool);
  const counts = await countAffected(pool);

  const target = {
    provider: providerConfig.provider,
    name: providerConfig.model,
    dimensions: providerConfig.dimensions
  };

  const auditDetails = {
    previous: {
      model_id: previous.modelId,
      provider: previous.provider,
      name: previous.name,
      dimensions: previous.dimensions
    },
    target,
    effects: {
      chunks_discarded: counts.chunks,
      entities_marked_pending: counts.entities
    },
    dry_run: dryRun
  };

  if (dryRun) {
    await writeAuditRow(pool, 'embeddings.migrate', auditDetails);
    return {
      dryRun: true,
      previous,
      target,
      effects: {
        chunksDiscarded: counts.chunks,
        entitiesMarkedPending: counts.entities
      },
      newModelId: null,
      elapsedMs: Date.now() - started
    };
  }

  // Idempotency: if the active model already matches the target identity
  // exactly, treat the call as a no-op — do not discard chunks or re-mark
  // entities pending, because the system is already in the target state.
  const alreadyConverged =
    previous.dimensions === providerConfig.dimensions &&
    previous.provider === providerConfig.provider &&
    previous.name === providerConfig.model;

  if (alreadyConverged) {
    await writeAuditRow(pool, 'embeddings.migrate', {
      ...auditDetails,
      // No-op path: nothing is actually discarded or re-marked.
      effects: {
        chunks_discarded: 0,
        entities_marked_pending: 0
      },
      new_model_id: previous.modelId,
      idempotent_no_op: true
    });
    return {
      dryRun: false,
      previous,
      target,
      effects: {
        chunksDiscarded: 0,
        entitiesMarkedPending: 0
      },
      newModelId: previous.modelId,
      elapsedMs: Date.now() - started
    };
  }

  const client = await pool.connect();
  let newModelId: string | null = null;

  try {
    await client.query('BEGIN');

    await client.query('DROP INDEX IF EXISTS idx_chunks_embedding');
    await client.query('TRUNCATE TABLE chunks');
    await client.query(
      `ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(${targetDimensions})`
    );

    await client.query(
      'UPDATE embedding_models SET is_active = false WHERE is_active = true'
    );

    const insertResult = await client.query<{ id: string }>(
      `
        INSERT INTO embedding_models (
          name,
          provider,
          dimensions,
          chunk_size,
          chunk_overlap,
          is_active,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, true, $6)
        RETURNING id
      `,
      [
        providerConfig.model,
        providerConfig.provider,
        providerConfig.dimensions,
        input.chunkSize ?? 300,
        input.chunkOverlap ?? 100,
        { source: 'pgm-admin.embeddings.migrate' }
      ]
    );
    newModelId = insertResult.rows[0]?.id ?? null;

    await client.query(
      `
        UPDATE entities
           SET enrichment_status = 'pending',
               enrichment_attempts = 0,
               updated_at = now()
         WHERE content IS NOT NULL
      `
    );

    await client.query(
      `
        CREATE INDEX idx_chunks_embedding
          ON chunks USING hnsw (embedding vector_cosine_ops)
          WITH (m = 16, ef_construction = 200)
      `
    );

    // Audit row is written inside the same transaction so (a) it cannot be
    // lost after commit, and (b) failed migrations cannot commit half the work
    // and then fail on audit insert.
    await writeAuditRow(client, 'embeddings.migrate', {
      ...auditDetails,
      new_model_id: newModelId
    });

    await client.query('COMMIT');
  } catch (error) {
    await rollbackQuietly(client);
    // On real-run failure, record a separate audit row so the operator can see
    // the attempt. Best-effort; do not fail the command if this also fails.
    try {
      await writeAuditRow(pool, 'embeddings.migrate', {
        ...auditDetails,
        failure: error instanceof Error ? error.message : 'unknown error'
      });
    } catch {
      // swallow — original error is re-thrown below
    }
    throw new AppError(
      ErrorCode.INTERNAL,
      error instanceof Error ? error.message : 'Migration failed',
      { phase: 'embeddings.migrate' }
    );
  } finally {
    client.release();
  }

  return {
    dryRun: false,
    previous,
    target,
    effects: {
      chunksDiscarded: counts.chunks,
      entitiesMarkedPending: counts.entities
    },
    newModelId,
    elapsedMs: Date.now() - started
  };
}

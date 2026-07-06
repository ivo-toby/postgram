import type { Pool, PoolClient } from 'pg';

import type { EntityType } from '../types/entities.js';
import { AppError, ErrorCode } from '../util/errors.js';

export type MaintenanceEntityScope =
  | { kind: 'all' }
  | { kind: 'type'; type: EntityType }
  | { kind: 'id'; id: string }
  | { kind: 'failed' };

export type ReextractMaintenanceInput = {
  scope: MaintenanceEntityScope;
  onlyFailed?: boolean | undefined;
  limit?: number | undefined;
  cleanEdges?: boolean | undefined;
  includeAutoCreated?: boolean | undefined;
  noEdgesOnly?: boolean | undefined;
  showSkipped?: boolean | undefined;
};

export type ReembedMaintenanceInput = {
  scope: MaintenanceEntityScope;
  onlyFailed?: boolean | undefined;
  modelId?: string | undefined;
};

export type PruneEdgesMaintenanceInput = {
  below: number;
  source?: string | undefined;
  relation?: string | undefined;
};

export type MaintenanceSkippedBreakdown = {
  noContent: number;
  archived: number;
  autoCreated: number;
  skippedExtraction: number;
};

export type ReextractMaintenancePreview = {
  dryRun: true;
  wouldMark: number;
  wouldDeleteEdges: number;
  scope: Record<string, unknown>;
  skipped?: MaintenanceSkippedBreakdown | undefined;
  implications: {
    destructive: true;
    llmCost: true;
    clearsExtractionErrors: true;
    deletesLlmEdges: boolean;
  };
};

export type ReextractMaintenanceResult = {
  dryRun: false;
  markedCount: number;
  deletedEdges: number;
  scope: Record<string, unknown>;
  skipped?: MaintenanceSkippedBreakdown | undefined;
  implications: ReextractMaintenancePreview['implications'];
};

export type ReembedMaintenancePreview = {
  dryRun: true;
  wouldMark: number;
  wouldDeleteChunks: number;
  scope: Record<string, unknown>;
  implications: {
    destructive: true;
    deletesEmbeddings: true;
    providerWork: true;
    activeModelChange: boolean;
  };
};

export type ReembedMaintenanceResult = {
  dryRun: false;
  markedCount: number;
  deletedChunks: number;
  scope: Record<string, unknown>;
  implications: ReembedMaintenancePreview['implications'];
};

export type PruneEdgesMaintenancePreview = {
  dryRun: true;
  wouldDelete: number;
  threshold: number;
  source: string;
  relation: string | null;
  implications: {
    destructive: true;
    permanentDelete: true;
    scopedToLlmExtraction: boolean;
  };
};

export type PruneEdgesMaintenanceResult = {
  dryRun: false;
  deleted: number;
  threshold: number;
  source: string;
  relation: string | null;
  implications: PruneEdgesMaintenancePreview['implications'];
};

const ENTITY_TYPES = new Set<EntityType>([
  'memory',
  'person',
  'project',
  'task',
  'interaction',
  'document'
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function validationError(message: string, details?: Record<string, unknown>) {
  return new AppError(ErrorCode.VALIDATION, message, details);
}

function requireEntityType(type: EntityType): EntityType {
  if (!ENTITY_TYPES.has(type)) {
    throw validationError('Invalid entity type', { field: 'type' });
  }

  return type;
}

function requireUuid(id: string, field: string): string {
  if (!UUID_PATTERN.test(id)) {
    throw validationError('Invalid UUID', { field });
  }

  return id;
}

function normalizeLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) {
    return undefined;
  }

  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw validationError('Limit must be between 1 and 10000', {
      field: 'limit'
    });
  }

  return limit;
}

function normalizeScope(scope: MaintenanceEntityScope): MaintenanceEntityScope {
  switch (scope.kind) {
    case 'all':
      return { kind: 'all' };
    case 'type':
      return { kind: 'type', type: requireEntityType(scope.type) };
    case 'id':
      return { kind: 'id', id: requireUuid(scope.id, 'scope.id') };
    case 'failed':
      return { kind: 'failed' };
  }
}

function scopeSummary(
  scope: MaintenanceEntityScope,
  extras: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...scope,
    ...extras
  };
}

async function writeMaintenanceAudit(
  executor: Pool | PoolClient,
  input: {
    actorAdminUserId?: string | undefined;
    operation: 'reembed.start' | 'reextract.start' | 'edges.prune';
    details: Record<string, unknown>;
  }
): Promise<void> {
  await executor.query(
    `
      INSERT INTO audit_log (
        api_key_id,
        admin_user_id,
        operation,
        entity_id,
        details
      )
      VALUES (NULL, $1, $2, NULL, $3::jsonb)
    `,
    [
      input.actorAdminUserId ?? null,
      input.operation,
      JSON.stringify(input.details)
    ]
  );
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original operation error.
  }
}

function reextractImplications(cleanEdges: boolean): ReextractMaintenancePreview['implications'] {
  return {
    destructive: true,
    llmCost: true,
    clearsExtractionErrors: true,
    deletesLlmEdges: cleanEdges
  };
}

function reembedImplications(modelId: string | undefined): ReembedMaintenancePreview['implications'] {
  return {
    destructive: true,
    deletesEmbeddings: true,
    providerWork: true,
    activeModelChange: modelId !== undefined
  };
}

function pruneImplications(source: string): PruneEdgesMaintenancePreview['implications'] {
  return {
    destructive: true,
    permanentDelete: true,
    scopedToLlmExtraction: source === 'llm-extraction'
  };
}

function buildReextractSelection(input: ReextractMaintenanceInput): {
  params: unknown[];
  selectionSql: string;
  scope: MaintenanceEntityScope;
  limit?: number | undefined;
} {
  const scope = normalizeScope(input.scope);
  const limit = normalizeLimit(input.limit);
  const conditions = [
    'content IS NOT NULL',
    "status IS DISTINCT FROM 'archived'",
    "extraction_status IS DISTINCT FROM 'skipped'"
  ];
  const params: unknown[] = [];

  if (!input.includeAutoCreated) {
    conditions.push("NOT ('auto-created' = ANY(tags))");
  }
  if (input.noEdgesOnly) {
    conditions.push(
      "NOT EXISTS (SELECT 1 FROM edges WHERE source_id = entities.id AND source = 'llm-extraction')"
    );
  }

  if (scope.kind === 'id') {
    params.push(scope.id);
    conditions.push(`id = $${params.length}::uuid`);
  } else {
    if (scope.kind === 'type') {
      params.push(scope.type);
      conditions.push(`type = $${params.length}`);
    }
  }
  if (scope.kind === 'failed' || input.onlyFailed) {
    conditions.push("extraction_status = 'failed'");
  }

  const whereClause = conditions.join(' AND ');
  let selectionSql = `SELECT id FROM entities WHERE ${whereClause}`;
  if (limit !== undefined) {
    params.push(limit);
    selectionSql += ` ORDER BY created_at ASC LIMIT $${params.length}`;
  }

  return { params, selectionSql, scope, ...(limit !== undefined ? { limit } : {}) };
}

function buildReembedSelection(input: ReembedMaintenanceInput): {
  params: unknown[];
  selectionSql: string;
  whereClause: string;
  scope: MaintenanceEntityScope;
} {
  const scope = normalizeScope(input.scope);
  const conditions = ['content IS NOT NULL'];
  const params: unknown[] = [];

  if (scope.kind === 'id') {
    params.push(scope.id);
    conditions.push(`id = $${params.length}::uuid`);
  } else {
    if (scope.kind === 'type') {
      params.push(scope.type);
      conditions.push(`type = $${params.length}`);
    }
  }
  if (scope.kind === 'failed' || input.onlyFailed) {
    conditions.push("enrichment_status = 'failed'");
  }

  const whereClause = conditions.join(' AND ');
  return {
    params,
    selectionSql: `SELECT id FROM entities WHERE ${whereClause}`,
    whereClause,
    scope
  };
}

function buildPruneConditions(input: PruneEdgesMaintenanceInput): {
  params: unknown[];
  whereClause: string;
  source: string;
  relation: string | null;
  threshold: number;
} {
  const threshold = input.below;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw validationError('below must be a number between 0 and 1', {
      field: 'below'
    });
  }

  const source = input.source?.trim() || 'llm-extraction';
  if (source.length > 120) {
    throw validationError('source is too long', { field: 'source' });
  }

  const relation = input.relation?.trim() || null;
  if (relation !== null && relation.length > 120) {
    throw validationError('relation is too long', { field: 'relation' });
  }

  const conditions = ['confidence < $1'];
  const params: unknown[] = [threshold];

  if (source !== 'any') {
    params.push(source);
    conditions.push(`source = $${params.length}`);
  }

  if (relation !== null) {
    params.push(relation);
    conditions.push(`relation = $${params.length}`);
  }

  return {
    params,
    whereClause: conditions.join(' AND '),
    source,
    relation,
    threshold
  };
}

async function countSelection(
  executor: Pool | PoolClient,
  selectionSql: string,
  params: unknown[]
): Promise<number> {
  const result = await executor.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM (${selectionSql}) selected`,
    params
  );
  return Number(result.rows[0]?.count ?? '0');
}

async function countChunksForSelection(
  executor: Pool | PoolClient,
  selectionSql: string,
  params: unknown[]
): Promise<number> {
  const result = await executor.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM chunks WHERE entity_id IN (${selectionSql})`,
    params
  );
  return Number(result.rows[0]?.count ?? '0');
}

async function countLlmEdgesForSelection(
  executor: Pool | PoolClient,
  selectionSql: string,
  params: unknown[]
): Promise<number> {
  const result = await executor.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM edges
      WHERE source = 'llm-extraction'
        AND source_id IN (${selectionSql})
    `,
    params
  );
  return Number(result.rows[0]?.count ?? '0');
}

async function previewReextractSkipped(
  pool: Pool | PoolClient,
  input: ReextractMaintenanceInput,
  scope: MaintenanceEntityScope
): Promise<MaintenanceSkippedBreakdown | undefined> {
  if (!input.showSkipped) {
    return undefined;
  }

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (scope.kind === 'id') {
    params.push(scope.id);
    conditions.push(`id = $${params.length}::uuid`);
  } else {
    if (scope.kind === 'type') {
      params.push(scope.type);
      conditions.push(`type = $${params.length}`);
    }
  }
  if (scope.kind === 'failed' || input.onlyFailed) {
    conditions.push("extraction_status = 'failed'");
  }

  const whereClause = conditions.length > 0 ? conditions.join(' AND ') : 'TRUE';
  const autoCreatedFilter = input.includeAutoCreated
    ? '0'
    : `count(*) FILTER (
         WHERE content IS NOT NULL
           AND status IS DISTINCT FROM 'archived'
           AND 'auto-created' = ANY(tags)
       )`;

  const result = await pool.query<{
    no_content: string;
    archived: string;
    auto_created: string;
    skipped_extraction: string;
  }>(
    `
      SELECT
        count(*) FILTER (WHERE content IS NULL) AS no_content,
        count(*) FILTER (
          WHERE content IS NOT NULL
            AND status = 'archived'
        ) AS archived,
        ${autoCreatedFilter} AS auto_created,
        count(*) FILTER (
          WHERE content IS NOT NULL
            AND status IS DISTINCT FROM 'archived'
            AND NOT ('auto-created' = ANY(tags))
            AND extraction_status = 'skipped'
        ) AS skipped_extraction
      FROM entities
      WHERE ${whereClause}
    `,
    params
  );
  const row = result.rows[0];

  return {
    noContent: Number(row?.no_content ?? '0'),
    archived: Number(row?.archived ?? '0'),
    autoCreated: Number(row?.auto_created ?? '0'),
    skippedExtraction: Number(row?.skipped_extraction ?? '0')
  };
}

export async function previewAdminReextractMaintenance(
  pool: Pool,
  input: ReextractMaintenanceInput
): Promise<ReextractMaintenancePreview> {
  const cleanEdges = Boolean(input.cleanEdges);
  const selection = buildReextractSelection(input);
  const wouldMark = await countSelection(
    pool,
    selection.selectionSql,
    selection.params
  );
  const wouldDeleteEdges = cleanEdges
    ? await countLlmEdgesForSelection(
        pool,
        selection.selectionSql,
        selection.params
      )
    : 0;
  const skipped = await previewReextractSkipped(pool, input, selection.scope);

  return {
    dryRun: true,
    wouldMark,
    wouldDeleteEdges,
    scope: scopeSummary(selection.scope, {
      limit: selection.limit ?? null,
      cleanEdges,
      onlyFailed: selection.scope.kind === 'failed' || Boolean(input.onlyFailed)
    }),
    ...(skipped ? { skipped } : {}),
    implications: reextractImplications(cleanEdges)
  };
}

export async function applyAdminReextractMaintenance(
  pool: Pool,
  input: ReextractMaintenanceInput & {
    actorAdminUserId?: string | undefined;
  }
): Promise<ReextractMaintenanceResult> {
  const cleanEdges = Boolean(input.cleanEdges);
  const selection = buildReextractSelection(input);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    let deletedEdges = 0;
    if (cleanEdges) {
      const deleted = await client.query(
        `
          DELETE FROM edges
          WHERE source = 'llm-extraction'
            AND source_id IN (${selection.selectionSql})
        `,
        selection.params
      );
      deletedEdges = deleted.rowCount ?? 0;
    }

    const updated = await client.query(
      `
        UPDATE entities
        SET extraction_status = 'pending',
            extraction_error = NULL
        WHERE id IN (${selection.selectionSql})
      `,
      selection.params
    );
    const markedCount = updated.rowCount ?? 0;
    const skipped = await previewReextractSkipped(client, input, selection.scope);

    await writeMaintenanceAudit(client, {
      actorAdminUserId: input.actorAdminUserId,
      operation: 'reextract.start',
      details: {
        markedCount,
        deletedEdges,
        type:
          selection.scope.kind === 'type'
            ? selection.scope.type
            : selection.scope.kind === 'id'
              ? null
              : 'all',
        id: selection.scope.kind === 'id' ? selection.scope.id : null,
        limit: selection.limit ?? null,
        cleanEdges,
        includeAutoCreated: Boolean(input.includeAutoCreated),
        onlyFailed: selection.scope.kind === 'failed' || Boolean(input.onlyFailed)
      }
    });
    await client.query('COMMIT');

    return {
      dryRun: false,
      markedCount,
      deletedEdges,
      scope: scopeSummary(selection.scope, {
        limit: selection.limit ?? null,
        cleanEdges,
        onlyFailed: selection.scope.kind === 'failed' || Boolean(input.onlyFailed)
      }),
      ...(skipped ? { skipped } : {}),
      implications: reextractImplications(cleanEdges)
    };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function previewAdminReembedMaintenance(
  pool: Pool,
  input: ReembedMaintenanceInput
): Promise<ReembedMaintenancePreview> {
  const selection = buildReembedSelection(input);
  const [wouldMark, wouldDeleteChunks] = await Promise.all([
    countSelection(pool, selection.selectionSql, selection.params),
    countChunksForSelection(pool, selection.selectionSql, selection.params)
  ]);

  return {
    dryRun: true,
    wouldMark,
    wouldDeleteChunks,
    scope: scopeSummary(selection.scope, {
      modelId: input.modelId ?? null,
      onlyFailed: selection.scope.kind === 'failed' || Boolean(input.onlyFailed)
    }),
    implications: reembedImplications(input.modelId)
  };
}

export async function applyAdminReembedMaintenance(
  pool: Pool,
  input: ReembedMaintenanceInput & {
    actorAdminUserId?: string | undefined;
  }
): Promise<ReembedMaintenanceResult> {
  const selection = buildReembedSelection(input);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (input.modelId) {
      await client.query('UPDATE embedding_models SET is_active = false');
      const modelResult = await client.query<{ id: string }>(
        'UPDATE embedding_models SET is_active = true WHERE id = $1 RETURNING id',
        [input.modelId]
      );
      if (!modelResult.rows[0]) {
        throw new AppError(ErrorCode.NOT_FOUND, 'Embedding model not found');
      }
    }

    const deleted = await client.query(
      `DELETE FROM chunks WHERE entity_id IN (${selection.selectionSql})`,
      selection.params
    );
    const updated = await client.query(
      `
        UPDATE entities
        SET enrichment_status = 'pending',
            enrichment_attempts = 0
        WHERE ${selection.whereClause}
      `,
      selection.params
    );
    const markedCount = updated.rowCount ?? 0;
    const deletedChunks = deleted.rowCount ?? 0;

    await writeMaintenanceAudit(client, {
      actorAdminUserId: input.actorAdminUserId,
      operation: 'reembed.start',
      details: {
        markedCount,
        deletedChunks,
        model: input.modelId ?? null,
        type:
          selection.scope.kind === 'type'
            ? selection.scope.type
            : selection.scope.kind === 'id'
              ? null
              : 'all',
        id: selection.scope.kind === 'id' ? selection.scope.id : null,
        onlyFailed: selection.scope.kind === 'failed' || Boolean(input.onlyFailed)
      }
    });
    await client.query('COMMIT');

    return {
      dryRun: false,
      markedCount,
      deletedChunks,
      scope: scopeSummary(selection.scope, {
        modelId: input.modelId ?? null,
        onlyFailed: selection.scope.kind === 'failed' || Boolean(input.onlyFailed)
      }),
      implications: reembedImplications(input.modelId)
    };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function previewAdminPruneEdgesMaintenance(
  pool: Pool,
  input: PruneEdgesMaintenanceInput
): Promise<PruneEdgesMaintenancePreview> {
  const prune = buildPruneConditions(input);
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM edges WHERE ${prune.whereClause}`,
    prune.params
  );
  const wouldDelete = Number(result.rows[0]?.count ?? '0');

  return {
    dryRun: true,
    wouldDelete,
    threshold: prune.threshold,
    source: prune.source,
    relation: prune.relation,
    implications: pruneImplications(prune.source)
  };
}

export async function applyAdminPruneEdgesMaintenance(
  pool: Pool,
  input: PruneEdgesMaintenanceInput & {
    actorAdminUserId?: string | undefined;
  }
): Promise<PruneEdgesMaintenanceResult> {
  const prune = buildPruneConditions(input);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const deleted = await client.query(
      `DELETE FROM edges WHERE ${prune.whereClause}`,
      prune.params
    );
    const deletedCount = deleted.rowCount ?? 0;

    await writeMaintenanceAudit(client, {
      actorAdminUserId: input.actorAdminUserId,
      operation: 'edges.prune',
      details: {
        deleted: deletedCount,
        threshold: prune.threshold,
        source: prune.source,
        relation: prune.relation
      }
    });
    await client.query('COMMIT');

    return {
      dryRun: false,
      deleted: deletedCount,
      threshold: prune.threshold,
      source: prune.source,
      relation: prune.relation,
      implications: pruneImplications(prune.source)
    };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

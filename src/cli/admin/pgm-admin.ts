#!/usr/bin/env node

import { Pool } from 'pg';
import { Command } from 'commander';

import { createKey, revokeKey } from '../../auth/key-service.js';
import type { Scope } from '../../auth/types.js';
import type { EntityType, Visibility } from '../../types/entities.js';
import { loadConfig } from '../../config.js';
import { buildEmbeddingProviderConfig } from '../../index.js';
import {
  MigrateRefusal,
  runMigrate,
  type MigrateReport
} from '../../services/embeddings/admin.js';
import { AppError, ErrorCode, toErrorResponse } from '../../util/errors.js';
import {
  handleCliFailure,
  isJsonMode,
  parseCommaList,
  printHuman,
  printJson,
  resolveAdminDatabaseUrl,
  shortId
} from '../shared.js';

// Lowercase 8-4-4-4-12 UUID. Postgres would reject malformed casts, but a
// CLI-side check produces a friendlier error than an SQL exception.
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ApiKeyRow = {
  id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes: string[];
  allowed_types: string[] | null;
  allowed_visibility: string[];
  is_active: boolean;
  created_at: Date;
  last_used_at: Date | null;
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

type AuditRow = {
  id: string;
  api_key_id: string | null;
  operation: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  timestamp: Date;
  key_name: string | null;
};

function createPool(): Pool {
  return new Pool({
    connectionString: resolveAdminDatabaseUrl()
  });
}

async function withPool<T>(fn: (pool: Pool, json: boolean) => Promise<T>, json: boolean): Promise<T> {
  const pool = createPool();
  try {
    return await fn(pool, json);
  } finally {
    await pool.end();
  }
}

async function appendAuditEntry(
  pool: Pool,
  input: {
    operation: string;
    entityId?: string | null;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  await pool.query(
    `
      INSERT INTO audit_log (
        api_key_id,
        operation,
        entity_id,
        details
      )
      VALUES (NULL, $1, $2, $3)
    `,
    [input.operation, input.entityId ?? null, input.details ?? {}]
  );
}

function formatKeyList(keys: ApiKeyRow[]): string[] {
  if (keys.length === 0) {
    return ['No API keys'];
  }

  return [
    'id        name            active  scopes',
    ...keys.map(
      (key) =>
        `${shortId(key.id)}  ${key.name.padEnd(14)}  ${String(key.is_active).padEnd(6)}  ${key.scopes.join(',')}`
    )
  ];
}

function formatModelList(models: EmbeddingModelRow[]): string[] {
  if (models.length === 0) {
    return ['No embedding models'];
  }

  return [
    'id        name                     active',
    ...models.map(
      (model) =>
        `${shortId(model.id)}  ${model.name.padEnd(23)}  ${String(model.is_active)}`
    )
  ];
}

function formatAuditRows(rows: AuditRow[]): string[] {
  if (rows.length === 0) {
    return ['No audit rows'];
  }

  return rows.map((row) => {
    const key = row.key_name ? ` key=${row.key_name}` : '';
    const entity = row.entity_id ? ` entity=${shortId(row.entity_id)}` : '';
    return `${row.timestamp.toISOString()} ${row.operation}${key}${entity}`;
  });
}

function formatStats(stats: {
  entityCounts: Record<string, number>;
  chunkCount: number;
  keyCount: number;
  databaseSizeBytes: number;
  uptimeSeconds: number;
}): string[] {
  return [
    `entities: ${Object.entries(stats.entityCounts)
      .map(([type, count]) => `${type}=${count}`)
      .join(' ')}`,
    `chunks: ${stats.chunkCount}`,
    `keys: ${stats.keyCount}`,
    `database_size_bytes: ${stats.databaseSizeBytes}`,
    `uptime_seconds: ${stats.uptimeSeconds}`
  ];
}


async function runWithPool<T>(
  json: boolean,
  handler: (pool: Pool, json: boolean) => Promise<T>
): Promise<void> {
  try {
    const result = await withPool(async (pool, mode) => handler(pool, mode), json);

    if (result !== undefined) {
      if (json) {
        printJson(result);
      } else if (Array.isArray(result)) {
        printHuman(result.map(String));
      } else {
        printHuman([String(result)]);
      }
    }
  } catch (error) {
    await handleCliFailure(error, json);
  }
}

const program = new Command();

program
  .name('pgm-admin')
  .description('Postgram admin CLI')
  .option('--json', 'emit JSON output');

const keyCommand = program.command('key').description('Manage API keys');

keyCommand
  .command('create')
  .description('Create an API key')
  .requiredOption('--name <name>', 'key name')
  .option('--scopes <scopes>', 'comma-separated scopes', 'read')
  .option('--visibility <visibility>', 'comma-separated visibility values', 'shared')
  .option('--types <types>', 'comma-separated entity types')
  .action(async (options, command) => {
    const json = isJsonMode(command);

    await runWithPool(json, async (pool, mode) => {
      const created = await createKey(pool, {
        name: options.name,
        scopes: parseCommaList(options.scopes) as Scope[] | undefined,
        allowedTypes: parseCommaList(options.types) as EntityType[] | null | undefined,
        allowedVisibility: parseCommaList(options.visibility) as Visibility[] | undefined
      });

      if (created.isErr()) {
        throw created.error;
      }

      await appendAuditEntry(pool, {
        operation: 'key.create',
        entityId: created.value.record.id,
        details: {
          name: options.name
        }
      });

      return mode ? created.value : [`Created key ${options.name}`, created.value.plaintextKey];
    });
  });

keyCommand
  .command('list')
  .description('List API keys')
  .action(async (_options, command) => {
    const json = isJsonMode(command);

    await runWithPool(json, async (pool, mode) => {
      const result = await pool.query<ApiKeyRow>('SELECT * FROM api_keys ORDER BY created_at DESC');
      await appendAuditEntry(pool, { operation: 'key.list' });

      if (mode) {
        return {
          keys: result.rows.map((row) => ({
            id: row.id,
            name: row.name,
            isActive: row.is_active,
            scopes: row.scopes,
            allowedTypes: row.allowed_types,
            allowedVisibility: row.allowed_visibility,
            createdAt: row.created_at.toISOString(),
            lastUsedAt: row.last_used_at?.toISOString() ?? null
          }))
        };
      }

      return formatKeyList(result.rows);
    });
  });

keyCommand
  .command('revoke')
  .description('Revoke an API key')
  .argument('id', 'API key ID')
  .action(async (id, _options, command) => {
    const json = isJsonMode(command);

    await runWithPool(json, async (pool, mode) => {
      const revoked = await revokeKey(pool, id);
      if (revoked.isErr()) {
        throw revoked.error;
      }

      await appendAuditEntry(pool, {
        operation: 'key.revoke',
        entityId: id
      });

      return mode ? { revoked: true, id } : [`Revoked key ${shortId(id)}`];
    });
  });

program
  .command('audit')
  .description('Query audit logs')
  .option('--since <since>', 'ISO date or timestamp')
  .option('--key <key>', 'API key name filter')
  .option('--operation <operation>', 'comma-separated operation filter')
  .option('--entity <entity>', 'entity ID filter')
  .option('--limit <limit>', 'max rows', '50')
  .action(async (options, command) => {
    const json = isJsonMode(command);

    await runWithPool(json, async (pool, mode) => {
      const filters: string[] = [];
      const params: unknown[] = [];

      if (options.since) {
        params.push(new Date(options.since));
        filters.push(`a.timestamp >= $${params.length}`);
      }

      if (options.key) {
        params.push(options.key);
        filters.push(`k.name = $${params.length}`);
      }

      const operations = parseCommaList(options.operation);
      if (operations?.length) {
        params.push(operations);
        filters.push(`a.operation = ANY($${params.length})`);
      }

      if (options.entity) {
        params.push(options.entity);
        filters.push(`a.entity_id = $${params.length}`);
      }

      params.push(Number(options.limit));

      const rows = await pool.query<AuditRow>(
        `
          SELECT
            a.*,
            k.name AS key_name
          FROM audit_log a
          LEFT JOIN api_keys k ON k.id = a.api_key_id
          ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
          ORDER BY a.timestamp DESC
          LIMIT $${params.length}
        `,
        params
      );

      await appendAuditEntry(pool, {
        operation: 'audit.query',
        details: {
          since: options.since ?? null,
          key: options.key ?? null,
          operation: options.operation ?? null,
          entity: options.entity ?? null,
          limit: Number(options.limit)
        }
      });

      if (mode) {
        return {
          entries: rows.rows.map((row) => ({
            id: row.id,
            timestamp: row.timestamp.toISOString(),
            operation: row.operation,
            entityId: row.entity_id,
            apiKeyId: row.api_key_id,
            keyName: row.key_name,
            details: row.details
          }))
        };
      }

      return formatAuditRows(rows.rows);
    });
  });

const modelCommand = program.command('model').description('Manage embedding models');

modelCommand
  .command('list')
  .description('List embedding models')
  .action(async (_options, command) => {
    const json = isJsonMode(command);

    await runWithPool(json, async (pool, mode) => {
      const rows = await pool.query<EmbeddingModelRow>(
        'SELECT * FROM embedding_models ORDER BY created_at DESC'
      );

      await appendAuditEntry(pool, { operation: 'model.list' });

      if (mode) {
        return {
          models: rows.rows.map((row) => ({
            id: row.id,
            name: row.name,
            provider: row.provider,
            dimensions: row.dimensions,
            chunkSize: row.chunk_size,
            chunkOverlap: row.chunk_overlap,
            isActive: row.is_active,
            createdAt: row.created_at.toISOString()
          }))
        };
      }

      return formatModelList(rows.rows);
    });
  });

modelCommand
  .command('set-active')
  .description('Set the active embedding model')
  .argument('id', 'model ID')
  .action(async (id, _options, command) => {
    const json = isJsonMode(command);

    await runWithPool(json, async (pool, mode) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('UPDATE embedding_models SET is_active = false');
        const result = await client.query<EmbeddingModelRow>(
          `
            UPDATE embedding_models
            SET is_active = true
            WHERE id = $1
            RETURNING *
          `,
          [id]
        );

        if (!result.rows[0]) {
          throw new Error('Model not found');
        }

        await client.query('COMMIT');

        await appendAuditEntry(pool, {
          operation: 'model.set_active',
          entityId: id
        });

        if (mode) {
          const row = result.rows[0];
          return {
            model: {
              id: row.id,
              name: row.name,
              provider: row.provider,
              dimensions: row.dimensions,
              chunkSize: row.chunk_size,
              chunkOverlap: row.chunk_overlap,
              isActive: row.is_active,
              createdAt: row.created_at.toISOString()
            }
          };
        }

        return [`Active model set to ${shortId(id)}`];
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  });

program
  .command('reembed')
  .description('Mark entities for re-embedding')
  .option('--model <id>', 'switch active model before re-embedding')
  .option('--all', 're-embed all entities with content')
  .option('--type <type>', 're-embed entities of this type only')
  .option('--only-failed', "only re-queue entities whose enrichment_status = 'failed'")
  .action(async (options, command) => {
    const json = isJsonMode(command);

    if (!options.all && !options.type && !options.onlyFailed) {
      await handleCliFailure(
        new Error(
          'Specify --all, --type <type>, or --only-failed to confirm which entities to re-embed'
        ),
        json
      );
      return;
    }

    await runWithPool(json, async (pool) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        if (options.model) {
          await client.query('UPDATE embedding_models SET is_active = false');
          const modelResult = await client.query<{ id: string }>(
            'UPDATE embedding_models SET is_active = true WHERE id = $1 RETURNING id',
            [options.model]
          );
          if (!modelResult.rows[0]) {
            throw new Error('Model not found');
          }
        }

        const conditions = ["content IS NOT NULL"];
        const params: unknown[] = [];

        if (options.type) {
          params.push(options.type);
          conditions.push(`type = $${params.length}`);
        }

        if (options.onlyFailed) {
          conditions.push("enrichment_status = 'failed'");
        }

        const whereClause = conditions.join(' AND ');

        await client.query(
          `DELETE FROM chunks WHERE entity_id IN (SELECT id FROM entities WHERE ${whereClause})`,
          params
        );

        const updateResult = await client.query(
          `UPDATE entities SET enrichment_status = 'pending', enrichment_attempts = 0 WHERE ${whereClause}`,
          params
        );

        await client.query('COMMIT');

        const markedCount = updateResult.rowCount ?? 0;

        await appendAuditEntry(pool, {
          operation: 'reembed.start',
          details: {
            markedCount,
            model: options.model ?? null,
            type: options.type ?? 'all',
            onlyFailed: Boolean(options.onlyFailed)
          }
        });

        return json
          ? { markedCount }
          : [
              `Marked ${markedCount} entities for re-embedding${
                options.onlyFailed ? ' (only failed)' : ''
              }`
            ];
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  });

program
  .command('reextract')
  .description('Mark entities for re-extraction (knowledge-graph edges + tags)')
  .option('--all', 're-extract all entities with content')
  .option('--type <type>', 're-extract entities of this type only')
  .option('--id <uuid>', 're-extract a single entity by id (composes with --clean-edges; ignores other selectors)')
  .option('--only-failed', "only re-queue entities whose extraction_status = 'failed'")
  .option(
    '--limit <n>',
    'cap the number of entities marked (composes with --all/--type/--only-failed; ignored with --id). Selects oldest-first by created_at.'
  )
  .option(
    '--clean-edges',
    "delete existing LLM-extracted edges (source='llm-extraction') for the in-scope entities before re-extraction — gives a clean slate rather than appending alongside old edges"
  )
  .option(
    '--include-auto-created',
    "also re-queue entities tagged 'auto-created' (excluded by default because their only content is a bare name, which the LLM free-associates into new stubs and loops). Only use if you've manually enriched those entities' content."
  )
  .option(
    '--show-skipped',
    "report how many entities matching --type/--only-failed/--id were skipped by guardrails (no content, archived, auto-created), broken down by category. Counts ignore --limit so you see the full picture."
  )
  .action(async (options, command) => {
    const json = isJsonMode(command);

    if (!options.all && !options.type && !options.onlyFailed && !options.id) {
      await handleCliFailure(
        new Error(
          'Specify --all, --type <type>, --only-failed, or --id <uuid> to confirm which entities to re-extract'
        ),
        json
      );
      return;
    }

    if (options.id && !UUID_REGEX.test(options.id)) {
      await handleCliFailure(
        new Error(`--id must be a valid UUID (got "${options.id}")`),
        json
      );
      return;
    }

    let limit: number | undefined;
    if (options.limit !== undefined) {
      const parsed = Number.parseInt(options.limit, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        await handleCliFailure(
          new Error('--limit must be a positive integer'),
          json
        );
        return;
      }
      limit = parsed;
    }

    await runWithPool(json, async (pool) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Archived entities are explicitly out-of-scope for graph writes —
        // re-extracting them would cause pointless LLM calls and, with
        // auto-create enabled, spawn new stubs from data the user already
        // decided to retire. Auto-created stubs (content = just a name)
        // loop the extraction pipeline and are excluded by default; pass
        // --include-auto-created to override.
        const conditions = [
          'content IS NOT NULL',
          "status IS DISTINCT FROM 'archived'"
        ];
        if (!options.includeAutoCreated) {
          conditions.push("NOT ('auto-created' = ANY(tags))");
        }
        const params: unknown[] = [];

        // --id is exclusive: when given it pinpoints a single row, so
        // --type / --only-failed / --limit on top of it are nonsense.
        // The guardrails (content/status/auto-created) still apply and
        // surface as a 0-rows result rather than a misleading success.
        if (options.id) {
          params.push(options.id);
          conditions.push(`id = $${params.length}::uuid`);
        } else {
          if (options.type) {
            params.push(options.type);
            conditions.push(`type = $${params.length}`);
          }
          if (options.onlyFailed) {
            conditions.push("extraction_status = 'failed'");
          }
        }

        const whereClause = conditions.join(' AND ');

        // PostgreSQL doesn't allow LIMIT directly on UPDATE/DELETE, so we
        // wrap the selection in a subquery. Both the DELETE (for
        // --clean-edges) and the UPDATE use the same subquery shape — in a
        // single transaction this resolves to the same entity set, so
        // edges are cleaned for exactly the rows that are then re-queued.
        const selectionSubquery =
          limit !== undefined
            ? `SELECT id FROM entities WHERE ${whereClause} ORDER BY created_at ASC LIMIT ${limit}`
            : `SELECT id FROM entities WHERE ${whereClause}`;

        let deletedEdges = 0;
        if (options.cleanEdges) {
          const deleteResult = await client.query(
            `DELETE FROM edges
             WHERE source = 'llm-extraction'
               AND source_id IN (${selectionSubquery})`,
            params
          );
          deletedEdges = deleteResult.rowCount ?? 0;
        }

        const updateResult = await client.query(
          limit !== undefined
            ? `UPDATE entities
               SET extraction_status = 'pending',
                   extraction_error = NULL
               WHERE id IN (${selectionSubquery})`
            : `UPDATE entities
               SET extraction_status = 'pending',
                   extraction_error = NULL
               WHERE ${whereClause}`,
          params
        );

        // The skipped breakdown re-runs the user-specified filters
        // (--type, --only-failed, --id) without the guardrails, then
        // buckets each non-marked match into the FIRST guardrail it
        // tripped, in priority order: no_content → archived →
        // auto_created. This keeps the buckets disjoint so marked +
        // skipped totals add up. --limit is intentionally NOT applied to
        // the skipped query so operators see the full guardrail picture.
        let skipped:
          | { noContent: number; archived: number; autoCreated: number }
          | undefined;
        if (options.showSkipped) {
          const userConditions: string[] = [];
          const userParams: unknown[] = [];
          if (options.id) {
            userParams.push(options.id);
            userConditions.push(`id = $${userParams.length}::uuid`);
          } else {
            if (options.type) {
              userParams.push(options.type);
              userConditions.push(`type = $${userParams.length}`);
            }
            if (options.onlyFailed) {
              userConditions.push("extraction_status = 'failed'");
            }
          }
          const userWhere = userConditions.length
            ? userConditions.join(' AND ')
            : 'TRUE';

          const autoCreatedFilter = options.includeAutoCreated
            ? '0'
            : `count(*) FILTER (
                 WHERE content IS NOT NULL
                   AND status IS DISTINCT FROM 'archived'
                   AND 'auto-created' = ANY(tags)
               )`;

          const skippedResult = await client.query<{
            no_content: string;
            archived: string;
            auto_created: string;
          }>(
            `SELECT
               count(*) FILTER (WHERE content IS NULL) AS no_content,
               count(*) FILTER (
                 WHERE content IS NOT NULL
                   AND status = 'archived'
               ) AS archived,
               ${autoCreatedFilter} AS auto_created
             FROM entities
             WHERE ${userWhere}`,
            userParams
          );
          const row = skippedResult.rows[0];
          skipped = {
            noContent: Number(row?.no_content ?? '0'),
            archived: Number(row?.archived ?? '0'),
            autoCreated: Number(row?.auto_created ?? '0')
          };
        }

        await client.query('COMMIT');

        const markedCount = updateResult.rowCount ?? 0;

        await appendAuditEntry(pool, {
          operation: 'reextract.start',
          details: {
            markedCount,
            deletedEdges,
            type: options.type ?? (options.id ? null : 'all'),
            id: options.id ?? null,
            limit: limit ?? null,
            cleanEdges: Boolean(options.cleanEdges),
            includeAutoCreated: Boolean(options.includeAutoCreated),
            onlyFailed: Boolean(options.onlyFailed)
          }
        });

        const suffixes: string[] = [];
        if (options.onlyFailed) suffixes.push('only failed');
        if (limit !== undefined) suffixes.push(`limit ${limit}`);
        if (options.cleanEdges) suffixes.push(`deleted ${deletedEdges} prior edges`);
        const suffix = suffixes.length > 0 ? ` (${suffixes.join('; ')})` : '';

        if (json) {
          return skipped
            ? { markedCount, deletedEdges, skipped }
            : { markedCount, deletedEdges };
        }
        const lines = [`Marked ${markedCount} entities for re-extraction${suffix}`];
        if (skipped) {
          const total =
            skipped.noContent + skipped.archived + skipped.autoCreated;
          lines.push(
            `Skipped ${total} (no_content=${skipped.noContent}, archived=${skipped.archived}, auto_created=${skipped.autoCreated})`
          );
        }
        return lines;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  });

program
  .command('prune-edges')
  .description('Delete edges below a confidence threshold (default scope: source=llm-extraction)')
  .requiredOption('--below <threshold>', 'prune edges with confidence strictly below this value (0-1)')
  .option('--source <source>', "only prune edges with this source (default 'llm-extraction', use 'any' to include all)", 'llm-extraction')
  .option('--relation <relation>', 'only prune edges with this relation')
  .option('--dry-run', 'report what would be pruned without deleting')
  .action(async (options, command) => {
    const json = isJsonMode(command);

    const threshold = Number(options.below);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      await handleCliFailure(
        new Error('--below must be a number in [0, 1]'),
        json
      );
      return;
    }

    await runWithPool(json, async (pool) => {
      const conditions: string[] = ['confidence < $1'];
      const params: unknown[] = [threshold];

      if (options.source && options.source !== 'any') {
        params.push(options.source);
        conditions.push(`source = $${params.length}`);
      }

      if (options.relation) {
        params.push(options.relation);
        conditions.push(`relation = $${params.length}`);
      }

      const whereClause = conditions.join(' AND ');

      if (options.dryRun) {
        const countResult = await pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM edges WHERE ${whereClause}`,
          params
        );
        const wouldDelete = Number(countResult.rows[0]?.count ?? '0');
        return json
          ? { wouldDelete, threshold, source: options.source, relation: options.relation ?? null, dryRun: true }
          : [`Would delete ${wouldDelete} edges below confidence ${threshold}`];
      }

      const deleteResult = await pool.query(
        `DELETE FROM edges WHERE ${whereClause}`,
        params
      );
      const deleted = deleteResult.rowCount ?? 0;

      await appendAuditEntry(pool, {
        operation: 'edges.prune',
        details: {
          deleted,
          threshold,
          source: options.source,
          relation: options.relation ?? null
        }
      });

      return json
        ? { deleted, threshold, source: options.source, relation: options.relation ?? null }
        : [`Deleted ${deleted} edges below confidence ${threshold}`];
    });
  });

program
  .command('validate-edges')
  .description('Use the configured extraction LLM to validate edges and remove those it judges invalid')
  .option('--source <source>', "only validate edges with this source (default 'llm-extraction', 'any' for all)", 'llm-extraction')
  .option('--limit <n>', 'maximum edges to validate in this run (default 100)', '100')
  .option('--min-confidence <value>', 'remove edges the LLM validates below this confidence (default 0.4)', '0.4')
  .option('--skip-validated-days <n>', 'skip edges validated within the last N days (default 7)', '7')
  .option('--force', 'revalidate edges regardless of last_validated_at metadata')
  .option('--dry-run', 'report what would be removed without deleting or marking edges')
  .action(async (options, command) => {
    const json = isJsonMode(command);

    const limit = Number.parseInt(options.limit, 10);
    const minConfidence = Number(options.minConfidence);
    const skipDays = Number.parseInt(options.skipValidatedDays, 10);

    if (!Number.isFinite(limit) || limit <= 0) {
      await handleCliFailure(new Error('--limit must be a positive integer'), json);
      return;
    }
    if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
      await handleCliFailure(
        new Error('--min-confidence must be a number in [0, 1]'),
        json
      );
      return;
    }
    if (!Number.isFinite(skipDays) || skipDays < 0) {
      await handleCliFailure(
        new Error('--skip-validated-days must be a non-negative integer'),
        json
      );
      return;
    }

    // Config + provider construction happens before runWithPool, so any
    // failure (missing env, invalid provider creds) would otherwise throw
    // outside the CLI's structured-error path and break --json output.
    let callLlm: (prompt: string, schema?: object) => Promise<string>;
    let logger: ReturnType<typeof import('../../util/logger.js').createLogger>;
    let validateEdgeBatch: typeof import('../../services/edge-validation-service.js').validateEdgeBatch;
    try {
      const config = loadConfig();
      if (!config.EXTRACTION_ENABLED) {
        throw new Error(
          'EXTRACTION_ENABLED is not set — edge validation requires an extraction LLM. Set EXTRACTION_ENABLED=true and the provider credentials.'
        );
      }

      const { createLlmProvider } = await import('../../services/llm-provider.js');
      const { createLogger } = await import('../../util/logger.js');
      ({ validateEdgeBatch } = await import(
        '../../services/edge-validation-service.js'
      ));

      callLlm = createLlmProvider({
        provider: config.EXTRACTION_PROVIDER,
        model: config.EXTRACTION_MODEL,
        openaiApiKey: config.OPENAI_API_KEY,
        anthropicApiKey: config.ANTHROPIC_API_KEY,
        ollamaBaseUrl: config.OLLAMA_BASE_URL,
        ollamaApiKey: config.OLLAMA_API_KEY,
        disableThinking: config.EXTRACTION_DISABLE_THINKING,
        reasoningEffort: config.EXTRACTION_REASONING_EFFORT
      });
      logger = createLogger(config.LOG_LEVEL);
    } catch (error) {
      await handleCliFailure(error, json);
      return;
    }

    await runWithPool(json, async (pool) => {
      const result = await validateEdgeBatch(pool, callLlm, {
        source: options.source,
        limit,
        minConfidence,
        skipValidatedDays: skipDays,
        force: Boolean(options.force),
        dryRun: Boolean(options.dryRun),
        logger
      });

      if (!options.dryRun) {
        await appendAuditEntry(pool, {
          operation: 'edges.validate',
          details: {
            ...result,
            minConfidence,
            source: options.source,
            limit,
            skipValidatedDays: skipDays,
            force: Boolean(options.force)
          }
        });
      }

      return json
        ? { ...result, dryRun: Boolean(options.dryRun) }
        : [
            `Validated ${result.checked} edges (${result.kept} kept, ${result.removed} ${options.dryRun ? 'would be removed' : 'removed'}, ${result.skipped} skipped, ${result.errored} errored)`
          ];
    });
  });

program
  .command('improve-graph')
  .description(
    'Run extraction inline against existing entities, optionally with a different model, to enrich the current graph without wiping edges. Existing edges stay; new ones are added; overlapping edges have their confidence overwritten by the new run (so "improvement" with a less-confident model can lower individual confidences).'
  )
  .option('--all', 'process every entity with content (combine with --limit to bound cost)')
  .option('--type <type>', 'process entities of this type only')
  .option('--id <uuid>', 'process a single entity by id')
  .option('--limit <n>', 'cap the number of entities processed (oldest-first by created_at)')
  .option('--include-auto-created', "also process entities tagged 'auto-created' (off by default — their content is just a name and free-associates)")
  .option('--model <name>', 'extraction model override (e.g. claude-sonnet-4-6). Otherwise uses EXTRACTION_MODEL.')
  .option('--provider <name>', 'extraction provider override: openai | anthropic | ollama. Otherwise uses EXTRACTION_PROVIDER.')
  .option('--concurrency <n>', 'parallel extraction workers (default 1)', '1')
  .option('--debug', 'enable per-target decision logging at info level (same events as EXTRACTION_DEBUG_LOG)')
  .action(async (options, command) => {
    const json = isJsonMode(command);

    if (!options.all && !options.type && !options.id) {
      await handleCliFailure(
        new Error(
          'Specify --all, --type <type>, or --id <uuid> to confirm which entities to process'
        ),
        json
      );
      return;
    }
    if (options.id && !UUID_REGEX.test(options.id)) {
      await handleCliFailure(
        new Error(`--id must be a valid UUID (got "${options.id}")`),
        json
      );
      return;
    }

    let limit: number | undefined;
    if (options.limit !== undefined) {
      const parsed = Number.parseInt(options.limit, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        await handleCliFailure(
          new Error('--limit must be a positive integer'),
          json
        );
        return;
      }
      limit = parsed;
    }

    const concurrency = Number.parseInt(options.concurrency, 10);
    if (!Number.isInteger(concurrency) || concurrency <= 0 || concurrency > 16) {
      await handleCliFailure(
        new Error('--concurrency must be an integer between 1 and 16'),
        json
      );
      return;
    }

    const allowedProviders = ['openai', 'anthropic', 'ollama'] as const;
    type ProviderName = (typeof allowedProviders)[number];
    if (
      options.provider !== undefined &&
      !(allowedProviders as readonly string[]).includes(options.provider)
    ) {
      await handleCliFailure(
        new Error(
          `--provider must be one of ${allowedProviders.join(', ')} (got "${options.provider}")`
        ),
        json
      );
      return;
    }

    // Build LLM + embedding services up front so misconfiguration fails
    // before we touch the DB or print a misleading "started" line.
    type AutoCreateConfig = {
      enabled: boolean;
      types: readonly string[];
      minConfidence: number;
      minConfidenceByType?: Readonly<Record<string, number>>;
    };

    let callLlm: (prompt: string, schema?: object) => Promise<string>;
    let embeddingService: import('../../services/embedding-service.js').EmbeddingService;
    let logger: ReturnType<typeof import('../../util/logger.js').createLogger>;
    let extractAndLinkRelationships: typeof import('../../services/extraction-service.js').extractAndLinkRelationships;
    let autoCreate: AutoCreateConfig | undefined;
    let matchMinSimilarity: number;
    let minContentChars: number;

    try {
      const config = loadConfig();
      if (!config.EXTRACTION_ENABLED) {
        throw new Error(
          'EXTRACTION_ENABLED is not set — improve-graph runs the extraction LLM. Set EXTRACTION_ENABLED=true and the provider credentials.'
        );
      }

      const { createLlmProvider } = await import('../../services/llm-provider.js');
      const { createLogger } = await import('../../util/logger.js');
      const embeddingsModule = await import('../../services/embedding-service.js');
      const providersModule = await import('../../services/embeddings/providers.js');
      ({ extractAndLinkRelationships } = await import(
        '../../services/extraction-service.js'
      ));

      const provider: ProviderName = (options.provider as ProviderName | undefined) ?? config.EXTRACTION_PROVIDER;
      const model = options.model ?? config.EXTRACTION_MODEL;

      callLlm = createLlmProvider({
        provider,
        model,
        openaiApiKey: config.OPENAI_API_KEY,
        anthropicApiKey: config.ANTHROPIC_API_KEY,
        ollamaBaseUrl: config.OLLAMA_BASE_URL,
        ollamaApiKey: config.OLLAMA_API_KEY,
        disableThinking: config.EXTRACTION_DISABLE_THINKING,
        reasoningEffort: config.EXTRACTION_REASONING_EFFORT
      });

      // Mirror startServer's embedding setup. Extraction needs an embedder
      // for the chunk-similarity matching stage even when the run is
      // initiated from the CLI rather than the worker.
      const embeddingProviderConfig = buildEmbeddingProviderConfig(config);
      const embeddingProvider = providersModule.createEmbeddingProvider(
        embeddingProviderConfig
      );
      embeddingService = embeddingsModule.createEmbeddingService({
        provider: embeddingProvider
      });
      logger = createLogger(config.LOG_LEVEL);

      autoCreate = config.EXTRACTION_AUTO_CREATE_ENTITIES
        ? {
            enabled: true,
            types: config.EXTRACTION_AUTO_CREATE_TYPES,
            minConfidence: config.EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE,
            minConfidenceByType:
              config.EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE_BY_TYPE
          }
        : undefined;
      matchMinSimilarity = config.EXTRACTION_MATCH_MIN_SIMILARITY;
      minContentChars = config.EXTRACTION_MIN_CONTENT_CHARS;
    } catch (error) {
      await handleCliFailure(error, json);
      return;
    }

    await runWithPool(json, async (pool) => {
      // Selection mirrors reextract's guardrails: skip no-content,
      // archived, and (by default) auto-created stubs.
      const conditions = [
        'content IS NOT NULL',
        "status IS DISTINCT FROM 'archived'"
      ];
      if (!options.includeAutoCreated) {
        conditions.push("NOT ('auto-created' = ANY(tags))");
      }
      const params: unknown[] = [];

      if (options.id) {
        params.push(options.id);
        conditions.push(`id = $${params.length}::uuid`);
      } else if (options.type) {
        params.push(options.type);
        conditions.push(`type = $${params.length}`);
      }

      const whereClause = conditions.join(' AND ');
      const limitClause = limit !== undefined ? `LIMIT ${limit}` : '';

      const candidates = await pool.query<{
        id: string;
        type: string;
        content: string;
        visibility: string;
        owner: string | null;
      }>(
        `SELECT id, type, content, visibility, owner
         FROM entities
         WHERE ${whereClause}
         ORDER BY created_at ASC
         ${limitClause}`,
        params
      );

      if (candidates.rows.length === 0) {
        const result = {
          processed: 0,
          edgesLinked: 0,
          deferred: 0,
          errored: 0,
          entities: [] as Array<{
            id: string;
            edgesLinked: number;
            deferred: boolean;
            error: string | null;
          }>
        };
        return json ? result : ['No entities matched the selectors'];
      }

      // Per-entity advisory lock matches the worker's lock convention so
      // CLI runs and worker runs can't double-extract the same entity.
      // The outer pool connection is just for the lock; extraction itself
      // borrows from the main pool.
      const lockClient = await pool.connect();
      const debugLog = options.debug
        ? (event: string, payload: Record<string, unknown>) =>
            logger.info({ event, ...payload }, event)
        : undefined;

      type EntityResult = {
        id: string;
        edgesLinked: number;
        deferred: boolean;
        error: string | null;
        skipped: 'lock_held' | null;
      };

      const queue = [...candidates.rows];
      const results: EntityResult[] = [];

      const worker = async (): Promise<void> => {
        for (;;) {
          const entity = queue.shift();
          if (!entity) return;

          const lockRes = await lockClient.query<{ locked: boolean }>(
            'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
            [entity.id]
          );
          if (!lockRes.rows[0]?.locked) {
            results.push({
              id: entity.id,
              edgesLinked: 0,
              deferred: false,
              error: null,
              skipped: 'lock_held'
            });
            continue;
          }

          try {
            const linked = await extractAndLinkRelationships(
              pool,
              {
                apiKeyId: null,
                keyName: 'cli-improve-graph',
                scopes: ['read', 'write', 'delete'] as const,
                allowedTypes: null,
                allowedVisibility: ['personal', 'work', 'shared'] as const
              },
              {
                id: entity.id,
                type: entity.type,
                content: entity.content,
                visibility: entity.visibility,
                owner: entity.owner
              },
              {
                callLlm,
                embeddingService,
                matchMinSimilarity,
                minContentChars,
                ...(autoCreate ? { autoCreate } : {}),
                ...(debugLog ? { debugLog } : {})
              }
            );
            results.push({
              id: entity.id,
              edgesLinked: linked,
              deferred: false,
              error: null,
              skipped: null
            });
          } catch (error) {
            // SemanticMatchUnavailableError surfaces as an error here; the
            // worker treats it specially because it leaves entities
            // retry-eligible, but for an inline CLI run there's nothing to
            // retry against, so we record it like any other failure.
            const message =
              error instanceof Error ? error.message : String(error);
            const deferred =
              error instanceof Error &&
              error.name === 'SemanticMatchUnavailableError';
            results.push({
              id: entity.id,
              edgesLinked: 0,
              deferred,
              error: deferred ? null : message,
              skipped: null
            });
          } finally {
            await lockClient
              .query('SELECT pg_advisory_unlock(hashtext($1))', [entity.id])
              .catch(() => undefined);
          }
        }
      };

      try {
        await Promise.all(
          Array.from({ length: concurrency }, () => worker())
        );
      } finally {
        lockClient.release();
      }

      const summary = {
        processed: results.filter((r) => r.skipped === null).length,
        edgesLinked: results.reduce((sum, r) => sum + r.edgesLinked, 0),
        deferred: results.filter((r) => r.deferred).length,
        errored: results.filter((r) => r.error !== null).length,
        skippedLockHeld: results.filter((r) => r.skipped === 'lock_held').length
      };

      await appendAuditEntry(pool, {
        operation: 'improve-graph.run',
        details: {
          ...summary,
          model: options.model ?? null,
          provider: options.provider ?? null,
          id: options.id ?? null,
          type: options.type ?? null,
          all: Boolean(options.all),
          limit: limit ?? null
        }
      });

      if (json) {
        return {
          ...summary,
          entities: results.map((r) => ({
            id: r.id,
            edgesLinked: r.edgesLinked,
            deferred: r.deferred,
            error: r.error,
            skipped: r.skipped
          }))
        };
      }

      const lines = [
        `Processed ${summary.processed} entities, linked ${summary.edgesLinked} edges` +
          (summary.deferred > 0 ? `, ${summary.deferred} deferred (semantic match unavailable)` : '') +
          (summary.errored > 0 ? `, ${summary.errored} errored` : '') +
          (summary.skippedLockHeld > 0 ? `, ${summary.skippedLockHeld} skipped (lock held by worker)` : '')
      ];
      for (const r of results) {
        if (r.error) {
          lines.push(`  ${shortId(r.id)} error: ${r.error}`);
        } else if (r.deferred) {
          lines.push(`  ${shortId(r.id)} deferred (embeddings unavailable)`);
        } else if (r.skipped === 'lock_held') {
          lines.push(`  ${shortId(r.id)} skipped (lock held)`);
        } else {
          lines.push(`  ${shortId(r.id)} +${r.edgesLinked} edges`);
        }
      }
      return lines;
    });
  });

program
  .command('stats')
  .description('Show system stats')
  .action(async (_options, command) => {
    const json = isJsonMode(command);

    await runWithPool(json, async (pool, mode) => {
      const entityCountsResult = await pool.query<{ type: string; count: string }>(
        `
          SELECT type, count(*)::text AS count
          FROM entities
          GROUP BY type
        `
      );
      const chunkCountResult = await pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM chunks'
      );
      const keyCountResult = await pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM api_keys'
      );
      const databaseSizeResult = await pool.query<{ size: string }>(
        'SELECT pg_database_size(current_database())::text AS size'
      );
      const uptimeResult = await pool.query<{ uptime: string }>(
        'SELECT EXTRACT(EPOCH FROM now() - pg_postmaster_start_time())::text AS uptime'
      );

      await appendAuditEntry(pool, { operation: 'stats.view' });

      const stats = {
        entityCounts: Object.fromEntries(
          entityCountsResult.rows.map((row) => [row.type, Number(row.count)])
        ),
        chunkCount: Number(chunkCountResult.rows[0]?.count ?? '0'),
        keyCount: Number(keyCountResult.rows[0]?.count ?? '0'),
        databaseSizeBytes: Number(databaseSizeResult.rows[0]?.size ?? '0'),
        uptimeSeconds: Math.floor(Number(uptimeResult.rows[0]?.uptime ?? '0'))
      };

      if (mode) {
        return stats;
      }

      return formatStats(stats);
    });
  });

const embeddingsCommand = program
  .command('embeddings')
  .description('Manage embedding storage');

embeddingsCommand
  .command('migrate')
  .description('Migrate chunk embedding storage to a new dimension')
  .requiredOption('--target-dimensions <n>', 'target embedding dimension')
  .option('--dry-run', 'report affected counts without altering schema or data')
  .option('--yes', 'confirm destructive migration (required outside --dry-run)')
  .action(async (options, command) => {
    const json = isJsonMode(command);
    const targetDimensions = Number(options.targetDimensions);

    if (!Number.isInteger(targetDimensions) || targetDimensions <= 0) {
      const message = `--target-dimensions must be a positive integer (got ${options.targetDimensions})`;
      if (json) {
        printJson({ error: { code: 'VALIDATION', message } });
      } else {
        printHuman([`VALIDATION: ${message}`]);
      }
      process.exit(65);
    }

    let providerConfig;
    try {
      providerConfig = buildEmbeddingProviderConfig(loadConfig());
    } catch (error) {
      const appError =
        error instanceof AppError
          ? error
          : new AppError(
              ErrorCode.VALIDATION,
              error instanceof Error ? error.message : 'invalid config'
            );
      if (json) {
        printJson(toErrorResponse(appError));
      } else {
        printHuman([`${appError.code}: ${appError.message}`]);
      }
      process.exit(65);
    }

    const pool = createPool();

    try {
      const report = await runMigrate({
        pool,
        providerConfig,
        targetDimensions,
        dryRun: Boolean(options.dryRun),
        yes: Boolean(options.yes)
      });

      if (json) {
        printJson(report);
      } else {
        printHuman(formatMigrateReport(report));
      }
      process.exit(0);
    } catch (error) {
      if (error instanceof MigrateRefusal) {
        if (json) {
          printJson({ error: { code: 'VALIDATION', message: error.message } });
        } else {
          printHuman([`REFUSED: ${error.message}`]);
        }
        process.exit(error.exitCode);
      }
      const appError =
        error instanceof AppError
          ? error
          : new AppError(
              ErrorCode.INTERNAL,
              error instanceof Error ? error.message : 'migration failed'
            );
      if (json) {
        printJson(toErrorResponse(appError));
      } else {
        printHuman([`${appError.code}: ${appError.message}`]);
      }
      process.exit(70);
    } finally {
      await pool.end().catch(() => undefined);
    }
  });

function formatMigrateReport(report: MigrateReport): string[] {
  const header = report.dryRun ? 'dry run — no changes applied' : 'migration complete';
  return [
    header,
    `previous: provider=${report.previous.provider ?? 'none'} name=${report.previous.name ?? 'none'} dimensions=${report.previous.dimensions ?? 'none'}`,
    `target:   provider=${report.target.provider} name=${report.target.name} dimensions=${report.target.dimensions}`,
    `effects:  chunks_discarded=${report.effects.chunksDiscarded} entities_marked_pending=${report.effects.entitiesMarkedPending}`,
    report.newModelId ? `new_model_id=${report.newModelId}` : 'new_model_id=(dry-run)',
    `elapsed_ms=${report.elapsedMs}`
  ];
}

await program.parseAsync(process.argv);

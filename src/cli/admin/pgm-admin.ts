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

function formatQueue(queue: {
  embedding: { pending: number; completed: number; failed: number; retryEligible: number; oldestPendingSecs: number | null };
  extraction: { pending: number; completed: number; failed: number } | null;
}): string[] {
  const lines: string[] = [];
  const e = queue.embedding;
  const age = e.oldestPendingSecs !== null ? ` oldest_pending=${Math.round(e.oldestPendingSecs)}s` : '';
  lines.push(
    `embedding:  pending=${e.pending}  completed=${e.completed}  failed=${e.failed}  retry_eligible=${e.retryEligible}${age}`
  );
  if (queue.extraction) {
    const x = queue.extraction;
    lines.push(
      `extraction: pending=${x.pending}  completed=${x.completed}  failed=${x.failed}`
    );
  } else {
    lines.push('extraction: disabled');
  }
  return lines;
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
  .action(async (options, command) => {
    const json = isJsonMode(command);

    if (!options.all && !options.type) {
      await handleCliFailure(
        new Error('Specify --all or --type <type> to confirm which entities to re-embed'),
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
            type: options.type ?? 'all'
          }
        });

        return json
          ? { markedCount }
          : [`Marked ${markedCount} entities for re-embedding`];
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
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

program
  .command('queue')
  .description('Show enrichment and extraction queue status')
  .action(async (_options, command) => {
    const json = isJsonMode(command);

    await runWithPool(json, async (pool, mode) => {
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

      const result = await pool.query<QueueRow>(`
        SELECT
          COUNT(*) FILTER (WHERE enrichment_status = 'pending')::text                                                                                     AS embedding_pending,
          COUNT(*) FILTER (WHERE enrichment_status = 'completed')::text                                                                                   AS embedding_completed,
          COUNT(*) FILTER (WHERE enrichment_status = 'failed')::text                                                                                      AS embedding_failed,
          COUNT(*) FILTER (WHERE enrichment_status = 'failed' AND enrichment_attempts < 3 AND updated_at < now() - interval '5 minutes')::text            AS embedding_retry_eligible,
          EXTRACT(EPOCH FROM now() - MIN(updated_at) FILTER (WHERE enrichment_status = 'pending'))::text                                                  AS oldest_pending_secs,
          COUNT(*) FILTER (WHERE extraction_status = 'pending')::text                                                                                     AS extraction_pending,
          COUNT(*) FILTER (WHERE extraction_status = 'completed')::text                                                                                   AS extraction_completed,
          COUNT(*) FILTER (WHERE extraction_status = 'failed')::text                                                                                      AS extraction_failed,
          COUNT(*) FILTER (WHERE extraction_status IS NOT NULL)::text                                                                                     AS extraction_any
        FROM entities
        WHERE content IS NOT NULL
      `);

      const row = result.rows[0];
      if (!row) {
        return mode ? {} : ['No data'];
      }

      const extractionEnabled = Number(row.extraction_any) > 0;

      const queue = {
        embedding: {
          pending: Number(row.embedding_pending),
          completed: Number(row.embedding_completed),
          failed: Number(row.embedding_failed),
          retryEligible: Number(row.embedding_retry_eligible),
          oldestPendingSecs: row.oldest_pending_secs !== null ? Number(row.oldest_pending_secs) : null
        },
        extraction: extractionEnabled
          ? {
              pending: Number(row.extraction_pending),
              completed: Number(row.extraction_completed),
              failed: Number(row.extraction_failed)
            }
          : null
      };

      return mode ? queue : formatQueue(queue);
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

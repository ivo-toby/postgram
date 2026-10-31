import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthContext } from '../../src/auth/types.js';
import { setFeatureStage } from '../../src/services/feature-service.js';
import { createTask, updateTask } from '../../src/services/task-service.js';
import { ErrorCode } from '../../src/util/errors.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

const KEY_ID = '00000000-0000-0000-0000-000000000502';
const READ_ONLY_KEY_ID = '00000000-0000-0000-0000-000000000503';

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    apiKeyId: KEY_ID,
    keyName: 'stage-key',
    clientId: 'stage-key',
    scopes: ['read', 'write'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared'],
    ...overrides
  };
}

function readOnlyAuth(): AuthContext {
  return auth({
    apiKeyId: READ_ONLY_KEY_ID,
    keyName: 'stage-read-key',
    clientId: 'stage-read-key',
    scopes: ['read']
  });
}

type AuditRow = {
  operation: string;
  entity_id: string | null;
  details: Record<string, unknown>;
};

type PoolQuery = (sql: string, params?: unknown[]) => Promise<unknown>;

/**
 * Wraps the test pool so that the first `bumps` pool-level queries are
 * followed by an independent, immediately committed `UPDATE` of `taskId`.
 * That reproduces another writer bumping the version between the stage
 * read and the stage write: each bump costs one attempt, so one bump must be
 * retried and several bumps must end in CONFLICT.
 */
function poolWithConcurrentWrites(
  pool: Pool,
  taskId: string,
  bumps: number
): Pool {
  const realQuery = (pool.query as unknown as PoolQuery).bind(pool);
  let remaining = bumps;

  const hookedQuery = async (
    sql: string,
    params?: unknown[]
  ): Promise<unknown> => {
    const result = await realQuery(sql, params);
    if (remaining > 0) {
      remaining -= 1;
      await realQuery(
        'UPDATE entities SET version = version + 1 WHERE id = $1',
        [taskId]
      );
    }
    return result;
  };

  return new Proxy(pool, {
    get(target, prop): unknown {
      if (prop === 'query') {
        return hookedQuery;
      }
      const value: unknown = Reflect.get(target, prop);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    }
  });
}

describe('feature stage service', () => {
  let database: TestDatabase | undefined;

  function db(): TestDatabase {
    if (!database) {
      throw new Error('test database not initialized');
    }
    return database;
  }

  async function task(content: string, metadata?: Record<string, unknown>) {
    return (
      await createTask(db().pool, auth(), {
        content,
        ...(metadata ? { metadata } : {})
      })
    )._unsafeUnwrap();
  }

  async function entityRow(id: string) {
    const result = await db().pool.query<{
      version: number;
      status: string | null;
      metadata: Record<string, unknown>;
    }>('SELECT version, status, metadata FROM entities WHERE id = $1', [id]);
    const row = result.rows[0];
    if (!row) {
      throw new Error(`entity ${id} not found`);
    }
    return row;
  }

  async function auditRows(operation: string): Promise<AuditRow[]> {
    const result = await db().pool.query<AuditRow>(
      `SELECT operation, entity_id, details FROM audit_log
       WHERE operation = $1 ORDER BY timestamp, id`,
      [operation]
    );
    return result.rows;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    await resetTestDatabase(db().pool);
    await seedApiKey(db().pool, { id: KEY_ID, name: 'stage-key' });
    await seedApiKey(db().pool, {
      id: READ_ONLY_KEY_ID,
      name: 'stage-read-key',
      scopes: ['read']
    });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('promotes a plain task by short id and keeps its other metadata (stage-set)', async () => {
    const plain = await task('Stage plain task', {
      context: 'work',
      due_date: '2026-12-31'
    });
    expect(plain.metadata).toEqual({ context: 'work', due_date: '2026-12-31' });

    const promoted = (
      await setFeatureStage(db().pool, auth(), {
        id: plain.id.slice(0, 8),
        stage: 'functional_test'
      })
    )._unsafeUnwrap();

    expect(promoted.previous_stage).toBeNull();
    expect(promoted.entity.id).toBe(plain.id);
    expect(promoted.entity.status).toBe('inbox');

    const { stage_set_at: stageSetAt, ...writtenMetadata } =
      promoted.entity.metadata;
    expect(writtenMetadata).toEqual({
      context: 'work',
      due_date: '2026-12-31',
      kind: 'feature',
      stage: 'functional_test',
      stage_source: 'manual',
      pull_requests: []
    });
    expect(
      typeof stageSetAt === 'string' && !Number.isNaN(Date.parse(stageSetAt))
    ).toBe(true);

    const stored = await entityRow(plain.id);
    expect(stored.metadata.stage).toBe('functional_test');
    expect(stored.metadata.context).toBe('work');
    expect(stored.metadata.due_date).toBe('2026-12-31');

    expect(await auditRows('feature_stage')).toEqual([
      {
        operation: 'feature_stage',
        entity_id: plain.id,
        details: { from: null, to: 'functional_test', source: 'manual' }
      }
    ]);
  }, 120_000);

  it('moves backwards from functional_test to building (stage-set)', async () => {
    const feature = await task('Stage backwards feature', { kind: 'feature' });

    const forward = (
      await setFeatureStage(db().pool, auth(), {
        id: feature.id,
        stage: 'functional_test'
      })
    )._unsafeUnwrap();
    expect(forward.previous_stage).toBe('building');

    const back = (
      await setFeatureStage(db().pool, auth(), {
        id: feature.id,
        stage: 'building'
      })
    )._unsafeUnwrap();
    expect(back.previous_stage).toBe('functional_test');
    expect(back.entity.metadata.stage).toBe('building');
    expect(back.entity.metadata.stage_source).toBe('manual');

    const stored = await entityRow(feature.id);
    expect(stored.metadata.stage).toBe('building');
    expect(stored.version).toBe(back.entity.version);
  }, 120_000);

  it('does not touch task status when reaching released (released-status)', async () => {
    const feature = await task('Stage released feature', { kind: 'feature' });
    const inProgress = (
      await updateTask(db().pool, auth(), {
        id: feature.id,
        version: feature.version,
        status: 'next'
      })
    )._unsafeUnwrap();
    expect(inProgress.status).toBe('next');

    const released = (
      await setFeatureStage(db().pool, auth(), {
        id: feature.id,
        stage: 'released'
      })
    )._unsafeUnwrap();

    expect(released.previous_stage).toBe('building');
    expect(released.entity.metadata.stage).toBe('released');
    expect(released.entity.status).toBe('next');

    const stored = await entityRow(feature.id);
    expect(stored.status).toBe('next');
    expect(stored.metadata.stage).toBe('released');
  }, 120_000);

  it('rejects an unknown stage and a read-only key without writing (stage-set)', async () => {
    const feature = await task('Stage rejection feature', { kind: 'feature' });
    const before = await entityRow(feature.id);

    const invalid = await setFeatureStage(db().pool, auth(), {
      id: feature.id,
      stage: 'shipping'
    });
    expect(invalid.isErr()).toBe(true);
    expect(invalid._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.VALIDATION
    });

    const forbidden = await setFeatureStage(db().pool, readOnlyAuth(), {
      id: feature.id,
      stage: 'review'
    });
    expect(forbidden.isErr()).toBe(true);
    expect(forbidden._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.FORBIDDEN
    });

    expect(await entityRow(feature.id)).toEqual(before);
    expect(await auditRows('feature_stage')).toEqual([]);
  }, 120_000);

  it('retries a version conflict once and returns CONFLICT when it persists (stage-set)', async () => {
    const single = await task('Stage retry feature', { kind: 'feature' });

    const retried = (
      await setFeatureStage(
        poolWithConcurrentWrites(db().pool, single.id, 1),
        auth(),
        { id: single.id, stage: 'review' }
      )
    )._unsafeUnwrap();

    expect(retried.entity.id).toBe(single.id);
    expect(retried.previous_stage).toBe('building');
    expect(retried.entity.metadata.stage).toBe('review');
    expect(retried.entity.metadata.stage_source).toBe('manual');
    expect((await entityRow(single.id)).metadata.stage).toBe('review');
    expect(
      (await auditRows('feature_stage'))
        .filter((row) => row.entity_id === single.id)
        .map((row) => row.details)
    ).toEqual([{ from: 'building', to: 'review', source: 'manual' }]);

    const persistent = await task('Stage persistent conflict feature', {
      kind: 'feature'
    });
    const before = await entityRow(persistent.id);

    const failed = await setFeatureStage(
      poolWithConcurrentWrites(db().pool, persistent.id, 20),
      auth(),
      { id: persistent.id, stage: 'review' }
    );

    expect(failed.isErr()).toBe(true);
    expect(failed._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.CONFLICT
    });

    const after = await entityRow(persistent.id);
    expect(after.metadata).toEqual(before.metadata);
    expect(after.status).toBe(before.status);
    expect(
      (await auditRows('feature_stage')).filter(
        (row) => row.entity_id === persistent.id
      )
    ).toEqual([]);
  }, 120_000);

  it('writes one feature_stage row per change and none for the same stage (feature-audit)', async () => {
    const feature = await task('Stage audit feature', { kind: 'feature' });

    const first = (
      await setFeatureStage(db().pool, auth(), {
        id: feature.id.slice(0, 8),
        stage: 'review'
      })
    )._unsafeUnwrap();
    expect(first.previous_stage).toBe('building');

    (
      await setFeatureStage(db().pool, auth(), {
        id: feature.id,
        stage: 'functional_test'
      })
    )._unsafeUnwrap();

    (
      await setFeatureStage(db().pool, auth(), {
        id: feature.id,
        stage: 'ready_to_merge'
      })
    )._unsafeUnwrap();

    const same = (
      await setFeatureStage(db().pool, auth(), {
        id: feature.id,
        stage: 'ready_to_merge'
      })
    )._unsafeUnwrap();
    expect(same.previous_stage).toBe('ready_to_merge');
    expect(same.entity.metadata.stage).toBe('ready_to_merge');

    expect(await auditRows('feature_stage')).toEqual([
      {
        operation: 'feature_stage',
        entity_id: feature.id,
        details: { from: 'building', to: 'review', source: 'manual' }
      },
      {
        operation: 'feature_stage',
        entity_id: feature.id,
        details: { from: 'review', to: 'functional_test', source: 'manual' }
      },
      {
        operation: 'feature_stage',
        entity_id: feature.id,
        details: {
          from: 'functional_test',
          to: 'ready_to_merge',
          source: 'manual'
        }
      }
    ]);
  }, 120_000);
});

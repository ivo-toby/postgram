import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthContext } from '../../src/auth/types.js';
import { storeEntity } from '../../src/services/entity-service.js';
import {
  addFeaturePullRequest,
  createFeature,
  resolveFeatureId,
  setFeatureStage,
  setRepositoryReleaseOnMerge
} from '../../src/services/feature-service.js';
import { createTask, updateTask } from '../../src/services/task-service.js';
import { ErrorCode } from '../../src/util/errors.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

const KEY_ID = '00000000-0000-0000-0000-000000000402';
const PR_URL = 'https://github.com/ivo-toby/postgram/pull/12';

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    apiKeyId: KEY_ID,
    keyName: 'feature-key',
    clientId: 'feature-key',
    scopes: ['read', 'write'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared'],
    ...overrides
  };
}

type AuditRow = { operation: string; entity_id: string | null; details: Record<string, unknown> };

function errorCode(result: { isErr(): boolean; _unsafeUnwrapErr(): unknown }): unknown {
  expect(result.isErr()).toBe(true);
  const error = result._unsafeUnwrapErr() as { code?: unknown };
  return error.code;
}

describe('feature service (feature)', () => {
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
    return result.rows[0];
  }

  async function auditRows(operation: string): Promise<AuditRow[]> {
    const result = await db().pool.query<AuditRow>(
      `SELECT operation, entity_id, details FROM audit_log
       WHERE operation = $1 ORDER BY timestamp, id`,
      [operation]
    );
    return result.rows;
  }

  async function insertTask(id: string, content: string, status = 'inbox') {
    await db().pool.query(
      `INSERT INTO entities (id, type, content, visibility, status, metadata)
       VALUES ($1, 'task', $2, 'shared', $3, '{}')`,
      [id, content, status]
    );
  }

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    await resetTestDatabase(db().pool);
    await db().pool.query(
      'TRUNCATE TABLE agent_sessions, workspaces, machines, repositories CASCADE'
    );
    await seedApiKey(db().pool, { id: KEY_ID, name: 'feature-key' });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('fills feature defaults in the task tools and leaves other tasks alone (C1)', async () => {
    const plain = await task('Plain task');
    expect(plain.metadata).toEqual({});

    const feature = await task('Feature A\nbody', { kind: 'feature' });
    expect(feature.metadata).toMatchObject({
      kind: 'feature',
      stage: 'building',
      stage_source: 'manual',
      pull_requests: []
    });
    const setAt = feature.metadata.stage_set_at;
    expect(typeof setAt === 'string' && !Number.isNaN(Date.parse(setAt))).toBe(true);

    const marked = (
      await updateTask(db().pool, auth(), {
        id: plain.id,
        version: plain.version,
        metadata: { kind: 'feature' }
      })
    )._unsafeUnwrap();
    expect(marked.metadata).toMatchObject({ kind: 'feature', stage: 'building', pull_requests: [] });
  }, 120_000);

  it('rejects invalid feature metadata without writing (C1)', async () => {
    const badStage = await createTask(db().pool, auth(), {
      content: 'Bad stage',
      metadata: { kind: 'feature', stage: 'shipping' }
    });
    expect(errorCode(badStage)).toBe(ErrorCode.VALIDATION);

    const badPrs = await createTask(db().pool, auth(), {
      content: 'Bad prs',
      metadata: { kind: 'feature', pull_requests: 'none' }
    });
    expect(errorCode(badPrs)).toBe(ErrorCode.VALIDATION);

    const nonCanonical = await createTask(db().pool, auth(), {
      content: 'Bad pr url',
      metadata: {
        kind: 'feature',
        pull_requests: [
          { url: 'https://github.com/Ivo-Toby/postgram/pull/12/files', state: 'open', updated_at: '2026-10-31T10:00:00.000Z' }
        ]
      }
    });
    expect(errorCode(nonCanonical)).toBe(ErrorCode.VALIDATION);

    const count = await db().pool.query<{ n: string }>('SELECT count(*)::text AS n FROM entities');
    expect(count.rows[0]?.n).toBe('0');

    const feature = await task('Feature A', { kind: 'feature' });
    const rejected = await updateTask(db().pool, auth(), {
      id: feature.id,
      version: feature.version,
      metadata: { stage: 'shipping' }
    });
    expect(errorCode(rejected)).toBe(ErrorCode.VALIDATION);
    expect((await entityRow(feature.id))?.version).toBe(feature.version);
  }, 120_000);

  it('marks a stage change through updateTask as manual and never derives (C1)', async () => {
    const feature = await task('Feature A', {
      kind: 'feature',
      stage: 'review',
      stage_source: 'derived',
      stage_set_at: '2026-01-01T00:00:00.000Z'
    });
    expect(feature.metadata).toMatchObject({ stage: 'review', stage_source: 'derived' });

    const moved = (
      await updateTask(db().pool, auth(), {
        id: feature.id,
        version: feature.version,
        metadata: { stage: 'building' }
      })
    )._unsafeUnwrap();
    expect(moved.metadata).toMatchObject({ stage: 'building', stage_source: 'manual' });
    expect(moved.metadata.stage_set_at).not.toBe('2026-01-01T00:00:00.000Z');

    const withPr = (
      await updateTask(db().pool, auth(), {
        id: moved.id,
        version: moved.version,
        metadata: {
          pull_requests: [{ url: PR_URL, state: 'merged', updated_at: '2026-10-31T10:00:00.000Z' }]
        }
      })
    )._unsafeUnwrap();
    expect(withPr.metadata.stage).toBe('building');
  }, 120_000);

  it('creates features and resolves full and short ids (C2)', async () => {
    const created = (
      await createFeature(db().pool, auth(), { content: '  Keyword rank fusion\nbody', tags: ['search'] })
    )._unsafeUnwrap();
    expect(created.status).toBe('inbox');
    expect(created.tags).toEqual(['search']);
    expect(created.metadata).toMatchObject({ kind: 'feature', stage: 'building', stage_source: 'manual', pull_requests: [] });

    expect((await resolveFeatureId(db().pool, auth(), created.id))._unsafeUnwrap().id).toBe(created.id);
    expect(
      (await resolveFeatureId(db().pool, auth(), created.id.slice(0, 8)))._unsafeUnwrap().id
    ).toBe(created.id);

    await insertTask('abcd1234-0000-4000-8000-000000000001', 'First twin');
    await insertTask('abcd1234-0000-4000-8000-000000000002', 'Second twin\nbody');
    const ambiguous = await resolveFeatureId(db().pool, auth(), 'abcd1234');
    expect(errorCode(ambiguous)).toBe(ErrorCode.CONFLICT);
    expect(ambiguous._unsafeUnwrapErr().details.candidates).toEqual([
      { id: 'abcd1234-0000-4000-8000-000000000001', title: 'First twin' },
      { id: 'abcd1234-0000-4000-8000-000000000002', title: 'Second twin' }
    ]);

    await db().pool.query(
      "UPDATE entities SET status = 'archived' WHERE id = 'abcd1234-0000-4000-8000-000000000001'"
    );
    expect(
      (await resolveFeatureId(db().pool, auth(), 'abcd1234'))._unsafeUnwrap().id
    ).toBe('abcd1234-0000-4000-8000-000000000002');

    const memory = (
      await storeEntity(db().pool, auth(), { type: 'memory', content: 'note' })
    )._unsafeUnwrap();
    const workTask = (
      await createTask(db().pool, auth(), { content: 'Work only', visibility: 'work' })
    )._unsafeUnwrap();

    expect(errorCode(await resolveFeatureId(db().pool, auth(), 'not-an-id'))).toBe(ErrorCode.VALIDATION);
    expect(errorCode(await resolveFeatureId(db().pool, auth(), 'ABCD1234'))).toBe(ErrorCode.VALIDATION);
    expect(errorCode(await resolveFeatureId(db().pool, auth(), memory.id))).toBe(ErrorCode.VALIDATION);
    expect(
      errorCode(await resolveFeatureId(db().pool, auth(), '99999999-0000-4000-8000-000000000000'))
    ).toBe(ErrorCode.NOT_FOUND);
    expect(errorCode(await resolveFeatureId(db().pool, auth(), 'ffffffff'))).toBe(ErrorCode.NOT_FOUND);

    const personalOnly = auth({ allowedVisibility: ['personal', 'shared'] });
    expect(errorCode(await resolveFeatureId(db().pool, personalOnly, workTask.id))).toBe(ErrorCode.NOT_FOUND);
    expect(
      errorCode(await resolveFeatureId(db().pool, personalOnly, workTask.id.slice(0, 8)))
    ).toBe(ErrorCode.NOT_FOUND);
  }, 120_000);

  it('sets any stage by hand, backwards too, without touching status (C3)', async () => {
    const plain = await task('Plain task becomes a feature');

    const first = (
      await setFeatureStage(db().pool, auth(), { id: plain.id.slice(0, 8), stage: 'functional_test' })
    )._unsafeUnwrap();
    expect(first.previous_stage).toBeNull();
    expect(first.entity.metadata).toMatchObject({
      kind: 'feature',
      stage: 'functional_test',
      stage_source: 'manual',
      pull_requests: []
    });

    const back = (
      await setFeatureStage(db().pool, auth(), { id: plain.id, stage: 'building' })
    )._unsafeUnwrap();
    expect(back.previous_stage).toBe('functional_test');
    expect(back.entity.metadata.stage).toBe('building');

    const released = (
      await setFeatureStage(db().pool, auth(), { id: plain.id, stage: 'released' })
    )._unsafeUnwrap();
    expect(released.entity.status).toBe('inbox');

    expect(
      (await auditRows('feature_stage')).map((row) => [row.entity_id, row.details])
    ).toEqual([
      [plain.id, { from: null, to: 'functional_test', source: 'manual' }],
      [plain.id, { from: 'functional_test', to: 'building', source: 'manual' }],
      [plain.id, { from: 'building', to: 'released', source: 'manual' }]
    ]);

    const before = await entityRow(plain.id);
    expect(
      errorCode(await setFeatureStage(db().pool, auth(), { id: plain.id, stage: 'shipping' }))
    ).toBe(ErrorCode.VALIDATION);
    expect(
      errorCode(
        await setFeatureStage(db().pool, auth({ scopes: ['read'] }), { id: plain.id, stage: 'review' })
      )
    ).toBe(ErrorCode.FORBIDDEN);
    expect(await entityRow(plain.id)).toEqual(before);
  }, 120_000);

  it('derives stages from pull requests, forward only (C4, worked example)', async () => {
    const feature = (await createFeature(db().pool, auth(), { content: 'Feature A' }))._unsafeUnwrap();

    const opened = (
      await addFeaturePullRequest(db().pool, auth(), {
        id: feature.id,
        url: 'https://github.com/Ivo-Toby/Postgram/pull/12/files#diff'
      })
    )._unsafeUnwrap();
    expect(opened).toMatchObject({ stage_changed: true, from: 'building', to: 'review' });
    expect(opened.entity.metadata).toMatchObject({ stage: 'review', stage_source: 'derived' });
    expect(opened.entity.metadata.pull_requests).toEqual([
      { url: PR_URL, state: 'open', updated_at: expect.any(String) as string }
    ]);

    (await setFeatureStage(db().pool, auth(), { id: feature.id, stage: 'building' }))._unsafeUnwrap();

    const reReported = (
      await addFeaturePullRequest(db().pool, auth(), { id: feature.id, url: PR_URL, state: 'open' })
    )._unsafeUnwrap();
    expect(reReported).toMatchObject({ stage_changed: false, from: 'building', to: 'building' });
    expect(reReported.entity.metadata.pull_requests).toHaveLength(1);

    const merged = (
      await addFeaturePullRequest(db().pool, auth(), { id: feature.id, url: PR_URL, state: 'merged' })
    )._unsafeUnwrap();
    expect(merged).toMatchObject({ stage_changed: true, from: 'building', to: 'awaiting_release' });
    expect(merged.entity.metadata.pull_requests).toEqual([
      { url: PR_URL, state: 'merged', updated_at: expect.any(String) as string }
    ]);

    expect((await auditRows('feature_pr')).map((row) => row.details)).toEqual([
      { url: PR_URL, state: 'open' },
      { url: PR_URL, state: 'merged' }
    ]);
    expect(
      (await auditRows('feature_stage')).map((row) => row.details)
    ).toEqual([
      { from: 'building', to: 'review', source: 'derived' },
      { from: 'review', to: 'building', source: 'manual' },
      { from: 'building', to: 'awaiting_release', source: 'derived' }
    ]);
  }, 120_000);

  it('never derives backwards and ignores closed pull requests (C4)', async () => {
    const feature = (await createFeature(db().pool, auth(), { content: 'Feature B' }))._unsafeUnwrap();
    (await setFeatureStage(db().pool, auth(), { id: feature.id, stage: 'ready_to_merge' }))._unsafeUnwrap();

    const open = (
      await addFeaturePullRequest(db().pool, auth(), {
        id: feature.id,
        url: 'https://github.com/ivo-toby/postgram/pull/13'
      })
    )._unsafeUnwrap();
    expect(open).toMatchObject({ stage_changed: false, from: 'ready_to_merge', to: 'ready_to_merge' });

    const closed = (
      await addFeaturePullRequest(db().pool, auth(), {
        id: feature.id,
        url: 'https://github.com/ivo-toby/postgram/pull/14',
        state: 'closed'
      })
    )._unsafeUnwrap();
    expect(closed.stage_changed).toBe(false);
    expect(closed.entity.metadata.pull_requests).toHaveLength(2);

    const before = await entityRow(feature.id);
    const gitlab = await addFeaturePullRequest(db().pool, auth(), {
      id: feature.id,
      url: 'https://gitlab.com/ivo-toby/postgram/-/merge_requests/1'
    });
    expect(errorCode(gitlab)).toBe(ErrorCode.VALIDATION);
    expect(await entityRow(feature.id)).toEqual(before);
  }, 120_000);

  it('releases on merge when the repository says so, keeping the status (C5)', async () => {
    const setting = (
      await setRepositoryReleaseOnMerge(db().pool, auth(), {
        remote: 'git@github.com:Ivo-Toby/postgram.git',
        releaseOnMerge: true
      })
    )._unsafeUnwrap();
    expect(setting).toEqual({ remote: 'github.com/ivo-toby/postgram', release_on_merge: true });
    expect((await auditRows('repository_update')).map((row) => [row.entity_id, row.details])).toEqual([
      [null, { remote: 'github.com/ivo-toby/postgram', release_on_merge: true }]
    ]);

    const feature = (await createFeature(db().pool, auth(), { content: 'Feature C' }))._unsafeUnwrap();
    (await setFeatureStage(db().pool, auth(), { id: feature.id, stage: 'review' }))._unsafeUnwrap();

    const merged = (
      await addFeaturePullRequest(db().pool, auth(), { id: feature.id, url: PR_URL, state: 'merged' })
    )._unsafeUnwrap();
    expect(merged).toMatchObject({ stage_changed: true, from: 'review', to: 'released' });
    expect(merged.entity.status).toBe('inbox');

    const other = (await createFeature(db().pool, auth(), { content: 'Feature D' }))._unsafeUnwrap();
    const otherMerged = (
      await addFeaturePullRequest(db().pool, auth(), {
        id: other.id,
        url: 'https://github.com/ivo-toby/other-repo/pull/1',
        state: 'merged'
      })
    )._unsafeUnwrap();
    expect(otherMerged.to).toBe('awaiting_release');
  }, 120_000);
});

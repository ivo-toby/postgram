import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthContext } from '../../src/auth/types.js';
import { createTask, updateTask } from '../../src/services/task-service.js';
import { ErrorCode } from '../../src/util/errors.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

const KEY_ID = '00000000-0000-0000-0000-000000000502';
const PERSONAL_ONLY_KEY_ID = '00000000-0000-0000-0000-000000000503';
const DOC_ONLY_KEY_ID = '00000000-0000-0000-0000-000000000504';
const PR_URL = 'https://github.com/ivo-toby/postgram/pull/12';

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    apiKeyId: KEY_ID,
    keyName: 'task-feature-key',
    clientId: 'task-feature-key',
    scopes: ['read', 'write', 'delete'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared'],
    ...overrides
  };
}

function errorCode(result: {
  isErr(): boolean;
  _unsafeUnwrapErr(): unknown;
}): unknown {
  expect(result.isErr()).toBe(true);
  const error = result._unsafeUnwrapErr() as { code?: unknown };
  return error.code;
}

describe('task feature metadata normalization', () => {
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
      metadata: Record<string, unknown>;
    }>('SELECT version, metadata FROM entities WHERE id = $1', [id]);
    return result.rows[0];
  }

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    await resetTestDatabase(db().pool);
    await seedApiKey(db().pool, { id: KEY_ID, name: 'task-feature-key' });
    await seedApiKey(db().pool, {
      id: PERSONAL_ONLY_KEY_ID,
      name: 'personal-only-key',
      allowedVisibility: ['personal']
    });
    await seedApiKey(db().pool, {
      id: DOC_ONLY_KEY_ID,
      name: 'doc-only-key',
      allowedTypes: ['document']
    });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('fills feature defaults on createTask and leaves non-feature tasks alone', async () => {
    const plain = await task('Plain task');
    expect(plain.metadata).toEqual({});

    const otherKind = await task('Other kind', {
      kind: 'note',
      stage: 'shipping'
    });
    expect(otherKind.metadata).toEqual({ kind: 'note', stage: 'shipping' });

    const feature = await task('Feature A\nbody', { kind: 'feature' });
    expect(feature.metadata).toMatchObject({
      kind: 'feature',
      stage: 'building',
      stage_source: 'manual',
      pull_requests: []
    });
    const setAt = feature.metadata.stage_set_at;
    expect(
      typeof setAt === 'string' && !Number.isNaN(Date.parse(setAt))
    ).toBe(true);
  }, 120_000);

  it('stores non-feature metadata exactly as provided', async () => {
    const created = await task('Exact metadata', {
      context: 'work',
      due_date: '2026-01-15',
      custom: 42
    });
    expect(created.metadata).toEqual({
      context: 'work',
      due_date: '2026-01-15',
      custom: 42
    });

    const updated = (
      await updateTask(db().pool, auth(), {
        id: created.id,
        version: created.version,
        metadata: { extra: true }
      })
    )._unsafeUnwrap();
    expect(updated.metadata).toEqual({
      context: 'work',
      due_date: '2026-01-15',
      custom: 42,
      extra: true
    });
  }, 120_000);

  it('fills feature defaults when updateTask marks an existing task', async () => {
    const plain = await task('Plain task');
    const marked = (
      await updateTask(db().pool, auth(), {
        id: plain.id,
        version: plain.version,
        metadata: { kind: 'feature' }
      })
    )._unsafeUnwrap();
    expect(marked.metadata).toMatchObject({
      kind: 'feature',
      stage: 'building',
      stage_source: 'manual',
      pull_requests: []
    });
    const setAt = marked.metadata.stage_set_at;
    expect(
      typeof setAt === 'string' && !Number.isNaN(Date.parse(setAt))
    ).toBe(true);
  }, 120_000);

  it('rejects invalid feature metadata without writing', async () => {
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
          {
            url: 'https://github.com/Ivo-Toby/postgram/pull/12/files',
            state: 'open',
            updated_at: '2026-10-31T10:00:00.000Z'
          }
        ]
      }
    });
    expect(errorCode(nonCanonical)).toBe(ErrorCode.VALIDATION);

    const count = await db().pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM entities'
    );
    expect(count.rows[0]?.n).toBe('0');

    const feature = await task('Feature A', { kind: 'feature' });
    const rejected = await updateTask(db().pool, auth(), {
      id: feature.id,
      version: feature.version,
      metadata: { stage: 'shipping' }
    });
    expect(errorCode(rejected)).toBe(ErrorCode.VALIDATION);

    const row = await entityRow(feature.id);
    expect(row?.version).toBe(feature.version);
    expect(row?.metadata.stage).toBe('building');
  }, 120_000);

  it('marks a stage change through updateTask as manual and never derives', async () => {
    const feature = await task('Feature A', {
      kind: 'feature',
      stage: 'review',
      stage_source: 'derived',
      stage_set_at: '2026-01-01T00:00:00.000Z'
    });
    expect(feature.metadata).toMatchObject({
      stage: 'review',
      stage_source: 'derived'
    });

    const moved = (
      await updateTask(db().pool, auth(), {
        id: feature.id,
        version: feature.version,
        metadata: { stage: 'building' }
      })
    )._unsafeUnwrap();
    expect(moved.metadata).toMatchObject({
      stage: 'building',
      stage_source: 'manual'
    });
    expect(moved.metadata.stage_set_at).not.toBe('2026-01-01T00:00:00.000Z');
    const setAt = moved.metadata.stage_set_at;
    expect(
      typeof setAt === 'string' && !Number.isNaN(Date.parse(setAt))
    ).toBe(true);

    const withPr = (
      await updateTask(db().pool, auth(), {
        id: moved.id,
        version: moved.version,
        metadata: {
          pull_requests: [
            { url: PR_URL, state: 'merged', updated_at: '2026-10-31T10:00:00.000Z' }
          ]
        }
      })
    )._unsafeUnwrap();
    expect(withPr.metadata.stage).toBe('building');
    expect(withPr.metadata.pull_requests).toEqual([
      { url: PR_URL, state: 'merged', updated_at: '2026-10-31T10:00:00.000Z' }
    ]);
  }, 120_000);

  it('returns the updateEntity access error, not VALIDATION, for an invisible task', async () => {
    const feature = await task('Feature A', { kind: 'feature' });

    const personalOnlyAuth = auth({
      apiKeyId: PERSONAL_ONLY_KEY_ID,
      keyName: 'personal-only-key',
      clientId: 'personal-only-key',
      allowedVisibility: ['personal']
    });
    // The feature created above defaults to visibility 'work' semantics via
    // the shared pool; force it to 'work' so the personal-only key cannot see
    // it.
    await db().pool.query(`UPDATE entities SET visibility = 'work' WHERE id = $1`, [
      feature.id
    ]);
    const refreshed = await entityRow(feature.id);

    const rejected = await updateTask(db().pool, personalOnlyAuth, {
      id: feature.id,
      version: refreshed?.version ?? feature.version,
      metadata: { stage: 'shipping' }
    });
    expect(errorCode(rejected)).toBe(ErrorCode.FORBIDDEN);
    expect((await entityRow(feature.id))?.metadata.stage).toBe('building');

    const docOnlyAuth = auth({
      apiKeyId: DOC_ONLY_KEY_ID,
      keyName: 'doc-only-key',
      clientId: 'doc-only-key',
      allowedTypes: ['document']
    });
    const rejectedByType = await updateTask(db().pool, docOnlyAuth, {
      id: feature.id,
      version: (await entityRow(feature.id))?.version ?? feature.version,
      metadata: { stage: 'shipping' }
    });
    expect(errorCode(rejectedByType)).toBe(ErrorCode.FORBIDDEN);

    const finalRow = await entityRow(feature.id);
    expect(finalRow?.metadata.stage).toBe('building');
    expect(finalRow?.version).toBe(refreshed?.version);
  }, 120_000);
});

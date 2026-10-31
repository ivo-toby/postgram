import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthContext } from '../../src/auth/types.js';
import { storeEntity } from '../../src/services/entity-service.js';
import {
  createFeature,
  resolveFeatureId,
  setRepositoryReleaseOnMerge
} from '../../src/services/feature-service.js';
import { createTask } from '../../src/services/task-service.js';
import { ErrorCode } from '../../src/util/errors.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

const KEY_ID = '00000000-0000-0000-0000-000000000302';

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    apiKeyId: KEY_ID,
    keyName: 'feature-slice-key',
    clientId: 'feature-slice-key',
    scopes: ['read', 'write'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared'],
    ...overrides
  };
}

function errorCode(result: { isErr(): boolean; _unsafeUnwrapErr(): unknown }): unknown {
  expect(result.isErr()).toBe(true);
  const error = result._unsafeUnwrapErr() as { code?: unknown };
  return error.code;
}

describe('feature-service (slice f3)', () => {
  let database: TestDatabase | undefined;

  function db(): TestDatabase {
    if (!database) {
      throw new Error('test database not initialized');
    }
    return database;
  }

  async function insertTask(
    id: string,
    content: string,
    status = 'inbox',
    visibility = 'shared'
  ): Promise<void> {
    await db().pool.query(
      `INSERT INTO entities (id, type, content, visibility, status, metadata)
       VALUES ($1, 'task', $2, $3, $4, '{}')`,
      [id, content, visibility, status]
    );
  }

  async function auditRows(
    operation: string
  ): Promise<{ entity_id: string | null; details: Record<string, unknown> }[]> {
    const result = await db().pool.query<{
      entity_id: string | null;
      details: Record<string, unknown>;
    }>(
      `SELECT entity_id, details FROM audit_log
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
    await seedApiKey(db().pool, { id: KEY_ID, name: 'feature-slice-key' });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('creates an inbox task with feature defaults and the given tags (feature-create)', async () => {
    const created = (
      await createFeature(db().pool, auth(), {
        content: '  Keyword rank fusion\nbody',
        tags: ['search']
      })
    )._unsafeUnwrap();

    expect(created.type).toBe('task');
    expect(created.status).toBe('inbox');
    expect(created.tags).toEqual(['search']);
    expect(created.visibility).toBe('shared');
    expect(created.metadata).toMatchObject({
      kind: 'feature',
      stage: 'building',
      stage_source: 'manual',
      pull_requests: []
    });
    const stageSetAt = created.metadata['stage_set_at'];
    expect(
      typeof stageSetAt === 'string' && !Number.isNaN(Date.parse(stageSetAt))
    ).toBe(true);

    const work = (
      await createFeature(db().pool, auth(), {
        content: 'Work feature',
        visibility: 'work'
      })
    )._unsafeUnwrap();
    expect(work.visibility).toBe('work');

    const empty = await createFeature(db().pool, auth(), { content: '   ' });
    expect(errorCode(empty)).toBe(ErrorCode.VALIDATION);

    const readOnly = await createFeature(
      db().pool,
      auth({ scopes: ['read'] }),
      { content: 'Forbidden feature' }
    );
    expect(errorCode(readOnly)).toBe(ErrorCode.FORBIDDEN);
    // Two features were created earlier in this test; the rejected calls
    // above must have written nothing, so the count stays at 2.
    const count = await db().pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM entities'
    );
    expect(count.rows[0]?.n).toBe('2');
  }, 120_000);

  it('resolves a full UUID and its 8-hex prefix to the same task (feature-id-resolve)', async () => {
    const created = (
      await createFeature(db().pool, auth(), { content: 'Resolve me' })
    )._unsafeUnwrap();

    const byUuid = (
      await resolveFeatureId(db().pool, auth(), created.id)
    )._unsafeUnwrap();
    expect(byUuid.id).toBe(created.id);
    expect(byUuid.content).toBe('Resolve me');

    const byShort = (
      await resolveFeatureId(db().pool, auth(), created.id.slice(0, 8))
    )._unsafeUnwrap();
    expect(byShort.id).toBe(created.id);
  }, 120_000);

  it('reports CONFLICT with candidates ordered by id, then resolves after archiving (feature-id-resolve)', async () => {
    const longTitle = `${'x'.repeat(100)} tail`;
    await insertTask('abef1234-0000-4000-8000-000000000003', longTitle);
    await insertTask('abcd1234-0000-4000-8000-000000000001', 'First twin');
    await insertTask('abcd1234-0000-4000-8000-000000000002', 'Second twin\nbody');

    const ambiguous = await resolveFeatureId(db().pool, auth(), 'abcd1234');
    expect(errorCode(ambiguous)).toBe(ErrorCode.CONFLICT);
    expect(
      ambiguous._unsafeUnwrapErr().details['candidates']
    ).toEqual([
      { id: 'abcd1234-0000-4000-8000-000000000001', title: 'First twin' },
      { id: 'abcd1234-0000-4000-8000-000000000002', title: 'Second twin' }
    ]);

    const otherAmbiguous = (
      await resolveFeatureId(db().pool, auth(), 'abef1234')
    )._unsafeUnwrap();
    expect(otherAmbiguous.id).toBe(
      'abef1234-0000-4000-8000-000000000003'
    );

    await db().pool.query(
      "UPDATE entities SET status = 'archived' WHERE id = 'abcd1234-0000-4000-8000-000000000001'"
    );
    const afterArchive = (
      await resolveFeatureId(db().pool, auth(), 'abcd1234')
    )._unsafeUnwrap();
    expect(afterArchive.id).toBe('abcd1234-0000-4000-8000-000000000002');
  }, 120_000);

  it('truncates candidate titles to the trimmed first line, 80 chars (feature-id-resolve)', async () => {
    await insertTask('cafe1234-0000-4000-8000-000000000001', '   padded title line   \nbody');
    await insertTask(
      'cafe1234-0000-4000-8000-000000000002',
      `${'y'.repeat(100)} overflow`
    );

    const ambiguous = await resolveFeatureId(db().pool, auth(), 'cafe1234');
    expect(errorCode(ambiguous)).toBe(ErrorCode.CONFLICT);
    expect(
      ambiguous._unsafeUnwrapErr().details['candidates']
    ).toEqual([
      { id: 'cafe1234-0000-4000-8000-000000000001', title: 'padded title line' },
      { id: 'cafe1234-0000-4000-8000-000000000002', title: 'y'.repeat(80) }
    ]);
  }, 120_000);

  it('rejects bad ids with VALIDATION and unknown or invisible ids with NOT_FOUND (feature-id-resolve)', async () => {
    const memory = (
      await storeEntity(db().pool, auth(), { type: 'memory', content: 'note' })
    )._unsafeUnwrap();
    const workTask = (
      await createTask(db().pool, auth(), {
        content: 'Work only',
        visibility: 'work'
      })
    )._unsafeUnwrap();

    expect(
      errorCode(await resolveFeatureId(db().pool, auth(), 'not-an-id'))
    ).toBe(ErrorCode.VALIDATION);
    expect(
      errorCode(await resolveFeatureId(db().pool, auth(), 'ABCD1234'))
    ).toBe(ErrorCode.VALIDATION);
    expect(
      errorCode(
        await resolveFeatureId(db().pool, auth(), 'ABCD1234-0000-4000-8000-000000000000')
      )
    ).toBe(ErrorCode.VALIDATION);
    expect(
      errorCode(await resolveFeatureId(db().pool, auth(), memory.id))
    ).toBe(ErrorCode.VALIDATION);
    expect(
      errorCode(
        await resolveFeatureId(
          db().pool,
          auth(),
          '99999999-0000-4000-8000-000000000000'
        )
      )
    ).toBe(ErrorCode.NOT_FOUND);
    expect(
      errorCode(await resolveFeatureId(db().pool, auth(), 'ffffffff'))
    ).toBe(ErrorCode.NOT_FOUND);

    const personalOnly = auth({ allowedVisibility: ['personal', 'shared'] });
    expect(
      errorCode(await resolveFeatureId(db().pool, personalOnly, workTask.id))
    ).toBe(ErrorCode.NOT_FOUND);
    expect(
      errorCode(
        await resolveFeatureId(
          db().pool,
          personalOnly,
          workTask.id.slice(0, 8)
        )
      )
    ).toBe(ErrorCode.NOT_FOUND);

    const memoryOnly = auth({ allowedTypes: ['memory'] });
    expect(
      errorCode(await resolveFeatureId(db().pool, memoryOnly, workTask.id))
    ).toBe(ErrorCode.NOT_FOUND);
    expect(
      errorCode(
        await resolveFeatureId(
          db().pool,
          memoryOnly,
          workTask.id.slice(0, 8)
        )
      )
    ).toBe(ErrorCode.NOT_FOUND);
  }, 120_000);

  it('upserts release_on_merge and audits only creates and changes (repository-setting, feature-audit)', async () => {
    // A missing repository row means release_on_merge false.
    const missing = await db().pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM repositories'
    );
    expect(missing.rows[0]?.n).toBe('0');

    const created = (
      await setRepositoryReleaseOnMerge(db().pool, auth(), {
        remote: 'git@github.com:Ivo-Toby/postgram.git',
        releaseOnMerge: true
      })
    )._unsafeUnwrap();
    expect(created).toEqual({
      remote: 'github.com/ivo-toby/postgram',
      release_on_merge: true
    });

    // Same value again: no new audit row.
    const unchanged = (
      await setRepositoryReleaseOnMerge(db().pool, auth(), {
        remote: 'https://github.com/Ivo-Toby/postgram',
        releaseOnMerge: true
      })
    )._unsafeUnwrap();
    expect(unchanged).toEqual({
      remote: 'github.com/ivo-toby/postgram',
      release_on_merge: true
    });
    expect(await auditRows('repository_update')).toEqual([
      {
        entity_id: null,
        details: { remote: 'github.com/ivo-toby/postgram', release_on_merge: true }
      }
    ]);

    const changed = (
      await setRepositoryReleaseOnMerge(db().pool, auth(), {
        remote: 'github.com/Ivo-Toby/postgram.git',
        releaseOnMerge: false
      })
    )._unsafeUnwrap();
    expect(changed).toEqual({
      remote: 'github.com/ivo-toby/postgram',
      release_on_merge: false
    });
    expect(await auditRows('repository_update')).toEqual([
      {
        entity_id: null,
        details: { remote: 'github.com/ivo-toby/postgram', release_on_merge: true }
      },
      {
        entity_id: null,
        details: {
          remote: 'github.com/ivo-toby/postgram',
          release_on_merge: false
        }
      }
    ]);

    const rows = await db().pool.query<{
      remote: string;
      release_on_merge: boolean;
    }>('SELECT remote, release_on_merge FROM repositories ORDER BY remote');
    expect(rows.rows).toEqual([
      { remote: 'github.com/ivo-toby/postgram', release_on_merge: false }
    ]);
  }, 120_000);

  it('rejects an empty remote and a read-only key without writing (repository-setting)', async () => {
    const empty = await setRepositoryReleaseOnMerge(db().pool, auth(), {
      remote: '   ',
      releaseOnMerge: true
    });
    expect(errorCode(empty)).toBe(ErrorCode.VALIDATION);

    const readOnly = await setRepositoryReleaseOnMerge(
      db().pool,
      auth({ scopes: ['read'] }),
      { remote: 'git@github.com:Ivo-Toby/postgram.git', releaseOnMerge: true }
    );
    expect(errorCode(readOnly)).toBe(ErrorCode.FORBIDDEN);

    const repos = await db().pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM repositories'
    );
    expect(repos.rows[0]?.n).toBe('0');
    expect(await auditRows('repository_update')).toEqual([]);
  }, 120_000);
});

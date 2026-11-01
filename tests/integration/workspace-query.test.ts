import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthContext } from '../../src/auth/types.js';
import type { ServiceResult } from '../../src/types/common.js';
import { createFeature } from '../../src/services/feature-service.js';
import { listWorkspaces } from '../../src/services/workspace-query.js';
import { reportWorkspace } from '../../src/services/workspace-service.js';
import { ErrorCode } from '../../src/util/errors.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

const KEY_ID = '00000000-0000-0000-0000-000000000502';
const OPTIONS = { dormantAfterDays: 30 };

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    apiKeyId: KEY_ID,
    keyName: 'ws-query-key',
    clientId: 'ws-query-key',
    scopes: ['read', 'write'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared'],
    ...overrides
  };
}

function hookReport(input: {
  alias?: string;
  path: string;
  featureId?: string;
  repo?: string;
  sessionId?: string;
  event?: 'start' | 'activity' | 'stop' | 'end';
}): Record<string, unknown> {
  const alias = input.alias ?? 'strongbad';
  return {
    source: 'hook',
    machine: { alias, hostname: `${alias}-host`, boot_id: 'boot-a' },
    workspace: {
      path: input.path,
      repo_remote: input.repo ?? 'git@github.com:Ivo-Toby/postgram.git',
      repo_root: '/home/ivo/src/postgram',
      branch: 'feat/x',
      git: { dirty_count: 0, unpushed_count: 0, has_upstream: true }
    },
    ...(input.featureId !== undefined ? { feature_id: input.featureId } : {}),
    session: {
      agent_kind: 'claude-code',
      agent_session_id: input.sessionId ?? `s-${input.path}`,
      event: input.event ?? 'start',
      cwd: null,
      transcript_path: null
    }
  };
}

function errorCode<T>(result: Awaited<ServiceResult<T>>): ErrorCode | null {
  return result.isErr() ? result.error.code : null;
}

describe('workspace-query (slice q2)', () => {
  let database: TestDatabase | undefined;

  function db(): TestDatabase {
    if (!database) {
      throw new Error('test database not initialized');
    }
    return database;
  }

  async function report(input: Record<string, unknown>): Promise<string> {
    const result = await reportWorkspace(db().pool, auth(), input, OPTIONS);
    if (result.isErr()) {
      throw result.error;
    }
    const workspace = result.value.workspace;
    if (!workspace) {
      throw new Error('report returned no workspace');
    }
    return workspace.id;
  }

  async function setActivity(path: string, iso: string): Promise<void> {
    await db().pool.query(
      'UPDATE workspaces SET last_activity_at = $2 WHERE path = $1',
      [path, iso]
    );
  }

  async function feature(
    content: string,
    visibility: 'personal' | 'work' | 'shared' = 'shared'
  ): Promise<string> {
    return (
      await createFeature(db().pool, auth(), { content, visibility })
    )._unsafeUnwrap().id;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    await resetTestDatabase(db().pool);
    await db().pool.query(
      'TRUNCATE TABLE agent_sessions, workspaces, machines, repositories CASCADE'
    );
    await seedApiKey(db().pool, { id: KEY_ID, name: 'ws-query-key' });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('applies FR-040 visibility to linked and unlinked workspaces (C1)', async () => {
    const workFeature = await feature('Work feature', 'work');
    const personalFeature = await feature('Personal feature', 'personal');
    const linkedWork = await report(
      hookReport({ path: '/home/ivo/wt/a', featureId: workFeature })
    );
    const linkedPersonal = await report(
      hookReport({ path: '/home/ivo/wt/b', featureId: personalFeature })
    );
    const unlinked = await report(
      hookReport({ alias: 'codebox', path: '/home/ivo/wt/c' })
    );
    await setActivity('/home/ivo/wt/b', '2026-10-02T10:00:00.000Z');
    await setActivity('/home/ivo/wt/c', '2026-10-01T10:00:00.000Z');

    const all = (
      await listWorkspaces(db().pool, auth(), {}, OPTIONS)
    )._unsafeUnwrap();
    expect(all.map((w) => w.id).sort()).toEqual(
      [linkedWork, linkedPersonal, unlinked].sort()
    );

    const noPersonal = (
      await listWorkspaces(
        db().pool,
        auth({ allowedVisibility: ['work', 'shared'] }),
        {},
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(noPersonal.map((w) => w.id)).toEqual([linkedWork]);

    const noTasks = (
      await listWorkspaces(
        db().pool,
        auth({ allowedTypes: ['memory'] }),
        {},
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(noTasks.map((w) => w.id)).toEqual([unlinked]);

    const noWork = (
      await listWorkspaces(
        db().pool,
        auth({ allowedVisibility: ['personal', 'shared'] }),
        {},
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(noWork.map((w) => w.id)).toEqual([linkedPersonal, unlinked]);
  }, 120_000);

  it('filters by machine, normalized repo, short feature id and unassigned (C1)', async () => {
    const featureId = await feature('Filter feature');
    const linked = await report(
      hookReport({ path: '/home/ivo/wt/a', featureId })
    );
    const codebox = await report(
      hookReport({ alias: 'codebox', path: '/home/ivo/wt/b' })
    );
    const other = await report(
      hookReport({
        path: '/home/ivo/wt/c',
        repo: 'https://github.com/ivo-toby/other'
      })
    );
    await setActivity('/home/ivo/wt/a', '2026-10-01T10:00:00.000Z');
    await setActivity('/home/ivo/wt/b', '2026-10-03T10:00:00.000Z');
    await setActivity('/home/ivo/wt/c', '2026-10-02T10:00:00.000Z');

    const all = (
      await listWorkspaces(db().pool, auth(), {}, OPTIONS)
    )._unsafeUnwrap();
    expect(all.map((w) => w.id)).toEqual([codebox, other, linked]);

    const byMachine = (
      await listWorkspaces(db().pool, auth(), { machine: 'codebox' }, OPTIONS)
    )._unsafeUnwrap();
    expect(byMachine.map((w) => w.id)).toEqual([codebox]);

    const byRepo = (
      await listWorkspaces(
        db().pool,
        auth(),
        { repo: 'git@github.com:Ivo-Toby/other.git' },
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(byRepo.map((w) => w.id)).toEqual([other]);

    const byFeature = (
      await listWorkspaces(
        db().pool,
        auth(),
        { featureId: featureId.slice(0, 8) },
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(byFeature.map((w) => w.id)).toEqual([linked]);

    const unassigned = (
      await listWorkspaces(db().pool, auth(), { unassigned: true }, OPTIONS)
    )._unsafeUnwrap();
    expect(unassigned.map((w) => w.id)).toEqual([codebox, other]);
  }, 120_000);

  it('maps feature id, visibility and unassigned errors (C1)', async () => {
    await report(hookReport({ path: '/home/ivo/wt/a' }));

    const forbidden = await listWorkspaces(
      db().pool,
      auth({ scopes: ['write'] }),
      {},
      OPTIONS
    );
    expect(errorCode(forbidden)).toBe(ErrorCode.FORBIDDEN);

    const unknown = await listWorkspaces(
      db().pool,
      auth(),
      { featureId: '00000000-0000-4000-8000-000000000999' },
      OPTIONS
    );
    expect(errorCode(unknown)).toBe(ErrorCode.NOT_FOUND);

    for (const id of [
      'abcd1234-0000-4000-8000-000000000001',
      'abcd1234-0000-4000-8000-000000000002'
    ]) {
      await db().pool.query(
        `INSERT INTO entities (id, type, content, visibility, status, metadata)
         VALUES ($1, 'task', $2, 'shared', 'inbox', '{}'::jsonb)`,
        [id, `Task ${id.slice(-1)}`]
      );
    }
    const ambiguous = await listWorkspaces(
      db().pool,
      auth(),
      { featureId: 'abcd1234' },
      OPTIONS
    );
    expect(errorCode(ambiguous)).toBe(ErrorCode.CONFLICT);

    const conflicting = await listWorkspaces(
      db().pool,
      auth(),
      {
        featureId: '00000000-0000-4000-8000-000000000999',
        unassigned: true
      },
      OPTIONS
    );
    expect(errorCode(conflicting)).toBe(ErrorCode.VALIDATION);
  }, 120_000);

  it('holds the session window: non-ended plus newest ended by default (C1)', async () => {
    const path = '/home/ivo/wt/sessions';
    await report(hookReport({ path, sessionId: 'old' }));
    await report(hookReport({ path, sessionId: 'old', event: 'end' }));
    await report(hookReport({ path, sessionId: 'new' }));
    await report(hookReport({ path, sessionId: 'newest' }));
    await report(hookReport({ path, sessionId: 'newest', event: 'end' }));

    const [byDefault] = (
      await listWorkspaces(db().pool, auth(), {}, OPTIONS)
    )._unsafeUnwrap();
    expect(byDefault?.sessions.map((s) => s.agent_session_id)).toEqual([
      'newest',
      'new'
    ]);

    const [withEnded] = (
      await listWorkspaces(db().pool, auth(), { includeEnded: true }, OPTIONS)
    )._unsafeUnwrap();
    expect(withEnded?.sessions.map((s) => s.agent_session_id)).toEqual([
      'newest',
      'new',
      'old'
    ]);
  }, 120_000);

  it('falls back to the alias when connect_target is null (C1)', async () => {
    await report(hookReport({ alias: 'codebox', path: '/home/ivo/wt/a' }));

    const [workspace] = (
      await listWorkspaces(db().pool, auth(), { machine: 'codebox' }, OPTIONS)
    )._unsafeUnwrap();
    expect(workspace?.machine).toBe('codebox');
    expect(workspace?.connect_target).toBe('codebox');
  }, 120_000);
});

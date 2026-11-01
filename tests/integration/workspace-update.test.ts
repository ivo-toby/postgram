import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthContext } from '../../src/auth/types.js';
import type { ServiceResult } from '../../src/types/common.js';
import { storeEntity } from '../../src/services/entity-service.js';
import { createFeature } from '../../src/services/feature-service.js';
import { createTask } from '../../src/services/task-service.js';
import { reportWorkspace } from '../../src/services/workspace-service.js';
import { updateWorkspace } from '../../src/services/workspace-update.js';
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
    keyName: 'update-key',
    clientId: 'update-key',
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

describe('updateWorkspace (where-q4)', () => {
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

  async function feature(
    content: string,
    visibility: 'personal' | 'work' | 'shared' = 'shared'
  ): Promise<string> {
    return (
      await createFeature(db().pool, auth(), { content, visibility })
    )._unsafeUnwrap().id;
  }

  async function plainTask(content: string): Promise<string> {
    return (
      await createTask(db().pool, auth(), { content, visibility: 'shared' })
    )._unsafeUnwrap().id;
  }

  async function entityVersion(id: string): Promise<number> {
    const result = await db().pool.query<{ version: number }>(
      'SELECT version FROM entities WHERE id = $1',
      [id]
    );
    const version = result.rows[0]?.version;
    if (version === undefined) {
      throw new Error('entity not found');
    }
    return version;
  }

  async function linkAudits(): Promise<Record<string, unknown>[]> {
    const result = await db().pool.query<{ details: Record<string, unknown> }>(
      `SELECT details FROM audit_log WHERE operation = 'workspace_link'
       ORDER BY timestamp, id`
    );
    return result.rows.map((row) => row.details);
  }

  async function auditCount(): Promise<number> {
    const result = await db().pool.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM audit_log'
    );
    return result.rows[0]?.n ?? 0;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    await resetTestDatabase(db().pool);
    await db().pool.query(
      'TRUNCATE TABLE agent_sessions, workspaces, machines, repositories CASCADE'
    );
    await seedApiKey(db().pool, { id: KEY_ID, name: 'update-key' });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('links an unlinked workspace to a plain task by short id (C1)', async () => {
    const workspaceId = await report(hookReport({ path: '/home/ivo/wt/a' }));
    const taskId = await plainTask('Link me');
    const versionBefore = await entityVersion(taskId);
    const auditsBefore = await linkAudits();

    const linked = (
      await updateWorkspace(
        db().pool,
        auth(),
        { id: workspaceId, featureId: taskId.slice(0, 8) },
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(linked.feature_id).toBe(taskId);

    const task = await db().pool.query<{
      version: number;
      metadata: Record<string, unknown>;
    }>('SELECT version, metadata FROM entities WHERE id = $1', [taskId]);
    expect(task.rows[0]?.metadata).toMatchObject({
      kind: 'feature',
      stage: 'building',
      stage_source: 'manual',
      pull_requests: []
    });
    expect(typeof task.rows[0]?.metadata?.stage_set_at).toBe('string');
    expect(task.rows[0]?.version).toBe(versionBefore + 1);
    expect(auditsBefore).toEqual([]);
    expect(await linkAudits()).toEqual([{ from: null, to: taskId }]);
  }, 120_000);

  it('links by full UUID without writing an existing feature or duplicating the audit row (C1)', async () => {
    const workspaceId = await report(hookReport({ path: '/home/ivo/wt/b' }));
    const featureId = await feature('Existing feature');
    const versionBefore = await entityVersion(featureId);

    (
      await updateWorkspace(
        db().pool,
        auth(),
        { id: workspaceId, featureId },
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(await entityVersion(featureId)).toBe(versionBefore);
    expect(await linkAudits()).toEqual([{ from: null, to: featureId }]);

    (
      await updateWorkspace(
        db().pool,
        auth(),
        { id: workspaceId, featureId },
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(await entityVersion(featureId)).toBe(versionBefore);
    expect(await linkAudits()).toEqual([{ from: null, to: featureId }]);
  }, 120_000);

  it('unlinks with an audit row; a caller without personal is FORBIDDEN (C1, C4)', async () => {
    const workspaceId = await report(hookReport({ path: '/home/ivo/wt/c' }));
    const taskId = await plainTask('To unlink');
    (
      await updateWorkspace(
        db().pool,
        auth(),
        { id: workspaceId, featureId: taskId },
        OPTIONS
      )
    )._unsafeUnwrap();

    const forbidden = (
      await updateWorkspace(
        db().pool,
        auth({ allowedVisibility: ['work', 'shared'] }),
        { id: workspaceId, featureId: null },
        OPTIONS
      )
    )._unsafeUnwrapErr();
    expect(forbidden.code).toBe(ErrorCode.FORBIDDEN);
    const still = await db().pool.query<{ feature_id: string | null }>(
      'SELECT feature_id FROM workspaces WHERE id = $1',
      [workspaceId]
    );
    expect(still.rows[0]?.feature_id).toBe(taskId);

    const unlinked = (
      await updateWorkspace(
        db().pool,
        auth(),
        { id: workspaceId, featureId: null },
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(unlinked.feature_id).toBeNull();
    expect(await linkAudits()).toEqual([
      { from: null, to: taskId },
      { from: taskId, to: null }
    ]);
  }, 120_000);

  it('sets missing once, keeps it on repeat, clears it; no audit rows (C2, C3)', async () => {
    const workspaceId = await report(hookReport({ path: '/home/ivo/wt/d' }));
    const auditsBefore = await auditCount();

    const missing = (
      await updateWorkspace(
        db().pool,
        auth(),
        { id: workspaceId, missing: true },
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(missing.risks).toContain('missing');
    expect(missing.missing_since).not.toBeNull();

    const again = (
      await updateWorkspace(
        db().pool,
        auth(),
        { id: workspaceId, missing: true },
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(again.missing_since).toBe(missing.missing_since);

    const found = (
      await updateWorkspace(
        db().pool,
        auth(),
        { id: workspaceId, missing: false },
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(found.missing_since).toBeNull();
    expect(found.risks).not.toContain('missing');

    expect(await auditCount()).toBe(auditsBefore);
  }, 120_000);

  it('rejects invalid updates without writing (C1, C4)', async () => {
    const workspaceId = await report(hookReport({ path: '/home/ivo/wt/e' }));
    const personal = await feature('Personal feature', 'personal');
    const hidden = await report(
      hookReport({ path: '/home/ivo/wt/hidden', featureId: personal })
    );
    const memory = (
      await storeEntity(db().pool, auth(), {
        type: 'memory',
        content: 'not a task',
        visibility: 'shared'
      })
    )._unsafeUnwrap();
    const auditsBefore = await linkAudits();

    const cases: [Awaited<ServiceResult<unknown>>, ErrorCode][] = [
      [
        await updateWorkspace(db().pool, auth(), { id: workspaceId }, OPTIONS),
        ErrorCode.VALIDATION
      ],
      [
        await updateWorkspace(
          db().pool,
          auth(),
          { id: 'not-a-uuid', missing: true },
          OPTIONS
        ),
        ErrorCode.NOT_FOUND
      ],
      [
        await updateWorkspace(
          db().pool,
          auth(),
          { id: '00000000-0000-4000-8000-000000000999', missing: true },
          OPTIONS
        ),
        ErrorCode.NOT_FOUND
      ],
      [
        await updateWorkspace(
          db().pool,
          auth({ allowedVisibility: ['work', 'shared'] }),
          { id: hidden, missing: true },
          OPTIONS
        ),
        ErrorCode.NOT_FOUND
      ],
      [
        await updateWorkspace(
          db().pool,
          auth(),
          { id: workspaceId, featureId: '00000000-0000-4000-8000-000000000998' },
          OPTIONS
        ),
        ErrorCode.NOT_FOUND
      ],
      [
        await updateWorkspace(
          db().pool,
          auth(),
          { id: workspaceId, featureId: memory.id },
          OPTIONS
        ),
        ErrorCode.VALIDATION
      ],
      [
        await updateWorkspace(
          db().pool,
          auth({ scopes: ['read'] }),
          { id: workspaceId, missing: true },
          OPTIONS
        ),
        ErrorCode.FORBIDDEN
      ]
    ];
    for (const [result, code] of cases) {
      expect(errorCode(result)).toBe(code);
    }

    expect(await linkAudits()).toEqual(auditsBefore);
    const rows = await db().pool.query<{
      feature_id: string | null;
      missing_since: Date | null;
    }>('SELECT feature_id, missing_since FROM workspaces WHERE id = ANY($1)', [
      [workspaceId, hidden]
    ]);
    expect(rows.rows.every((row) => row.missing_since === null)).toBe(true);
    expect(rows.rows.map((row) => row.feature_id).sort()).toEqual(
      [null, personal].sort()
    );
  }, 120_000);
}, 120_000);

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthContext } from '../../src/auth/types.js';
import { storeEntity } from '../../src/services/entity-service.js';
import { createTask } from '../../src/services/task-service.js';
import { reportWorkspace } from '../../src/services/workspace-service.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

const KEY_ID = '00000000-0000-0000-0000-000000000401';
const OPTIONS = { dormantAfterDays: 30 };

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    apiKeyId: KEY_ID,
    keyName: 'workspace-key',
    clientId: 'workspace-key',
    scopes: ['read', 'write'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared'],
    ...overrides
  };
}

type HookReport = {
  alias?: string;
  bootId?: string | null;
  path?: string;
  sessionId?: string | null;
  event?: 'start' | 'activity' | 'stop' | 'end';
  extra?: Record<string, unknown>;
  workspace?: Record<string, unknown>;
};

function hookReport(input: HookReport = {}): Record<string, unknown> {
  return {
    source: 'hook',
    machine: {
      alias: input.alias ?? 'strongbad',
      hostname: `${input.alias ?? 'strongbad'}-host`,
      boot_id: input.bootId === undefined ? 'boot-a' : input.bootId
    },
    workspace: {
      path: input.path ?? '/home/ivo/wt/feature-a',
      repo_remote: 'git@github.com:Ivo-Toby/postgram.git',
      repo_root: '/home/ivo/src/postgram',
      branch: 'feat/feature-a',
      git: { dirty_count: 0, unpushed_count: 0, has_upstream: true },
      ...(input.workspace ?? {})
    },
    session: {
      agent_kind: 'claude-code',
      agent_session_id:
        input.sessionId === undefined ? 'session-1' : input.sessionId,
      event: input.event ?? 'start',
      cwd: null,
      transcript_path: null
    },
    ...(input.extra ?? {})
  };
}

describe('workspace report (feature)', () => {
  let database: TestDatabase | undefined;

  function db(): TestDatabase {
    if (!database) {
      throw new Error('test database not initialized');
    }
    return database;
  }

  async function report(
    input: Record<string, unknown>,
    context: AuthContext = auth()
  ) {
    const result = await reportWorkspace(db().pool, context, input, OPTIONS);
    if (result.isErr()) {
      throw result.error;
    }
    return result.value;
  }

  async function count(table: string): Promise<number> {
    const result = await db().pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${table}`
    );
    return Number(result.rows[0]?.n ?? '0');
  }

  async function sessionStatus(agentSessionId: string) {
    const result = await db().pool.query<{
      status: string;
      boot_id: string | null;
      end_reason: string | null;
      ended_at: Date | null;
    }>(
      `SELECT status, boot_id, end_reason, ended_at
       FROM agent_sessions WHERE agent_session_id = $1`,
      [agentSessionId]
    );
    return result.rows[0];
  }

  async function auditOperations(): Promise<string[]> {
    const result = await db().pool.query<{ operation: string }>(
      `SELECT operation FROM audit_log ORDER BY timestamp, operation`
    );
    return result.rows.map((row) => row.operation);
  }

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    await resetTestDatabase(db().pool);
    await db().pool.query(
      'TRUNCATE TABLE agent_sessions, workspaces, machines, repositories CASCADE'
    );
    await seedApiKey(db().pool, { id: KEY_ID, name: 'workspace-key' });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('records machine, workspace and session and returns the workspace object', async () => {
    const result = await report(
      hookReport({
        workspace: {
          git: { dirty_count: 2, unpushed_count: 3, has_upstream: true }
        }
      })
    );

    expect(result.interrupted_sessions).toBe(0);
    expect(result.warnings).toEqual([]);
    expect(result.feature).toBeNull();
    expect(result.session).toMatchObject({ status: 'running' });
    expect(result.workspace).toMatchObject({
      machine: 'strongbad',
      connect_target: 'strongbad',
      path: '/home/ivo/wt/feature-a',
      repo_remote: 'github.com/ivo-toby/postgram',
      branch: 'feat/feature-a',
      feature_id: null,
      git: { dirty_count: 2, unpushed_count: 3, has_upstream: true },
      missing_since: null,
      risks: ['dirty', 'unpushed'],
      resume_session: {
        agent_kind: 'claude-code',
        agent_session_id: 'session-1',
        status: 'running'
      }
    });
    expect(result.workspace?.sessions).toHaveLength(1);
    expect(result.workspace?.sessions[0]).toMatchObject({
      agent_session_id: 'session-1',
      status: 'running',
      dormant: false
    });
    expect(await count('machines')).toBe(1);
    expect(await count('workspaces')).toBe(1);
    expect(await count('agent_sessions')).toBe(1);
  }, 120_000);

  it('strips a trailing slash so both forms are one workspace', async () => {
    await report(hookReport({ path: '/home/ivo/wt/feature-a/' }));
    const second = await report(
      hookReport({ path: '/home/ivo/wt/feature-a', event: 'activity' })
    );

    expect(second.workspace?.path).toBe('/home/ivo/wt/feature-a');
    expect(await count('workspaces')).toBe(1);
    expect(await count('agent_sessions')).toBe(1);
  }, 120_000);

  it('interrupts other sessions after a reboot but resumes the reported one (C1)', async () => {
    await report(hookReport({ sessionId: 's1', bootId: 'A' }));
    await report(
      hookReport({ sessionId: 's2', bootId: 'A', path: '/home/ivo/wt/feature-b' })
    );

    const result = await report(
      hookReport({ sessionId: 's1', bootId: 'B', event: 'start' })
    );

    expect(result.interrupted_sessions).toBe(1);
    expect(await sessionStatus('s1')).toMatchObject({
      status: 'running',
      boot_id: 'B',
      end_reason: null,
      ended_at: null
    });
    const s2 = await sessionStatus('s2');
    expect(s2).toMatchObject({ status: 'interrupted', end_reason: 'reboot' });
    expect(s2?.ended_at).not.toBeNull();

    const machine = await db().pool.query<{ boot_id: string }>(
      `SELECT boot_id FROM machines WHERE alias = 'strongbad'`
    );
    expect(machine.rows[0]?.boot_id).toBe('B');
    expect(await auditOperations()).toContain('session_interrupt');
  }, 120_000);

  it('never interrupts on a null boot id or on another machine', async () => {
    await report(hookReport({ sessionId: 's1', bootId: 'A' }));
    await report(hookReport({ sessionId: 's2', bootId: null, alias: 'codebox' }));
    const otherMachine = await report(
      hookReport({ sessionId: 's3', bootId: 'B', alias: 'codebox' })
    );

    expect(otherMachine.interrupted_sessions).toBe(0);
    expect(await sessionStatus('s1')).toMatchObject({ status: 'running' });
  }, 120_000);

  it('applies the event status table regardless of the previous status', async () => {
    await report(hookReport({ event: 'start' }));
    expect(await sessionStatus('session-1')).toMatchObject({ status: 'running' });

    await report(hookReport({ event: 'stop' }));
    expect(await sessionStatus('session-1')).toMatchObject({ status: 'idle' });

    await report(hookReport({ event: 'end', extra: {} }));
    const ended = await sessionStatus('session-1');
    expect(ended).toMatchObject({ status: 'ended' });
    expect(ended?.ended_at).not.toBeNull();

    await report(hookReport({ event: 'activity' }));
    expect(await sessionStatus('session-1')).toMatchObject({
      status: 'running',
      ended_at: null,
      end_reason: null
    });
    expect(await count('agent_sessions')).toBe(1);
  }, 120_000);

  it('keeps, clears or replaces the git snapshot (C2)', async () => {
    await report(
      hookReport({
        workspace: {
          git: { dirty_count: 4, unpushed_count: 1, has_upstream: true }
        }
      })
    );
    const before = await db().pool.query<{ git_state_at: Date }>(
      'SELECT git_state_at FROM workspaces'
    );

    const omitted = hookReport({ event: 'activity' });
    delete (omitted.workspace as Record<string, unknown>).git;
    const kept = await report(omitted);
    expect(kept.workspace?.git).toEqual({
      dirty_count: 4,
      unpushed_count: 1,
      has_upstream: true
    });
    const after = await db().pool.query<{ git_state_at: Date }>(
      'SELECT git_state_at FROM workspaces'
    );
    expect(after.rows[0]?.git_state_at.toISOString()).toBe(
      before.rows[0]?.git_state_at.toISOString()
    );

    const cleared = await report(
      hookReport({ event: 'activity', workspace: { git: null, branch: null } })
    );
    expect(cleared.workspace?.git).toBeNull();
    expect(cleared.workspace?.branch).toBeNull();
    expect(cleared.workspace?.risks).toEqual([]);
  }, 120_000);

  it('writes no entity and audits only structural changes (C3)', async () => {
    const task = (
      await createTask(db().pool, auth(), { content: 'Feature A\nbody' })
    )._unsafeUnwrap();
    await report(hookReport({ extra: { feature_id: task.id } }));
    const auditAfterFirst = await auditOperations();
    const entityBefore = await db().pool.query<{
      version: number;
      updated_at: Date;
      enrichment_status: string | null;
    }>('SELECT version, updated_at, enrichment_status FROM entities WHERE id = $1', [
      task.id
    ]);

    for (let index = 0; index < 50; index += 1) {
      await report(
        hookReport({
          event: index % 2 === 0 ? 'activity' : 'stop',
          extra: { feature_id: task.id }
        })
      );
    }

    const entityAfter = await db().pool.query<{
      version: number;
      updated_at: Date;
      enrichment_status: string | null;
    }>('SELECT version, updated_at, enrichment_status FROM entities WHERE id = $1', [
      task.id
    ]);
    expect(entityAfter.rows[0]).toEqual(entityBefore.rows[0]);
    expect(await count('entities')).toBe(1);
    expect(await auditOperations()).toEqual(auditAfterFirst);
    expect(auditAfterFirst).toEqual(
      expect.arrayContaining([
        'machine_create',
        'workspace_create',
        'workspace_link',
        'session_create'
      ])
    );
  }, 120_000);

  it('links visible tasks and warns without changing the link otherwise', async () => {
    const task = (
      await createTask(db().pool, auth(), {
        content: '  Keyword rank fusion\nbody',
        visibility: 'work'
      })
    )._unsafeUnwrap();
    const memory = (
      await storeEntity(db().pool, auth(), { type: 'memory', content: 'note' })
    )._unsafeUnwrap();

    const linked = await report(hookReport({ extra: { feature_id: task.id } }));
    expect(linked.workspace?.feature_id).toBe(task.id);
    expect(linked.feature).toEqual({
      id: task.id,
      title: 'Keyword rank fusion',
      stage: null
    });

    const notTask = await report(
      hookReport({ event: 'activity', extra: { feature_id: memory.id } })
    );
    expect(notTask.warnings).toEqual(['feature_not_task']);
    expect(notTask.workspace?.feature_id).toBe(task.id);

    const unknown = await report(
      hookReport({
        event: 'activity',
        extra: { feature_id: '00000000-0000-0000-0000-00000000dead' }
      })
    );
    expect(unknown.warnings).toEqual(['feature_not_found']);
    expect(unknown.workspace?.feature_id).toBe(task.id);

    const invisible = await report(
      hookReport({ event: 'activity', extra: { feature_id: task.id } }),
      auth({ allowedVisibility: ['personal'] })
    );
    expect(invisible.warnings).toEqual(['feature_not_found']);

    const absent = await report(hookReport({ event: 'activity' }));
    expect(absent.workspace?.feature_id).toBe(task.id);
    expect(absent.warnings).toEqual([]);
  }, 120_000);

  it('rejects invalid reports and read-only keys without writing (C4)', async () => {
    const invalid = [
      hookReport({ alias: 'Not Valid!' }),
      hookReport({ path: 'relative/path' }),
      hookReport({ extra: { feature_id: 'abc12345' } }),
      { ...hookReport(), sessions: [] },
      { source: 'hook', machine: { alias: 'x', hostname: 'x', boot_id: null }, session: {} }
    ];

    for (const input of invalid) {
      const result = await reportWorkspace(db().pool, auth(), input, OPTIONS);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('VALIDATION');
    }

    const forbidden = await reportWorkspace(
      db().pool,
      auth({ scopes: ['read'] }),
      hookReport(),
      OPTIONS
    );
    expect(forbidden._unsafeUnwrapErr().code).toBe('FORBIDDEN');

    expect(await count('machines')).toBe(0);
    expect(await count('workspaces')).toBe(0);
    expect(await count('agent_sessions')).toBe(0);
    expect(await count('audit_log')).toBe(0);
  }, 120_000);

  it('runs only the machine steps when the workspace is omitted', async () => {
    const result = await report({
      source: 'hook',
      machine: { alias: 'codebox', hostname: 'codebox-vm', boot_id: 'A' }
    });

    expect(result.workspace).toBeNull();
    expect(result.feature).toBeNull();
    expect(await count('machines')).toBe(1);
    expect(await count('workspaces')).toBe(0);
  }, 120_000);

  it('records scan sessions as idle without a boot id (C5)', async () => {
    const result = await report({
      source: 'scan',
      machine: { alias: 'strongbad', hostname: 'strongbad-host', boot_id: 'A' },
      workspace: { path: '/home/ivo/wt/feature-a', branch: 'feat/feature-a' },
      sessions: [
        {
          agent_kind: 'claude-code',
          agent_session_id: 'old-1',
          observed_at: '2026-10-01T10:00:00.000Z',
          cwd: '/home/ivo/wt/feature-a',
          transcript_path: null
        }
      ]
    });

    expect(result.sessions).toEqual([
      { id: expect.any(String) as string, status: 'idle' }
    ]);
    const scanned = await db().pool.query<{
      status: string;
      boot_id: string | null;
      last_activity_at: Date;
    }>(
      `SELECT status, boot_id, last_activity_at FROM agent_sessions
       WHERE agent_session_id = 'old-1'`
    );
    expect(scanned.rows[0]).toMatchObject({ status: 'idle', boot_id: null });
    expect(scanned.rows[0]?.last_activity_at.toISOString()).toBe(
      '2026-10-01T10:00:00.000Z'
    );

    const machine = await db().pool.query<{ boot_id: string | null }>(
      `SELECT boot_id FROM machines WHERE alias = 'strongbad'`
    );
    expect(machine.rows[0]?.boot_id).toBeNull();

    const reboot = await report(hookReport({ sessionId: 'new-1', bootId: 'B' }));
    expect(reboot.interrupted_sessions).toBe(0);
    expect(await sessionStatus('old-1')).toMatchObject({ status: 'idle' });
  }, 120_000);
});

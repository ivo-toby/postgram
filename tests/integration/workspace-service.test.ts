import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthContext } from '../../src/auth/types.js';
import { createTask } from '../../src/services/task-service.js';
import { reportWorkspace } from '../../src/services/workspace-service.js';
import type { ReportResult } from '../../src/types/workspaces.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

const KEY_ID = '00000000-0000-0000-0000-000000000501';
const OPTIONS = { dormantAfterDays: 30 };

const BOOM_FUNCTION = 'test_report_boom_fn';
const BOOM_TRIGGER = 'test_report_boom';
const BOOM_SESSION_ID = 'boom-1';

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    apiKeyId: KEY_ID,
    keyName: 'workspace-service-key',
    clientId: 'workspace-service-key',
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

function scanReport(
  sessions: Record<string, unknown>[],
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    source: 'scan',
    machine: {
      alias: 'strongbad',
      hostname: 'strongbad-host',
      boot_id: 'boot-scan'
    },
    workspace: { path: '/home/ivo/wt/feature-a', branch: 'feat/feature-a' },
    sessions,
    ...extra
  };
}

type AuditRow = {
  operation: string;
  entity_id: string | null;
  details: Record<string, unknown>;
};

type SessionRow = {
  id: string;
  status: string;
  boot_id: string | null;
  ended_at: Date | null;
  end_reason: string | null;
  last_activity_at: Date;
};

type EntitySnapshot = {
  version: number;
  enrichment_status: string | null;
  updated_at: Date;
};

describe('workspace-service.reportWorkspace', () => {
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
  ): Promise<ReportResult> {
    const result = await reportWorkspace(db().pool, context, input, OPTIONS);

    if (result.isErr()) {
      throw result.error;
    }

    return result.value;
  }

  async function count(table: string): Promise<number> {
    const result = await db().pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${table}`
    );

    return Number(result.rows[0]?.count ?? '0');
  }

  async function auditRows(): Promise<AuditRow[]> {
    const result = await db().pool.query<AuditRow>(
      `
        SELECT operation, entity_id, details
          FROM audit_log
         WHERE operation IN (
           'machine_create', 'workspace_create', 'workspace_link',
           'session_create', 'session_end', 'session_interrupt'
         )
         ORDER BY operation, entity_id
      `
    );

    return result.rows;
  }

  async function auditOperations(): Promise<string[]> {
    return (await auditRows()).map((row) => row.operation);
  }

  function auditFor(rows: AuditRow[], operation: string): AuditRow[] {
    return rows.filter((row) => row.operation === operation);
  }

  async function sessionByAgentId(agentSessionId: string): Promise<SessionRow | undefined> {
    const result = await db().pool.query<SessionRow>(
      `
        SELECT id, status, boot_id, ended_at, end_reason, last_activity_at
          FROM agent_sessions
         WHERE agent_session_id = $1
      `,
      [agentSessionId]
    );

    return result.rows[0];
  }

  async function machineBootId(alias: string): Promise<string | null | undefined> {
    const result = await db().pool.query<{ boot_id: string | null }>(
      'SELECT boot_id FROM machines WHERE alias = $1',
      [alias]
    );

    return result.rows[0]?.boot_id;
  }

  async function workspaceLastActivity(path: string): Promise<Date | undefined> {
    const result = await db().pool.query<{ last_activity_at: Date }>(
      'SELECT last_activity_at FROM workspaces WHERE path = $1',
      [path]
    );

    return result.rows[0]?.last_activity_at;
  }

  async function entitySnapshot(id: string): Promise<EntitySnapshot | undefined> {
    const result = await db().pool.query<EntitySnapshot>(
      `
        SELECT version, enrichment_status, updated_at
          FROM entities
         WHERE id = $1
      `,
      [id]
    );

    return result.rows[0];
  }

  async function installSessionInsertFailure(): Promise<void> {
    await db().pool.query(`
      CREATE OR REPLACE FUNCTION ${BOOM_FUNCTION}() RETURNS trigger
      LANGUAGE plpgsql AS $fn$
        BEGIN
          RAISE EXCEPTION 'injected report failure';
        END;
      $fn$;
    `);
    await db().pool.query(`
      CREATE TRIGGER ${BOOM_TRIGGER}
        BEFORE INSERT ON agent_sessions
        FOR EACH ROW
        WHEN (NEW.agent_session_id = '${BOOM_SESSION_ID}')
        EXECUTE FUNCTION ${BOOM_FUNCTION}();
    `);
  }

  async function removeSessionInsertFailure(): Promise<void> {
    await db().pool.query(
      `DROP TRIGGER IF EXISTS ${BOOM_TRIGGER} ON agent_sessions`
    );
    await db().pool.query(`DROP FUNCTION IF EXISTS ${BOOM_FUNCTION}()`);
  }

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    await resetTestDatabase(db().pool);
    await seedApiKey(db().pool, { id: KEY_ID, name: 'workspace-service-key' });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('records a hook report, answers the contract shape and audits only the structural changes', async () => {
    const task = (
      await createTask(db().pool, auth(), {
        content: 'Keyword rank fusion\nbody',
        visibility: 'work'
      })
    )._unsafeUnwrap();

    const result = await report(
      hookReport({
        workspace: { git: { dirty_count: 2, unpushed_count: 3, has_upstream: true } },
        extra: { feature_id: task.id }
      })
    );

    // Response keys: `sessions` is scan-only, so it is absent here.
    expect(Object.keys(result).sort()).toEqual([
      'feature',
      'interrupted_sessions',
      'session',
      'warnings',
      'workspace'
    ]);
    expect(result.interrupted_sessions).toBe(0);
    expect(result.warnings).toEqual([]);
    expect(result.session).toEqual({
      id: expect.any(String) as string,
      status: 'running'
    });
    expect(result.feature).toEqual({
      id: task.id,
      title: 'Keyword rank fusion',
      stage: null
    });
    expect(result.workspace).toMatchObject({
      machine: 'strongbad',
      connect_target: 'strongbad',
      path: '/home/ivo/wt/feature-a',
      repo_remote: 'github.com/ivo-toby/postgram',
      branch: 'feat/feature-a',
      feature_id: task.id,
      git: { dirty_count: 2, unpushed_count: 3, has_upstream: true },
      risks: ['dirty', 'unpushed'],
      resume_session: { agent_session_id: 'session-1', status: 'running' }
    });

    const rows = await auditRows();
    expect(rows.map((row) => row.operation)).toEqual([
      'machine_create',
      'session_create',
      'workspace_create',
      'workspace_link'
    ]);

    const workspaceId = result.workspace?.id;
    const sessionId = result.session?.id;
    expect(auditFor(rows, 'machine_create')).toEqual([
      { operation: 'machine_create', entity_id: null, details: { alias: 'strongbad' } }
    ]);
    expect(auditFor(rows, 'workspace_create')).toEqual([
      { operation: 'workspace_create', entity_id: workspaceId, details: {} }
    ]);
    expect(auditFor(rows, 'workspace_link')).toEqual([
      { operation: 'workspace_link', entity_id: workspaceId, details: { feature_id: task.id } }
    ]);
    expect(auditFor(rows, 'session_create')).toEqual([
      { operation: 'session_create', entity_id: workspaceId, details: { session_id: sessionId } }
    ]);

    // A report never writes entities (FR-016).
    expect(await count('entities')).toBe(1);
    expect(await count('chunks')).toBe(0);
  }, 120_000);

  it('answers a machine-only report with null workspace and writes only the machine step', async () => {
    const result = await report({
      source: 'hook',
      machine: { alias: 'codebox', hostname: 'codebox-vm', boot_id: 'boot-a' }
    });

    expect(Object.keys(result).sort()).toEqual([
      'feature',
      'interrupted_sessions',
      'warnings',
      'workspace'
    ]);
    expect(result.workspace).toBeNull();
    expect(result.feature).toBeNull();
    expect(result.interrupted_sessions).toBe(0);
    expect(result.warnings).toEqual([]);

    expect(await count('machines')).toBe(1);
    expect(await count('workspaces')).toBe(0);
    expect(await count('agent_sessions')).toBe(0);
    expect(await auditOperations()).toEqual(['machine_create']);
  }, 120_000);

  it('answers a scan report with session refs, keeps boot ids out of the reboot rule', async () => {
    // A live hook session on the same machine with an older boot id.
    await report(hookReport({ sessionId: 'live-1', bootId: 'boot-a' }));
    const auditBeforeRebootScan = await auditOperations();

    const result = await report(
      scanReport([
        {
          agent_kind: 'claude-code',
          agent_session_id: 'scanned-1',
          observed_at: '2026-10-01T10:00:00.000Z',
          cwd: '/home/ivo/wt/feature-a',
          transcript_path: null
        }
      ])
    );

    // Response keys: `session` is hook-only.
    expect(Object.keys(result).sort()).toEqual([
      'feature',
      'interrupted_sessions',
      'sessions',
      'warnings',
      'workspace'
    ]);
    expect(result.sessions).toEqual([
      { id: expect.any(String) as string, status: 'idle' }
    ]);
    expect(result.interrupted_sessions).toBe(0);
    expect(result.warnings).toEqual([]);
    expect(result.workspace?.sessions.map((session) => session.agent_session_id)).toEqual(
      ['live-1', 'scanned-1']
    );

    const scanned = await sessionByAgentId('scanned-1');
    expect(scanned).toMatchObject({ status: 'idle', boot_id: null, end_reason: null });
    expect(await sessionByAgentId('live-1')).toMatchObject({
      status: 'running',
      boot_id: 'boot-a'
    });

    // A scan report never sets machines.boot_id and never runs the reboot rule.
    expect(await machineBootId('strongbad')).toBe('boot-a');
    expect(await workspaceLastActivity('/home/ivo/wt/feature-a')).toBeInstanceOf(Date);

    const rows = await auditRows();
    const scanCreates = auditFor(rows, 'session_create').filter(
      (row) => row.details.session_id === scanned?.id
    );
    expect(scanCreates).toHaveLength(1);
    expect(scanCreates[0]?.entity_id).toBe(result.workspace?.id);
    expect(auditFor(rows, 'session_interrupt')).toEqual([]);
    expect((await auditOperations()).filter((op) => op === 'session_interrupt')).toHaveLength(0);
    expect(await auditOperations()).toEqual(
      [...auditBeforeRebootScan, 'session_create'].sort()
    );
  }, 120_000);

  it('identifies the reported session before the reboot rule interrupts the others', async () => {
    await report(hookReport({ sessionId: 's1', bootId: 'boot-a' }));
    await report(
      hookReport({ sessionId: 's2', bootId: 'boot-a', path: '/home/ivo/wt/feature-b' })
    );

    const result = await report(
      hookReport({ sessionId: 's1', bootId: 'boot-b', event: 'start' })
    );

    expect(result.interrupted_sessions).toBe(1);
    expect(result.session?.status).toBe('running');
    expect(await sessionByAgentId('s1')).toMatchObject({
      status: 'running',
      boot_id: 'boot-b',
      ended_at: null,
      end_reason: null
    });
    const interrupted = await sessionByAgentId('s2');
    expect(interrupted).toMatchObject({
      status: 'interrupted',
      end_reason: 'reboot'
    });
    expect(interrupted?.ended_at).not.toBeNull();
    expect(await machineBootId('strongbad')).toBe('boot-b');

    const rows = await auditRows();
    expect(auditFor(rows, 'session_interrupt')).toEqual([
      {
        operation: 'session_interrupt',
        entity_id: null,
        details: { session_id: interrupted?.id, reason: 'reboot' }
      }
    ]);
  }, 120_000);

  it('audits session_end once, on the transition into ended only', async () => {
    await report(hookReport({ event: 'start' }));
    expect(await auditOperations()).toEqual([
      'machine_create',
      'session_create',
      'workspace_create'
    ]);

    await report(hookReport({ event: 'stop' }));
    expect(await auditOperations()).toEqual([
      'machine_create',
      'session_create',
      'workspace_create'
    ]);

    await report(hookReport({ event: 'end' }));
    const endRows = auditFor(await auditRows(), 'session_end');
    expect(endRows).toHaveLength(1);
    expect(await sessionByAgentId('session-1')).toMatchObject({
      status: 'ended',
      end_reason: null
    });

    // A repeated `end` changes no status, so it writes no audit row.
    await report(hookReport({ event: 'end' }));
    expect(auditFor(await auditRows(), 'session_end')).toEqual(endRows);
    expect(await count('agent_sessions')).toBe(1);
  }, 120_000);

  it('writes no audit row and no entity change for repeated activity reports', async () => {
    const task = (
      await createTask(db().pool, auth(), { content: 'Feature A\nbody' })
    )._unsafeUnwrap();

    await report(hookReport({ extra: { feature_id: task.id } }));

    const auditBefore = await auditOperations();
    const entityBefore = await entitySnapshot(task.id);
    expect(entityBefore?.enrichment_status).toBeDefined();

    for (let index = 0; index < 50; index += 1) {
      await report(
        hookReport({
          event: index % 2 === 0 ? 'activity' : 'stop',
          extra: { feature_id: task.id }
        })
      );
    }

    expect(await auditOperations()).toEqual(auditBefore);
    expect(await entitySnapshot(task.id)).toEqual(entityBefore);
    expect(await count('entities')).toBe(1);
    expect(await count('machines')).toBe(1);
    expect(await count('workspaces')).toBe(1);
    expect(await count('agent_sessions')).toBe(1);
  }, 120_000);

  it('rejects invalid reports with VALIDATION and writes nothing', async () => {
    const invalid: Record<string, unknown>[] = [
      hookReport({ alias: 'Not Valid!' }),
      hookReport({ alias: 'x'.repeat(65) }),
      hookReport({ path: 'relative/path' }),
      { ...hookReport(), feature_id: 'abc12345' },
      { ...hookReport(), sessions: [] },
      { ...scanReport([]), session: { agent_kind: 'pi', agent_session_id: null, cwd: null, transcript_path: null } },
      scanReport([{ agent_kind: 'pi', agent_session_id: null, cwd: null, transcript_path: null }]),
      {
        source: 'hook',
        machine: { alias: 'codebox', hostname: 'codebox', boot_id: null },
        session: {}
      },
      { source: 'hook', machine: { alias: 'codebox' } },
      { ...hookReport(), unknown_key: true }
    ];

    for (const input of invalid) {
      const result = await reportWorkspace(db().pool, auth(), input, OPTIONS);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('VALIDATION');
    }

    expect(await count('machines')).toBe(0);
    expect(await count('workspaces')).toBe(0);
    expect(await count('agent_sessions')).toBe(0);
    expect(await count('audit_log')).toBe(0);
  }, 120_000);

  it('rejects a key without write scope with FORBIDDEN and writes nothing', async () => {
    const result = await reportWorkspace(
      db().pool,
      auth({ scopes: ['read'] }),
      hookReport(),
      OPTIONS
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('FORBIDDEN');

    expect(await count('machines')).toBe(0);
    expect(await count('workspaces')).toBe(0);
    expect(await count('agent_sessions')).toBe(0);
    expect(await count('audit_log')).toBe(0);
  }, 120_000);

  it('rolls the whole transaction back when a store step throws', async () => {
    const task = (
      await createTask(db().pool, auth(), { content: 'Feature R\nbody' })
    )._unsafeUnwrap();

    // Committed baseline: machine boot-a and one running session s1.
    await report(hookReport({ sessionId: 's1', bootId: 'boot-a' }));
    const baselineSession = await sessionByAgentId('s1');
    const baselineAudit = await auditOperations();
    const baselineEntity = await entitySnapshot(task.id);
    expect(baselineSession).toMatchObject({ status: 'running', boot_id: 'boot-a' });

    await installSessionInsertFailure();

    try {
      // This report updates the machine and interrupts s1 (steps 1-2) before
      // the injected failure hits the session insert (step 5).
      const failed = await reportWorkspace(
        db().pool,
        auth(),
        hookReport({ sessionId: BOOM_SESSION_ID, bootId: 'boot-b', extra: { feature_id: task.id } }),
        OPTIONS
      );

      expect(failed.isErr()).toBe(true);
      expect(failed._unsafeUnwrapErr().code).toBe('INTERNAL');
    } finally {
      await removeSessionInsertFailure();
    }

    // Nothing survived: the reboot update and the machine boot id reverted.
    expect(await sessionByAgentId('s1')).toEqual(baselineSession);
    expect(await sessionByAgentId(BOOM_SESSION_ID)).toBeUndefined();
    expect(await machineBootId('strongbad')).toBe('boot-a');
    expect(await auditOperations()).toEqual(baselineAudit);
    expect(await count('agent_sessions')).toBe(1);
    expect(await count('workspaces')).toBe(1);
    expect(await entitySnapshot(task.id)).toEqual(baselineEntity);

    // The pool is usable again after the rollback.
    const after = await report(
      hookReport({ sessionId: 's2', bootId: 'boot-b', extra: { feature_id: task.id } })
    );
    expect(after.interrupted_sessions).toBe(1);
    expect(after.warnings).toEqual([]);
  }, 120_000);
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthContext } from '../../src/auth/types.js';
import type { ServiceResult } from '../../src/types/common.js';
import { storeEntity } from '../../src/services/entity-service.js';
import {
  createFeature,
  setFeatureStage
} from '../../src/services/feature-service.js';
import {
  listMachines,
  setMachineConnectTarget
} from '../../src/services/machine-service.js';
import { createTask } from '../../src/services/task-service.js';
import { getWhere } from '../../src/services/where-service.js';
import { lookupWorkspace } from '../../src/services/workspace-lookup.js';
import { listWorkspaces } from '../../src/services/workspace-query.js';
import { reportWorkspace } from '../../src/services/workspace-service.js';
import { updateWorkspace } from '../../src/services/workspace-update.js';
import { ErrorCode } from '../../src/util/errors.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

const KEY_ID = '00000000-0000-0000-0000-000000000501';
const OPTIONS = { dormantAfterDays: 30 };
const STAGE_KEYS = [
  'building',
  'review',
  'functional_test',
  'ready_to_merge',
  'awaiting_release',
  'unassigned'
];

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    apiKeyId: KEY_ID,
    keyName: 'where-key',
    clientId: 'where-key',
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

describe('where core (feature)', () => {
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

  async function plainTask(content: string): Promise<string> {
    return (
      await createTask(db().pool, auth(), { content, visibility: 'shared' })
    )._unsafeUnwrap().id;
  }

  async function linkAudits(): Promise<Record<string, unknown>[]> {
    const result = await db().pool.query<{ details: Record<string, unknown> }>(
      `SELECT details FROM audit_log WHERE operation = 'workspace_link'
       ORDER BY timestamp, id`
    );
    return result.rows.map((row) => row.details);
  }

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    await resetTestDatabase(db().pool);
    await db().pool.query(
      'TRUNCATE TABLE agent_sessions, workspaces, machines, repositories CASCADE'
    );
    await seedApiKey(db().pool, { id: KEY_ID, name: 'where-key' });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('lists visible workspaces with filters, newest first (C1)', async () => {
    const work = await feature('Work feature', 'work');
    const linked = await report(
      hookReport({ path: '/home/ivo/wt/a', featureId: work })
    );
    const unlinked = await report(
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
    expect(all.map((w) => w.id)).toEqual([unlinked, other, linked]);
    expect(all[0]?.connect_target).toBe('codebox');

    const noPersonal = (
      await listWorkspaces(
        db().pool,
        auth({ allowedVisibility: ['work', 'shared'] }),
        {},
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(noPersonal.map((w) => w.id)).toEqual([linked]);

    const noTasks = (
      await listWorkspaces(
        db().pool,
        auth({ allowedTypes: ['memory'] }),
        {},
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(noTasks.map((w) => w.id)).toEqual([unlinked, other]);

    const byMachine = (
      await listWorkspaces(db().pool, auth(), { machine: 'codebox' }, OPTIONS)
    )._unsafeUnwrap();
    expect(byMachine.map((w) => w.id)).toEqual([unlinked]);

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
        { featureId: work.slice(0, 8) },
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(byFeature.map((w) => w.id)).toEqual([linked]);

    const unassigned = (
      await listWorkspaces(db().pool, auth(), { unassigned: true }, OPTIONS)
    )._unsafeUnwrap();
    expect(unassigned.map((w) => w.id)).toEqual([unlinked, other]);

    const forbidden = await listWorkspaces(
      db().pool,
      auth({ scopes: ['write'] }),
      {},
      OPTIONS
    );
    expect(errorCode(forbidden)).toBe(ErrorCode.FORBIDDEN);
  }, 120_000);

  it('shows ended sessions only on request, keeping the newest one (C1)', async () => {
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

  it('looks up the exact workspace or its longest prefix (C2)', async () => {
    const featureId = await feature('Lookup feature\nbody');
    const outer = await report(
      hookReport({ path: '/home/ivo/wt/a', featureId })
    );
    const inner = await report(hookReport({ path: '/home/ivo/wt/a/sub' }));

    const fromSubdir = (
      await lookupWorkspace(
        db().pool,
        auth(),
        { machine: 'strongbad', path: '/home/ivo/wt/a/cli/src' },
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(fromSubdir.workspace?.id).toBe(outer);
    expect(fromSubdir.feature).toEqual({
      id: featureId,
      title: 'Lookup feature',
      stage: 'building',
      pull_requests: []
    });

    const trailing = (
      await lookupWorkspace(
        db().pool,
        auth(),
        { machine: 'strongbad', path: '/home/ivo/wt/a/' },
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(trailing.workspace?.id).toBe(outer);

    const longest = (
      await lookupWorkspace(
        db().pool,
        auth(),
        { machine: 'strongbad', path: '/home/ivo/wt/a/sub/deep' },
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(longest.workspace?.id).toBe(inner);
    expect(longest.feature).toBeNull();

    for (const input of [
      { machine: 'strongbad', path: '/home/ivo/wt/ab' },
      { machine: 'unknown', path: '/home/ivo/wt/a' }
    ]) {
      const none = (
        await lookupWorkspace(db().pool, auth(), input, OPTIONS)
      )._unsafeUnwrap();
      expect(none).toEqual({ workspace: null, feature: null });
    }

    const invisible = (
      await lookupWorkspace(
        db().pool,
        auth({ allowedVisibility: ['work', 'shared'] }),
        { machine: 'strongbad', path: '/home/ivo/wt/a/sub' },
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(invisible.workspace?.id).toBe(outer);

    const relative = await lookupWorkspace(
      db().pool,
      auth(),
      { machine: 'strongbad', path: 'wt/a' },
      OPTIONS
    );
    expect(errorCode(relative)).toBe(ErrorCode.VALIDATION);
  }, 120_000);

  it('shows a linked plain task as building in lookup (C2)', async () => {
    const taskId = await plainTask('Plain linked task');
    await report(hookReport({ path: '/home/ivo/wt/plain', featureId: taskId }));

    const found = (
      await lookupWorkspace(
        db().pool,
        auth(),
        { machine: 'strongbad', path: '/home/ivo/wt/plain' },
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(found.feature).toEqual({
      id: taskId,
      title: 'Plain linked task',
      stage: 'building',
      pull_requests: []
    });
  }, 120_000);

  it('links, unlinks and marks a workspace missing (C3)', async () => {
    const workspaceId = await report(hookReport({ path: '/home/ivo/wt/b' }));
    const taskId = await plainTask('Link me');

    const linked = (
      await updateWorkspace(
        db().pool,
        auth(),
        { id: workspaceId, featureId: taskId.slice(0, 8) },
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(linked.feature_id).toBe(taskId);
    const task = await db().pool.query<{ metadata: Record<string, unknown> }>(
      'SELECT metadata FROM entities WHERE id = $1',
      [taskId]
    );
    expect(task.rows[0]?.metadata).toMatchObject({
      kind: 'feature',
      stage: 'building',
      stage_source: 'manual',
      pull_requests: []
    });
    expect(await linkAudits()).toEqual([{ from: null, to: taskId }]);

    (
      await updateWorkspace(
        db().pool,
        auth(),
        { id: workspaceId, featureId: taskId },
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(await linkAudits()).toHaveLength(1);

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

  it('rejects invalid workspace updates without writing (C3)', async () => {
    const workspaceId = await report(hookReport({ path: '/home/ivo/wt/b' }));
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
    const before = await linkAudits();

    const cases: [Awaited<ServiceResult<unknown>>, ErrorCode][] = [
      [
        await updateWorkspace(db().pool, auth(), { id: workspaceId }, OPTIONS),
        ErrorCode.VALIDATION
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
          auth(),
          {
            id: workspaceId,
            featureId: '00000000-0000-4000-8000-000000000998'
          },
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
      ],
      [
        await updateWorkspace(
          db().pool,
          auth({ allowedVisibility: ['work', 'shared'] }),
          { id: hidden, missing: true },
          OPTIONS
        ),
        ErrorCode.NOT_FOUND
      ]
    ];
    for (const [result, code] of cases) {
      expect(errorCode(result)).toBe(code);
    }

    expect(await linkAudits()).toEqual(before);
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

  it('lists machines and sets a connect target (C4)', async () => {
    await report(hookReport({ path: '/home/ivo/wt/a' }));
    await report(hookReport({ alias: 'codebox', path: '/home/ivo/wt/b' }));

    const machines = (await listMachines(db().pool, auth()))._unsafeUnwrap();
    expect(machines.map((m) => [m.alias, m.hostname, m.connect_target])).toEqual(
      [
        ['codebox', 'codebox-host', null],
        ['strongbad', 'strongbad-host', null]
      ]
    );
    expect(Number.isNaN(Date.parse(machines[0]?.last_seen_at ?? ''))).toBe(
      false
    );

    const set = (
      await setMachineConnectTarget(db().pool, auth(), {
        alias: 'codebox',
        connectTarget: 'ivo@codebox.local'
      })
    )._unsafeUnwrap();
    expect(set.connect_target).toBe('ivo@codebox.local');
    const [view] = (
      await listWorkspaces(db().pool, auth(), { machine: 'codebox' }, OPTIONS)
    )._unsafeUnwrap();
    expect(view?.connect_target).toBe('ivo@codebox.local');

    const cleared = (
      await setMachineConnectTarget(db().pool, auth(), {
        alias: 'codebox',
        connectTarget: null
      })
    )._unsafeUnwrap();
    expect(cleared.connect_target).toBeNull();

    const invalid = await setMachineConnectTarget(db().pool, auth(), {
      alias: 'codebox',
      connectTarget: 'bad target!'
    });
    expect(errorCode(invalid)).toBe(ErrorCode.VALIDATION);
    const unknown = await setMachineConnectTarget(db().pool, auth(), {
      alias: 'nope',
      connectTarget: 'nope'
    });
    expect(errorCode(unknown)).toBe(ErrorCode.NOT_FOUND);
    const readOnly = await setMachineConnectTarget(
      db().pool,
      auth({ scopes: ['read'] }),
      { alias: 'codebox', connectTarget: 'x' }
    );
    expect(errorCode(readOnly)).toBe(ErrorCode.FORBIDDEN);
    const after = (await listMachines(db().pool, auth()))._unsafeUnwrap();
    expect(after[0]?.connect_target).toBeNull();
  }, 120_000);

  it('groups features by stage and action with the inclusion rules (C5)', async () => {
    const building = await feature('Building feature');
    const review = await feature('Review feature');
    const released = await feature('Released feature');
    const done = await feature('Done feature');
    const idle = await feature('Feature without workspace');
    const plain = await plainTask('Plain linked task');
    (
      await setFeatureStage(db().pool, auth(), { id: review, stage: 'review' })
    )._unsafeUnwrap();
    (
      await setFeatureStage(db().pool, auth(), {
        id: released,
        stage: 'released'
      })
    )._unsafeUnwrap();
    await db().pool.query("UPDATE entities SET status = 'done' WHERE id = $1", [
      done
    ]);

    const wBuilding = await report(
      hookReport({ path: '/home/ivo/wt/building', featureId: building })
    );
    const wReview = await report(
      hookReport({
        alias: 'codebox',
        path: '/home/ivo/wt/review',
        featureId: review
      })
    );
    await report(
      hookReport({ path: '/home/ivo/wt/released', featureId: released })
    );
    await report(hookReport({ path: '/home/ivo/wt/done', featureId: done }));
    const wPlain = await report(
      hookReport({ path: '/home/ivo/wt/plain', featureId: plain })
    );
    const wFree = await report(hookReport({ path: '/home/ivo/wt/free' }));
    await setActivity('/home/ivo/wt/building', '2026-10-05T10:00:00.000Z');
    await setActivity('/home/ivo/wt/plain', '2026-10-04T10:00:00.000Z');

    const stage = (
      await getWhere(db().pool, auth(), {}, OPTIONS)
    )._unsafeUnwrap();
    expect(stage.view).toBe('stage');
    expect(stage.dormant_after_days).toBe(30);
    expect(Number.isNaN(Date.parse(stage.generated_at))).toBe(false);
    expect(stage.groups.map((g) => g.key)).toEqual(STAGE_KEYS);
    expect(stage.groups.map((g) => g.label)).toEqual([
      'Building',
      'Review',
      'Functional test',
      'Ready to merge',
      'Awaiting release',
      'Unassigned'
    ]);

    const groups = new Map(stage.groups.map((g) => [g.key, g]));
    const buildingGroup = groups.get('building');
    expect(
      buildingGroup && 'features' in buildingGroup
        ? buildingGroup.features.map((f) => f.id)
        : null
    ).toEqual([building, plain, idle]);
    const plainFeature =
      buildingGroup && 'features' in buildingGroup
        ? buildingGroup.features.find((f) => f.id === plain)
        : undefined;
    expect(plainFeature).toMatchObject({
      title: 'Plain linked task',
      stage: 'building',
      stage_source: null,
      stage_set_at: null,
      task_status: 'inbox',
      pull_requests: []
    });
    expect(plainFeature?.workspaces.map((w) => w.id)).toEqual([wPlain]);
    const idleFeature =
      buildingGroup && 'features' in buildingGroup
        ? buildingGroup.features.find((f) => f.id === idle)
        : undefined;
    expect(idleFeature?.workspaces).toEqual([]);
    const reviewGroup = groups.get('review');
    expect(
      reviewGroup && 'features' in reviewGroup
        ? reviewGroup.features.map((f) => [f.id, f.workspaces.map((w) => w.id)])
        : null
    ).toEqual([[review, [wReview]]]);
    const unassigned = groups.get('unassigned');
    expect(
      unassigned && 'workspaces' in unassigned
        ? unassigned.workspaces.map((w) => w.id)
        : null
    ).toEqual([wFree]);
    const shownIds = stage.groups.flatMap((g) =>
      'features' in g ? g.features.map((f) => f.id) : []
    );
    expect(shownIds).not.toContain(released);
    expect(shownIds).not.toContain(done);

    const withReleased = (
      await getWhere(db().pool, auth(), { includeReleased: true }, OPTIONS)
    )._unsafeUnwrap();
    expect(withReleased.groups.map((g) => g.key)).toEqual([
      'building',
      'review',
      'functional_test',
      'ready_to_merge',
      'awaiting_release',
      'released',
      'unassigned'
    ]);
    const releasedGroup = withReleased.groups.find((g) => g.key === 'released');
    expect(
      releasedGroup && 'features' in releasedGroup
        ? releasedGroup.features.map((f) => f.id)
        : null
    ).toEqual([released]);

    const withDone = (
      await getWhere(db().pool, auth(), { includeDone: true }, OPTIONS)
    )._unsafeUnwrap();
    expect(
      withDone.groups.flatMap((g) =>
        'features' in g ? g.features.map((f) => f.id) : []
      )
    ).toContain(done);

    const actions = (
      await getWhere(
        db().pool,
        auth(),
        { view: 'actions', includeReleased: true },
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(actions.groups.map((g) => [g.key, g.label])).toEqual([
      ['review', 'Review'],
      ['test', 'Test'],
      ['merge', 'Merge'],
      ['release', 'Release'],
      ['in_progress', 'In progress'],
      ['unassigned', 'Unassigned']
    ]);
    const inProgress = actions.groups.find((g) => g.key === 'in_progress');
    expect(
      inProgress && 'features' in inProgress
        ? inProgress.features.map((f) => f.id)
        : null
    ).toEqual([building, plain, idle]);

    const codebox = (
      await getWhere(db().pool, auth(), { machine: 'codebox' }, OPTIONS)
    )._unsafeUnwrap();
    expect(
      codebox.groups.map((g) =>
        'features' in g ? g.features.map((f) => f.id) : g.workspaces.map((w) => w.id)
      )
    ).toEqual([[], [review], [], [], [], []]);
    expect(wBuilding).not.toBe(wReview);

    const badView = await getWhere(
      db().pool,
      auth(),
      { view: 'kanban' },
      OPTIONS
    );
    expect(errorCode(badView)).toBe(ErrorCode.VALIDATION);
    const noRead = await getWhere(
      db().pool,
      auth({ scopes: ['write'] }),
      {},
      OPTIONS
    );
    expect(errorCode(noRead)).toBe(ErrorCode.FORBIDDEN);
  }, 120_000);
});

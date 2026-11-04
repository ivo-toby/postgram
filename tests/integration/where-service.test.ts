import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthContext } from '../../src/auth/types.js';
import type { ServiceResult } from '../../src/types/common.js';
import {
  createFeature,
  setFeatureStage
} from '../../src/services/feature-service.js';
import { createTask } from '../../src/services/task-service.js';
import { getWhere } from '../../src/services/where-service.js';
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
    keyName: 'where-slice-key',
    clientId: 'where-slice-key',
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

describe('getWhere (slice)', () => {
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

  async function setActivity(path: string, iso: string): Promise<void> {
    await db().pool.query(
      'UPDATE workspaces SET last_activity_at = $2 WHERE path = $1',
      [path, iso]
    );
  }

  async function plainTask(content: string): Promise<string> {
    return (
      await createTask(db().pool, auth(), { content, visibility: 'shared' })
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
    await seedApiKey(db().pool, { id: KEY_ID, name: 'where-slice-key' });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('groups stage and action views with a plain task in building', async () => {
    const building = await feature('Building feature');
    const review = await feature('Review feature');
    (
      await setFeatureStage(db().pool, auth(), { id: review, stage: 'review' })
    )._unsafeUnwrap();
    const plain = await plainTask('Plain linked task\nsecond line');
    await report(hookReport({ path: '/home/ivo/wt/building', featureId: building }));
    const wReview = await report(
      hookReport({
        alias: 'codebox',
        path: '/home/ivo/wt/review',
        featureId: review
      })
    );
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
    expect(Number.isNaN(Date.parse(stage.generated_at))).toBe(false);
    expect(stage.dormant_after_days).toBe(30);
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
    ).toEqual([building, plain]);
    const plainFeature =
      buildingGroup && 'features' in buildingGroup
        ? buildingGroup.features.find((f) => f.id === plain)
        : undefined;
    expect(plainFeature).toMatchObject({
      title: 'Plain linked task',
      stage: 'building',
      stage_source: null,
      stage_set_at: null,
      pull_requests: []
    });
    expect(plainFeature?.workspaces.map((w) => w.id)).toEqual([wPlain]);
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

    const actions = (
      await getWhere(db().pool, auth(), { view: 'actions' }, OPTIONS)
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
    ).toEqual([building, plain]);
    const actionsReview = actions.groups.find((g) => g.key === 'review');
    expect(
      actionsReview && 'features' in actionsReview
        ? actionsReview.features.map((f) => f.id)
        : null
    ).toEqual([review]);

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

  it('hides released and done features with their workspaces unless flagged', async () => {
    const released = await feature('Released feature');
    const done = await feature('Done feature');
    (
      await setFeatureStage(db().pool, auth(), {
        id: released,
        stage: 'released'
      })
    )._unsafeUnwrap();
    await db().pool.query("UPDATE entities SET status = 'done' WHERE id = $1", [
      done
    ]);
    await report(hookReport({ path: '/home/ivo/wt/released', featureId: released }));
    await report(hookReport({ path: '/home/ivo/wt/done', featureId: done }));

    const stage = (
      await getWhere(db().pool, auth(), {}, OPTIONS)
    )._unsafeUnwrap();
    const shownIds = stage.groups.flatMap((g) =>
      'features' in g ? g.features.map((f) => f.id) : []
    );
    expect(shownIds).not.toContain(released);
    expect(shownIds).not.toContain(done);
    const unassigned = stage.groups.find((g) => g.key === 'unassigned');
    expect(
      unassigned && 'workspaces' in unassigned
        ? unassigned.workspaces.map((w) => w.id)
        : null
    ).toEqual([]);
    expect(stage.groups.map((g) => g.key)).toEqual(STAGE_KEYS);

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
    expect(actions.groups.map((g) => g.key)).not.toContain('released');
    expect(
      actions.groups.flatMap((g) =>
        'features' in g ? g.features.map((f) => f.id) : []
      )
    ).not.toContain(released);
  }, 120_000);

  it('keeps only matching workspaces for machine and repo filters', async () => {
    const review = await feature('Review feature');
    (
      await setFeatureStage(db().pool, auth(), { id: review, stage: 'review' })
    )._unsafeUnwrap();
    const building = await feature('Building feature');
    const wReview = await report(
      hookReport({
        alias: 'codebox',
        path: '/home/ivo/wt/review',
        featureId: review
      })
    );
    const wBuilding = await report(
      hookReport({ path: '/home/ivo/wt/building', featureId: building })
    );
    await setActivity('/home/ivo/wt/building', '2026-10-05T10:00:00.000Z');
    await setActivity('/home/ivo/wt/review', '2026-10-04T10:00:00.000Z');

    const byMachine = (
      await getWhere(db().pool, auth(), { machine: 'codebox' }, OPTIONS)
    )._unsafeUnwrap();
    expect(
      byMachine.groups.map((g) =>
        'features' in g ? g.features.map((f) => f.id) : g.workspaces.map((w) => w.id)
      )
    ).toEqual([[], [review], [], [], [], []]);

    const byRepo = (
      await getWhere(
        db().pool,
        auth(),
        { repo: 'https://github.com/Ivo-Toby/postgram' },
        OPTIONS
      )
    )._unsafeUnwrap();
    const repoFeatureIds = byRepo.groups.flatMap((g) =>
      'features' in g ? g.features.map((f) => f.id) : []
    );
    expect(repoFeatureIds).toEqual([building, review]);
    const repoWorkspaceIds = byRepo.groups.flatMap((g) =>
      'features' in g
        ? g.features.flatMap((f) => f.workspaces.map((w) => w.id))
        : g.workspaces.map((w) => w.id)
    );
    expect(repoWorkspaceIds).toContain(wReview);
    expect(repoWorkspaceIds).toContain(wBuilding);

    const byOtherRepo = (
      await getWhere(
        db().pool,
        auth(),
        { repo: 'git@github.com:Ivo-Toby/other-repo.git' },
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(
      byOtherRepo.groups.flatMap((g) =>
        'features' in g ? g.features.map((f) => f.id) : g.workspaces.map((w) => w.id)
      )
    ).toEqual([]);
  }, 120_000);

  it('applies FR-040 visibility to linked and unlinked workspaces', async () => {
    const review = await feature('Review feature');
    (
      await setFeatureStage(db().pool, auth(), { id: review, stage: 'review' })
    )._unsafeUnwrap();
    const wReview = await report(
      hookReport({ path: '/home/ivo/wt/review', featureId: review })
    );
    const wFree = await report(hookReport({ path: '/home/ivo/wt/free' }));

    // Without personal: the unlinked workspace is hidden, the linked one
    // (shared feature) stays.
    const noPersonal = (
      await getWhere(
        db().pool,
        auth({ allowedVisibility: ['work', 'shared'] }),
        {},
        OPTIONS
      )
    )._unsafeUnwrap();
    const unassigned = noPersonal.groups.find((g) => g.key === 'unassigned');
    expect(
      unassigned && 'workspaces' in unassigned
        ? unassigned.workspaces.map((w) => w.id)
        : null
    ).toEqual([]);
    const reviewGroup = noPersonal.groups.find((g) => g.key === 'review');
    expect(
      reviewGroup && 'features' in reviewGroup
        ? reviewGroup.features.flatMap((f) => f.workspaces.map((w) => w.id))
        : null
    ).toEqual([wReview]);

    // Without the task type: no features at all and no linked workspaces.
    const noTasks = (
      await getWhere(
        db().pool,
        auth({ allowedTypes: ['memory'] }),
        {},
        OPTIONS
      )
    )._unsafeUnwrap();
    expect(
      noTasks.groups.flatMap((g) =>
        'features' in g ? g.features.map((f) => f.id) : []
      )
    ).toEqual([]);
    const noTasksUnassigned = noTasks.groups.find(
      (g) => g.key === 'unassigned'
    );
    expect(
      noTasksUnassigned && 'workspaces' in noTasksUnassigned
        ? noTasksUnassigned.workspaces.map((w) => w.id)
        : null
    ).toEqual([wFree]);
  }, 120_000);
});

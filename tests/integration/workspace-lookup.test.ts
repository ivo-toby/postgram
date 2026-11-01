import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthContext } from '../../src/auth/types.js';
import type { ServiceResult } from '../../src/types/common.js';
import {
  createFeature,
  setFeatureStage
} from '../../src/services/feature-service.js';
import { createTask } from '../../src/services/task-service.js';
import { lookupWorkspace } from '../../src/services/workspace-lookup.js';
import { reportWorkspace } from '../../src/services/workspace-service.js';
import { ErrorCode } from '../../src/util/errors.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

const KEY_ID = '00000000-0000-0000-0000-000000000501';
const OPTIONS = { dormantAfterDays: 30 };

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
  sessionId?: string;
}): Record<string, unknown> {
  const alias = input.alias ?? 'strongbad';
  return {
    source: 'hook',
    machine: { alias, hostname: `${alias}-host`, boot_id: 'boot-a' },
    workspace: {
      path: input.path,
      repo_remote: 'git@github.com:Ivo-Toby/postgram.git',
      repo_root: '/home/ivo/src/postgram',
      branch: 'feat/x',
      git: { dirty_count: 0, unpushed_count: 0, has_upstream: true }
    },
    ...(input.featureId !== undefined ? { feature_id: input.featureId } : {}),
    session: {
      agent_kind: 'claude-code',
      agent_session_id: input.sessionId ?? `s-${input.path}`,
      event: 'start',
      cwd: null,
      transcript_path: null
    }
  };
}

function errorCode<T>(result: Awaited<ServiceResult<T>>): ErrorCode | null {
  return result.isErr() ? result.error.code : null;
}

describe('workspace lookup (slice where-q3)', () => {
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

  async function lookup(
    input: { machine: string; path: string },
    authOverrides: Partial<AuthContext> = {}
  ) {
    return (
      await lookupWorkspace(db().pool, auth(authOverrides), input, OPTIONS)
    )._unsafeUnwrap();
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

  it('matches an exact path, a trailing slash and a subdirectory (C1)', async () => {
    const featureId = await feature('Lookup feature\nbody');
    const workspaceId = await report(
      hookReport({ path: '/home/ivo/wt/a', featureId })
    );

    for (const path of [
      '/home/ivo/wt/a',
      '/home/ivo/wt/a/',
      '/home/ivo/wt/a/cli/src'
    ]) {
      const found = await lookup({ machine: 'strongbad', path });
      expect(found.workspace?.id).toBe(workspaceId);
      expect(found.feature).toEqual({
        id: featureId,
        title: 'Lookup feature',
        stage: 'building',
        pull_requests: []
      });
    }
  }, 120_000);

  it('picks the longest matching workspace, and the longest visible one (C3)', async () => {
    const featureId = await feature('Outer feature\nbody');
    const outer = await report(
      hookReport({ path: '/home/ivo/wt/a', featureId })
    );
    const inner = await report(hookReport({ path: '/home/ivo/wt/a/sub' }));

    const longest = await lookup({ machine: 'strongbad', path: '/home/ivo/wt/a/sub/deep' });
    expect(longest.workspace?.id).toBe(inner);
    expect(longest.feature).toBeNull();

    // The inner workspace is unlinked (personal) and invisible to this
    // caller, so the visible outer one wins.
    const visible = await lookup(
      { machine: 'strongbad', path: '/home/ivo/wt/a/sub/deep' },
      { allowedVisibility: ['work', 'shared'] }
    );
    expect(visible.workspace?.id).toBe(outer);
    expect(visible.feature?.id).toBe(featureId);
  }, 120_000);

  it('returns null for a slash-boundary miss and an unknown machine (C4)', async () => {
    const featureId = await feature('Boundary feature\nbody');
    await report(hookReport({ path: '/home/ivo/wt/a/b', featureId }));

    for (const input of [
      { machine: 'strongbad', path: '/home/ivo/wt/a/bc' },
      { machine: 'unknown', path: '/home/ivo/wt/a/b' }
    ]) {
      const none = await lookup(input);
      expect(none).toEqual({ workspace: null, feature: null });
    }
  }, 120_000);

  it('shows a linked plain task as building (C5)', async () => {
    const taskId = await plainTask('Plain linked task');
    await report(hookReport({ path: '/home/ivo/wt/plain', featureId: taskId }));

    const found = await lookup({ machine: 'strongbad', path: '/home/ivo/wt/plain' });
    expect(found.feature).toEqual({
      id: taskId,
      title: 'Plain linked task',
      stage: 'building',
      pull_requests: []
    });
  }, 120_000);

  it('shows a staged feature with its pull request (C6)', async () => {
    const featureId = await feature('Staged feature\nbody');
    await report(hookReport({ path: '/home/ivo/wt/staged', featureId }));

    const staged = await setFeatureStage(db().pool, auth(), {
      id: featureId,
      stage: 'review'
    });
    if (staged.isErr()) {
      throw staged.error;
    }

    const pr = {
      url: 'https://github.com/Ivo-Toby/postgram/pull/7',
      state: 'open',
      updated_at: '2026-01-02T03:04:05.000Z'
    };
    await db().pool.query(
      "UPDATE entities SET metadata = metadata || jsonb_build_object('pull_requests', $2::jsonb) WHERE id = $1",
      [featureId, JSON.stringify([pr])]
    );

    const found = await lookup({ machine: 'strongbad', path: '/home/ivo/wt/staged' });
    expect(found.feature).toEqual({
      id: featureId,
      title: 'Staged feature',
      stage: 'review',
      pull_requests: [pr]
    });
  }, 120_000);

  it('rejects a relative path, an empty machine and a key without read (C7)', async () => {
    const relative = await lookupWorkspace(
      db().pool,
      auth(),
      { machine: 'strongbad', path: 'wt/a' },
      OPTIONS
    );
    expect(errorCode(relative)).toBe(ErrorCode.VALIDATION);

    const emptyMachine = await lookupWorkspace(
      db().pool,
      auth(),
      { machine: '  ', path: '/home/ivo/wt/a' },
      OPTIONS
    );
    expect(errorCode(emptyMachine)).toBe(ErrorCode.VALIDATION);

    const noRead = await lookupWorkspace(
      db().pool,
      auth({ scopes: ['write'] }),
      { machine: 'strongbad', path: '/home/ivo/wt/a' },
      OPTIONS
    );
    expect(errorCode(noRead)).toBe(ErrorCode.FORBIDDEN);
  }, 120_000);
});

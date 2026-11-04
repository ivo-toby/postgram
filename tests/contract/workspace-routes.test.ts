// Contract tests for the workspace/machine/where REST routes
// (spec 004, rest.md; proposal D12). The app is built directly: a fake auth
// middleware sets the AuthContext, the slice registers its routes, and the
// onError handler is the same envelope renderer the real app uses.
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthContext } from '../../src/auth/types.js';
import {
  createFeature,
  setFeatureStage
} from '../../src/services/feature-service.js';
import { registerWorkspaceRoutes } from '../../src/transport/workspace-routes.js';
import {
  normalizeError,
  toErrorResponse,
  toHttpStatus
} from '../../src/util/errors.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

type Json = Record<string, unknown>;

const KEY_ID = '00000000-0000-4000-8000-000000000001';

function hookReport(input: {
  alias?: string;
  path: string;
  featureId?: string;
}): Json {
  const alias = input.alias ?? 'strongbad';
  return {
    source: 'hook',
    machine: { alias, hostname: `${alias}-host`, boot_id: 'boot-a' },
    workspace: {
      path: input.path,
      repo_remote: 'git@github.com:Ivo-Toby/postgram.git',
      repo_root: '/home/ivo/src/postgram',
      branch: 'feat/x',
      git: { dirty_count: 1, unpushed_count: 0, has_upstream: true }
    },
    ...(input.featureId !== undefined ? { feature_id: input.featureId } : {}),
    session: {
      agent_kind: 'claude-code',
      agent_session_id: `s-${input.path}`,
      event: 'start',
      cwd: null,
      transcript_path: null
    }
  };
}

describe('workspace routes (contract)', () => {
  let database: TestDatabase | undefined;
  let app: Hono<{ Variables: { auth: AuthContext } }> | undefined;
  let auth: AuthContext;

  function db(): TestDatabase {
    if (!database) {
      throw new Error('test database not initialized');
    }
    return database;
  }

  function appRequired(): Hono<{ Variables: { auth: AuthContext } }> {
    if (!app) {
      throw new Error('app not initialized');
    }
    return app;
  }

  async function call(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ status: number; json: Json }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    const response = await appRequired().request(path, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, json: (await response.json()) as Json };
  }

  function errorCode(json: Json): unknown {
    const error = json.error as Json | undefined;
    return error?.code;
  }

  async function makeFeature(content: string): Promise<string> {
    const created = await createFeature(db().pool, auth, { content });
    return created._unsafeUnwrap().id;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    const pool = database.pool;

    app = new Hono<{ Variables: { auth: AuthContext } }>();
    app.onError((error, c) => {
      const appError = normalizeError(error);
      return c.json(
        toErrorResponse(appError),
        toHttpStatus(appError.code) as ContentfulStatusCode
      );
    });
    app.use('/api/*', async (c, next) => {
      c.set('auth', auth);
      await next();
    });
    registerWorkspaceRoutes(app, pool, { dormantAfterDays: 7 });
  }, 120_000);

  beforeEach(async () => {
    const pool = db().pool;
    await resetTestDatabase(pool);
    await pool.query(
      'TRUNCATE TABLE agent_sessions, workspaces, machines, repositories CASCADE'
    );
    await seedApiKey(pool, {
      id: KEY_ID,
      name: 'workspace-routes-test',
      scopes: ['read', 'write', 'delete']
    });
    auth = {
      apiKeyId: KEY_ID,
      keyName: 'workspace-routes-test',
      clientId: 'workspace-routes-test',
      scopes: ['read', 'write'],
      allowedTypes: null,
      allowedVisibility: ['personal', 'work', 'shared']
    };
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('reports a workspace and rejects an invalid alias (report)', async () => {
    const reported = await call(
      'POST',
      '/api/workspaces/report',
      hookReport({ path: '/home/ivo/wt/a/' })
    );
    expect(reported.status).toBe(200);
    const workspace = reported.json.workspace as Json;
    expect(workspace).toMatchObject({
      machine: 'strongbad',
      path: '/home/ivo/wt/a',
      repo_remote: 'github.com/ivo-toby/postgram',
      risks: ['dirty']
    });
    expect(typeof workspace.id).toBe('string');
    expect(reported.json.feature).toBeNull();
    expect((reported.json.session as Json).status).toBe('running');

    const badAlias = await call('POST', '/api/workspaces/report', {
      ...hookReport({ path: '/home/ivo/wt/a' }),
      machine: { alias: 'Bad Alias', hostname: 'x', boot_id: null }
    });
    expect(badAlias.status).toBe(400);
    expect(errorCode(badAlias.json)).toBe('VALIDATION');
    expect(typeof (badAlias.json.error as Json).message).toBe('string');
  });

  it('links, marks missing, and validates PATCH bodies (patch)', async () => {
    const reported = await call(
      'POST',
      '/api/workspaces/report',
      hookReport({ path: '/home/ivo/wt/a' })
    );
    const workspaceId = (reported.json.workspace as Json).id as string;
    const featureId = await makeFeature('Linked feature');

    const linked = await call('PATCH', `/api/workspaces/${workspaceId}`, {
      feature_id: featureId.slice(0, 8)
    });
    expect(linked.status).toBe(200);
    expect((linked.json.workspace as Json).feature_id).toBe(featureId);

    const missing = await call('PATCH', `/api/workspaces/${workspaceId}`, {
      missing: true
    });
    expect(missing.status).toBe(200);
    expect((missing.json.workspace as Json).risks).toEqual([
      'dirty',
      'missing'
    ]);

    const empty = await call('PATCH', `/api/workspaces/${workspaceId}`, {});
    expect(empty.status).toBe(400);
    expect(errorCode(empty.json)).toBe('VALIDATION');

    const unknown = await call(
      'PATCH',
      '/api/workspaces/00000000-0000-4000-8000-000000000999',
      { missing: false }
    );
    expect(unknown.status).toBe(404);
    expect(errorCode(unknown.json)).toBe('NOT_FOUND');
  });

  it('lists machines and sets a connect target (machines)', async () => {
    await call(
      'POST',
      '/api/workspaces/report',
      hookReport({ path: '/home/ivo/wt/a' })
    );
    await call(
      'POST',
      '/api/workspaces/report',
      hookReport({ alias: 'codebox', path: '/home/ivo/wt/b' })
    );

    const machines = await call('GET', '/api/machines');
    expect(machines.status).toBe(200);
    expect(
      (machines.json.machines as Json[]).map((m) => [m.alias, m.connect_target])
    ).toEqual([
      ['codebox', null],
      ['strongbad', null]
    ]);

    const set = await call('PUT', '/api/machines/codebox', {
      connect_target: 'ivo@codebox.local'
    });
    expect(set.status).toBe(200);
    expect(set.json.machine).toMatchObject({
      alias: 'codebox',
      hostname: 'codebox-host',
      connect_target: 'ivo@codebox.local'
    });
    expect(typeof (set.json.machine as Json).last_seen_at).toBe('string');

    const invalid = await call('PUT', '/api/machines/codebox', {
      connect_target: 'bad target!'
    });
    expect(invalid.status).toBe(400);
    expect(errorCode(invalid.json)).toBe('VALIDATION');

    const missingKey = await call('PUT', '/api/machines/codebox', {});
    expect(missingKey.status).toBe(400);

    const unknown = await call('PUT', '/api/machines/nope', {
      connect_target: 'nope'
    });
    expect(unknown.status).toBe(404);
    expect(errorCode(unknown.json)).toBe('NOT_FOUND');
  });

  it('looks a workspace up by machine and path (lookup)', async () => {
    const featureId = await makeFeature('Lookup feature');
    const reported = await call(
      'POST',
      '/api/workspaces/report',
      hookReport({ path: '/home/ivo/wt/a', featureId })
    );
    const workspaceId = (reported.json.workspace as Json).id as string;

    const lookup = await call(
      'GET',
      `/api/workspaces/lookup?machine=strongbad&path=${encodeURIComponent('/home/ivo/wt/a/cli')}`
    );
    expect(lookup.status).toBe(200);
    expect((lookup.json.workspace as Json).id).toBe(workspaceId);
    const feature = lookup.json.feature as Json;
    expect(feature.id).toBe(featureId);
    expect(feature.pull_requests).toEqual([]);
    expect(typeof feature.title).toBe('string');
    expect(typeof feature.stage).toBe('string');

    const noMatch = await call(
      'GET',
      '/api/workspaces/lookup?machine=nope&path=%2Fhome'
    );
    expect(noMatch.status).toBe(200);
    expect(noMatch.json).toEqual({ workspace: null, feature: null });

    const missingPath = await call(
      'GET',
      '/api/workspaces/lookup?machine=strongbad'
    );
    expect(missingPath.status).toBe(400);
    expect(errorCode(missingPath.json)).toBe('VALIDATION');

    const missingMachine = await call(
      'GET',
      '/api/workspaces/lookup?path=%2Fhome'
    );
    expect(missingMachine.status).toBe(400);
  });

  it('lists workspaces with filters and strict flags (list)', async () => {
    const first = await call(
      'POST',
      '/api/workspaces/report',
      hookReport({ path: '/home/ivo/wt/a' })
    );
    const workspaceId = (first.json.workspace as Json).id as string;
    await call(
      'POST',
      '/api/workspaces/report',
      hookReport({ alias: 'codebox', path: '/home/ivo/wt/b' })
    );
    // Fixed timestamps so the last_activity_at DESC order is deterministic.
    await db()
      .pool.query('UPDATE workspaces SET last_activity_at = $1 WHERE id = $2', [
        new Date('2026-01-01T00:00:00Z'),
        workspaceId
      ]);
    await db()
      .pool.query(
        "UPDATE workspaces SET last_activity_at = $1 WHERE path = '/home/ivo/wt/b'",
        [new Date('2026-02-01T00:00:00Z')]
      );

    const all = await call('GET', '/api/workspaces');
    expect(all.status).toBe(200);
    expect((all.json.workspaces as Json[]).map((w) => w.path)).toEqual([
      '/home/ivo/wt/b',
      '/home/ivo/wt/a'
    ]);

    const byMachine = await call('GET', '/api/workspaces?machine=codebox');
    expect((byMachine.json.workspaces as Json[]).map((w) => w.path)).toEqual([
      '/home/ivo/wt/b'
    ]);

    const featureId = await makeFeature('Listed feature');
    await call('PATCH', `/api/workspaces/${workspaceId}`, {
      feature_id: featureId.slice(0, 8)
    });
    const byFeature = await call(
      'GET',
      `/api/workspaces?feature_id=${featureId.slice(0, 8)}`
    );
    expect(byFeature.status).toBe(200);
    expect((byFeature.json.workspaces as Json[]).map((w) => w.id)).toEqual([
      workspaceId
    ]);

    const unassigned = await call(
      'GET',
      '/api/workspaces?unassigned=true&machine=codebox'
    );
    expect(unassigned.status).toBe(200);
    expect((unassigned.json.workspaces as Json[]).map((w) => w.path)).toEqual([
      '/home/ivo/wt/b'
    ]);

    const badFlag = await call('GET', '/api/workspaces?include_ended=yes');
    expect(badFlag.status).toBe(400);
    expect(errorCode(badFlag.json)).toBe('VALIDATION');
  });

  it('serves the where views with the configured dormancy (where)', async () => {
    const featureId = await makeFeature('Where feature');
    await setFeatureStage(db().pool, auth, { id: featureId, stage: 'review' });
    await call(
      'POST',
      '/api/workspaces/report',
      hookReport({ path: '/home/ivo/wt/a', featureId })
    );
    await call(
      'POST',
      '/api/workspaces/report',
      hookReport({ alias: 'codebox', path: '/home/ivo/wt/free' })
    );

    const stage = await call('GET', '/api/where');
    expect(stage.status).toBe(200);
    expect(stage.json.view).toBe('stage');
    expect(stage.json.dormant_after_days).toBe(7);
    expect(typeof stage.json.generated_at).toBe('string');
    const groups = stage.json.groups as Json[];
    const keys = groups.map((g) => g.key);
    expect(keys).toContain('review');
    expect(keys).toContain('unassigned');
    const review = groups.find((g) => g.key === 'review')?.features as Json[];
    expect(review.map((f) => f.id)).toEqual([featureId]);
    const unassignedGroup = groups.find((g) => g.key === 'unassigned');
    expect(
      ((unassignedGroup?.workspaces as Json[] | undefined) ?? []).map(
        (w) => w.path
      )
    ).toContain('/home/ivo/wt/free');

    const actions = await call(
      'GET',
      '/api/where?view=actions&include_released=true&machine=strongbad'
    );
    expect(actions.status).toBe(200);
    expect(actions.json.view).toBe('actions');
    expect(Array.isArray(actions.json.groups)).toBe(true);

    const badView = await call('GET', '/api/where?view=kanban');
    expect(badView.status).toBe(400);
    expect(errorCode(badView.json)).toBe('VALIDATION');

    const badFlag = await call('GET', '/api/where?include_done=1');
    expect(badFlag.status).toBe(400);
    expect(errorCode(badFlag.json)).toBe('VALIDATION');
  });

  it('rejects mutating routes for a read-only key (403)', async () => {
    const reported = await call(
      'POST',
      '/api/workspaces/report',
      hookReport({ path: '/home/ivo/wt/a' })
    );
    const workspaceId = (reported.json.workspace as Json).id as string;

    auth = { ...auth, scopes: ['read'] };

    const report = await call(
      'POST',
      '/api/workspaces/report',
      hookReport({ alias: 'codebox', path: '/home/ivo/wt/b' })
    );
    expect(report.status).toBe(403);
    expect(errorCode(report.json)).toBe('FORBIDDEN');

    const patch = await call('PATCH', `/api/workspaces/${workspaceId}`, {
      missing: true
    });
    expect(patch.status).toBe(403);
    expect(errorCode(patch.json)).toBe('FORBIDDEN');

    const put = await call('PUT', '/api/machines/strongbad', {
      connect_target: 'x'
    });
    expect(put.status).toBe(403);
    expect(errorCode(put.json)).toBe('FORBIDDEN');

    // Reads still work with the same read-only key.
    const machines = await call('GET', '/api/machines');
    expect(machines.status).toBe(200);
  });
});

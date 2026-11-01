import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createKey } from '../../src/auth/key-service.js';
import { createApp } from '../../src/index.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

type Json = Record<string, unknown>;
type Visibility = 'personal' | 'work' | 'shared';

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

describe('workspace and feature REST API (feature)', () => {
  let database: TestDatabase | undefined;
  let app: ReturnType<typeof createApp> | undefined;

  function db(): TestDatabase {
    if (!database) {
      throw new Error('test database not initialized');
    }
    return database;
  }

  async function key(
    options: {
      scopes?: Array<'read' | 'write' | 'delete'>;
      allowedVisibility?: Visibility[];
    } = {}
  ): Promise<string> {
    const created = (
      await createKey(db().pool, {
        name: `ws-${crypto.randomUUID()}`,
        scopes: options.scopes ?? ['read', 'write'],
        allowedVisibility: options.allowedVisibility ?? [
          'personal',
          'work',
          'shared'
        ]
      })
    )._unsafeUnwrap();
    return created.plaintextKey;
  }

  async function call(
    apiKey: string | null,
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ status: number; json: Json }> {
    if (!app) {
      throw new Error('app not initialized');
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (apiKey !== null) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const response = await app.request(path, {
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

  beforeAll(async () => {
    database = await createTestDatabase();
    app = createApp({ pool: database.pool, workspaceDormantAfterDays: 7 });
  }, 120_000);

  beforeEach(async () => {
    await resetTestDatabase(db().pool);
    await db().pool.query(
      'TRUNCATE TABLE agent_sessions, workspaces, machines, repositories CASCADE'
    );
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('runs the feature lifecycle over REST (C6)', async () => {
    const apiKey = await key();

    const created = await call(apiKey, 'POST', '/api/features', {
      content: 'Keyword rank fusion\nbody',
      tags: ['search'],
      visibility: 'shared'
    });
    expect(created.status).toBe(201);
    const entity = created.json.entity as Json;
    const featureId = entity.id as string;
    expect(entity).toMatchObject({
      type: 'task',
      status: 'inbox',
      visibility: 'shared',
      metadata: { kind: 'feature', stage: 'building', pull_requests: [] }
    });

    const repository = await call(apiKey, 'PUT', '/api/repositories', {
      remote: 'git@github.com:Ivo-Toby/postgram.git',
      release_on_merge: false
    });
    expect(repository.status).toBe(200);
    expect(repository.json).toEqual({
      repository: {
        remote: 'github.com/ivo-toby/postgram',
        release_on_merge: false
      }
    });

    const stage = await call(
      apiKey,
      'POST',
      `/api/features/${featureId.slice(0, 8)}/stage`,
      { stage: 'functional_test' }
    );
    expect(stage.status).toBe(200);
    expect(stage.json.previous_stage).toBe('building');
    expect((stage.json.entity as Json).metadata).toMatchObject({
      stage: 'functional_test',
      stage_source: 'manual'
    });

    const back = await call(apiKey, 'POST', `/api/features/${featureId}/stage`, {
      stage: 'building'
    });
    expect(back.json.previous_stage).toBe('functional_test');

    const opened = await call(
      apiKey,
      'POST',
      `/api/features/${featureId}/pull-requests`,
      { url: 'https://github.com/Ivo-Toby/postgram/pull/12/files' }
    );
    expect(opened.status).toBe(200);
    expect(opened.json).toMatchObject({
      stage_changed: true,
      from: 'building',
      to: 'review'
    });
    expect(
      ((opened.json.entity as Json).metadata as Json).pull_requests
    ).toMatchObject([
      { url: 'https://github.com/ivo-toby/postgram/pull/12', state: 'open' }
    ]);

    const merged = await call(
      apiKey,
      'POST',
      `/api/features/${featureId}/pull-requests`,
      { url: 'https://github.com/ivo-toby/postgram/pull/12', state: 'merged' }
    );
    expect(merged.json).toMatchObject({
      stage_changed: true,
      from: 'review',
      to: 'awaiting_release'
    });

    const badStage = await call(
      apiKey,
      'POST',
      `/api/features/${featureId}/stage`,
      { stage: 'shipped' }
    );
    expect(badStage.status).toBe(400);
    expect(errorCode(badStage.json)).toBe('VALIDATION');

    const badPr = await call(
      apiKey,
      'POST',
      `/api/features/${featureId}/pull-requests`,
      { url: 'https://gitlab.com/a/b/-/merge_requests/1' }
    );
    expect(badPr.status).toBe(400);

    const unknown = await call(
      apiKey,
      'POST',
      '/api/features/00000000-0000-4000-8000-000000000999/stage',
      { stage: 'review' }
    );
    expect(unknown.status).toBe(404);

    const emptyContent = await call(apiKey, 'POST', '/api/features', {
      content: ''
    });
    expect(emptyContent.status).toBe(400);
  }, 120_000);

  it('returns 409 with candidates for an ambiguous short id (C6)', async () => {
    const apiKey = await key();
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

    const ambiguous = await call(apiKey, 'POST', '/api/features/abcd1234/stage', {
      stage: 'review'
    });
    expect(ambiguous.status).toBe(409);
    expect(
      ((ambiguous.json.error as Json).details as Json).candidates
    ).toEqual([
      { id: 'abcd1234-0000-4000-8000-000000000001', title: 'Task 1' },
      { id: 'abcd1234-0000-4000-8000-000000000002', title: 'Task 2' }
    ]);
  }, 120_000);

  it('reports, links, looks up and lists workspaces over REST (C6)', async () => {
    const apiKey = await key();
    const feature = await call(apiKey, 'POST', '/api/features', {
      content: 'Linked feature'
    });
    const featureId = (feature.json.entity as Json).id as string;

    const reported = await call(
      apiKey,
      'POST',
      '/api/workspaces/report',
      hookReport({ path: '/home/ivo/wt/a/' })
    );
    expect(reported.status).toBe(200);
    const workspace = reported.json.workspace as Json;
    const workspaceId = workspace.id as string;
    expect(workspace).toMatchObject({
      machine: 'strongbad',
      connect_target: 'strongbad',
      path: '/home/ivo/wt/a',
      repo_remote: 'github.com/ivo-toby/postgram',
      risks: ['dirty']
    });
    expect(reported.json.feature).toBeNull();

    const invalidReport = await call(apiKey, 'POST', '/api/workspaces/report', {
      ...hookReport({ path: '/home/ivo/wt/a' }),
      machine: { alias: 'Bad Alias', hostname: 'x', boot_id: null }
    });
    expect(invalidReport.status).toBe(400);

    const linked = await call(apiKey, 'PATCH', `/api/workspaces/${workspaceId}`, {
      feature_id: featureId.slice(0, 8)
    });
    expect(linked.status).toBe(200);
    expect((linked.json.workspace as Json).feature_id).toBe(featureId);

    const missing = await call(apiKey, 'PATCH', `/api/workspaces/${workspaceId}`, {
      missing: true
    });
    expect((missing.json.workspace as Json).risks).toEqual(['dirty', 'missing']);

    const emptyPatch = await call(
      apiKey,
      'PATCH',
      `/api/workspaces/${workspaceId}`,
      {}
    );
    expect(emptyPatch.status).toBe(400);
    const unknownPatch = await call(
      apiKey,
      'PATCH',
      '/api/workspaces/00000000-0000-4000-8000-000000000999',
      { missing: false }
    );
    expect(unknownPatch.status).toBe(404);

    const lookup = await call(
      apiKey,
      'GET',
      `/api/workspaces/lookup?machine=strongbad&path=${encodeURIComponent('/home/ivo/wt/a/cli')}`
    );
    expect(lookup.status).toBe(200);
    expect((lookup.json.workspace as Json).id).toBe(workspaceId);
    expect(lookup.json.feature).toEqual({
      id: featureId,
      title: 'Linked feature',
      stage: 'building',
      pull_requests: []
    });

    const noMatch = await call(
      apiKey,
      'GET',
      '/api/workspaces/lookup?machine=nope&path=%2Fhome'
    );
    expect(noMatch.status).toBe(200);
    expect(noMatch.json).toEqual({ workspace: null, feature: null });

    await call(
      apiKey,
      'POST',
      '/api/workspaces/report',
      hookReport({ alias: 'codebox', path: '/home/ivo/wt/b' })
    );
    const all = await call(apiKey, 'GET', '/api/workspaces');
    expect(all.status).toBe(200);
    expect((all.json.workspaces as Json[]).map((w) => w.path)).toEqual([
      '/home/ivo/wt/b',
      '/home/ivo/wt/a'
    ]);
    const byFeature = await call(
      apiKey,
      'GET',
      `/api/workspaces?feature_id=${featureId.slice(0, 8)}`
    );
    expect((byFeature.json.workspaces as Json[]).map((w) => w.id)).toEqual([
      workspaceId
    ]);
    const unassigned = await call(
      apiKey,
      'GET',
      '/api/workspaces?unassigned=true&machine=codebox'
    );
    expect((unassigned.json.workspaces as Json[]).map((w) => w.path)).toEqual([
      '/home/ivo/wt/b'
    ]);
    const badFlag = await call(apiKey, 'GET', '/api/workspaces?include_ended=yes');
    expect(badFlag.status).toBe(400);
  }, 120_000);

  it('lists machines and sets a connect target over REST (C6)', async () => {
    const apiKey = await key();
    await call(
      apiKey,
      'POST',
      '/api/workspaces/report',
      hookReport({ path: '/home/ivo/wt/a' })
    );
    await call(
      apiKey,
      'POST',
      '/api/workspaces/report',
      hookReport({ alias: 'codebox', path: '/home/ivo/wt/b' })
    );

    const machines = await call(apiKey, 'GET', '/api/machines');
    expect(machines.status).toBe(200);
    expect(
      (machines.json.machines as Json[]).map((m) => [m.alias, m.connect_target])
    ).toEqual([
      ['codebox', null],
      ['strongbad', null]
    ]);

    const set = await call(apiKey, 'PUT', '/api/machines/codebox', {
      connect_target: 'ivo@codebox.local'
    });
    expect(set.status).toBe(200);
    expect(set.json.machine).toMatchObject({
      alias: 'codebox',
      hostname: 'codebox-host',
      connect_target: 'ivo@codebox.local'
    });

    const invalid = await call(apiKey, 'PUT', '/api/machines/codebox', {
      connect_target: 'bad target!'
    });
    expect(invalid.status).toBe(400);
    const unknown = await call(apiKey, 'PUT', '/api/machines/nope', {
      connect_target: 'nope'
    });
    expect(unknown.status).toBe(404);
  }, 120_000);

  it('serves the where views with the configured dormancy (C6)', async () => {
    const apiKey = await key();
    const feature = await call(apiKey, 'POST', '/api/features', {
      content: 'Where feature'
    });
    const featureId = (feature.json.entity as Json).id as string;
    await call(apiKey, 'POST', `/api/features/${featureId}/stage`, {
      stage: 'review'
    });
    await call(
      apiKey,
      'POST',
      '/api/workspaces/report',
      hookReport({ path: '/home/ivo/wt/a', featureId })
    );
    await call(
      apiKey,
      'POST',
      '/api/workspaces/report',
      hookReport({ alias: 'codebox', path: '/home/ivo/wt/free' })
    );

    const stage = await call(apiKey, 'GET', '/api/where');
    expect(stage.status).toBe(200);
    expect(stage.json.view).toBe('stage');
    expect(stage.json.dormant_after_days).toBe(7);
    const groups = stage.json.groups as Json[];
    expect(groups.map((g) => g.key)).toEqual([
      'building',
      'review',
      'functional_test',
      'ready_to_merge',
      'awaiting_release',
      'unassigned'
    ]);
    const review = groups[1]?.features as Json[];
    expect(review.map((f) => f.id)).toEqual([featureId]);
    expect((review[0]?.workspaces as Json[]).map((w) => w.path)).toEqual([
      '/home/ivo/wt/a'
    ]);
    expect(
      ((groups[5]?.workspaces as Json[]) ?? []).map((w) => w.path)
    ).toEqual(['/home/ivo/wt/free']);

    const actions = await call(
      apiKey,
      'GET',
      '/api/where?view=actions&include_released=true&machine=strongbad'
    );
    expect(actions.status).toBe(200);
    expect((actions.json.groups as Json[]).map((g) => g.key)).toEqual([
      'review',
      'test',
      'merge',
      'release',
      'in_progress',
      'unassigned'
    ]);
    expect(
      ((actions.json.groups as Json[])[5]?.workspaces as Json[]).length
    ).toBe(0);

    const badView = await call(apiKey, 'GET', '/api/where?view=kanban');
    expect(badView.status).toBe(400);
    const badFlag = await call(apiKey, 'GET', '/api/where?include_done=1');
    expect(badFlag.status).toBe(400);
  }, 120_000);

  it('enforces authentication, scopes and visibility (C6)', async () => {
    const writer = await key();
    const reader = await key({ scopes: ['read'] });
    const noPersonal = await key({ allowedVisibility: ['work', 'shared'] });
    const reported = await call(
      writer,
      'POST',
      '/api/workspaces/report',
      hookReport({ path: '/home/ivo/wt/a' })
    );
    const workspaceId = (reported.json.workspace as Json).id as string;

    expect((await call(null, 'GET', '/api/where')).status).toBe(401);
    expect(
      (
        await call(
          reader,
          'POST',
          '/api/workspaces/report',
          hookReport({ path: '/home/ivo/wt/b' })
        )
      ).status
    ).toBe(403);
    expect(
      (
        await call(reader, 'PATCH', `/api/workspaces/${workspaceId}`, {
          missing: true
        })
      ).status
    ).toBe(403);
    expect(
      (
        await call(reader, 'PUT', '/api/machines/strongbad', {
          connect_target: 'x'
        })
      ).status
    ).toBe(403);
    expect(
      (
        await call(reader, 'POST', '/api/features', { content: 'nope' })
      ).status
    ).toBe(403);

    const hidden = await call(noPersonal, 'GET', '/api/workspaces');
    expect(hidden.json.workspaces).toEqual([]);
    const hiddenPatch = await call(
      noPersonal,
      'PATCH',
      `/api/workspaces/${workspaceId}`,
      { missing: true }
    );
    expect(hiddenPatch.status).toBe(404);
  }, 120_000);
});

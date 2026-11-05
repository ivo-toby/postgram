import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { createKey } from '../../src/auth/key-service.js';
import { createApp } from '../../src/index.js';
import { createEmbeddingService } from '../../src/services/embedding-service.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

type Json = Record<string, unknown>;

type ToolResult = {
  structuredContent?: Json;
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

function payload(result: ToolResult): Json {
  if (result.structuredContent) {
    return result.structuredContent;
  }

  const text = result.content?.find((item) => item.type === 'text')?.text;
  if (!text) {
    throw new Error('tool result has no content');
  }

  return JSON.parse(text) as Json;
}

function hookReport(input: { path: string; featureId?: string }): Json {
  return {
    source: 'hook',
    machine: {
      alias: 'strongbad',
      hostname: 'strongbad-host',
      boot_id: 'boot-a'
    },
    workspace: {
      path: input.path,
      repo_remote: 'git@github.com:Ivo-Toby/postgram.git',
      repo_root: '/home/ivo/src/postgram',
      branch: 'feat/x',
      git: { dirty_count: 0, unpushed_count: 2, has_upstream: true }
    },
    ...(input.featureId !== undefined ? { feature_id: input.featureId } : {}),
    session: {
      agent_kind: 'claude-code',
      agent_session_id: 'sess-1',
      event: 'start',
      cwd: `${input.path}/cli`,
      transcript_path: null
    }
  };
}

describe('MCP workspace tools', () => {
  let database: TestDatabase | undefined;
  let server: ReturnType<typeof serve> | undefined;
  let baseUrl = '';
  const clients: Client[] = [];
  const embeddingService = createEmbeddingService();

  function db(): TestDatabase {
    if (!database) {
      throw new Error('test database not initialized');
    }

    return database;
  }

  async function connect(
    scopes: Array<'read' | 'write' | 'delete'> = ['read', 'write']
  ): Promise<Client> {
    const name = `mcp-ws-${crypto.randomUUID()}`;
    const created = (
      await createKey(db().pool, {
        name,
        clientId: name,
        scopes,
        allowedTypes: null,
        allowedVisibility: ['personal', 'work', 'shared']
      })
    )._unsafeUnwrap();

    const transport = new StreamableHTTPClientTransport(
      new URL('/mcp', baseUrl),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${created.plaintextKey}` }
        }
      }
    );
    const client = new Client(
      { name: 'postgram-mcp-workspace-test', version: '0.1.0' },
      { capabilities: {} }
    );

    // StreamableHTTPClientTransport.sessionId is string|undefined but Transport
    // declares sessionId?: string; incompatible under exactOptionalPropertyTypes.
    await client.connect(transport as unknown as Transport);
    clients.push(client);
    return client;
  }

  async function tool(client: Client, name: string, args: Json) {
    const result = (await client.callTool({
      name,
      arguments: args
    })) as ToolResult;
    return { isError: result.isError === true, json: payload(result) };
  }

  async function createFeatureId(content: string): Promise<string> {
    const result = await db().pool.query<{ id: string }>(
      `INSERT INTO entities (type, content, visibility, status, metadata)
       VALUES ('task', $1, 'shared', 'inbox',
               '{"kind":"feature","stage":"building","stage_source":"manual","stage_set_at":"2026-10-01T00:00:00.000Z","pull_requests":[]}'::jsonb)
       RETURNING id`,
      [content]
    );
    const id = result.rows[0]?.id;
    if (!id) {
      throw new Error('feature insert failed');
    }
    return id;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    if (!database) {
      throw new Error('test database not initialized');
    }

    const app = createApp({ pool: database.pool, embeddingService });
    server = serve(
      { fetch: app.fetch, hostname: '127.0.0.1', port: 0 },
      (info) => {
        baseUrl = `http://${info.address}:${info.port}`;
      }
    );
  }, 120_000);

  beforeEach(async () => {
    await resetTestDatabase(db().pool);
    await db().pool.query(
      'TRUNCATE TABLE agent_sessions, workspaces, machines, repositories CASCADE'
    );
  });

  afterAll(async () => {
    for (const client of clients) {
      await client.close();
    }

    if (server) {
      await new Promise<void>((resolve) => {
        server?.close(() => resolve());
      });
    }

    if (database) {
      await database.close();
    }
  });

  it('lists the workspace tools alongside the existing tools', async () => {
    const client = await connect();
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name);

    for (const name of [
      'workspace_report',
      'workspace_lookup',
      'workspace_link',
      'workspace_delete',
      'feature_stage',
      'feature_pr',
      'where'
    ]) {
      expect(names).toContain(name);
    }

    for (const name of [
      'store',
      'store_session_context',
      'groom_session_context',
      'recall',
      'search',
      'update',
      'delete',
      'task_create',
      'task_list',
      'task_update',
      'task_complete',
      'link',
      'unlink',
      'expand',
      'queue',
      'sync_push',
      'sync_status'
    ]) {
      expect(names).toContain(name);
    }
  }, 120_000);

  it('reports a workspace with compact output and the full report', async () => {
    const client = await connect();

    const reported = await tool(
      client,
      'workspace_report',
      hookReport({ path: '/home/ivo/wt/slice' })
    );
    expect(reported.isError).toBe(false);
    expect(Object.keys(reported.json).sort()).toEqual([
      'feature',
      'interrupted_sessions',
      'session_id',
      'session_status',
      'warnings',
      'workspace_id'
    ]);
    expect(reported.json).toMatchObject({
      session_status: 'running',
      feature: null,
      interrupted_sessions: 0,
      warnings: []
    });
    const workspaceId = reported.json.workspace_id as string;

    const full = await tool(client, 'workspace_report', {
      ...hookReport({ path: '/home/ivo/wt/slice' }),
      full_response: true
    });
    expect(full.isError).toBe(false);
    expect((full.json.workspace as Json).id).toBe(workspaceId);
    expect((full.json.session as Json).status).toBe('running');
  }, 120_000);

  it('links, looks up and unlinks a workspace with compact ids', async () => {
    const client = await connect();
    const featureId = await createFeatureId('Slice feature');

    const reported = await tool(
      client,
      'workspace_report',
      hookReport({ path: '/home/ivo/wt/link' })
    );
    const workspaceId = reported.json.workspace_id as string;

    const linked = await tool(client, 'workspace_link', {
      workspace_id: workspaceId,
      feature_id: featureId.slice(0, 8)
    });
    expect(linked).toEqual({
      isError: false,
      json: { workspace_id: workspaceId, feature_id: featureId }
    });

    const lookup = await tool(client, 'workspace_lookup', {
      machine: 'strongbad',
      path: '/home/ivo/wt/link/cli/src'
    });
    expect(lookup.json).toEqual({
      workspace_id: workspaceId,
      feature: {
        id: featureId,
        title: 'Slice feature',
        stage: 'building',
        pull_requests: []
      }
    });

    const none = await tool(client, 'workspace_lookup', {
      machine: 'strongbad',
      path: '/elsewhere'
    });
    expect(none).toEqual({
      isError: false,
      json: { workspace_id: null, feature: null }
    });

    const unlinked = await tool(client, 'workspace_link', {
      workspace_id: workspaceId,
      feature_id: null
    });
    expect(unlinked.json).toEqual({
      workspace_id: workspaceId,
      feature_id: null
    });
  }, 120_000);

  it('deletes a workspace only with the delete scope', async () => {
    const writer = await connect();
    const reported = await tool(
      writer,
      'workspace_report',
      hookReport({ path: '/home/ivo/wt/del' })
    );
    const workspaceId = reported.json.workspace_id as string;

    const denied = await tool(writer, 'workspace_delete', {
      workspace_id: workspaceId
    });
    expect(denied.isError).toBe(true);

    const deleter = await connect(['read', 'write', 'delete']);
    const deleted = await tool(deleter, 'workspace_delete', {
      workspace_id: workspaceId
    });
    expect(deleted).toEqual({
      isError: false,
      json: { deleted: true, workspace_id: workspaceId, path: '/home/ivo/wt/del' }
    });
  }, 120_000);

  it('moves a feature stage and attaches a pull request', async () => {
    const client = await connect();
    const featureId = await createFeatureId('Stage feature');

    const staged = await tool(client, 'feature_stage', {
      id: featureId.slice(0, 8),
      stage: 'functional_test'
    });
    expect(staged.json).toEqual({
      id: featureId,
      stage: 'functional_test',
      previous_stage: 'building'
    });

    await tool(client, 'feature_stage', { id: featureId, stage: 'building' });
    const pr = await tool(client, 'feature_pr', {
      id: featureId,
      url: 'https://github.com/ivo-toby/postgram/pull/7'
    });
    expect(pr.json).toEqual({
      id: featureId,
      stage: 'review',
      stage_changed: true
    });

    const again = await tool(client, 'feature_pr', {
      id: featureId,
      url: 'https://github.com/ivo-toby/postgram/pull/7',
      state: 'open'
    });
    expect(again.json).toEqual({
      id: featureId,
      stage: 'review',
      stage_changed: false
    });

    const invalid = await tool(client, 'feature_stage', {
      id: featureId,
      stage: 'shipped'
    });
    expect(invalid.isError).toBe(true);
    expect((invalid.json.error as Json).code).toBe('VALIDATION');
  }, 120_000);

  it('returns the where view with compact workspaces', async () => {
    const client = await connect();
    const featureId = await createFeatureId('Where feature');
    await tool(client, 'feature_stage', { id: featureId, stage: 'review' });
    await tool(
      client,
      'workspace_report',
      hookReport({ path: '/home/ivo/wt/where', featureId })
    );

    const actions = await tool(client, 'where', { view: 'actions' });
    expect(actions.isError).toBe(false);
    expect(actions.json.view).toBe('actions');
    expect(actions.json.dormant_after_days).toBe(30);
    const groups = actions.json.groups as Json[];
    expect(groups.map((g) => g.key)).toEqual([
      'review',
      'test',
      'merge',
      'release',
      'in_progress',
      'unassigned'
    ]);
    const feature = (groups[0]?.features as Json[])[0];
    expect(feature).toMatchObject({
      id: featureId,
      title: 'Where feature',
      stage: 'review'
    });
    expect(feature?.workspaces).toEqual([
      {
        machine: 'strongbad',
        connect_target: 'strongbad',
        path: '/home/ivo/wt/where',
        branch: 'feat/x',
        risks: ['unpushed'],
        resume_session: {
          agent_kind: 'claude-code',
          agent_session_id: 'sess-1',
          status: 'running',
          cwd: '/home/ivo/wt/where/cli'
        },
        latest_session: {
          agent_kind: 'claude-code',
          agent_session_id: 'sess-1',
          status: 'running'
        }
      }
    ]);

    const full = await tool(client, 'where', { full_response: true });
    const fullFeature = ((full.json.groups as Json[])[1]?.features as Json[])[0];
    const fullWorkspace = (fullFeature?.workspaces as Json[])[0];
    expect(fullWorkspace?.sessions).toHaveLength(1);
    expect(fullWorkspace?.git).toEqual({
      dirty_count: 0,
      unpushed_count: 2,
      has_upstream: true
    });

    const badView = await tool(client, 'where', { view: 'kanban' });
    expect(badView.isError).toBe(true);
    expect((badView.json.error as Json).code).toBe('VALIDATION');
  }, 120_000);

  it('denies a read-only key the workspace_report tool', async () => {
    const reader = await connect(['read']);
    const denied = await tool(
      reader,
      'workspace_report',
      hookReport({ path: '/home/ivo/wt/denied' })
    );
    expect(denied.isError).toBe(true);
    expect((denied.json.error as Json).code).toBe('FORBIDDEN');
  }, 120_000);

  it('keeps existing tools working after the helper move', async () => {
    const client = await connect();

    const stored = await tool(client, 'store', {
      type: 'memory',
      content: 'after helper move'
    });
    expect(stored.isError).toBe(false);
    const storedEntity = stored.json.entity as Json;
    expect(typeof storedEntity.id).toBe('string');
    expect(storedEntity.type).toBe('memory');

    const task = await tool(client, 'task_create', {
      content: 'Task after helper move'
    });
    expect(task.isError).toBe(false);
    const taskEntity = task.json.entity as Json;
    expect(typeof taskEntity.id).toBe('string');
    expect(taskEntity.type).toBe('task');
  }, 120_000);
});

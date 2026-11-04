import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createKey } from '../../src/auth/key-service.js';
import { createApp } from '../../src/index.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

type Json = Record<string, unknown>;

describe('createApp workspace and feature route wiring (slice w1)', () => {
  let database: TestDatabase | undefined;

  function db(): TestDatabase {
    if (!database) {
      throw new Error('test database not initialized');
    }
    return database;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 240_000);

  beforeEach(async () => {
    await resetTestDatabase(db().pool);
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  async function apiKey(): Promise<string> {
    const created = (
      await createKey(db().pool, {
        name: `wiring-${crypto.randomUUID()}`,
        scopes: ['read', 'write'],
        allowedTypes: null,
        allowedVisibility: ['personal', 'work', 'shared']
      })
    )._unsafeUnwrap();
    return created.plaintextKey;
  }

  async function call(
    app: ReturnType<typeof createApp>,
    key: string | null,
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ status: number; json: Json }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (key !== null) {
      headers.Authorization = `Bearer ${key}`;
    }
    const response = await app.request(path, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, json: (await response.json()) as Json };
  }

  it('passes workspaceDormantAfterDays to GET /api/where', async () => {
    const key = await apiKey();
    const app = createApp({
      pool: db().pool,
      workspaceDormantAfterDays: 5
    });

    const { status, json } = await call(app, key, 'GET', '/api/where');

    expect(status).toBe(200);
    expect(json.dormant_after_days).toBe(5);
  });

  it('defaults dormant_after_days to 30 when the option is omitted', async () => {
    const key = await apiKey();
    const app = createApp({ pool: db().pool });

    const { status, json } = await call(app, key, 'GET', '/api/where');

    expect(status).toBe(200);
    expect(json.dormant_after_days).toBe(30);
  });

  it('keeps existing routes answering', async () => {
    const key = await apiKey();
    const app = createApp({ pool: db().pool });

    const { status, json } = await call(app, key, 'GET', '/api/tasks');

    expect(status).toBe(200);
    expect(Array.isArray(json.items)).toBe(true);
  });

  it('registers the feature and workspace REST routes', async () => {
    const key = await apiKey();
    const app = createApp({
      pool: db().pool,
      workspaceDormantAfterDays: 5
    });

    const feature = await call(app, key, 'POST', '/api/features', {
      content: 'wiring feature',
      visibility: 'work'
    });
    expect(feature.status).toBe(201);
    expect(
      typeof (feature.json.entity as Json)?.content
    ).toBe('string');

    const report = await call(app, key, 'POST', '/api/workspaces/report', {
      source: 'hook',
      machine: {
        alias: 'strongbad',
        hostname: 'strongbad-host',
        boot_id: 'boot-a'
      },
      workspace: {
        path: '/home/ivo/src/postgram',
        repo_remote: 'git@github.com:Ivo-Toby/postgram.git',
        repo_root: '/home/ivo/src/postgram',
        branch: 'feat/x',
        git: { dirty_count: 0, unpushed_count: 0, has_upstream: true }
      },
      session: {
        agent_kind: 'claude-code',
        agent_session_id: 's-wiring',
        event: 'start',
        cwd: null,
        transcript_path: null
      }
    });
    expect(report.status).toBe(200);
  });
});

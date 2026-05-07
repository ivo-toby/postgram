import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { createKey } from '../../src/auth/key-service.js';
import { createApp } from '../../src/index.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase,
} from '../helpers/postgres.js';

describe('POST /api/documents/ingest', () => {
  let database: TestDatabase | undefined;
  let uploadsDir: string;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  afterAll(async () => {
    if (database) await database.close();
  });

  beforeEach(async () => {
    if (database) await resetTestDatabase(database.pool);
    uploadsDir = await mkdtemp(path.join(tmpdir(), 'pgm-uploads-'));
  });

  afterEach(async () => {
    await rm(uploadsDir, { recursive: true, force: true });
  });

  async function authenticatedApp() {
    if (!database) throw new Error('db missing');
    const created = (
      await createKey(database.pool, {
        name: `ingest-${crypto.randomUUID()}`,
        scopes: ['read', 'write'],
        allowedVisibility: ['shared', 'work'],
      })
    )._unsafeUnwrap();
    return {
      app: createApp({
        pool: database.pool,
        documentIngest: { uploadsDir },
      }),
      apiKey: created.plaintextKey,
    };
  }

  it('accepts a multipart upload and stashes the bytes in uploadsDir', async () => {
    const { app, apiKey } = await authenticatedApp();
    const form = new FormData();
    form.append(
      'file',
      new Blob([new TextEncoder().encode('hello pdf')], {
        type: 'application/pdf',
      }),
      'test.pdf',
    );
    form.append('visibility', 'shared');

    const res = await app.request('/api/documents/ingest', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { id: string; status: string; loading_status: string };
    expect(body.status).toBe('created');
    expect(body.loading_status).toBe('pending');

    const files = await readdir(uploadsDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.bin$/);

    const row = await database!.pool.query(
      `SELECT mime_type, source_uri, loading_status FROM entities WHERE id = $1`,
      [body.id],
    );
    expect(row.rows[0].mime_type).toBe('application/pdf');
    expect(row.rows[0].source_uri).toMatch(/^file:\/\/.*\.bin$/);
    expect(row.rows[0].loading_status).toBe('pending');
  });

  it('accepts a JSON URL ingest', async () => {
    const { app, apiKey } = await authenticatedApp();
    const res = await app.request('/api/documents/ingest', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://example.com/page.html',
        mime_type: 'text/html',
      }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { id: string };
    const row = await database!.pool.query(
      `SELECT source_uri FROM entities WHERE id = $1`,
      [body.id],
    );
    expect(row.rows[0].source_uri).toBe('https://example.com/page.html');
  });

  it('is idempotent on source_uri', async () => {
    const { app, apiKey } = await authenticatedApp();
    const post = () =>
      app.request('/api/documents/ingest', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: 'https://example.com/dup' }),
      });
    const a = (await (await post()).json()) as { id: string; status: string };
    const b = (await (await post()).json()) as { id: string; status: string };
    expect(a.status).toBe('created');
    expect(b.status).toBe('exists');
    expect(b.id).toBe(a.id);
  });

  it('handles concurrent ingests of the same URL without 5xx', async () => {
    const { app, apiKey } = await authenticatedApp();
    const url = `https://example.com/race-${crypto.randomUUID()}`;
    const post = () =>
      app.request('/api/documents/ingest', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => post()),
    );
    const bodies = await Promise.all(
      responses.map(async (r) => ({
        status: r.status,
        body: (await r.json()) as { id: string; status: string },
      })),
    );
    // Every response should be 2xx — none should leak a 5xx from a unique
    // index violation.
    for (const r of bodies) {
      expect(r.status).toBeLessThan(300);
    }
    // All return the same entity id.
    const ids = new Set(bodies.map((r) => r.body.id));
    expect(ids.size).toBe(1);
    // Exactly one is reported as 'created', all others 'exists'.
    const createds = bodies.filter((r) => r.body.status === 'created');
    expect(createds).toHaveLength(1);
  });

  it('returns 401 without an api key', async () => {
    if (!database) throw new Error('db missing');
    const app = createApp({
      pool: database.pool,
      documentIngest: { uploadsDir },
    });
    const res = await app.request('/api/documents/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/x' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 500 when ingest is not configured on the deployment', async () => {
    if (!database) throw new Error('db missing');
    const created = (
      await createKey(database.pool, {
        name: `unconfigured-${crypto.randomUUID()}`,
        scopes: ['read', 'write'],
      })
    )._unsafeUnwrap();
    const app = createApp({ pool: database.pool });
    const res = await app.request('/api/documents/ingest', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${created.plaintextKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: 'https://example.com/x' }),
    });
    expect(res.status).toBe(500);
  });
});

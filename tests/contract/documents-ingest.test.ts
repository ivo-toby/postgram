import { rm } from 'node:fs/promises';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { Readable } from 'node:stream';

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import type { AuthContext } from '../../src/auth/types.js';
import type { AttachmentStore } from '../../src/services/loaders/attachment-store.js';
import {
  INGEST_FORM_OVERHEAD_BYTES,
  registerRestRoutes
} from '../../src/transport/rest.js';
import {
  normalizeError,
  toErrorResponse,
  toHttpStatus
} from '../../src/util/errors.js';
import {
  createFakeRegistry,
  createTempStore,
  type TempStore
} from '../helpers/document-loaders.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

type Json = Record<string, unknown>;
type TestApp = Hono<{ Variables: { auth: AuthContext } }>;

const anyString = expect.any(String) as string;
const hex64 = expect.stringMatching(/^[0-9a-f]{64}$/) as string;
const MAX_BYTES = 2048;
const PDF = new TextEncoder().encode('%PDF-1.4 contract test bytes');

describe('document ingest REST routes', () => {
  let database: TestDatabase;
  let temp: TempStore;
  let auth: AuthContext;
  const registry = createFakeRegistry();

  function baseAuth(overrides: Partial<AuthContext> = {}): AuthContext {
    return {
      apiKeyId: null,
      keyName: 'docs-test',
      clientId: 'docs-test',
      scopes: ['read', 'write', 'delete'],
      allowedTypes: null,
      allowedVisibility: ['personal', 'work', 'shared'],
      ...overrides
    };
  }

  function buildApp(
    withLoaders: boolean,
    store: AttachmentStore = temp.store
  ): TestApp {
    const app: TestApp = new Hono();
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
    registerRestRoutes(app, database.pool, {
      documentLoaders: withLoaders
        ? { registry, attachmentStore: store, maxBytes: MAX_BYTES }
        : undefined
    });
    return app;
  }

  let app: TestApp;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 240_000);

  beforeEach(async () => {
    await resetTestDatabase(database.pool);
    temp = await createTempStore();
    auth = baseAuth();
    app = buildApp(true);
  });

  afterEach(async () => {
    await temp.cleanup();
  });

  afterAll(async () => {
    await database.close();
  });

  function form(
    fields: Record<string, string> = {},
    file: { bytes?: Uint8Array; name?: string; type?: string } | null = {}
  ): FormData {
    const fd = new FormData();
    if (file !== null) {
      fd.set(
        'file',
        new File([(file.bytes ?? PDF).slice()], file.name ?? 'doc.pdf', {
          type: file.type ?? 'application/pdf'
        })
      );
    }
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  }

  async function ingest(body: FormData, target: TestApp = app) {
    const res = await target.request('/api/documents/ingest', {
      method: 'POST',
      body
    });
    return { res, json: (await res.json()) as Json };
  }

  it('answers 202 for a new document and 200 for the same bytes again', async () => {
    const first = await ingest(form());
    expect(first.res.status).toBe(202);
    expect(first.json).toEqual({
      id: anyString,
      status: 'created',
      loading_status: 'pending'
    });

    const second = await ingest(form());
    expect(second.res.status).toBe(200);
    expect(second.json).toEqual({
      id: first.json.id,
      status: 'exists',
      loading_status: 'pending'
    });
  });

  it('applies the optional form fields', async () => {
    const { res, json } = await ingest(
      form({
        title: 'Quarterly report',
        visibility: 'work',
        owner: 'ivo',
        tags: 'a, b,,c',
        metadata: JSON.stringify({ source_system: 'drive' })
      })
    );
    expect(res.status).toBe(202);
    const row = (
      await database.pool.query<Record<string, unknown>>(
        'SELECT visibility, owner, tags, metadata, type, source FROM entities WHERE id = $1',
        [json.id]
      )
    ).rows[0];
    expect(row).toMatchObject({
      visibility: 'work',
      owner: 'ivo',
      tags: ['a', 'b', 'c'],
      type: 'document',
      source: 'ingest',
      metadata: {
        source_system: 'drive',
        title: 'Quarterly report',
        filename: 'doc.pdf'
      }
    });
  });

  it('honours mime_type over the part type', async () => {
    const { res, json } = await ingest(
      form(
        { mime_type: 'text/plain' },
        { name: 'x.bin', type: 'application/zip' }
      )
    );
    expect(res.status).toBe(202);
    const row = (
      await database.pool.query<{ mime_type: string }>(
        'SELECT mime_type FROM entities WHERE id = $1',
        [json.id]
      )
    ).rows[0]!;
    expect(row.mime_type).toBe('text/plain');
  });

  it('rejects invalid metadata with 400', async () => {
    for (const metadata of ['{not json', '[1,2]', '"str"', 'null', '7']) {
      const { res, json } = await ingest(form({ metadata }));
      expect(res.status).toBe(400);
      expect((json.error as Json).code).toBe('VALIDATION');
    }
    const n = await database.pool.query('SELECT COUNT(*) AS n FROM entities');
    expect(n.rows[0]).toEqual({ n: '0' });
  });

  it('rejects a missing file, a non-file file and a bad visibility with 400', async () => {
    expect((await ingest(form({}, null))).res.status).toBe(400);
    expect((await ingest(form({ visibility: 'secret' }))).res.status).toBe(400);
    const textFile = new FormData();
    textFile.set('file', 'just a string');
    expect((await ingest(textFile)).res.status).toBe(400);
  });

  it('rejects a body that is not multipart with 400', async () => {
    const res = await app.request('/api/documents/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    expect(res.status).toBe(400);
  });

  it('answers 413 when the upload is over the limit', async () => {
    const big = new Uint8Array(MAX_BYTES + 512).fill(65);
    const { res, json } = await ingest(form({}, { bytes: big }));
    expect(res.status).toBe(413);
    expect((json.error as Json).code).toBe('PAYLOAD_TOO_LARGE');
    const n = await database.pool.query('SELECT COUNT(*) AS n FROM entities');
    expect(n.rows[0]).toEqual({ n: '0' });
  });

  it('answers 415 with the accepted types when no loader matches', async () => {
    const { res, json } = await ingest(
      form({}, { name: 'a.zip', type: 'application/zip' })
    );
    expect(res.status).toBe(415);
    const error = json.error as Json;
    expect(error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect((error.details as Json).accepted).toEqual({
      mime_types: ['application/pdf', 'text/plain'],
      extensions: ['.pdf', '.txt']
    });
    const n = await database.pool.query('SELECT COUNT(*) AS n FROM entities');
    expect(n.rows[0]).toEqual({ n: '0' });
  });

  it('answers 403 without the write scope', async () => {
    auth = baseAuth({ scopes: ['read'] });
    const { res } = await ingest(form());
    expect(res.status).toBe(403);
  });

  it('answers 503 for ingest, and 404 for the read routes, when loaders are not configured', async () => {
    const off = buildApp(false);
    const { res, json } = await ingest(form(), off);
    expect(res.status).toBe(503);
    expect((json.error as Json).code).toBe('UNAVAILABLE');

    const id = '00000000-0000-4000-8000-000000000000';
    expect((await off.request(`/api/entities/${id}/attachments`)).status).toBe(
      404
    );
    expect((await off.request(`/api/attachments/${id}/content`)).status).toBe(
      404
    );
  });

  describe('size limit', () => {
    it('accepts a file of exactly maxBytes (multipart overhead is allowed for)', async () => {
      const exact = new Uint8Array(MAX_BYTES).fill(66);
      const { res } = await ingest(form({}, { bytes: exact }));
      expect(res.status).toBe(202);
    });

    it('rejects a file of maxBytes + 1 with 413', async () => {
      const over = new Uint8Array(MAX_BYTES + 1).fill(67);
      const { res, json } = await ingest(form({}, { bytes: over }));
      expect(res.status).toBe(413);
      expect((json.error as Json).code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('rejects a body above maxBytes plus the form allowance with 413', async () => {
      const huge = new Uint8Array(
        MAX_BYTES + INGEST_FORM_OVERHEAD_BYTES + 1024
      );
      const { res, json } = await ingest(form({}, { bytes: huge }));
      expect(res.status).toBe(413);
      expect((json.error as Json).code).toBe('PAYLOAD_TOO_LARGE');
      const n = await database.pool.query('SELECT COUNT(*) AS n FROM entities');
      expect(n.rows[0]).toEqual({ n: '0' });
    });
  });

  it('rejects an empty file with 400', async () => {
    const { res, json } = await ingest(form({}, { bytes: new Uint8Array(0) }));
    expect(res.status).toBe(400);
    expect((json.error as Json).code).toBe('VALIDATION');
    const n = await database.pool.query('SELECT COUNT(*) AS n FROM entities');
    expect(n.rows[0]).toEqual({ n: '0' });
  });

  it('answers 500, not 404, when the file cannot be opened for another reason than ENOENT', async () => {
    const { json } = await ingest(form());
    const attId = (
      await database.pool.query<{ id: string }>('SELECT id FROM attachments')
    ).rows[0]!.id;
    const broken = Object.assign(Object.create(temp.store) as AttachmentStore, {
      openReadStream: () => {
        const stream = new Readable({ read() {} });
        process.nextTick(() =>
          stream.destroy(
            Object.assign(new Error('permission denied'), { code: 'EACCES' })
          )
        );
        return stream;
      }
    });
    const res = await buildApp(true, broken).request(
      `/api/attachments/${attId}/content`
    );
    expect(res.status).toBe(500);
    expect(json.id).toBeDefined();
  });

  describe('attachments', () => {
    const NAME = 'Résumé – 日本 "v2".pdf';

    async function ingestOne(fields: Record<string, string> = {}) {
      const { json } = await ingest(form(fields, { name: NAME }));
      const entityId = json.id as string;
      const list = await app.request(`/api/entities/${entityId}/attachments`);
      const body = (await list.json()) as { attachments: Json[] };
      return { entityId, list, body };
    }

    it('lists attachments without the storage uri', async () => {
      const { entityId, list, body } = await ingestOne();
      expect(list.status).toBe(200);
      expect(body.attachments).toHaveLength(1);
      const att = body.attachments[0]!;
      expect(att).toEqual({
        id: anyString,
        entity_id: entityId,
        role: 'original',
        ref: 'original',
        kind: 'document',
        mime_type: 'application/pdf',
        filename: NAME,
        byte_size: PDF.byteLength,
        sha256: hex64,
        created_at: anyString
      });
      expect(JSON.stringify(body)).not.toContain('storage_uri');
    });

    it('streams the exact bytes with safe headers and a non-ASCII filename', async () => {
      const { body } = await ingestOne();
      const id = body.attachments[0]!.id as string;
      const res = await app.request(`/api/attachments/${id}/content`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
      expect(res.headers.get('content-length')).toBe(String(PDF.byteLength));
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');

      const disposition = res.headers.get('content-disposition') ?? '';
      expect(disposition.startsWith('attachment;')).toBe(true);
      const fallback = /filename="([^"]*)"/.exec(disposition);
      expect(fallback).not.toBeNull();
      expect(fallback![1]).toMatch(/^[\x20-\x7e]*$/);
      expect(fallback![1]).not.toContain('"');
      expect(disposition).toContain(
        `filename*=UTF-8''${encodeURIComponent(NAME).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`
      );

      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(Buffer.from(bytes).equals(Buffer.from(PDF))).toBe(true);
    });

    it('applies entity access rules to list and download', async () => {
      const { entityId, body } = await ingestOne({ visibility: 'personal' });
      const id = body.attachments[0]!.id as string;

      auth = baseAuth({ allowedVisibility: ['shared'] });
      expect(
        (await app.request(`/api/entities/${entityId}/attachments`)).status
      ).toBe(403);
      expect((await app.request(`/api/attachments/${id}/content`)).status).toBe(
        403
      );

      auth = baseAuth({ scopes: ['write'] });
      expect(
        (await app.request(`/api/entities/${entityId}/attachments`)).status
      ).toBe(403);
      expect((await app.request(`/api/attachments/${id}/content`)).status).toBe(
        403
      );

      auth = baseAuth({ allowedTypes: ['memory'] });
      expect(
        (await app.request(`/api/entities/${entityId}/attachments`)).status
      ).toBe(403);
      expect((await app.request(`/api/attachments/${id}/content`)).status).toBe(
        403
      );
    });

    it('answers 404 for unknown and malformed attachment ids', async () => {
      const id = '00000000-0000-4000-8000-000000000000';
      expect(
        (await app.request(`/api/entities/${id}/attachments`)).status
      ).toBe(404);
      expect((await app.request(`/api/attachments/${id}/content`)).status).toBe(
        404
      );
      expect(
        (await app.request('/api/attachments/not-a-uuid/content')).status
      ).toBe(404);
    });

    it('answers 404 and does not crash when the file is missing on disk', async () => {
      const { body } = await ingestOne();
      const id = body.attachments[0]!.id as string;
      await rm(temp.root, { recursive: true, force: true });
      const res = await app.request(`/api/attachments/${id}/content`);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: Json }).error.code).toBe(
        'NOT_FOUND'
      );
    });
  });

  it('shows the loading fields on entity responses only when set', async () => {
    const { json } = await ingest(form());
    await database.pool.query(
      "UPDATE entities SET loader_name = 'fake', loading_error = 'e' WHERE id = $1",
      [json.id]
    );
    const doc = (await (
      await app.request(`/api/entities/${json.id as string}`)
    ).json()) as {
      entity: Json;
    };
    expect(doc.entity).toMatchObject({
      mime_type: 'application/pdf',
      loading_status: 'pending',
      loading_error: 'e',
      loader_name: 'fake'
    });

    const created = await app.request('/api/entities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'memory', content: 'plain' })
    });
    const mem = ((await created.json()) as { entity: Json }).entity;
    for (const key of [
      'mime_type',
      'loading_status',
      'loading_error',
      'loader_name'
    ]) {
      expect(mem).not.toHaveProperty(key);
    }
  });
});

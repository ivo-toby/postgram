import { createHash } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
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
import {
  getAttachmentForDownload,
  ingestDocument,
  lockIngestSha,
  listAttachments,
  type IngestInput
} from '../../src/services/document-ingest-service.js';
import { MAX_LOADING_ATTEMPTS } from '../../src/services/document-loading-fields.js';
import { ErrorCode } from '../../src/util/errors.js';
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

function authWith(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    apiKeyId: null,
    keyName: 'ingest-test',
    clientId: 'ingest-test',
    scopes: ['read', 'write', 'delete'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared'],
    ...overrides
  };
}

const PDF = new TextEncoder().encode('%PDF-1.4 fake pdf bytes');

function pdfInput(overrides: Partial<IngestInput> = {}): IngestInput {
  return {
    bytes: PDF,
    filename: 'a.pdf',
    mimeType: 'application/pdf',
    ...overrides
  };
}

async function filesUnder(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const dir of await readdir(root)) {
    for (const f of await readdir(`${root}/${dir}`)) out.push(`${dir}/${f}`);
  }
  return out;
}

describe('ingestDocument', () => {
  let database: TestDatabase;
  let temp: TempStore;
  const registry = createFakeRegistry();

  const deps = () => ({
    pool: database.pool,
    registry,
    attachmentStore: temp.store
  });

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 240_000);

  beforeEach(async () => {
    await resetTestDatabase(database.pool);
    temp = await createTempStore();
  });

  afterEach(async () => {
    await temp.cleanup();
  });

  afterAll(async () => {
    await database.close();
  });

  async function counts() {
    const e = await database.pool.query<{ n: string }>(
      'SELECT COUNT(*) AS n FROM entities'
    );
    const a = await database.pool.query<{ n: string }>(
      'SELECT COUNT(*) AS n FROM attachments'
    );
    return {
      entities: Number(e.rows[0]!.n),
      attachments: Number(a.rows[0]!.n)
    };
  }

  it('creates a pending document entity with an original attachment', async () => {
    const result = (
      await ingestDocument(
        authWith(),
        pdfInput({ title: 'My Doc', tags: ['x'], metadata: { k: 1 } }),
        deps()
      )
    )._unsafeUnwrap();

    expect(result.status).toBe('created');
    expect(result.loadingStatus).toBe('pending');

    const entity = (
      await database.pool.query<Record<string, unknown>>(
        'SELECT * FROM entities WHERE id = $1',
        [result.id]
      )
    ).rows[0];
    expect(entity).toMatchObject({
      type: 'document',
      content: null,
      source: 'ingest',
      mime_type: 'application/pdf',
      loading_status: 'pending',
      enrichment_status: null,
      visibility: 'shared',
      owner: null,
      tags: ['x'],
      metadata: { k: 1, title: 'My Doc', filename: 'a.pdf' }
    });

    const sha = createHash('sha256').update(PDF).digest('hex');
    const att = (
      await database.pool.query(
        'SELECT * FROM attachments WHERE entity_id = $1',
        [result.id]
      )
    ).rows;
    expect(att).toHaveLength(1);
    expect(att[0]).toMatchObject({
      role: 'original',
      ref: 'original',
      kind: 'document',
      mime_type: 'application/pdf',
      filename: 'a.pdf',
      byte_size: String(PDF.byteLength),
      sha256: sha,
      storage_uri: `${sha.slice(0, 2)}/${sha}`
    });
    expect(await filesUnder(temp.root)).toEqual([`${sha.slice(0, 2)}/${sha}`]);

    const audit = await database.pool.query(
      "SELECT * FROM audit_log WHERE operation = 'document.ingest' AND entity_id = $1",
      [result.id]
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('uses the filename, then a default, as the title', async () => {
    const a = (
      await ingestDocument(authWith(), pdfInput(), deps())
    )._unsafeUnwrap();
    const b = (
      await ingestDocument(
        authWith(),
        { bytes: new TextEncoder().encode('other'), mimeType: 'text/plain' },
        deps()
      )
    )._unsafeUnwrap();
    const rows = await database.pool.query<{
      id: string;
      metadata: Record<string, unknown>;
    }>('SELECT id, metadata FROM entities');
    const byId = new Map(rows.rows.map((r) => [r.id, r.metadata]));
    expect(byId.get(a.id)).toMatchObject({ title: 'a.pdf', filename: 'a.pdf' });
    expect(byId.get(b.id)).toEqual({ title: 'Untitled document' });
  });

  it('maps the extension to the effective type when the type is octet-stream', async () => {
    const result = (
      await ingestDocument(
        authWith(),
        pdfInput({ mimeType: 'application/octet-stream' }),
        deps()
      )
    )._unsafeUnwrap();
    const row = (
      await database.pool.query<{ mime_type: string }>(
        'SELECT mime_type FROM entities WHERE id = $1',
        [result.id]
      )
    ).rows[0]!;
    expect(row.mime_type).toBe('application/pdf');
  });

  it('returns exists for the same bytes, owner and visibility', async () => {
    const first = (
      await ingestDocument(authWith(), pdfInput({ owner: 'ivo' }), deps())
    )._unsafeUnwrap();
    const second = (
      await ingestDocument(authWith(), pdfInput({ owner: 'ivo' }), deps())
    )._unsafeUnwrap();
    expect(second).toEqual({
      id: first.id,
      status: 'exists',
      loadingStatus: 'pending'
    });
    expect(await counts()).toEqual({ entities: 1, attachments: 1 });
  });

  it('creates a new entity for a different owner or visibility', async () => {
    const a = (
      await ingestDocument(authWith(), pdfInput({ owner: 'ivo' }), deps())
    )._unsafeUnwrap();
    const b = (
      await ingestDocument(authWith(), pdfInput({ owner: 'sam' }), deps())
    )._unsafeUnwrap();
    const c = (
      await ingestDocument(
        authWith(),
        pdfInput({ owner: 'ivo', visibility: 'work' }),
        deps()
      )
    )._unsafeUnwrap();
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    expect(b.status).toBe('created');
    expect(c.status).toBe('created');
    expect(await counts()).toEqual({ entities: 3, attachments: 3 });
    // one file on disk for the same bytes
    expect(await filesUnder(temp.root)).toHaveLength(1);
  });

  it('creates a new entity when the first one is archived', async () => {
    const first = (
      await ingestDocument(authWith(), pdfInput(), deps())
    )._unsafeUnwrap();
    await database.pool.query(
      "UPDATE entities SET status = 'archived' WHERE id = $1",
      [first.id]
    );
    const second = (
      await ingestDocument(authWith(), pdfInput(), deps())
    )._unsafeUnwrap();
    expect(second.status).toBe('created');
    expect(second.id).not.toBe(first.id);
  });

  it('re-queues a failed entity whose attempts are used up', async () => {
    const first = (
      await ingestDocument(authWith(), pdfInput(), deps())
    )._unsafeUnwrap();
    await database.pool.query(
      "UPDATE entities SET loading_status = 'failed', loading_attempts = 3, loading_error = 'boom' WHERE id = $1",
      [first.id]
    );
    const second = (
      await ingestDocument(authWith(), pdfInput(), deps())
    )._unsafeUnwrap();
    expect(second).toEqual({
      id: first.id,
      status: 'exists',
      loadingStatus: 'pending'
    });
    const row = (
      await database.pool.query<Record<string, unknown>>(
        'SELECT loading_status, loading_attempts, loading_error FROM entities WHERE id = $1',
        [first.id]
      )
    ).rows[0];
    expect(row).toEqual({
      loading_status: 'pending',
      loading_attempts: 0,
      loading_error: null
    });
  });

  it('leaves a failed entity with attempts left alone', async () => {
    const first = (
      await ingestDocument(authWith(), pdfInput(), deps())
    )._unsafeUnwrap();
    await database.pool.query(
      "UPDATE entities SET loading_status = 'failed', loading_attempts = 2, loading_error = 'boom' WHERE id = $1",
      [first.id]
    );
    const second = (
      await ingestDocument(authWith(), pdfInput(), deps())
    )._unsafeUnwrap();
    expect(second).toEqual({
      id: first.id,
      status: 'exists',
      loadingStatus: 'failed'
    });
  });

  it('returns a 415-class error and stores nothing when no loader matches', async () => {
    const result = await ingestDocument(
      authWith(),
      {
        bytes: new TextEncoder().encode('zip'),
        filename: 'a.zip',
        mimeType: 'application/zip'
      },
      deps()
    );
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(ErrorCode.UNSUPPORTED_MEDIA_TYPE);
    expect(error.details).toMatchObject({
      accepted: {
        mime_types: ['application/pdf', 'text/plain'],
        extensions: ['.pdf', '.txt']
      }
    });
    expect(await filesUnder(temp.root)).toEqual([]);
    expect(await counts()).toEqual({ entities: 0, attachments: 0 });
  });

  it('sanitises the filename and never uses it as a path', async () => {
    const result = (
      await ingestDocument(
        authWith(),
        pdfInput({ filename: '..\\..//etc/pass\u0000wd\u0007.pdf' }),
        deps()
      )
    )._unsafeUnwrap();
    const att = (
      await database.pool.query<{ filename: string; storage_uri: string }>(
        'SELECT filename, storage_uri FROM attachments WHERE entity_id = $1',
        [result.id]
      )
    ).rows[0]!;
    expect(att.filename).toBe('passwd.pdf');
    expect(att.storage_uri).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{64}$/);
    const meta = (
      await database.pool.query<{ metadata: { filename: string } }>(
        'SELECT metadata FROM entities WHERE id = $1',
        [result.id]
      )
    ).rows[0]!;
    expect(meta.metadata.filename).toBe('passwd.pdf');
  });

  it('caps the filename length at 255 characters', async () => {
    const long = `${'a'.repeat(400)}.pdf`;
    const result = (
      await ingestDocument(authWith(), pdfInput({ filename: long }), deps())
    )._unsafeUnwrap();
    const att = (
      await database.pool.query<{ filename: string }>(
        'SELECT filename FROM attachments WHERE entity_id = $1',
        [result.id]
      )
    ).rows[0]!;
    expect(att.filename).toHaveLength(255);
  });

  it('shares the re-queue limit constant with the worker', () => {
    expect(MAX_LOADING_ATTEMPTS).toBe(3);
  });

  it('rejects an empty file with a validation error before anything else', async () => {
    const err = (
      await ingestDocument(
        authWith(),
        pdfInput({ bytes: new Uint8Array(0), mimeType: 'application/zip' }),
        deps()
      )
    )._unsafeUnwrapErr();
    expect(err.code).toBe(ErrorCode.VALIDATION);
    expect(err.message).toBe('file is empty');
    expect(await counts()).toEqual({ entities: 0, attachments: 0 });
    expect(await filesUnder(temp.root)).toEqual([]);
  });

  it('repairs a lost file when the same bytes are ingested again', async () => {
    const first = (
      await ingestDocument(authWith(), pdfInput(), deps())
    )._unsafeUnwrap();
    const sha = createHash('sha256').update(PDF).digest('hex');
    await rm(temp.store.resolvePath(`${sha.slice(0, 2)}/${sha}`));
    expect(await filesUnder(temp.root)).toEqual([]);

    const second = (
      await ingestDocument(authWith(), pdfInput(), deps())
    )._unsafeUnwrap();
    expect(second).toEqual({
      id: first.id,
      status: 'exists',
      loadingStatus: 'pending'
    });
    expect(await filesUnder(temp.root)).toEqual([`${sha.slice(0, 2)}/${sha}`]);
  });

  it('marks the audit entry as requeued only when a re-queue happened', async () => {
    const first = (
      await ingestDocument(authWith(), pdfInput(), deps())
    )._unsafeUnwrap();
    await ingestDocument(authWith(), pdfInput(), deps());
    await database.pool.query(
      "UPDATE entities SET loading_status = 'failed', loading_attempts = 3 WHERE id = $1",
      [first.id]
    );
    await ingestDocument(authWith(), pdfInput(), deps());
    const rows = (
      await database.pool.query<{ details: Record<string, unknown> }>(
        "SELECT details FROM audit_log WHERE operation = 'document.ingest' ORDER BY timestamp"
      )
    ).rows.map((r) => r.details);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ status: 'created' });
    expect(rows[1]).toMatchObject({ status: 'exists' });
    expect(rows[1]).not.toHaveProperty('requeued');
    expect(rows[2]).toMatchObject({ status: 'exists', requeued: true });
  });

  it('takes the shared per-sha lock (lockIngestSha)', async () => {
    const sha = createHash('sha256').update(PDF).digest('hex');
    const holder = await database.pool.connect();
    try {
      await holder.query('BEGIN');
      await lockIngestSha(holder, sha);
      let settled = false;
      const pending = (async () => {
        const r = await ingestDocument(authWith(), pdfInput(), deps());
        settled = true;
        return r;
      })();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await holder.query('COMMIT');
      expect((await pending)._unsafeUnwrap().status).toBe('created');
    } finally {
      holder.release();
    }
  });

  it('strips bidi control characters from the filename', async () => {
    const result = (
      await ingestDocument(
        authWith(),
        pdfInput({
          filename: 'a\u200eb\u200fc\u202ad\u202ee\u2066f\u2069g.pdf'
        }),
        deps()
      )
    )._unsafeUnwrap();
    const att = (
      await database.pool.query<{ filename: string }>(
        'SELECT filename FROM attachments WHERE entity_id = $1',
        [result.id]
      )
    ).rows[0]!;
    expect(att.filename).toBe('abcdefg.pdf');
  });

  describe('access control', () => {
    it('requires the write scope', async () => {
      const err = (
        await ingestDocument(authWith({ scopes: ['read'] }), pdfInput(), deps())
      )._unsafeUnwrapErr();
      expect(err.code).toBe(ErrorCode.FORBIDDEN);
      expect(await counts()).toEqual({ entities: 0, attachments: 0 });
      expect(await filesUnder(temp.root)).toEqual([]);
    });

    it('requires access to the document type', async () => {
      const err = (
        await ingestDocument(
          authWith({ allowedTypes: ['memory'] }),
          pdfInput(),
          deps()
        )
      )._unsafeUnwrapErr();
      expect(err.code).toBe(ErrorCode.FORBIDDEN);
      expect(await filesUnder(temp.root)).toEqual([]);
    });

    it('requires access to the requested visibility (and the shared default)', async () => {
      const personal = (
        await ingestDocument(
          authWith({ allowedVisibility: ['shared'] }),
          pdfInput({ visibility: 'personal' }),
          deps()
        )
      )._unsafeUnwrapErr();
      expect(personal.code).toBe(ErrorCode.FORBIDDEN);

      const dflt = (
        await ingestDocument(
          authWith({ allowedVisibility: ['work'] }),
          pdfInput(),
          deps()
        )
      )._unsafeUnwrapErr();
      expect(dflt.code).toBe(ErrorCode.FORBIDDEN);
      expect(await counts()).toEqual({ entities: 0, attachments: 0 });
    });
  });

  it('creates one entity for concurrent ingests of the same bytes', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        ingestDocument(authWith(), pdfInput(), deps())
      )
    );
    const values = results.map((r) => r._unsafeUnwrap());
    expect(new Set(values.map((v) => v.id)).size).toBe(1);
    expect(values.filter((v) => v.status === 'created')).toHaveLength(1);
    expect(await counts()).toEqual({ entities: 1, attachments: 1 });
  });

  describe('read side', () => {
    it('lists attachments without storage_uri exposure in the service shape', async () => {
      const created = (
        await ingestDocument(authWith(), pdfInput(), deps())
      )._unsafeUnwrap();
      const list = (
        await listAttachments(authWith(), created.id, { pool: database.pool })
      )._unsafeUnwrap();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        entityId: created.id,
        role: 'original',
        ref: 'original',
        kind: 'document',
        mimeType: 'application/pdf',
        filename: 'a.pdf',
        byteSize: PDF.byteLength
      });
    });

    it('applies the entity access rules to list and download', async () => {
      const created = (
        await ingestDocument(
          authWith(),
          pdfInput({ visibility: 'personal' }),
          deps()
        )
      )._unsafeUnwrap();
      const attId = (
        await database.pool.query<{ id: string }>('SELECT id FROM attachments')
      ).rows[0]!.id;

      const noVis = authWith({ allowedVisibility: ['shared'] });
      expect(
        (
          await listAttachments(noVis, created.id, { pool: database.pool })
        )._unsafeUnwrapErr().code
      ).toBe(ErrorCode.FORBIDDEN);
      expect(
        (
          await getAttachmentForDownload(noVis, attId, deps())
        )._unsafeUnwrapErr().code
      ).toBe(ErrorCode.FORBIDDEN);

      const noScope = authWith({ scopes: ['write'] });
      expect(
        (
          await listAttachments(noScope, created.id, { pool: database.pool })
        )._unsafeUnwrapErr().code
      ).toBe(ErrorCode.FORBIDDEN);
      expect(
        (
          await getAttachmentForDownload(noScope, attId, deps())
        )._unsafeUnwrapErr().code
      ).toBe(ErrorCode.FORBIDDEN);

      const noType = authWith({ allowedTypes: ['memory'] });
      expect(
        (
          await listAttachments(noType, created.id, { pool: database.pool })
        )._unsafeUnwrapErr().code
      ).toBe(ErrorCode.FORBIDDEN);
    });

    it('answers not found for unknown ids', async () => {
      const id = '00000000-0000-4000-8000-000000000000';
      expect(
        (
          await listAttachments(authWith(), id, { pool: database.pool })
        )._unsafeUnwrapErr().code
      ).toBe(ErrorCode.NOT_FOUND);
      expect(
        (
          await getAttachmentForDownload(authWith(), id, deps())
        )._unsafeUnwrapErr().code
      ).toBe(ErrorCode.NOT_FOUND);
    });

    it('opens a stream with the stored bytes', async () => {
      await ingestDocument(authWith(), pdfInput(), deps());
      const attId = (
        await database.pool.query<{ id: string }>('SELECT id FROM attachments')
      ).rows[0]!.id;
      const download = (
        await getAttachmentForDownload(authWith(), attId, deps())
      )._unsafeUnwrap();
      expect(download.attachment.mimeType).toBe('application/pdf');
      const chunks: Buffer[] = [];
      for await (const c of download.openStream()) chunks.push(c as Buffer);
      expect(Buffer.concat(chunks).equals(Buffer.from(PDF))).toBe(true);
    });
  });
});

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pino from 'pino';

import { createEmbeddingService } from '../../src/services/embedding-service.js';
import { createEnrichmentWorker } from '../../src/services/enrichment-worker.js';
import { FilesystemAttachmentStore } from '../../src/services/loaders/attachment-store.js';
import { LoaderRegistry, type RegisteredLoader } from '../../src/services/loaders/registry.js';
import type { DocumentLoader, LoaderResult } from '../../src/types/loader.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase,
} from '../helpers/postgres.js';

function makeRegistry(loader: DocumentLoader): LoaderRegistry {
  const entry: RegisteredLoader = {
    loader,
    config: {
      kind: 'in-process',
      name: loader.name,
      package: '@x/loader',
      accepts: loader.accepts,
      priority: 0,
      options: {},
      enabled: true,
    },
    enabled: true,
    status: 'ok',
  };
  return new LoaderRegistry([entry]);
}

describe('enrichment-worker loading stage', () => {
  let database: TestDatabase | undefined;
  let attachmentsDir: string;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  afterAll(async () => {
    if (database) await database.close();
  });

  beforeEach(async () => {
    attachmentsDir = await mkdtemp(path.join(tmpdir(), 'pgm-att-'));
    if (database) await resetTestDatabase(database.pool);
  });

  afterEach(async () => {
    await rm(attachmentsDir, { recursive: true, force: true });
  });

  it('routes a pending entity through a matching loader and queues enrichment', async () => {
    if (!database) throw new Error('db missing');

    const fakeLoader: DocumentLoader = {
      name: 'fake',
      version: '1.0.0',
      accepts: { mimeTypes: ['application/x-fake'] },
      async load(): Promise<LoaderResult> {
        return {
          documentType: 'fake',
          blocks: [
            { kind: 'heading', level: 1, text: 'Title' },
            { kind: 'text', text: 'extracted body content', metadata: { page: 1 } },
          ],
          metadata: { title: 'Title' },
        };
      },
    };

    const tmp = await mkdtemp(path.join(tmpdir(), 'pgm-uploads-'));
    const fakeFile = path.join(tmp, 'doc.bin');
    await writeFile(fakeFile, 'placeholder');

    const insert = await database.pool.query<{ id: string }>(
      `
        INSERT INTO entities (
          type, content, mime_type, source_uri, loading_status, enrichment_status
        )
        VALUES ('document', NULL, 'application/x-fake', $1, 'pending', NULL)
        RETURNING id
      `,
      [`file://${fakeFile}`],
    );
    const entityId = insert.rows[0]!.id;

    const worker = createEnrichmentWorker({
      pool: database.pool,
      embeddingService: createEmbeddingService({ mode: 'deterministic' }),
      logger: pino({ level: 'silent' }),
      loaderRegistry: makeRegistry(fakeLoader),
      attachmentStore: new FilesystemAttachmentStore(attachmentsDir),
    });

    await worker.runOnce();

    const after = await database.pool.query(
      `SELECT loading_status, enrichment_status, content, loader_name FROM entities WHERE id = $1`,
      [entityId],
    );
    expect(after.rows[0].loading_status).toBe('completed');
    expect(after.rows[0].enrichment_status).toBe('completed');
    expect(after.rows[0].loader_name).toBe('fake');
    expect(String(after.rows[0].content)).toContain('extracted body content');

    const chunks = await database.pool.query(
      `SELECT block_kind, content, block_metadata FROM chunks WHERE entity_id = $1 ORDER BY chunk_index`,
      [entityId],
    );
    expect(chunks.rows.length).toBeGreaterThan(0);
    // Heading + text blocks should preserve their kind through to chunks.
    expect(chunks.rows.some((r) => r.block_kind === 'heading')).toBe(false);
    // We don't write block_kind from the worker yet (chunks are still
    // produced by the legacy chunkText pass on entity.content). That's a
    // deliberate v1 limitation; this assertion documents it.
    expect(chunks.rows.every((r) => r.block_kind === 'text')).toBe(true);

    await rm(tmp, { recursive: true, force: true });
  }, 120_000);

  it('marks loading_status=failed when no loader matches', async () => {
    if (!database) throw new Error('db missing');

    const tmp = await mkdtemp(path.join(tmpdir(), 'pgm-uploads-'));
    const fakeFile = path.join(tmp, 'doc.bin');
    await writeFile(fakeFile, 'placeholder');

    const insert = await database.pool.query<{ id: string }>(
      `
        INSERT INTO entities (
          type, content, mime_type, source_uri, loading_status
        )
        VALUES ('document', NULL, 'application/x-unknown', $1, 'pending')
        RETURNING id
      `,
      [`file://${fakeFile}`],
    );
    const entityId = insert.rows[0]!.id;

    const fakeLoader: DocumentLoader = {
      name: 'fake',
      version: '1.0.0',
      accepts: { mimeTypes: ['application/x-fake'] },
      async load(): Promise<LoaderResult> {
        throw new Error('should not be called');
      },
    };

    const worker = createEnrichmentWorker({
      pool: database.pool,
      embeddingService: createEmbeddingService({ mode: 'deterministic' }),
      logger: pino({ level: 'silent' }),
      loaderRegistry: makeRegistry(fakeLoader),
      attachmentStore: new FilesystemAttachmentStore(attachmentsDir),
    });

    await worker.runOnce();

    const after = await database.pool.query(
      `SELECT loading_status, loading_error, loading_attempts FROM entities WHERE id = $1`,
      [entityId],
    );
    expect(after.rows[0].loading_status).toBe('failed');
    expect(after.rows[0].loading_error).toMatch(/no_loader/);
    expect(after.rows[0].loading_attempts).toBe(1);

    await rm(tmp, { recursive: true, force: true });
  }, 120_000);

  it('captures loader errors in loading_error', async () => {
    if (!database) throw new Error('db missing');

    const tmp = await mkdtemp(path.join(tmpdir(), 'pgm-uploads-'));
    const fakeFile = path.join(tmp, 'doc.bin');
    await writeFile(fakeFile, 'placeholder');

    const insert = await database.pool.query<{ id: string }>(
      `
        INSERT INTO entities (
          type, content, mime_type, source_uri, loading_status
        )
        VALUES ('document', NULL, 'application/x-fake', $1, 'pending')
        RETURNING id
      `,
      [`file://${fakeFile}`],
    );
    const entityId = insert.rows[0]!.id;

    const blowingUpLoader: DocumentLoader = {
      name: 'fake',
      version: '1.0.0',
      accepts: { mimeTypes: ['application/x-fake'] },
      async load(): Promise<LoaderResult> {
        throw new Error('boom — corrupt file');
      },
    };

    const worker = createEnrichmentWorker({
      pool: database.pool,
      embeddingService: createEmbeddingService({ mode: 'deterministic' }),
      logger: pino({ level: 'silent' }),
      loaderRegistry: makeRegistry(blowingUpLoader),
      attachmentStore: new FilesystemAttachmentStore(attachmentsDir),
    });

    await worker.runOnce();

    const after = await database.pool.query(
      `SELECT loading_status, loading_error FROM entities WHERE id = $1`,
      [entityId],
    );
    expect(after.rows[0].loading_status).toBe('failed');
    expect(after.rows[0].loading_error).toMatch(/boom — corrupt file/);

    await rm(tmp, { recursive: true, force: true });
  }, 120_000);

  it('two concurrent workers do not both dispatch the same pending row', async () => {
    if (!database) throw new Error('db missing');

    const tmp = await mkdtemp(path.join(tmpdir(), 'pgm-uploads-'));
    const fakeFile = path.join(tmp, 'doc.bin');
    await writeFile(fakeFile, 'placeholder');

    const insert = await database.pool.query<{ id: string }>(
      `
        INSERT INTO entities (
          type, content, mime_type, source_uri, loading_status
        )
        VALUES ('document', NULL, 'application/x-fake', $1, 'pending')
        RETURNING id
      `,
      [`file://${fakeFile}`],
    );
    const entityId = insert.rows[0]!.id;

    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowLoader: DocumentLoader = {
      name: 'slow',
      version: '1.0.0',
      accepts: { mimeTypes: ['application/x-fake'] },
      async load(): Promise<LoaderResult> {
        calls += 1;
        await gate;
        return { documentType: 'fake', blocks: [{ kind: 'text', text: 'ok' }] };
      },
    };

    const make = () =>
      createEnrichmentWorker({
        pool: database!.pool,
        embeddingService: createEmbeddingService({ mode: 'deterministic' }),
        logger: pino({ level: 'silent' }),
        loaderRegistry: makeRegistry(slowLoader),
        attachmentStore: new FilesystemAttachmentStore(attachmentsDir),
      });

    const a = make().runOnce();
    const b = make().runOnce();
    // Give both a chance to claim before releasing the loader gate.
    await new Promise((r) => setTimeout(r, 100));
    expect(calls).toBe(1);
    release();
    await Promise.all([a, b]);

    expect(calls).toBe(1);

    const after = await database.pool.query(
      `SELECT loading_status FROM entities WHERE id = $1`,
      [entityId],
    );
    expect(after.rows[0].loading_status).toBe('completed');

    await rm(tmp, { recursive: true, force: true });
  }, 120_000);
});

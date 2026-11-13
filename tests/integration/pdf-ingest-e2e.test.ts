import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
import { ingestDocument } from '../../src/services/document-ingest-service.js';
import { createEmbeddingService } from '../../src/services/embedding-service.js';
import { createEnrichmentWorker } from '../../src/services/enrichment-worker.js';
import { buildRegistry } from '../../src/services/loaders/build-registry.js';
import { loadLoadersConfig } from '../../src/services/loaders/config-loader.js';
import type { LoaderRegistry } from '../../src/services/loaders/registry.js';
import { searchEntities } from '../../src/services/search-service.js';
import { createLogger } from '../../src/util/logger.js';
import {
  createTempStore,
  type TempStore
} from '../helpers/document-loaders.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

const fixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures'
);

const auth: AuthContext = {
  apiKeyId: null,
  keyName: 'pdf-e2e',
  clientId: 'pdf-e2e',
  scopes: ['read', 'write', 'delete'],
  allowedTypes: null,
  allowedVisibility: ['personal', 'work', 'shared']
};

type Row = {
  content: string | null;
  metadata: Record<string, unknown>;
  loader_name: string | null;
  loading_status: string | null;
  loading_error: string | null;
};

describe('PDF ingest end to end (real loader package)', () => {
  let database: TestDatabase;
  let temp: TempStore;
  let registry: LoaderRegistry;
  const embeddingService = createEmbeddingService();

  beforeAll(async () => {
    database = await createTestDatabase();
    // The built-in default configuration and the real package resolution.
    const config = await loadLoadersConfig(undefined);
    registry = await buildRegistry(config, createLogger('fatal'));
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

  async function ingest(file: string, title: string): Promise<string> {
    const bytes = await readFile(path.join(fixtures, file));
    const result = await ingestDocument(
      auth,
      { bytes, filename: file, mimeType: 'application/pdf', title },
      { pool: database.pool, registry, attachmentStore: temp.store }
    );
    return result._unsafeUnwrap().id;
  }

  async function runWorker(): Promise<void> {
    const worker = createEnrichmentWorker({
      pool: database.pool,
      embeddingService,
      loaderRegistry: registry,
      attachmentStore: temp.store
    });
    // One pass loads; the same pass embeds what the load produced.
    for (let i = 0; i < 5; i += 1) {
      if ((await worker.runOnce()) === 0) break;
    }
  }

  async function row(id: string): Promise<Row> {
    const r = await database.pool.query<Row>(
      `SELECT content, metadata, loader_name, loading_status, loading_error
       FROM entities WHERE id = $1`,
      [id]
    );
    return r.rows[0]!;
  }

  it('registers the built-in pdf loader from the workspace package', () => {
    expect(registry.list()).toEqual([
      expect.objectContaining({ name: 'pdf', status: 'ok' })
    ]);
  });

  it('loads, enriches and finds a 3-page PDF', async () => {
    const id = await ingest('three-pages.pdf', 'Upload title');
    await runWorker();

    const entity = await row(id);
    expect(entity.loading_status).toBe('completed');
    expect(entity.loader_name).toBe('pdf');
    expect(entity.content).toContain('[page 1]');
    expect(entity.content).toContain('[page 2]');
    expect(entity.content).toContain('[page 3]');
    expect(entity.content).toContain(
      'Postgram fixture page one: the quick brown fox'
    );
    expect(entity.content).toContain(
      'Postgram fixture page two: jumps over the lazy dog'
    );
    expect(entity.content).toContain(
      'Postgram fixture page three: zebra quartz vexing'
    );
    expect(entity.metadata.title).toBe('Upload title');
    expect(entity.metadata.loader).toMatchObject({
      documentType: 'pdf',
      pageCount: 3,
      pdfTitle: 'Postgram fixture document'
    });

    const chunks = await database.pool.query<{ n: string }>(
      'SELECT COUNT(*) AS n FROM chunks WHERE entity_id = $1',
      [id]
    );
    expect(Number(chunks.rows[0]!.n)).toBeGreaterThan(0);

    const found = (
      await searchEntities(
        database.pool,
        auth,
        { query: 'zebra quartz vexing', limit: 5 },
        { embeddingService }
      )
    )._unsafeUnwrap();
    expect(found.results.map((r) => r.entityId)).toContain(id);
  });

  it('fails a corrupt PDF with a pdf: error', async () => {
    const id = await ingest('corrupt.pdf', 'Broken');
    await runWorker();
    const entity = await row(id);
    expect(entity.loading_status).toBe('failed');
    expect(entity.loading_error).toMatch(/^pdf: /);
    expect(entity.content).toBeNull();
  });

  it('completes a PDF without a text layer and leaves content empty', async () => {
    const id = await ingest('no-text.pdf', 'Scan');
    await runWorker();
    const entity = await row(id);
    expect(entity.loading_status).toBe('completed');
    expect(entity.loader_name).toBe('pdf');
    expect(entity.content).toBeNull();
    expect(entity.metadata.loader).toMatchObject({ pageCount: 1 });
  });
});

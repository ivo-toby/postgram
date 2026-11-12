import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { serve } from '@hono/node-server';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { createKey } from '../../src/auth/key-service.js';
import { createApp } from '../../src/index.js';
import { createEmbeddingService } from '../../src/services/embedding-service.js';
import { createEnrichmentWorker } from '../../src/services/enrichment-worker.js';
import {
  LoaderRegistry,
  type RegisteredLoader
} from '../../src/services/loaders/registry.js';
import type { DocumentLoader } from '../../src/types/loader.js';
import type { InProcessLoaderConfig } from '../../src/types/loaders-config.js';
import {
  createTempStore,
  type TempStore
} from '../helpers/document-loaders.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

const execFileAsync = promisify(execFile);
const TSX_BIN = path.resolve('node_modules/.bin/tsx');
const PGM_ENTRYPOINT = path.resolve('cli/src/pgm.ts');

// Each case starts a tsx process, which is slow on a cold cache.
vi.setConfig({ testTimeout: 120_000 });

type IngestJson = { id: string; status: string; loading_status: string };
type Run = { code: number; stdout: string; stderr: string };
type Load = DocumentLoader['load'];

const ACCEPTS = {
  mimeTypes: ['application/pdf', 'text/plain'],
  extensions: ['.pdf', '.txt']
};

function registryWith(load: Load): LoaderRegistry {
  const loader: DocumentLoader = {
    name: 'fake',
    version: '1.0.0',
    accepts: ACCEPTS,
    load
  };
  const entry: RegisteredLoader = {
    loader,
    config: {
      kind: 'in-process',
      name: 'fake',
      package: '@x/fake',
      accepts: ACCEPTS,
      priority: 0,
      options: {},
      enabled: true
    } as InProcessLoaderConfig,
    enabled: true,
    status: 'ok'
  };
  return new LoaderRegistry([entry]);
}

const textLoad: Load = () =>
  Promise.resolve({
    documentType: 'fake',
    blocks: [{ kind: 'text', text: 'hello from the fake loader' }]
  });

describe('pgm ingest', () => {
  let database: TestDatabase;
  let temp: TempStore;
  let files: string;
  let apiKey: string;
  let server: ReturnType<typeof serve> | undefined;
  let baseUrl = '';
  let worker: ReturnType<typeof createEnrichmentWorker> | undefined;
  let timer: NodeJS.Timeout | undefined;
  const embeddingService = createEmbeddingService();

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 240_000);

  beforeEach(async () => {
    await resetTestDatabase(database.pool);
    temp = await createTempStore();
    files = await mkdtemp(path.join(tmpdir(), 'pgm-ingest-files-'));
    apiKey = (
      await createKey(database.pool, {
        name: `cli-ingest-${crypto.randomUUID()}`,
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['shared', 'work']
      })
    )._unsafeUnwrap().plaintextKey;
  });

  afterEach(async () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    worker = undefined;
    if (server) {
      await new Promise<void>((resolve) => {
        server?.close(() => resolve());
      });
      server = undefined;
    }
    await temp.cleanup();
    await rm(files, { recursive: true, force: true });
  });

  afterAll(async () => {
    await database.close();
  });

  function start(options: { load?: Load | null; maxBytes?: number } = {}) {
    const load = options.load === undefined ? textLoad : options.load;
    const app = createApp({
      pool: database.pool,
      embeddingService,
      ...(load === null
        ? {}
        : {
            documentLoaders: {
              registry: registryWith(load),
              attachmentStore: temp.store,
              maxBytes: options.maxBytes ?? 4096
            }
          })
    });
    server = serve(
      { fetch: app.fetch, hostname: '127.0.0.1', port: 0 },
      (info) => {
        baseUrl = `http://${info.address}:${info.port}`;
      }
    );
    if (load !== null) {
      worker = createEnrichmentWorker({
        pool: database.pool,
        embeddingService,
        loaderRegistry: registryWith(load),
        attachmentStore: temp.store
      });
    }
  }

  function runWorkerInBackground() {
    timer = setInterval(() => {
      void worker?.runOnce().catch(() => undefined);
    }, 100);
  }

  async function file(name: string, content: string | Buffer): Promise<string> {
    const target = path.join(files, name);
    await writeFile(target, content);
    return target;
  }

  async function pgm(args: string[]): Promise<Run> {
    try {
      const { stdout, stderr } = await execFileAsync(
        TSX_BIN,
        [PGM_ENTRYPOINT, ...args],
        {
          env: {
            ...process.env,
            PGM_API_URL: baseUrl,
            PGM_API_KEY: apiKey,
            NODE_OPTIONS: [process.env.NODE_OPTIONS, '--no-deprecation']
              .filter(Boolean)
              .join(' ')
          },
          cwd: process.cwd(),
          timeout: 120_000
        }
      );
      return { code: 0, stdout, stderr };
    } catch (error) {
      const err = error as { code?: number; stdout?: string; stderr?: string };
      return {
        code: typeof err.code === 'number' ? err.code : 1,
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? ''
      };
    }
  }

  async function entityRow(id: string) {
    const result = await database.pool.query<{
      loading_status: string | null;
      enrichment_status: string | null;
      content: string | null;
      metadata: Record<string, unknown>;
      owner: string | null;
      tags: string[];
      visibility: string;
    }>(
      `SELECT loading_status, enrichment_status, content, metadata, owner, tags, visibility
       FROM entities WHERE id = $1`,
      [id]
    );
    return result.rows[0]!;
  }

  it('uploads a file and prints the entity id and status', async () => {
    start();
    const report = await file('report.pdf', '%PDF-1.4 created');

    const run = await pgm(['ingest', report]);

    expect(run.code).toBe(0);
    const id =
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(
        run.stdout
      )?.[0];
    expect(id).toBeDefined();
    expect(run.stdout).toContain('created');
    expect(run.stdout).toContain('pending');
    const stored = await entityRow(id!);
    expect(stored.metadata).toMatchObject({
      filename: 'report.pdf',
      title: 'report.pdf'
    });
  });

  it('sends only the base name, even for a path with directories', async () => {
    start();
    const nested = await file('nested.txt', 'plain text');

    const run = await pgm(['--json', 'ingest', nested]);

    const { id } = JSON.parse(run.stdout) as { id: string };
    expect((await entityRow(id)).metadata.filename).toBe('nested.txt');
  });

  it('reports exists with the first id on a second upload', async () => {
    start();
    const report = await file('same.pdf', '%PDF-1.4 same bytes');

    const first = JSON.parse(
      (await pgm(['--json', 'ingest', report])).stdout
    ) as IngestJson;
    const second = await pgm(['ingest', report]);
    const secondJson = JSON.parse(
      (await pgm(['--json', 'ingest', report])).stdout
    ) as IngestJson;

    expect(first.status).toBe('created');
    expect(second.code).toBe(0);
    expect(second.stdout).toContain(first.id);
    expect(second.stdout).toContain('exists');
    expect(secondJson).toMatchObject({ id: first.id, status: 'exists' });
  });

  it('passes title, visibility, owner, tags and metadata to the server', async () => {
    start();
    const report = await file('opts.txt', 'some text');

    const run = await pgm([
      '--json',
      'ingest',
      report,
      '--title',
      'Quarterly numbers',
      '--visibility',
      'work',
      '--owner',
      'alice',
      '--tags',
      'a,b',
      '--metadata',
      '{"team":"x"}',
      '--mime-type',
      'text/plain'
    ]);

    expect(run.code).toBe(0);
    const { id } = JSON.parse(run.stdout) as { id: string };
    const stored = await entityRow(id);
    expect(stored).toMatchObject({
      visibility: 'work',
      owner: 'alice',
      tags: ['a', 'b']
    });
    expect(stored.metadata).toMatchObject({
      title: 'Quarterly numbers',
      team: 'x'
    });
  });

  it('prints the server response object in JSON mode', async () => {
    start();
    const report = await file('json.pdf', '%PDF-1.4 json mode');

    const run = await pgm(['--json', 'ingest', report]);

    expect(run.code).toBe(0);
    const body = JSON.parse(run.stdout) as IngestJson;
    expect(Object.keys(body).sort()).toEqual([
      'id',
      'loading_status',
      'status'
    ]);
    expect(body).toMatchObject({
      status: 'created',
      loading_status: 'pending'
    });
  });

  it('with --wait, returns after loading and enrichment complete', async () => {
    start();
    runWorkerInBackground();
    const report = await file('wait.pdf', '%PDF-1.4 wait for me');

    const run = await pgm(['ingest', report, '--wait']);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain('completed');
    const id =
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(
        run.stdout
      )![0];
    const stored = await entityRow(id);
    expect(stored.loading_status).toBe('completed');
    expect(stored.enrichment_status).toBe('completed');
    expect(stored.content).toContain('hello from the fake loader');
  });

  it('with --wait, treats a loader that returns no text as done', async () => {
    start({
      load: () => Promise.resolve({ documentType: 'fake', blocks: [] })
    });
    runWorkerInBackground();
    const report = await file('empty.pdf', '%PDF-1.4 no text');

    const run = await pgm(['--json', 'ingest', report, '--wait']);

    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout) as IngestJson).toMatchObject({
      status: 'created',
      loading_status: 'completed',
      enrichment_status: 'completed'
    });
  });

  it('with --wait, exits non-zero and prints the loader error on failure', async () => {
    start({ load: () => Promise.reject(new Error('corrupt pdf structure')) });
    runWorkerInBackground();
    const report = await file('bad.pdf', '%PDF-1.4 bad');

    const run = await pgm(['ingest', report, '--wait']);

    expect(run.code).toBe(1);
    expect(run.stdout).toContain('fake: corrupt pdf structure');
    expect(run.stdout).toMatch(/retr(y|ies)/i);
  });

  it('with --wait and --json, a failure prints an error object with the entity state', async () => {
    start({ load: () => Promise.reject(new Error('corrupt pdf structure')) });
    runWorkerInBackground();
    const report = await file('bad-json.pdf', '%PDF-1.4 bad json');

    const run = await pgm(['--json', 'ingest', report, '--wait']);

    expect(run.code).toBe(1);
    const body = JSON.parse(run.stdout) as {
      error: {
        code: string;
        message: string;
        details: Record<string, unknown>;
      };
    };
    expect(body.error.code).toBe('PROCESSING_FAILED');
    expect(body.error.message).toContain('corrupt pdf structure');
    expect(body.error.details).toMatchObject({ loading_status: 'failed' });
  });

  it('with --wait, exits non-zero when the timeout passes while processing', async () => {
    start();
    // No worker runs, so the document stays pending.
    const report = await file('slow.pdf', '%PDF-1.4 never loaded');

    const run = await pgm(['ingest', report, '--wait', '--timeout', '2']);

    expect(run.code).toBe(1);
    expect(run.stdout).toMatch(/still processing/i);
  });

  it('rejects --timeout without --wait and uploads nothing', async () => {
    start();
    const report = await file('no-wait.pdf', '%PDF-1.4 no wait');

    const run = await pgm(['ingest', report, '--timeout', '30']);

    expect(run.code).toBe(1);
    expect(run.stdout).toMatch(/--timeout only applies together with --wait/);
    const count = await database.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM entities'
    );
    expect(count.rows[0]!.n).toBe('0');
  });

  it('rejects a bad --timeout value', async () => {
    start();
    const report = await file('t.pdf', '%PDF-1.4 t');

    const run = await pgm(['ingest', report, '--wait', '--timeout', 'soon']);

    expect(run.code).toBe(1);
    expect(run.stdout).toContain('--timeout');
  });

  it('lists the accepted types and extensions on 415', async () => {
    start();
    const odd = await file('movie.xyz', 'not supported');

    const run = await pgm(['ingest', odd]);

    expect(run.code).toBe(1);
    expect(run.stdout).toContain('application/pdf');
    expect(run.stdout).toContain('text/plain');
    expect(run.stdout).toContain('.pdf');
    expect(run.stdout).toContain('.txt');
  });

  it('shows the server limit on 413', async () => {
    start({ maxBytes: 1024 });
    const big = await file('big.pdf', Buffer.alloc(2048, 1));

    const run = await pgm(['ingest', big]);

    expect(run.code).toBe(1);
    expect(run.stdout).toContain('1024');
    expect(run.stdout).toMatch(/too large|exceeds/i);
  });

  it('says that loaders are not enabled on 503', async () => {
    start({ load: null });
    const report = await file('off.pdf', '%PDF-1.4 off');

    const run = await pgm(['ingest', report]);

    expect(run.code).toBe(1);
    expect(run.stdout).toMatch(/document loaders are not enabled/i);
  });

  it('fails clearly when the file does not exist', async () => {
    start();

    const run = await pgm(['ingest', path.join(files, 'missing.pdf')]);

    expect(run.code).toBe(1);
    expect(run.stdout).toMatch(/file not found/i);
    expect(run.stdout).toContain('missing.pdf');
  });

  it('fails clearly when the path is a directory', async () => {
    start();

    const run = await pgm(['ingest', files]);

    expect(run.code).toBe(1);
    expect(run.stdout).toMatch(/not a regular file/i);
  });
});

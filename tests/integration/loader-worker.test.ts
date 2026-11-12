import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import { createEmbeddingService } from '../../src/services/embedding-service.js';
import { createEnrichmentWorker } from '../../src/services/enrichment-worker.js';
import { FilesystemAttachmentStore } from '../../src/services/loaders/attachment-store.js';
import {
  LoaderRegistry,
  type RegisteredLoader
} from '../../src/services/loaders/registry.js';
import type {
  DocumentLoader,
  LoaderContext,
  LoaderInput,
  LoaderResult
} from '../../src/types/loader.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

type LoadFn = (input: LoaderInput, ctx: LoaderContext) => Promise<unknown>;

function fakeLoader(
  name: string,
  load: LoadFn,
  accepts = { mimeTypes: ['application/x-fake'], extensions: ['.fake'] }
): RegisteredLoader {
  const loader: DocumentLoader = {
    name,
    version: '1.0.0',
    accepts,
    load: load as DocumentLoader['load']
  };
  return {
    loader,
    config: {
      kind: 'in-process',
      name,
      package: 'fake',
      accepts,
      priority: 0,
      options: { greeting: 'hi' },
      enabled: true
    },
    enabled: true,
    status: 'ok'
  };
}

const goodResult: LoaderResult = {
  documentType: 'fake-doc',
  blocks: [
    { kind: 'heading', level: 1, text: 'Title', metadata: { page: 1 } },
    { kind: 'text', text: 'First page body', metadata: { page: 1 } },
    { kind: 'text', text: 'Second page body', metadata: { page: 2 } }
  ],
  metadata: { pages: 2 }
};

describe('enrichment-worker loading stage', () => {
  let database: TestDatabase | undefined;
  let dir: string;
  let store: FilesystemAttachmentStore;

  function pool() {
    if (!database) throw new Error('test database not initialized');
    return database.pool;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    await resetTestDatabase(pool());
    dir = await mkdtemp(path.join(tmpdir(), 'pgm-loader-worker-'));
    store = new FilesystemAttachmentStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  afterAll(async () => {
    if (database) await database.close();
  });

  async function seed(
    opts: {
      mime?: string;
      filename?: string;
      loadingStatus?: string;
      attempts?: number;
      ageMinutes?: number;
      writeFile?: boolean;
      withOriginal?: boolean;
    } = {}
  ): Promise<string> {
    const inserted = await pool().query<{ id: string }>(
      `INSERT INTO entities (type, content, metadata, mime_type, loading_status, loading_attempts)
       VALUES ('document', NULL, '{"title":"My Doc","filename":"a.fake"}'::jsonb, $1, $2, $3)
       RETURNING id`,
      [
        opts.mime ?? 'application/x-fake',
        opts.loadingStatus ?? 'pending',
        opts.attempts ?? 0
      ]
    );
    const id = inserted.rows[0]!.id;
    if (opts.withOriginal !== false) {
      const put = await store.put(Buffer.from(`bytes-${id}`));
      if (opts.writeFile === false) {
        await unlink(store.resolvePath(put.storageUri));
      }
      await pool().query(
        `INSERT INTO attachments (entity_id, role, ref, kind, mime_type, filename, byte_size, sha256, storage_uri)
         VALUES ($1, 'original', 'original', 'document', $2, $3, $4, $5, $6)`,
        [
          id,
          opts.mime ?? 'application/x-fake',
          opts.filename ?? 'a.fake',
          put.byteSize,
          put.sha256,
          put.storageUri
        ]
      );
    }
    if (opts.ageMinutes !== undefined) await age(id, opts.ageMinutes);
    return id;
  }

  async function age(id: string, minutes: number): Promise<void> {
    await pool().query(
      'ALTER TABLE entities DISABLE TRIGGER trg_entities_updated_at'
    );
    try {
      await pool().query(
        `UPDATE entities SET updated_at = now() - ($2::int * interval '1 minute') WHERE id = $1`,
        [id, minutes]
      );
    } finally {
      await pool().query(
        'ALTER TABLE entities ENABLE TRIGGER trg_entities_updated_at'
      );
    }
  }

  function worker(
    loaders: RegisteredLoader[],
    timeoutMs?: number,
    extra: Partial<Parameters<typeof createEnrichmentWorker>[0]> = {}
  ) {
    return createEnrichmentWorker({
      pool: pool(),
      embeddingService: createEmbeddingService(),
      loaderRegistry: new LoaderRegistry(loaders),
      attachmentStore: store,
      ...(timeoutMs !== undefined ? { loaderTimeoutMs: timeoutMs } : {}),
      ...extra
    });
  }

  async function row(id: string) {
    const r = await pool().query<{
      content: string | null;
      metadata: Record<string, unknown>;
      loader_name: string | null;
      loading_status: string | null;
      loading_error: string | null;
      loading_attempts: number;
      enrichment_status: string | null;
    }>(
      `SELECT content, metadata, loader_name, loading_status, loading_error,
              loading_attempts, enrichment_status FROM entities WHERE id = $1`,
      [id]
    );
    return r.rows[0]!;
  }

  async function chunkCount(id: string): Promise<number> {
    const r = await pool().query<{ c: string }>(
      'SELECT COUNT(*)::text AS c FROM chunks WHERE entity_id = $1',
      [id]
    );
    return Number(r.rows[0]!.c);
  }

  async function derived(id: string) {
    const r = await pool().query<{
      ref: string;
      kind: string;
      mime_type: string;
      byte_size: string;
      sha256: string;
      storage_uri: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT ref, kind, mime_type, byte_size::text, sha256, storage_uri, metadata
       FROM attachments WHERE entity_id = $1 AND role = 'derived' ORDER BY ref`,
      [id]
    );
    return r.rows;
  }

  it('loads, renders, merges metadata and then embeds the entity', async () => {
    const id = await seed();
    let seenInput: LoaderInput | undefined;
    let seenOptions: unknown;
    const w = worker([
      fakeLoader('fake', (input, ctx) => {
        seenInput = input;
        seenOptions = ctx.options;
        return Promise.resolve(goodResult);
      })
    ]);

    await w.runOnce();

    const r = await row(id);
    expect(r.loading_status).toBe('completed');
    expect(r.loader_name).toBe('fake');
    expect(r.loading_error).toBeNull();
    expect(r.content).toContain('[page 1]');
    expect(r.content).toContain('[page 2]');
    expect(r.content).toContain('Second page body');
    expect(r.metadata.title).toBe('My Doc');
    expect(r.metadata.filename).toBe('a.fake');
    expect(r.metadata.loader).toMatchObject({
      documentType: 'fake-doc',
      pages: 2
    });
    expect(seenInput).toMatchObject({
      kind: 'localPath',
      mimeType: 'application/x-fake',
      filename: 'a.fake'
    });
    expect(seenOptions).toEqual({ greeting: 'hi' });
    expect(r.enrichment_status).toBe('completed');
    expect(await chunkCount(id)).toBeGreaterThan(0);
  });

  it('keeps title and filename even if the loader returns them as metadata', async () => {
    const id = await seed();
    await worker([
      fakeLoader('fake', () =>
        Promise.resolve({
          ...goodResult,
          metadata: { title: 'Evil', filename: 'evil.txt' }
        })
      )
    ]).runOnce();
    const r = await row(id);
    expect(r.metadata.title).toBe('My Doc');
    expect(r.metadata.filename).toBe('a.fake');
    expect(r.metadata.loader).toMatchObject({ title: 'Evil' });
  });

  it('sets enrichment pending after the loading stage', async () => {
    const id = await seed();
    // Run only the loading stage by using a worker whose embedding fails.
    const w = createEnrichmentWorker({
      pool: pool(),
      embeddingService: {
        ...createEmbeddingService(),
        embedBatch: () => Promise.reject(new Error('no embeddings'))
      },
      loaderRegistry: new LoaderRegistry([
        fakeLoader('fake', () => Promise.resolve(goodResult))
      ]),
      attachmentStore: store
    });
    await w.runOnce();
    const r = await row(id);
    expect(r.loading_status).toBe('completed');
    expect(r.content).not.toBeNull();
    expect(r.enrichment_status).toBe('failed');
  });

  it('completes enrichment without chunks when the loader returns no text', async () => {
    const id = await seed();
    await worker([
      fakeLoader('fake', () =>
        Promise.resolve({ documentType: 'empty', blocks: [] })
      )
    ]).runOnce();
    const r = await row(id);
    expect(r.loading_status).toBe('completed');
    expect(r.content).toBeNull();
    expect(r.enrichment_status).toBe('completed');
    expect(await chunkCount(id)).toBe(0);
  });

  it('marks the row failed when the loader throws and keeps the original', async () => {
    const id = await seed();
    await worker([
      fakeLoader('fake', () => Promise.reject(new Error('boom')))
    ]).runOnce();
    const r = await row(id);
    expect(r.loading_status).toBe('failed');
    expect(r.loading_attempts).toBe(1);
    expect(r.loading_error).toMatch(/^fake: boom/);
    expect(r.content).toBeNull();
    const orig = await pool().query(
      "SELECT 1 FROM attachments WHERE entity_id = $1 AND role = 'original'",
      [id]
    );
    expect(orig.rowCount).toBe(1);
  });

  describe('claim rules', () => {
    function counting() {
      const state = { calls: 0 };
      const loader = fakeLoader('fake', () => {
        state.calls += 1;
        return Promise.resolve(goodResult);
      });
      return { state, loader };
    }

    it('does not claim a failed row younger than 5 minutes', async () => {
      const id = await seed({
        loadingStatus: 'failed',
        attempts: 1,
        ageMinutes: 1
      });
      const { state, loader } = counting();
      await worker([loader]).runOnce();
      expect(state.calls).toBe(0);
      expect((await row(id)).loading_status).toBe('failed');
    });

    it('claims a failed row older than 5 minutes', async () => {
      const id = await seed({
        loadingStatus: 'failed',
        attempts: 1,
        ageMinutes: 10
      });
      const { state, loader } = counting();
      await worker([loader]).runOnce();
      expect(state.calls).toBe(1);
      expect((await row(id)).loading_status).toBe('completed');
    });

    it('never claims a row with 3 attempts', async () => {
      const id = await seed({
        loadingStatus: 'failed',
        attempts: 3,
        ageMinutes: 60
      });
      const { state, loader } = counting();
      await worker([loader]).runOnce();
      expect(state.calls).toBe(0);
      expect((await row(id)).loading_status).toBe('failed');
    });

    it('reclaims a stale running row but not a fresh one', async () => {
      const stale = await seed({ loadingStatus: 'running', ageMinutes: 20 });
      const fresh = await seed({ loadingStatus: 'running', ageMinutes: 5 });
      const { state, loader } = counting();
      await worker([loader]).runOnce();
      expect(state.calls).toBe(1);
      expect((await row(stale)).loading_status).toBe('completed');
      expect((await row(fresh)).loading_status).toBe('running');
    });

    it('does not call the loader twice for one row with two workers', async () => {
      await seed();
      let calls = 0;
      const slow = fakeLoader('fake', async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 300));
        return goodResult;
      });
      await Promise.all([worker([slow]).runOnce(), worker([slow]).runOnce()]);
      expect(calls).toBe(1);
    });
  });

  it('fails with a timeout message when the loader never resolves', async () => {
    const id = await seed();
    let aborted = false;
    await worker(
      [
        fakeLoader('fake', (_input, ctx) => {
          ctx.signal.addEventListener('abort', () => {
            aborted = true;
          });
          return new Promise(() => undefined);
        })
      ],
      100
    ).runOnce();
    const r = await row(id);
    expect(r.loading_status).toBe('failed');
    expect(r.loading_error).toMatch(/^fake: .*timed out/);
    expect(aborted).toBe(true);
  });

  it('fails when the loader output is invalid', async () => {
    const id = await seed();
    await worker([
      fakeLoader('fake', () => Promise.resolve({ blocks: 'nope' }))
    ]).runOnce();
    const r = await row(id);
    expect(r.loading_status).toBe('failed');
    expect(r.loading_error).toMatch(/^fake: invalid loader result/);
  });

  describe('derived attachments', () => {
    it('stores derived attachments and does not duplicate them on retry', async () => {
      const id = await seed();
      const w = worker([
        fakeLoader('fake', () =>
          Promise.resolve({
            ...goodResult,
            attachments: [
              {
                ref: 'img1',
                kind: 'image' as const,
                mimeType: 'image/png',
                source: { kind: 'bytes' as const, bytes: Buffer.from('png!') },
                metadata: { page: 1 }
              }
            ]
          })
        )
      ]);
      await w.runOnce();
      let d = await derived(id);
      expect(d).toHaveLength(1);
      expect(d[0]).toMatchObject({
        ref: 'img1',
        kind: 'image',
        mime_type: 'image/png',
        byte_size: '4',
        metadata: { page: 1 }
      });
      expect(() => store.resolvePath(d[0]!.storage_uri)).not.toThrow();

      // Force a retry: put the row back to pending.
      await pool().query(
        "UPDATE entities SET loading_status = 'pending' WHERE id = $1",
        [id]
      );
      await w.runOnce();
      d = await derived(id);
      expect(d).toHaveLength(1);
      expect((await row(id)).loading_status).toBe('completed');
    });

    it('accepts a path source inside the loader temp dir', async () => {
      const id = await seed();
      await worker([
        fakeLoader('fake', async (_input, ctx) => {
          const file = path.join(ctx.tmpDir, 'out.bin');
          await writeFile(file, 'from-tmp');
          return {
            ...goodResult,
            attachments: [
              {
                ref: 'out',
                kind: 'binary' as const,
                mimeType: 'application/octet-stream',
                source: { kind: 'path' as const, path: file }
              }
            ]
          };
        })
      ]).runOnce();
      expect((await row(id)).loading_status).toBe('completed');
      const d = await derived(id);
      expect(d[0]?.byte_size).toBe('8');
    });

    it('rejects the reserved ref original', async () => {
      const id = await seed();
      await worker([
        fakeLoader('fake', () =>
          Promise.resolve({
            ...goodResult,
            attachments: [
              {
                ref: 'original',
                kind: 'binary' as const,
                mimeType: 'application/octet-stream',
                source: { kind: 'bytes' as const, bytes: Buffer.from('x') }
              }
            ]
          })
        )
      ]).runOnce();
      const r = await row(id);
      expect(r.loading_status).toBe('failed');
      expect(r.loading_error).toMatch(/reserved/);
      expect(r.content).toBeNull();
    });

    it('rejects a path source outside the loader temp dir', async () => {
      const id = await seed();
      const outside = path.join(dir, 'outside.txt');
      await mkdir(dir, { recursive: true });
      await writeFile(outside, 'secret');
      await worker([
        fakeLoader('fake', () =>
          Promise.resolve({
            ...goodResult,
            attachments: [
              {
                ref: 'x',
                kind: 'binary' as const,
                mimeType: 'text/plain',
                source: { kind: 'path' as const, path: outside }
              }
            ]
          })
        )
      ]).runOnce();
      const r = await row(id);
      expect(r.loading_status).toBe('failed');
      expect(r.loading_error).toMatch(/outside the loader temp directory/);
      expect(await derived(id)).toHaveLength(0);
    });
  });

  it('fails with no_loader when nothing matches', async () => {
    const id = await seed({ mime: 'application/x-other', filename: 'a.zzz' });
    await worker([
      fakeLoader('fake', () => Promise.resolve(goodResult))
    ]).runOnce();
    const r = await row(id);
    expect(r.loading_status).toBe('failed');
    expect(r.loading_error).toMatch(/^no_loader: /);
  });

  it('fails clearly when the original file is missing on disk', async () => {
    const id = await seed({ writeFile: false });
    await worker([
      fakeLoader('fake', () => Promise.resolve(goodResult))
    ]).runOnce();
    const r = await row(id);
    expect(r.loading_status).toBe('failed');
    expect(r.loading_error).toMatch(/missing on disk/);
  });

  it('fails clearly when the original attachment row is missing', async () => {
    const id = await seed({ withOriginal: false });
    await worker([
      fakeLoader('fake', () => Promise.resolve(goodResult))
    ]).runOnce();
    const r = await row(id);
    expect(r.loading_status).toBe('failed');
    expect(r.loading_error).toMatch(/original attachment row is missing/);
  });

  it('does nothing without registry/store and still enriches legacy entities', async () => {
    const pending = await seed();
    const legacy = await pool().query<{ id: string }>(
      `INSERT INTO entities (type, content, enrichment_status)
       VALUES ('memory', 'legacy text entity', 'pending') RETURNING id`
    );
    const w = createEnrichmentWorker({
      pool: pool(),
      embeddingService: createEmbeddingService()
    });
    await w.runOnce();
    const r = await row(pending);
    expect(r.loading_status).toBe('pending');
    expect(r.content).toBeNull();
    const l = await row(legacy.rows[0]!.id);
    expect(l.enrichment_status).toBe('completed');
    expect(await chunkCount(legacy.rows[0]!.id)).toBeGreaterThan(0);
  });

  describe('attempt accounting and claim token', () => {
    it('counts the attempt at claim time', async () => {
      const id = await seed();
      let attemptsSeenByLoader = -1;
      await worker([
        fakeLoader('fake', async () => {
          const r = await pool().query<{ a: number }>(
            'SELECT loading_attempts AS a FROM entities WHERE id = $1',
            [id]
          );
          attemptsSeenByLoader = r.rows[0]!.a;
          return goodResult;
        })
      ]).runOnce();
      expect(attemptsSeenByLoader).toBe(1);
    });

    it('ends a full cycle of three failures as failed with 3 attempts, never claimed again', async () => {
      const id = await seed();
      let calls = 0;
      const w = worker([
        fakeLoader('fake', () => {
          calls += 1;
          return Promise.reject(new Error('nope'));
        })
      ]);
      for (let i = 1; i <= 3; i += 1) {
        await w.runOnce();
        expect((await row(id)).loading_attempts).toBe(i);
        await age(id, 10);
      }
      await w.runOnce();
      await w.runOnce();
      const r = await row(id);
      expect(calls).toBe(3);
      expect(r.loading_status).toBe('failed');
      expect(r.loading_attempts).toBe(3);
    });

    it('sweeps a crashed stale running row with 3 attempts to failed', async () => {
      const id = await seed({
        loadingStatus: 'running',
        attempts: 3,
        ageMinutes: 20
      });
      let calls = 0;
      await worker([
        fakeLoader('fake', () => {
          calls += 1;
          return Promise.resolve(goodResult);
        })
      ]).runOnce();
      const r = await row(id);
      expect(calls).toBe(0);
      expect(r.loading_status).toBe('failed');
      expect(r.loading_attempts).toBe(3);
      expect(r.loading_error).toBe('interrupted: worker stopped during load');
    });

    it('derives the stale threshold from the loader timeout', async () => {
      const id = await seed({ loadingStatus: 'running', ageMinutes: 20 });
      let calls = 0;
      await worker(
        [
          fakeLoader('fake', () => {
            calls += 1;
            return Promise.resolve(goodResult);
          })
        ],
        30 * 60 * 1000
      ).runOnce();
      expect(calls).toBe(0);
      expect((await row(id)).loading_status).toBe('running');
    });

    it('discards the result when the claim was lost during the load', async () => {
      const id = await seed();
      await worker([
        fakeLoader('fake', async () => {
          await pool().query(
            'UPDATE entities SET loading_attempts = loading_attempts + 1 WHERE id = $1',
            [id]
          );
          return {
            ...goodResult,
            attachments: [
              {
                ref: 'img',
                kind: 'image' as const,
                mimeType: 'image/png',
                source: { kind: 'bytes' as const, bytes: Buffer.from('p') }
              }
            ]
          };
        })
      ]).runOnce();
      const r = await row(id);
      expect(r.content).toBeNull();
      expect(r.loading_status).toBe('running');
      expect(r.loader_name).toBeNull();
      expect(await derived(id)).toHaveLength(0);
    });

    it('does not record a failure when the claim was lost', async () => {
      const id = await seed();
      await worker([
        fakeLoader('fake', async () => {
          await pool().query(
            'UPDATE entities SET loading_attempts = loading_attempts + 1 WHERE id = $1',
            [id]
          );
          throw new Error('late failure');
        })
      ]).runOnce();
      const r = await row(id);
      expect(r.loading_status).toBe('running');
      expect(r.loading_error).toBeNull();
    });
  });

  it('processes at most one loading row per runOnce and counts it', async () => {
    const a = await seed();
    const b = await seed();
    const w = worker([fakeLoader('fake', () => Promise.resolve(goodResult))]);
    const processed = await w.runOnce();
    // one load + one enrichment of the loaded row
    expect(processed).toBe(2);
    const statuses = [
      (await row(a)).loading_status,
      (await row(b)).loading_status
    ];
    expect(statuses.sort()).toEqual(['completed', 'pending']);
    await w.runOnce();
    expect((await row(a)).loading_status).toBe('completed');
    expect((await row(b)).loading_status).toBe('completed');
  });

  it('embeds ordinary entities in the same runOnce as a loading row', async () => {
    await seed();
    const legacy = await pool().query<{ id: string }>(
      `INSERT INTO entities (type, content, enrichment_status)
       VALUES ('memory', 'ordinary entity', 'pending') RETURNING id`
    );
    await worker([
      fakeLoader('fake', () => Promise.resolve(goodResult))
    ]).runOnce();
    expect((await row(legacy.rows[0]!.id)).enrichment_status).toBe('completed');
  });

  it('strips NUL characters from content and metadata', async () => {
    const id = await seed();
    await worker([
      fakeLoader('fake', () =>
        Promise.resolve({
          documentType: 'nul',
          blocks: [{ kind: 'text', text: 'a\u0000b body' }],
          metadata: { 'k\u0000ey': 'x\u0000y', nested: ['p\u0000q'] },
          attachments: [
            {
              ref: 'r',
              kind: 'binary' as const,
              mimeType: 'application/octet-stream',
              source: { kind: 'bytes' as const, bytes: Buffer.from('z') },
              metadata: { note: 'n\u0000m' }
            }
          ]
        })
      )
    ]).runOnce();
    const r = await row(id);
    expect(r.loading_status).toBe('completed');
    expect(r.content).toContain('ab body');
    expect(r.content).not.toContain('\u0000');
    expect(r.metadata.loader).toMatchObject({
      key: 'xy',
      nested: ['pq']
    });
    expect((await derived(id))[0]?.metadata).toEqual({ note: 'nm' });
  });

  it('removes old chunks when a reload yields no text', async () => {
    const id = await seed();
    let empty = false;
    const w = worker([
      fakeLoader('fake', () =>
        Promise.resolve(empty ? { documentType: 'e', blocks: [] } : goodResult)
      )
    ]);
    await w.runOnce();
    expect(await chunkCount(id)).toBeGreaterThan(0);
    empty = true;
    await pool().query(
      "UPDATE entities SET loading_status = 'pending' WHERE id = $1",
      [id]
    );
    await w.runOnce();
    const r = await row(id);
    expect(r.content).toBeNull();
    expect(await chunkCount(id)).toBe(0);
  });

  it('handles a loader that returns a plain value', async () => {
    const id = await seed();
    await worker([
      fakeLoader('fake', (() => goodResult) as unknown as LoadFn)
    ]).runOnce();
    expect((await row(id)).loading_status).toBe('completed');
  });

  it('handles a loader that throws synchronously', async () => {
    const id = await seed();
    await worker([
      fakeLoader('fake', (() => {
        throw new Error('sync boom');
      }) as unknown as LoadFn)
    ]).runOnce();
    const r = await row(id);
    expect(r.loading_status).toBe('failed');
    expect(r.loading_error).toMatch(/^fake: sync boom/);
  });

  it('queues extraction for a loaded document like for any other', async () => {
    const id = await seed();
    let llmCalls = 0;
    await worker(
      [fakeLoader('fake', () => Promise.resolve(goodResult))],
      undefined,
      {
        extractionEnabled: true,
        callLlm: () => {
          llmCalls += 1;
          return Promise.resolve('[]');
        }
      }
    ).runOnce();
    const r = await pool().query<{ extraction_status: string | null }>(
      'SELECT extraction_status FROM entities WHERE id = $1',
      [id]
    );
    expect(llmCalls).toBeGreaterThan(0);
    expect(r.rows[0]?.extraction_status).toBe('completed');
  });
});

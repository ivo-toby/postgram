import { chmod, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SidecarLoaderClient,
  SidecarError
} from '../../src/services/loaders/sidecar-client.js';
import type { SidecarLoaderConfig } from '../../src/types/loaders-config.js';
import type { LoaderContext } from '../../src/types/loader.js';

type FakeRoute = {
  status: number;
  body: string;
  contentType?: string;
  /** Wait this long before answering. */
  delayMs?: number;
  /** Stream the body in these pieces (chunked, no content-length). */
  chunks?: string[];
};

type CapturedRequest = {
  method: string;
  pathname: string;
  headers: Record<string, string>;
  meta?: Record<string, unknown>;
  hasFile?: boolean;
};

function silentLogger(): LoaderContext['logger'] {
  return {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {}
  };
}

function ctx(signal?: AbortSignal): LoaderContext {
  return {
    tmpDir: '/tmp',
    logger: silentLogger(),
    fetch: globalThis.fetch.bind(globalThis),
    options: {},
    signal: signal ?? new AbortController().signal
  };
}

async function startFakeSidecar(routes: Record<string, FakeRoute>): Promise<{
  url: string;
  close: () => Promise<void>;
  captured: CapturedRequest[];
}> {
  const captured: CapturedRequest[] = [];
  const server = await new Promise<Server>((resolve, reject) => {
    const s = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? '/', 'http://x');
        const route = routes[url.pathname];
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = Buffer.concat(chunks);

        const cap: CapturedRequest = {
          method: req.method ?? 'GET',
          pathname: url.pathname,
          headers: Object.fromEntries(
            Object.entries(req.headers).map(([k, v]) => [
              k,
              Array.isArray(v) ? v.join(',') : (v ?? '')
            ])
          )
        };

        const ct = req.headers['content-type'] ?? '';
        if (ct.startsWith('multipart/form-data')) {
          const text = body.toString('utf8');
          const metaMatch = text.match(
            /Content-Type: application\/json[\s\S]*?\r\n\r\n([\s\S]*?)\r\n--/
          );
          if (metaMatch?.[1]) {
            try {
              cap.meta = JSON.parse(metaMatch[1]) as Record<string, unknown>;
            } catch {
              // ignore
            }
          }
          cap.hasFile = /name="file"/.test(text);
        }
        captured.push(cap);

        if (!route) {
          res.statusCode = 404;
          res.end();
          return;
        }
        if (route.delayMs) {
          await new Promise((r) => setTimeout(r, route.delayMs));
        }
        res.statusCode = route.status;
        if (route.contentType) {
          res.setHeader('content-type', route.contentType);
        }
        if (route.chunks) {
          for (const piece of route.chunks) {
            if (res.destroyed) return;
            res.write(piece);
            await new Promise((r) => setTimeout(r, 5));
          }
          res.end();
          return;
        }
        res.end(route.body);
      })();
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });

  const addr = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${addr.port}`,
    captured,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      })
  };
}

function cfg(
  endpoint: string,
  overrides: Partial<SidecarLoaderConfig> = {}
): SidecarLoaderConfig {
  return {
    kind: 'sidecar',
    name: 'test-sidecar',
    endpoint,
    accepts: { mimeTypes: ['application/x-test'] },
    priority: 0,
    maxBytes: 10_000_000,
    maxResponseBytes: 10_000_000,
    transport: { mode: 'multipart' },
    options: {},
    enabled: true,
    ...overrides
  } as SidecarLoaderConfig;
}

describe('SidecarLoaderClient', () => {
  let server: Awaited<ReturnType<typeof startFakeSidecar>> | undefined;

  beforeEach(() => {
    server = undefined;
  });

  afterEach(async () => {
    if (server) await server.close();
  });

  it('probeManifest caches the version reported by the sidecar', async () => {
    server = await startFakeSidecar({
      '/manifest': {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          name: 'test-sidecar',
          version: '7.8.9',
          accepts: { mimeTypes: ['application/x-test'] }
        })
      }
    });
    const client = new SidecarLoaderClient(cfg(server.url));
    expect(client.version).toBe('unknown');
    const manifest = await client.probeManifest();
    expect(manifest?.version).toBe('7.8.9');
    expect(client.version).toBe('7.8.9');
  });

  it('POST /load uploads bytes as multipart and parses LoaderResult', async () => {
    server = await startFakeSidecar({
      '/load': {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          documentType: 'test',
          blocks: [{ kind: 'text', text: 'echo' }]
        })
      }
    });
    const client = new SidecarLoaderClient(
      cfg(server.url, { sharedSecret: 's3cret' })
    );
    const result = await client.load(
      {
        kind: 'bytes',
        bytes: new TextEncoder().encode('hello'),
        mimeType: 'application/x-test',
        filename: 'h.bin'
      },
      ctx()
    );
    expect(result.documentType).toBe('test');
    expect(result.blocks).toHaveLength(1);

    const loadCall = server.captured.find((c) => c.pathname === '/load');
    expect(loadCall?.method).toBe('POST');
    expect(loadCall?.headers['x-postgram-secret']).toBe('s3cret');
    expect(loadCall?.hasFile).toBe(true);
    expect(loadCall?.meta?.mimeType).toBe('application/x-test');
    expect(loadCall?.meta?.filename).toBe('h.bin');
  });

  it('throws SidecarError on non-2xx response', async () => {
    server = await startFakeSidecar({
      '/load': { status: 500, body: 'whisper crashed' }
    });
    const client = new SidecarLoaderClient(cfg(server.url));
    await expect(
      client.load(
        {
          kind: 'bytes',
          bytes: new Uint8Array([1, 2]),
          mimeType: 'application/x-test'
        },
        ctx()
      )
    ).rejects.toThrowError(SidecarError);
  });

  it('rejects payloads above maxBytes before hitting the network', async () => {
    server = await startFakeSidecar({
      '/load': { status: 200, body: '{}' }
    });
    const client = new SidecarLoaderClient(cfg(server.url, { maxBytes: 4 }));
    await expect(
      client.load(
        {
          kind: 'bytes',
          bytes: new Uint8Array([1, 2, 3, 4, 5]),
          mimeType: 'application/x-test'
        },
        ctx()
      )
    ).rejects.toThrow(/exceeds maxBytes/);
    expect(server.captured.find((c) => c.pathname === '/load')).toBeUndefined();
  });

  it('shared-volume transport sends localPath instead of file', async () => {
    server = await startFakeSidecar({
      '/load': {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ documentType: 'audio', blocks: [] })
      }
    });
    const client = new SidecarLoaderClient(
      cfg(server.url, {
        transport: {
          mode: 'shared-volume',
          hostPath: '/var/postgram/uploads',
          sidecarPath: '/uploads'
        }
      })
    );
    await client.load(
      {
        kind: 'localPath',
        path: '/var/postgram/uploads/x.mp3',
        mimeType: 'audio/mpeg'
      },
      ctx()
    );
    const loadCall = server.captured.find((c) => c.pathname === '/load');
    expect(loadCall?.hasFile).toBe(false);
    expect(loadCall?.meta?.localPath).toBe('/uploads/x.mp3');
  });

  it('sends the filename of a localPath input in meta', async () => {
    server = await startFakeSidecar({
      '/load': {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ documentType: 'pdf', blocks: [] })
      }
    });
    const tmp = await mkdtemp(path.join(tmpdir(), 'pgm-sc-'));
    try {
      const file = path.join(tmp, 'abcdef');
      await writeFile(file, 'bytes');
      const client = new SidecarLoaderClient(cfg(server.url));
      await client.load(
        {
          kind: 'localPath',
          path: file,
          filename: 'Report.pdf',
          mimeType: 'application/pdf'
        },
        ctx()
      );
      const loadCall = server.captured.find((c) => c.pathname === '/load');
      expect(loadCall?.meta?.filename).toBe('Report.pdf');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  describe('response validation', () => {
    const load = (client: SidecarLoaderClient) =>
      client.load(
        {
          kind: 'bytes',
          bytes: new Uint8Array([1]),
          mimeType: 'application/x-test'
        },
        ctx()
      );
    const jsonRoute = (body: unknown): FakeRoute => ({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body)
    });

    it('rejects an empty object as a malformed result', async () => {
      server = await startFakeSidecar({ '/load': jsonRoute({}) });
      await expect(
        load(new SidecarLoaderClient(cfg(server.url)))
      ).rejects.toThrow(/invalid loader result/);
    });

    it('rejects a non-JSON body', async () => {
      server = await startFakeSidecar({
        '/load': { status: 200, body: 'not json' }
      });
      await expect(
        load(new SidecarLoaderClient(cfg(server.url)))
      ).rejects.toThrow(/not valid JSON/);
    });

    it('rejects a block with the wrong shape', async () => {
      server = await startFakeSidecar({
        '/load': jsonRoute({
          documentType: 'x',
          blocks: [{ kind: 'heading', level: 500000000, text: 'x' }]
        })
      });
      await expect(
        load(new SidecarLoaderClient(cfg(server.url)))
      ).rejects.toThrow(/invalid loader result/);
    });

    it('rejects an attachment with a path source', async () => {
      server = await startFakeSidecar({
        '/load': jsonRoute({
          documentType: 'x',
          blocks: [],
          attachments: [
            {
              ref: 'r',
              kind: 'binary',
              mimeType: 'a/b',
              source: { kind: 'path', path: '/etc/passwd' }
            }
          ]
        })
      });
      await expect(
        load(new SidecarLoaderClient(cfg(server.url)))
      ).rejects.toThrow(/invalid loader result.*attachments\.0\.source/);
    });

    it('rejects an attachment with a raw bytes source on the wire', async () => {
      server = await startFakeSidecar({
        '/load': jsonRoute({
          documentType: 'x',
          blocks: [],
          attachments: [
            {
              ref: 'r',
              kind: 'binary',
              mimeType: 'a/b',
              source: { kind: 'bytes', bytes: [1, 2] }
            }
          ]
        })
      });
      await expect(
        load(new SidecarLoaderClient(cfg(server.url)))
      ).rejects.toThrow(/invalid loader result/);
    });

    it('rejects invalid base64', async () => {
      server = await startFakeSidecar({
        '/load': jsonRoute({
          documentType: 'x',
          blocks: [],
          attachments: [
            {
              ref: 'r',
              kind: 'binary',
              mimeType: 'a/b',
              source: { kind: 'base64', data: '***not base64***' }
            }
          ]
        })
      });
      await expect(
        load(new SidecarLoaderClient(cfg(server.url)))
      ).rejects.toThrow(/invalid loader result/);
    });

    it('converts base64 attachment data to bytes (round trip)', async () => {
      const original = new Uint8Array([0, 1, 2, 250, 251, 255, 10, 13]);
      server = await startFakeSidecar({
        '/load': jsonRoute({
          documentType: 'x',
          blocks: [{ kind: 'image', attachmentRef: 'r', caption: 'c' }],
          attachments: [
            {
              ref: 'r',
              kind: 'image',
              mimeType: 'image/png',
              source: {
                kind: 'base64',
                data: Buffer.from(original).toString('base64')
              },
              metadata: { w: 2 }
            }
          ]
        })
      });
      const result = await load(new SidecarLoaderClient(cfg(server.url)));
      const att = result.attachments?.[0];
      expect(att?.source.kind).toBe('bytes');
      if (att?.source.kind !== 'bytes') throw new Error('expected bytes');
      expect(Array.from(att.source.bytes)).toEqual(Array.from(original));
      expect(att.metadata).toEqual({ w: 2 });
    });
  });

  describe('response size cap', () => {
    const load = (client: SidecarLoaderClient) =>
      client.load(
        {
          kind: 'bytes',
          bytes: new Uint8Array([1]),
          mimeType: 'application/x-test'
        },
        ctx()
      );
    const bigBody = JSON.stringify({
      documentType: 'x',
      blocks: [{ kind: 'text', text: 'a'.repeat(500) }]
    });

    it('fails when a response with content-length exceeds maxResponseBytes', async () => {
      server = await startFakeSidecar({
        '/load': { status: 200, body: bigBody }
      });
      const client = new SidecarLoaderClient(
        cfg(server.url, { maxResponseBytes: 100 })
      );
      await expect(load(client)).rejects.toThrow(/maxResponseBytes/);
    });

    it('fails when a streamed response exceeds maxResponseBytes', async () => {
      const pieces = bigBody.match(/.{1,50}/g) ?? [];
      server = await startFakeSidecar({
        '/load': { status: 200, body: '', chunks: pieces }
      });
      const client = new SidecarLoaderClient(
        cfg(server.url, { maxResponseBytes: 100 })
      );
      await expect(load(client)).rejects.toThrow(/maxResponseBytes/);
    });

    it('accepts a response within the limit', async () => {
      server = await startFakeSidecar({
        '/load': { status: 200, body: bigBody }
      });
      const client = new SidecarLoaderClient(
        cfg(server.url, { maxResponseBytes: bigBody.length })
      );
      const result = await load(client);
      expect(result.blocks).toHaveLength(1);
    });
  });

  describe('timeouts', () => {
    const okBody = JSON.stringify({ documentType: 'x', blocks: [] });
    const input = {
      kind: 'bytes' as const,
      bytes: new Uint8Array([1]),
      mimeType: 'application/x-test'
    };

    it('timeoutMs fires against a slow sidecar', async () => {
      server = await startFakeSidecar({
        '/load': { status: 200, body: okBody, delayMs: 1_000 }
      });
      const client = new SidecarLoaderClient(
        cfg(server.url, { timeoutMs: 50 })
      );
      const started = Date.now();
      await expect(client.load(input, ctx())).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(800);
    });

    it('without timeoutMs the client applies no timeout of its own', async () => {
      server = await startFakeSidecar({
        '/load': { status: 200, body: okBody, delayMs: 150 }
      });
      const config = cfg(server.url);
      expect(config.timeoutMs).toBeUndefined();
      const client = new SidecarLoaderClient(config);
      const result = await client.load(input, ctx());
      expect(result.documentType).toBe('x');
    });

    it('honours ctx.signal when it aborts mid-request', async () => {
      server = await startFakeSidecar({
        '/load': { status: 200, body: okBody, delayMs: 1_000 }
      });
      const client = new SidecarLoaderClient(cfg(server.url));
      const ctl = new AbortController();
      setTimeout(() => ctl.abort(new Error('host gave up')), 50);
      const started = Date.now();
      await expect(client.load(input, ctx(ctl.signal))).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(800);
    });

    it('honours a ctx.signal that is already aborted', async () => {
      server = await startFakeSidecar({
        '/load': { status: 200, body: okBody }
      });
      const client = new SidecarLoaderClient(cfg(server.url));
      const ctl = new AbortController();
      ctl.abort(new Error('already'));
      await expect(client.load(input, ctx(ctl.signal))).rejects.toThrow();
    });
  });

  describe('shared-volume transport', () => {
    const sv = (hostPath: string) =>
      cfg(server!.url, {
        transport: {
          mode: 'shared-volume',
          hostPath,
          sidecarPath: '/uploads'
        }
      });
    const okRoute: FakeRoute = {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ documentType: 'x', blocks: [] })
    };
    const input = (p: string) => ({
      kind: 'localPath' as const,
      path: p,
      mimeType: 'audio/mpeg'
    });

    it('throws when the path is outside hostPath, without calling the sidecar', async () => {
      server = await startFakeSidecar({ '/load': okRoute });
      const client = new SidecarLoaderClient(sv('/data/att'));
      await expect(client.load(input('/etc/passwd'), ctx())).rejects.toThrow(
        /outside/
      );
      expect(
        server.captured.find((c) => c.pathname === '/load')
      ).toBeUndefined();
    });

    it('respects the path separator boundary of hostPath', async () => {
      server = await startFakeSidecar({ '/load': okRoute });
      const client = new SidecarLoaderClient(sv('/data/att'));
      await expect(
        client.load(input('/data/attachments2/x.mp3'), ctx())
      ).rejects.toThrow(/outside/);
    });

    it('rejects traversal out of hostPath', async () => {
      server = await startFakeSidecar({ '/load': okRoute });
      const client = new SidecarLoaderClient(sv('/data/att'));
      await expect(
        client.load(input('/data/att/../secret/x.mp3'), ctx())
      ).rejects.toThrow(/outside/);
    });

    it('rejects hostPath itself', async () => {
      server = await startFakeSidecar({ '/load': okRoute });
      const client = new SidecarLoaderClient(sv('/data/att'));
      await expect(client.load(input('/data/att'), ctx())).rejects.toThrow(
        /outside/
      );
    });

    it('maps nested paths and tolerates trailing slashes in the config', async () => {
      server = await startFakeSidecar({ '/load': okRoute });
      const client = new SidecarLoaderClient(
        cfg(server.url, {
          transport: {
            mode: 'shared-volume',
            hostPath: '/data/att/',
            sidecarPath: '/uploads/'
          }
        })
      );
      await client.load(input('/data/att/ab/abcdef'), ctx());
      const loadCall = server.captured.find((c) => c.pathname === '/load');
      expect(loadCall?.meta?.localPath).toBe('/uploads/ab/abcdef');
    });

    it('requires a localPath input', async () => {
      server = await startFakeSidecar({ '/load': okRoute });
      const client = new SidecarLoaderClient(sv('/data/att'));
      await expect(
        client.load(
          {
            kind: 'bytes',
            bytes: new Uint8Array([1]),
            mimeType: 'audio/mpeg'
          },
          ctx()
        )
      ).rejects.toThrow(/requires a localPath input/);
    });
  });

  describe('multipart upload of a localPath input', () => {
    it('checks maxBytes with stat before reading the file', async () => {
      server = await startFakeSidecar({
        '/load': { status: 200, body: '{}' }
      });
      const tmp = await mkdtemp(path.join(tmpdir(), 'pgm-sc-big-'));
      try {
        const file = path.join(tmp, 'big');
        await writeFile(file, '');
        await truncate(file, 50 * 1024 * 1024); // sparse
        await chmod(file, 0o000); // unreadable: a read before the size check would fail with EACCES
        const client = new SidecarLoaderClient(
          cfg(server.url, { maxBytes: 1024 })
        );
        await expect(
          client.load(
            {
              kind: 'localPath',
              path: file,
              mimeType: 'application/x-test'
            },
            ctx()
          )
        ).rejects.toThrow(/exceeds maxBytes/);
        expect(
          server.captured.find((c) => c.pathname === '/load')
        ).toBeUndefined();
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    });
  });
});

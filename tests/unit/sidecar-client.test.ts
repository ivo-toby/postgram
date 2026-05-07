import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SidecarLoaderClient,
  SidecarError,
} from '../../src/services/loaders/sidecar-client.js';
import type { SidecarLoaderConfig } from '../../src/types/postgram-config.js';
import type { LoaderContext } from '../../src/types/loader.js';

type FakeRoute = {
  status: number;
  body: string;
  contentType?: string;
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
    error: () => {},
  };
}

function ctx(signal?: AbortSignal): LoaderContext {
  return {
    tmpDir: '/tmp',
    logger: silentLogger(),
    fetch: globalThis.fetch.bind(globalThis),
    options: {},
    signal: signal ?? new AbortController().signal,
  };
}

async function startFakeSidecar(
  routes: Record<string, FakeRoute>,
): Promise<{ url: string; close: () => Promise<void>; captured: CapturedRequest[] }> {
  const captured: CapturedRequest[] = [];
  const server = await new Promise<Server>((resolve, reject) => {
    const s = createServer(async (req, res) => {
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
            Array.isArray(v) ? v.join(',') : (v ?? ''),
          ]),
        ),
      };

      const ct = req.headers['content-type'] ?? '';
      if (ct.startsWith('multipart/form-data')) {
        const text = body.toString('utf8');
        const metaMatch = text.match(/Content-Type: application\/json[\s\S]*?\r\n\r\n([\s\S]*?)\r\n--/);
        if (metaMatch?.[1]) {
          try {
            cap.meta = JSON.parse(metaMatch[1]);
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
      res.statusCode = route.status;
      if (route.contentType) {
        res.setHeader('content-type', route.contentType);
      }
      res.end(route.body);
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
      }),
  };
}

function cfg(
  endpoint: string,
  overrides: Partial<SidecarLoaderConfig> = {},
): SidecarLoaderConfig {
  return {
    kind: 'sidecar',
    name: 'test-sidecar',
    endpoint,
    accepts: { mimeTypes: ['application/x-test'] },
    priority: 0,
    timeoutMs: 5_000,
    maxBytes: 10_000_000,
    concurrency: 1,
    healthCheckIntervalMs: 30_000,
    transport: { mode: 'multipart' },
    options: {},
    enabled: true,
    ...overrides,
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
          accepts: { mimeTypes: ['application/x-test'] },
        }),
      },
    });
    const client = new SidecarLoaderClient(cfg(server.url));
    expect(client.version).toBe('unknown');
    const manifest = await client.probeManifest();
    expect(manifest?.version).toBe('7.8.9');
    expect(client.version).toBe('7.8.9');
  });

  it('healthz returns false when sidecar is unreachable', async () => {
    const client = new SidecarLoaderClient(
      cfg('http://127.0.0.1:1', { timeoutMs: 200 }),
    );
    const healthy = await client.healthz();
    expect(healthy).toBe(false);
  });

  it('POST /load uploads bytes as multipart and parses LoaderResult', async () => {
    server = await startFakeSidecar({
      '/load': {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          documentType: 'test',
          blocks: [{ kind: 'text', text: 'echo' }],
        }),
      },
    });
    const client = new SidecarLoaderClient(
      cfg(server.url, { sharedSecret: 's3cret' }),
    );
    const result = await client.load(
      {
        kind: 'bytes',
        bytes: new TextEncoder().encode('hello'),
        mimeType: 'application/x-test',
        filename: 'h.bin',
      },
      ctx(),
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
      '/load': { status: 500, body: 'whisper crashed' },
    });
    const client = new SidecarLoaderClient(cfg(server.url));
    await expect(
      client.load(
        {
          kind: 'bytes',
          bytes: new Uint8Array([1, 2]),
          mimeType: 'application/x-test',
        },
        ctx(),
      ),
    ).rejects.toThrowError(SidecarError);
  });

  it('rejects payloads above maxBytes before hitting the network', async () => {
    server = await startFakeSidecar({
      '/load': { status: 200, body: '{}' },
    });
    const client = new SidecarLoaderClient(
      cfg(server.url, { maxBytes: 4 }),
    );
    await expect(
      client.load(
        {
          kind: 'bytes',
          bytes: new Uint8Array([1, 2, 3, 4, 5]),
          mimeType: 'application/x-test',
        },
        ctx(),
      ),
    ).rejects.toThrow(/exceeds maxBytes/);
    expect(server.captured.find((c) => c.pathname === '/load')).toBeUndefined();
  });

  it('shared-volume transport sends localPath instead of file', async () => {
    server = await startFakeSidecar({
      '/load': {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ documentType: 'audio', blocks: [] }),
      },
    });
    const client = new SidecarLoaderClient(
      cfg(server.url, {
        transport: {
          mode: 'shared-volume',
          hostPath: '/var/postgram/uploads',
          sidecarPath: '/uploads',
        },
      }),
    );
    await client.load(
      {
        kind: 'localPath',
        path: '/var/postgram/uploads/x.mp3',
        mimeType: 'audio/mpeg',
      },
      ctx(),
    );
    const loadCall = server.captured.find((c) => c.pathname === '/load');
    expect(loadCall?.hasFile).toBe(false);
    expect(loadCall?.meta?.localPath).toBe('/uploads/x.mp3');
  });
});

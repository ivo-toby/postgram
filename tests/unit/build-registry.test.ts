import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { buildRegistry } from '../../src/services/loaders/build-registry.js';
import type { SidecarLoaderClient } from '../../src/services/loaders/sidecar-client.js';
import type { DocumentLoader, LoaderResult } from '../../src/types/loader.js';
import type {
  InProcessLoaderConfig,
  LoadersConfig,
  SidecarLoaderConfig
} from '../../src/types/loaders-config.js';

const silentLogger = pino({ level: 'silent' });

function fakeLoader(name: string): DocumentLoader {
  return {
    name,
    version: '1.0.0',
    accepts: { mimeTypes: ['x/y'] },
    load: (): Promise<LoaderResult> =>
      Promise.resolve({ documentType: 'x', blocks: [] })
  };
}

function inProcess(
  name: string,
  overrides: Partial<InProcessLoaderConfig> = {}
): InProcessLoaderConfig {
  return {
    kind: 'in-process',
    name,
    package: `@x/${name}`,
    accepts: { mimeTypes: ['application/pdf'] },
    priority: 0,
    options: {},
    enabled: true,
    ...overrides
  };
}

function sidecar(
  name: string,
  overrides: Partial<SidecarLoaderConfig> = {}
): SidecarLoaderConfig {
  return {
    kind: 'sidecar',
    name,
    endpoint: 'http://127.0.0.1:1',
    accepts: { mimeTypes: ['audio/mpeg'] },
    priority: 0,
    maxBytes: 1000,
    maxResponseBytes: 1000,
    transport: { mode: 'multipart' },
    options: {},
    enabled: true,
    ...overrides
  };
}

function spyLogger() {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
  return { logger, asPino: logger as unknown as pino.Logger };
}

describe('buildRegistry', () => {
  it('registers a single in-process loader and resolves it', async () => {
    const cfg: LoadersConfig = {
      version: 1,
      pluginsDir: '/plugins',
      loaders: [inProcess('pdf')]
    };
    const registry = await buildRegistry(cfg, silentLogger, {
      importer: () => Promise.resolve(fakeLoader('pdf'))
    });
    const list = registry.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('pdf');
    expect(list[0]?.status).toBe('ok');
  });

  it('records load failures in the failed list', async () => {
    const cfg: LoadersConfig = {
      version: 1,
      pluginsDir: '/plugins',
      loaders: [inProcess('broken'), inProcess('good')]
    };
    const registry = await buildRegistry(cfg, silentLogger, {
      importer: (_roots, entry) =>
        entry.name === 'broken'
          ? Promise.reject(new Error('cannot find module'))
          : Promise.resolve(fakeLoader('good'))
    });
    const list = registry.list();
    expect(list).toHaveLength(2);
    const broken = list.find((l) => l.name === 'broken');
    const good = list.find((l) => l.name === 'good');
    expect(broken?.status).toBe('load_failed');
    expect(broken?.reason).toMatch(/cannot find module/);
    expect(good?.status).toBe('ok');
  });

  it('skips loaders disabled in config', async () => {
    const cfg: LoadersConfig = {
      version: 1,
      loaders: [inProcess('off', { enabled: false })]
    };
    const registry = await buildRegistry(cfg, silentLogger, {
      importer: () =>
        Promise.reject(new Error('should not be called for disabled loader'))
    });
    expect(registry.list()).toHaveLength(0);
  });

  it('passes pluginsDir first, then the app root, to the importer', async () => {
    const cfg: LoadersConfig = {
      version: 1,
      pluginsDir: '/plugins',
      loaders: [inProcess('pdf')]
    };
    let seen: string[] = [];
    await buildRegistry(cfg, silentLogger, {
      appRoot: '/app',
      importer: (roots) => {
        seen = roots;
        return Promise.resolve(fakeLoader('pdf'));
      }
    });
    expect(seen).toEqual(['/plugins', '/app']);
  });

  it('uses only the app root when pluginsDir is not set', async () => {
    const cfg: LoadersConfig = { version: 1, loaders: [inProcess('pdf')] };
    let seen: string[] = [];
    await buildRegistry(cfg, silentLogger, {
      appRoot: '/app',
      importer: (roots) => {
        seen = roots;
        return Promise.resolve(fakeLoader('pdf'));
      }
    });
    expect(seen).toEqual(['/app']);
  });

  it('does not throw when a loader fails to import and marks it failed', async () => {
    const cfg: LoadersConfig = { version: 1, loaders: [inProcess('pdf')] };
    const registry = await buildRegistry(cfg, silentLogger, {
      appRoot: '/app',
      importer: () => Promise.reject(new Error('boom'))
    });
    expect(registry.list()[0]).toMatchObject({
      name: 'pdf',
      status: 'load_failed',
      enabled: false,
      reason: 'boom'
    });
    expect(registry.acceptedTypes()).toEqual({ mimeTypes: [], extensions: [] });
    expect(
      registry.resolveByTypeOrName({ mimeType: 'application/pdf' }).ok
    ).toBe(false);
  });

  it('records a non-Error rejection as a string reason', async () => {
    const cfg: LoadersConfig = { version: 1, loaders: [inProcess('pdf')] };
    const registry = await buildRegistry(cfg, silentLogger, {
      appRoot: '/app',
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- non-Error rejection is the case under test
      importer: () => Promise.reject('plain string failure')
    });
    expect(registry.list()[0]).toMatchObject({
      status: 'load_failed',
      reason: 'plain string failure'
    });
  });

  describe('with the real importer', () => {
    it('marks a module that throws at import as failed and keeps the others', async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'pgm-build-'));
      try {
        await writeFile(
          path.join(dir, 'package.json'),
          JSON.stringify({ name: 'host', version: '0.0.0' })
        );
        for (const [pkg, body] of [
          ['bad-loader', `throw new Error('kaboom at import');`],
          [
            'good-loader',
            `export default { name: 'good', version: '1.0.0', accepts: { mimeTypes: ['a/b'] }, async load() { return { documentType: 'x', blocks: [] }; } };`
          ]
        ] as const) {
          const pkgDir = path.join(dir, 'node_modules', pkg);
          await mkdir(pkgDir, { recursive: true });
          await writeFile(
            path.join(pkgDir, 'package.json'),
            JSON.stringify({
              name: pkg,
              version: '1.0.0',
              type: 'module',
              main: 'index.js'
            })
          );
          await writeFile(path.join(pkgDir, 'index.js'), body);
        }
        const cfg: LoadersConfig = {
          version: 1,
          loaders: [
            inProcess('bad', { package: 'bad-loader' }),
            inProcess('good', { package: 'good-loader' })
          ]
        };
        const registry = await buildRegistry(cfg, silentLogger, {
          appRoot: dir
        });
        const list = registry.list();
        expect(list.find((l) => l.name === 'good')?.status).toBe('ok');
        const bad = list.find((l) => l.name === 'bad');
        expect(bad?.status).toBe('load_failed');
        expect(bad?.reason).toMatch(/kaboom at import/);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('warns, without mutating the loader, when a frozen loader name differs from the config name', async () => {
      const { logger, asPino } = spyLogger();
      const frozen = Object.freeze(fakeLoader('different-name'));
      const registry = await buildRegistry(
        { version: 1, loaders: [inProcess('pdf')] },
        asPino,
        { importer: () => Promise.resolve(frozen) }
      );
      expect(registry.list()[0]?.status).toBe('ok');
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const [payload] = logger.warn.mock.calls[0] as [
        Record<string, unknown>,
        string
      ];
      expect(payload).toMatchObject({
        loader: 'pdf',
        loaderReportedName: 'different-name'
      });
      expect(Object.keys(frozen)).not.toContain('__nameMismatch');
    });

    it('does not warn when the names match', async () => {
      const { logger, asPino } = spyLogger();
      await buildRegistry({ version: 1, loaders: [inProcess('pdf')] }, asPino, {
        importer: () => Promise.resolve(fakeLoader('pdf'))
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('sidecar loaders', () => {
    const fakeSidecar = (
      probe: SidecarLoaderClient['probeManifest']
    ): SidecarLoaderClient =>
      ({
        name: 'whisper',
        version: 'unknown',
        accepts: { mimeTypes: ['audio/mpeg'] },
        priority: 0,
        probeManifest: probe,
        load: () => Promise.resolve({ documentType: 'audio', blocks: [] })
      }) as unknown as SidecarLoaderClient;

    it('registers a sidecar loader even if the manifest probe returns nothing', async () => {
      const registry = await buildRegistry(
        { version: 1, loaders: [sidecar('whisper')] },
        silentLogger,
        {
          sidecarFactory: () => fakeSidecar(() => Promise.resolve(null))
        }
      );
      const list = registry.list();
      expect(list).toHaveLength(1);
      expect(list[0]?.kind).toBe('sidecar');
      expect(list[0]?.status).toBe('ok');
    });

    it('registers a sidecar loader and warns when the probe rejects', async () => {
      const { logger, asPino } = spyLogger();
      const registry = await buildRegistry(
        { version: 1, loaders: [sidecar('whisper')] },
        asPino,
        {
          sidecarFactory: () =>
            fakeSidecar(() => Promise.reject(new Error('connection refused')))
        }
      );
      expect(registry.list()[0]?.status).toBe('ok');
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const [payload] = logger.warn.mock.calls[0] as [Record<string, unknown>];
      expect(payload).toMatchObject({
        loader: 'whisper',
        err: 'connection refused'
      });
    });

    it('stringifies non-Error probe rejections', async () => {
      const { logger, asPino } = spyLogger();
      await buildRegistry(
        { version: 1, loaders: [sidecar('whisper')] },
        asPino,
        {
          sidecarFactory: () =>
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- non-Error rejection is the case under test
            fakeSidecar(() => Promise.reject('just text'))
        }
      );
      const [payload] = logger.warn.mock.calls[0] as [Record<string, unknown>];
      expect(payload.err).toBe('just text');
    });

    it('probes the manifest with a 5 second timeout signal', async () => {
      const seen: (AbortSignal | undefined)[] = [];
      await buildRegistry(
        { version: 1, loaders: [sidecar('whisper')] },
        silentLogger,
        {
          sidecarFactory: () =>
            fakeSidecar((signal) => {
              seen.push(signal);
              return Promise.resolve(null);
            })
        }
      );
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBeInstanceOf(AbortSignal);
      expect(seen[0]?.aborted).toBe(false);
    });

    it('records a sidecar whose factory throws as failed and keeps the others', async () => {
      const registry = await buildRegistry(
        {
          version: 1,
          loaders: [sidecar('broken'), inProcess('pdf')]
        },
        silentLogger,
        {
          sidecarFactory: () => {
            throw new Error('bad endpoint');
          },
          importer: () => Promise.resolve(fakeLoader('pdf'))
        }
      );
      const list = registry.list();
      expect(list.find((l) => l.name === 'pdf')?.status).toBe('ok');
      expect(list.find((l) => l.name === 'broken')).toMatchObject({
        status: 'load_failed',
        reason: 'bad endpoint'
      });
    });
  });
});

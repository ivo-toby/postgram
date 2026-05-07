import { describe, expect, it } from 'vitest';
import pino from 'pino';

import { buildRegistry } from '../../src/services/loaders/build-registry.js';
import type { SidecarLoaderClient } from '../../src/services/loaders/sidecar-client.js';
import type {
  DocumentLoader,
  LoaderResult,
} from '../../src/types/loader.js';
import type { PostgramConfig } from '../../src/types/postgram-config.js';

const silentLogger = pino({ level: 'silent' });

function fakeLoader(name: string): DocumentLoader {
  return {
    name,
    version: '1.0.0',
    accepts: { mimeTypes: ['x/y'] },
    async load(): Promise<LoaderResult> {
      return { documentType: 'x', blocks: [] };
    },
  };
}

describe('buildRegistry', () => {
  it('registers a single in-process loader and resolves it', async () => {
    const cfg: PostgramConfig = {
      version: 1,
      pluginsDir: '/plugins',
      attachmentsDir: '/att',
      loaders: [
        {
          kind: 'in-process',
          name: 'pdf',
          package: '@x/pdf',
          accepts: { mimeTypes: ['application/pdf'] },
          priority: 0,
          options: {},
          enabled: true,
        },
      ],
    };

    const registry = await buildRegistry(cfg, silentLogger, {
      importer: async () => fakeLoader('pdf'),
    });

    const list = registry.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('pdf');
    expect(list[0]?.status).toBe('ok');
  });

  it('records load failures in the failed list', async () => {
    const cfg: PostgramConfig = {
      version: 1,
      pluginsDir: '/plugins',
      attachmentsDir: '/att',
      loaders: [
        {
          kind: 'in-process',
          name: 'broken',
          package: '@x/broken',
          accepts: { mimeTypes: ['x/y'] },
          priority: 0,
          options: {},
          enabled: true,
        },
        {
          kind: 'in-process',
          name: 'good',
          package: '@x/good',
          accepts: { mimeTypes: ['a/b'] },
          priority: 0,
          options: {},
          enabled: true,
        },
      ],
    };

    const registry = await buildRegistry(cfg, silentLogger, {
      importer: async (_dir, entry) => {
        if (entry.name === 'broken') {
          throw new Error('cannot find module');
        }
        return fakeLoader('good');
      },
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
    const cfg: PostgramConfig = {
      version: 1,
      pluginsDir: '/plugins',
      attachmentsDir: '/att',
      loaders: [
        {
          kind: 'in-process',
          name: 'off',
          package: '@x/off',
          accepts: { mimeTypes: ['x/y'] },
          priority: 0,
          options: {},
          enabled: false,
        },
      ],
    };

    const registry = await buildRegistry(cfg, silentLogger, {
      importer: async () => {
        throw new Error('should not be called for disabled loader');
      },
    });
    expect(registry.list()).toHaveLength(0);
  });

  it('registers a sidecar loader even if manifest probe fails', async () => {
    const cfg: PostgramConfig = {
      version: 1,
      pluginsDir: '/plugins',
      attachmentsDir: '/att',
      loaders: [
        {
          kind: 'sidecar',
          name: 'whisper',
          endpoint: 'http://127.0.0.1:1',
          accepts: { mimeTypes: ['audio/mpeg'] },
          priority: 0,
          timeoutMs: 200,
          maxBytes: 1000,
          concurrency: 1,
          healthCheckIntervalMs: 30_000,
          transport: { mode: 'multipart' },
          options: {},
          enabled: true,
        },
      ],
    };

    const fakeSidecar = {
      name: 'whisper',
      version: 'unknown',
      accepts: { mimeTypes: ['audio/mpeg'] },
      priority: 0,
      probeManifest: async () => null,
      load: async () => ({ documentType: 'audio', blocks: [] }),
    } as unknown as SidecarLoaderClient;

    const registry = await buildRegistry(cfg, silentLogger, {
      sidecarFactory: () => fakeSidecar,
    });
    const list = registry.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.kind).toBe('sidecar');
    expect(list[0]?.status).toBe('ok');
  });
});

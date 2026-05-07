import { describe, expect, it } from 'vitest';

import {
  LoaderRegistry,
  type RegisteredLoader,
} from '../../src/services/loaders/registry.js';
import type { DocumentLoader, LoaderResult } from '../../src/types/loader.js';
import type { InProcessLoaderConfig } from '../../src/types/postgram-config.js';

function fakeLoader(
  name: string,
  accepts: DocumentLoader['accepts'] = { mimeTypes: ['application/pdf'] },
): DocumentLoader {
  return {
    name,
    version: '0.0.1',
    accepts,
    async load(): Promise<LoaderResult> {
      return { documentType: 'pdf', blocks: [] };
    },
  };
}

function entry(
  name: string,
  overrides: Partial<InProcessLoaderConfig> = {},
): RegisteredLoader {
  const config = {
    kind: 'in-process' as const,
    name,
    package: `@x/${name}`,
    accepts: { mimeTypes: ['application/pdf'] },
    priority: 0,
    options: {},
    enabled: true,
    ...overrides,
  } as InProcessLoaderConfig;
  return {
    loader: fakeLoader(name, config.accepts),
    config,
    enabled: config.enabled,
    status: 'ok',
  };
}

describe('LoaderRegistry', () => {
  it('returns no_loader when nothing matches', () => {
    const reg = new LoaderRegistry([entry('pdf')]);
    const result = reg.resolve({
      kind: 'bytes',
      bytes: new Uint8Array(),
      mimeType: 'audio/mpeg',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('no_loader');
  });

  it('picks the only matching loader', () => {
    const reg = new LoaderRegistry([entry('pdf')]);
    const result = reg.resolve({
      kind: 'bytes',
      bytes: new Uint8Array(),
      mimeType: 'application/pdf',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entry.config.name).toBe('pdf');
  });

  it('picks the higher-priority loader when multiple match', () => {
    const reg = new LoaderRegistry([
      entry('pdf-a', { priority: 0 }),
      entry('pdf-b', { priority: 5 }),
    ]);
    const result = reg.resolve({
      kind: 'bytes',
      bytes: new Uint8Array(),
      mimeType: 'application/pdf',
    });
    if (!result.ok) throw new Error('expected ok');
    expect(result.entry.config.name).toBe('pdf-b');
  });

  it('falls back to registration order on equal priority', () => {
    const reg = new LoaderRegistry([
      entry('first'),
      entry('second'),
    ]);
    const result = reg.resolve({
      kind: 'bytes',
      bytes: new Uint8Array(),
      mimeType: 'application/pdf',
    });
    if (!result.ok) throw new Error('expected ok');
    expect(result.entry.config.name).toBe('first');
  });

  it('skips disabled loaders', () => {
    const a = entry('a');
    const b = entry('b');
    a.enabled = false;
    const reg = new LoaderRegistry([a, b]);
    const result = reg.resolve({
      kind: 'bytes',
      bytes: new Uint8Array(),
      mimeType: 'application/pdf',
    });
    if (!result.ok) throw new Error('expected ok');
    expect(result.entry.config.name).toBe('b');
  });

  it('list() includes failed loaders', () => {
    const reg = new LoaderRegistry(
      [entry('pdf')],
      [
        {
          config: {
            kind: 'in-process',
            name: 'broken',
            package: '@x/broken',
            accepts: { mimeTypes: ['x/y'] },
            priority: 0,
            options: {},
            enabled: true,
          },
          reason: 'cannot find module',
        },
      ],
    );
    const list = reg.list();
    expect(list).toHaveLength(2);
    const broken = list.find((l) => l.name === 'broken');
    expect(broken?.status).toBe('load_failed');
    expect(broken?.reason).toBe('cannot find module');
  });

  it('setEnabled flips a loader on and off', () => {
    const reg = new LoaderRegistry([entry('pdf')]);
    expect(reg.setEnabled('pdf', false)).toBe(true);
    const result = reg.resolve({
      kind: 'bytes',
      bytes: new Uint8Array(),
      mimeType: 'application/pdf',
    });
    expect(result.ok).toBe(false);
    expect(reg.setEnabled('pdf', true)).toBe(true);
    expect(reg.setEnabled('does-not-exist', true)).toBe(false);
  });
});

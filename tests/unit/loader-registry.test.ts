import { describe, expect, it } from 'vitest';

import {
  LoaderRegistry,
  type RegisteredLoader
} from '../../src/services/loaders/registry.js';
import type { DocumentLoader, LoaderResult } from '../../src/types/loader.js';
import type { InProcessLoaderConfig } from '../../src/types/loaders-config.js';

function fakeLoader(
  name: string,
  accepts: DocumentLoader['accepts'] = { mimeTypes: ['application/pdf'] }
): DocumentLoader {
  return {
    name,
    version: '0.0.1',
    accepts,
    load: (): Promise<LoaderResult> =>
      Promise.resolve({ documentType: 'pdf', blocks: [] })
  };
}

function entry(
  name: string,
  overrides: Partial<InProcessLoaderConfig> = {}
): RegisteredLoader {
  const config = {
    kind: 'in-process' as const,
    name,
    package: `@x/${name}`,
    accepts: { mimeTypes: ['application/pdf'] },
    priority: 0,
    options: {},
    enabled: true,
    ...overrides
  } as InProcessLoaderConfig;
  return {
    loader: fakeLoader(name, config.accepts),
    config,
    enabled: config.enabled,
    status: 'ok'
  };
}

const pdf = () =>
  entry('pdf', {
    accepts: { mimeTypes: ['application/pdf'], extensions: ['.pdf'] }
  });

describe('LoaderRegistry', () => {
  describe('resolve (bytes and localPath inputs)', () => {
    it('returns no_loader when nothing matches', () => {
      const reg = new LoaderRegistry([entry('pdf')]);
      const result = reg.resolve({
        kind: 'bytes',
        bytes: new Uint8Array(),
        mimeType: 'audio/mpeg'
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('no_loader');
    });

    it('picks the only matching loader', () => {
      const reg = new LoaderRegistry([entry('pdf')]);
      const result = reg.resolve({
        kind: 'bytes',
        bytes: new Uint8Array(),
        mimeType: 'application/pdf'
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.entry.config.name).toBe('pdf');
    });

    it('picks the higher-priority loader when multiple match', () => {
      const reg = new LoaderRegistry([
        entry('pdf-a', { priority: 0 }),
        entry('pdf-b', { priority: 5 })
      ]);
      const result = reg.resolve({
        kind: 'bytes',
        bytes: new Uint8Array(),
        mimeType: 'application/pdf'
      });
      if (!result.ok) throw new Error('expected ok');
      expect(result.entry.config.name).toBe('pdf-b');
    });

    it('falls back to registration order on equal priority', () => {
      const reg = new LoaderRegistry([entry('first'), entry('second')]);
      const result = reg.resolve({
        kind: 'bytes',
        bytes: new Uint8Array(),
        mimeType: 'application/pdf'
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
        mimeType: 'application/pdf'
      });
      if (!result.ok) throw new Error('expected ok');
      expect(result.entry.config.name).toBe('b');
    });

    it('uses the filename of a localPath input for the extension fallback', () => {
      const reg = new LoaderRegistry([pdf()]);
      const result = reg.resolve({
        kind: 'localPath',
        path: '/store/ab/abcdef',
        filename: 'Report.PDF',
        mimeType: 'application/octet-stream'
      });
      if (!result.ok) throw new Error('expected ok');
      expect(result.entry.config.name).toBe('pdf');
    });

    it('falls back to the extension of the path of a localPath input without filename', () => {
      const reg = new LoaderRegistry([pdf()]);
      const result = reg.resolve({
        kind: 'localPath',
        path: '/uploads/Report Final.pdf',
        mimeType: ''
      });
      expect(result.ok).toBe(true);
    });

    it('does not match an extensionless localPath without filename', () => {
      const reg = new LoaderRegistry([pdf()]);
      const result = reg.resolve({
        kind: 'localPath',
        path: '/store/ab/abcdef',
        mimeType: 'application/octet-stream'
      });
      expect(result.ok).toBe(false);
    });

    it('applies the same rule as resolveByTypeOrName (MIME first)', () => {
      const reg = new LoaderRegistry([
        entry('ext', {
          priority: 9,
          accepts: { extensions: ['.pdf'], mimeTypes: ['x/ext'] }
        }),
        pdf()
      ]);
      const result = reg.resolve({
        kind: 'localPath',
        path: '/store/ab/abcdef',
        filename: 'a.pdf',
        mimeType: 'application/pdf'
      });
      if (!result.ok) throw new Error('expected ok');
      expect(result.entry.config.name).toBe('pdf');
    });
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
            enabled: true
          },
          reason: 'cannot find module'
        }
      ]
    );
    const list = reg.list();
    expect(list).toHaveLength(2);
    const broken = list.find((l) => l.name === 'broken');
    expect(broken?.status).toBe('load_failed');
    expect(broken?.reason).toBe('cannot find module');
  });

  it('has no runtime enable/disable API', () => {
    const reg = new LoaderRegistry([entry('pdf')]) as unknown as Record<
      string,
      unknown
    >;
    expect(reg.setEnabled).toBeUndefined();
  });

  describe('acceptedTypes', () => {
    it('returns the deduplicated MIME types and extensions of enabled loaders', () => {
      const reg = new LoaderRegistry([
        entry('pdf', {
          accepts: { mimeTypes: ['application/pdf'], extensions: ['.pdf'] }
        }),
        entry('pdf2', {
          accepts: {
            mimeTypes: ['application/pdf'],
            extensions: ['.PDF', '.ps']
          }
        }),
        entry('doc', {
          accepts: { mimeTypes: ['text/markdown'], extensions: ['.md'] }
        })
      ]);
      expect(reg.acceptedTypes()).toEqual({
        mimeTypes: ['application/pdf', 'text/markdown'],
        extensions: ['.pdf', '.ps', '.md']
      });
    });

    it('excludes disabled and failed loaders', () => {
      const off = entry('off', { accepts: { mimeTypes: ['a/off'] } });
      off.enabled = false;
      const bad = entry('bad', { accepts: { mimeTypes: ['a/bad'] } });
      bad.status = 'load_failed';
      const reg = new LoaderRegistry(
        [off, bad, entry('pdf')],
        [
          {
            config: {
              kind: 'in-process',
              name: 'broken',
              package: '@x/broken',
              accepts: { mimeTypes: ['a/broken'], extensions: ['.brk'] },
              priority: 0,
              options: {},
              enabled: true
            },
            reason: 'nope'
          }
        ]
      );
      expect(reg.acceptedTypes()).toEqual({
        mimeTypes: ['application/pdf'],
        extensions: []
      });
    });
  });

  describe('resolveByTypeOrName', () => {
    it('resolves by MIME type and echoes the normalised type', () => {
      const reg = new LoaderRegistry([pdf()]);
      const r = reg.resolveByTypeOrName({ mimeType: 'Application/PDF' });
      if (!r.ok) throw new Error('expected ok');
      expect(r.entry.config.name).toBe('pdf');
      expect(r.mimeType).toBe('application/pdf');
    });

    it('strips MIME parameters', () => {
      const reg = new LoaderRegistry([pdf()]);
      const r = reg.resolveByTypeOrName({
        mimeType: 'application/pdf; charset=binary'
      });
      if (!r.ok) throw new Error('expected ok');
      expect(r.mimeType).toBe('application/pdf');
    });

    it('resolves by extension when the MIME type is empty, octet-stream or missing', () => {
      const reg = new LoaderRegistry([pdf()]);
      for (const mimeType of [
        '',
        'application/octet-stream',
        'Application/Octet-Stream; x=y',
        undefined
      ]) {
        const r = reg.resolveByTypeOrName({ mimeType, filename: 'A.PDF' });
        if (!r.ok) throw new Error('expected ok');
        expect(r.entry.config.name).toBe('pdf');
        expect(r.mimeType).toBe('application/pdf');
      }
    });

    it('falls back to the extension when the informative type matches no loader', () => {
      const reg = new LoaderRegistry([pdf()]);
      const r = reg.resolveByTypeOrName({
        mimeType: 'text/plain',
        filename: 'x.pdf'
      });
      if (!r.ok) throw new Error('expected ok');
      expect(r.entry.config.name).toBe('pdf');
      expect(r.mimeType).toBe('application/pdf');
    });

    it('lets a MIME match win over an extension-only loader of higher priority', () => {
      const reg = new LoaderRegistry([
        entry('by-ext', { priority: 100, accepts: { extensions: ['.pdf'] } }),
        entry('by-mime', {
          priority: 0,
          accepts: { mimeTypes: ['application/pdf'] }
        })
      ]);
      const r = reg.resolveByTypeOrName({
        mimeType: 'application/pdf',
        filename: 'x.pdf'
      });
      if (!r.ok) throw new Error('expected ok');
      expect(r.entry.config.name).toBe('by-mime');
    });

    it('does not use the extension when the MIME type matches a loader', () => {
      const reg = new LoaderRegistry([
        entry('md', { accepts: { mimeTypes: ['text/markdown'] } }),
        entry('pdf-ext', { accepts: { extensions: ['.pdf'] } })
      ]);
      const r = reg.resolveByTypeOrName({
        mimeType: 'text/markdown',
        filename: 'x.pdf'
      });
      if (!r.ok) throw new Error('expected ok');
      expect(r.entry.config.name).toBe('md');
      expect(r.mimeType).toBe('text/markdown');
    });

    it('applies priority and configuration order within a pass', () => {
      const reg = new LoaderRegistry([
        entry('a', { accepts: { extensions: ['.x'] } }),
        entry('b', { priority: 3, accepts: { extensions: ['.x'] } }),
        entry('c', { priority: 3, accepts: { extensions: ['.x'] } })
      ]);
      const r = reg.resolveByTypeOrName({ filename: 'f.x' });
      if (!r.ok) throw new Error('expected ok');
      expect(r.entry.config.name).toBe('b');
    });

    it('uses the first concrete MIME type, skipping wildcards', () => {
      const reg = new LoaderRegistry([
        entry('multi', {
          accepts: {
            mimeTypes: ['text/*', 'text/markdown'],
            extensions: ['.md']
          }
        })
      ]);
      const r = reg.resolveByTypeOrName({ filename: 'a.md' });
      if (!r.ok) throw new Error('expected ok');
      expect(r.mimeType).toBe('text/markdown');
    });

    it('falls back to octet-stream when the loader declares no concrete type', () => {
      const reg = new LoaderRegistry([
        entry('ext', { accepts: { extensions: ['.xyz'] } })
      ]);
      const r = reg.resolveByTypeOrName({ filename: 'a.xyz' });
      if (!r.ok) throw new Error('expected ok');
      expect(r.mimeType).toBe('application/octet-stream');
    });

    it('returns no_loader for an unknown type and extension', () => {
      const reg = new LoaderRegistry([pdf()]);
      const r = reg.resolveByTypeOrName({
        mimeType: 'application/octet-stream',
        filename: 'x.bin'
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('no_loader');
    });

    it('returns no_loader when nothing is given', () => {
      const reg = new LoaderRegistry([pdf()]);
      expect(reg.resolveByTypeOrName({}).ok).toBe(false);
    });

    it('does not match disabled or failed loaders', () => {
      const off = pdf();
      off.enabled = false;
      const bad = entry('bad');
      bad.status = 'load_failed';
      const reg = new LoaderRegistry([off, bad]);
      expect(reg.resolveByTypeOrName({ mimeType: 'application/pdf' }).ok).toBe(
        false
      );
    });
  });
});

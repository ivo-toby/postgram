import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import loader from '../../packages/loader-pdf/src/index.js';
import { parseLoaderResult } from '../../src/types/loader.js';
import type {
  DocumentLoader,
  LoaderContext,
  LoaderInput
} from '../../src/types/loader.js';

// Compile-time guard: typecheck fails when the contract copy in the package
// drifts from the server's DocumentLoader type.
export const assignableToServerContract: DocumentLoader = loader;

const fixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures'
);
const fixture = (name: string) => path.join(fixtures, name);

function ctx(
  options: Record<string, unknown> = {},
  signal: AbortSignal = new AbortController().signal
): LoaderContext {
  return {
    tmpDir: '/nonexistent',
    logger: {
      trace() {},
      debug() {},
      info() {},
      warn() {},
      error() {}
    },
    fetch: () => Promise.reject(new Error('fetch is not used')),
    options,
    signal
  };
}

const fromPath = (name: string): LoaderInput => ({
  kind: 'localPath',
  path: fixture(name),
  mimeType: 'application/pdf',
  filename: name
});

describe('pdf loader', () => {
  it('declares its identity', () => {
    expect(loader.name).toBe('pdf');
    expect(loader.accepts.mimeTypes).toContain('application/pdf');
    expect(loader.accepts.extensions).toContain('.pdf');
  });

  it('returns one text block per page with 1-based page numbers', async () => {
    const result = await loader.load(fromPath('three-pages.pdf'), ctx());
    expect(result.documentType).toBe('pdf');
    expect('attachments' in result).toBe(false);
    expect(result.blocks.map((b) => b.metadata?.page)).toEqual([1, 2, 3]);
    const texts = result.blocks.map((b) => (b.kind === 'text' ? b.text : ''));
    expect(texts[0]).toContain(
      'Postgram fixture page one: the quick brown fox'
    );
    expect(texts[1]).toBe('Postgram fixture page two: jumps over the lazy dog');
    expect(texts[2]).toBe('Postgram fixture page three: zebra quartz vexing');
    // The output must satisfy the host contract.
    expect(() => parseLoaderResult(result)).not.toThrow();
  });

  it('keeps a paragraph break where the vertical gap is large', async () => {
    const result = await loader.load(fromPath('three-pages.pdf'), ctx());
    const first = result.blocks[0];
    expect(first?.kind === 'text' && first.text).toBe(
      'Postgram fixture page one: the quick brown fox\n\nSecond paragraph on page one.'
    );
  });

  it('reports pageCount and the PDF title', async () => {
    const result = await loader.load(fromPath('three-pages.pdf'), ctx());
    expect(result.metadata).toMatchObject({
      pageCount: 3,
      pdfTitle: 'Postgram fixture document'
    });
    expect(result.metadata?.truncated).toBeUndefined();
  });

  it('accepts a bytes input', async () => {
    const bytes = new Uint8Array(await readFile(fixture('three-pages.pdf')));
    const result = await loader.load(
      { kind: 'bytes', bytes, mimeType: 'application/pdf' },
      ctx()
    );
    expect(result.blocks).toHaveLength(3);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it('stops at maxPages and flags truncation', async () => {
    const result = await loader.load(
      fromPath('three-pages.pdf'),
      ctx({ maxPages: 2 })
    );
    expect(result.blocks.map((b) => b.metadata?.page)).toEqual([1, 2]);
    expect(result.metadata).toMatchObject({ pageCount: 3, truncated: true });
  });

  it('does not flag truncation when maxPages equals the page count', async () => {
    const result = await loader.load(
      fromPath('three-pages.pdf'),
      ctx({ maxPages: 3 })
    );
    expect(result.blocks).toHaveLength(3);
    expect(result.metadata?.truncated).toBeUndefined();
  });

  it.each([0, -1, 1.5, '10', null, Number.NaN])(
    'rejects an invalid maxPages (%j)',
    async (maxPages) => {
      await expect(
        loader.load(fromPath('three-pages.pdf'), ctx({ maxPages }))
      ).rejects.toThrow(/maxPages/);
    }
  );

  it('returns no blocks for a PDF without a text layer', async () => {
    const result = await loader.load(fromPath('no-text.pdf'), ctx());
    expect(result.blocks).toEqual([]);
    expect(result.documentType).toBe('pdf');
    expect(result.metadata).toMatchObject({ pageCount: 1 });
    expect(result.metadata?.pdfTitle).toBeUndefined();
  });

  it('throws a clear error for a corrupt file', async () => {
    await expect(loader.load(fromPath('corrupt.pdf'), ctx())).rejects.toThrow(
      /not a valid PDF|cannot be read/i
    );
  });

  it('throws a clear error for a password-protected file', async () => {
    await expect(
      loader.load(fromPath('encrypted-user-password.pdf'), ctx())
    ).rejects.toThrow(/password protected/i);
  });

  it('throws when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      loader.load(fromPath('three-pages.pdf'), ctx({}, controller.signal))
    ).rejects.toThrow(/abort/i);
  });

  it('checks the signal between pages', async () => {
    const controller = new AbortController();
    let checks = 0;
    // Abort once the loader has started the second page.
    const signal = new Proxy(controller.signal, {
      get(target, prop) {
        if (prop === 'throwIfAborted') {
          return () => {
            checks += 1;
            if (checks > 2) controller.abort();
            target.throwIfAborted();
          };
        }
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      }
    });
    await expect(
      loader.load(fromPath('three-pages.pdf'), ctx({}, signal))
    ).rejects.toThrow(/abort/i);
    expect(checks).toBeGreaterThan(2);
  });
});

describe('pdf loader fixtures', () => {
  it('are small', async () => {
    for (const name of [
      'three-pages.pdf',
      'no-text.pdf',
      'corrupt.pdf',
      'encrypted-user-password.pdf'
    ]) {
      expect((await readFile(fixture(name))).byteLength).toBeLessThan(8192);
    }
  });
});

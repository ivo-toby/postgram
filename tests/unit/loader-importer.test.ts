import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { importInProcessLoader } from '../../src/services/loaders/in-process-importer.js';
import type { InProcessLoaderConfig } from '../../src/types/loaders-config.js';

async function setupFakePlugin(opts: {
  pluginsDir: string;
  packageName: string;
  exportShape: 'default' | 'named' | 'cjs-default' | 'no-loader';
}): Promise<void> {
  const pkgDir = path.join(
    opts.pluginsDir,
    'node_modules',
    ...opts.packageName.split('/')
  );
  await mkdir(pkgDir, { recursive: true });

  await writeFile(
    path.join(opts.pluginsDir, 'package.json'),
    JSON.stringify({ name: 'host', version: '0.0.0' })
  );

  await writeFile(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({
      name: opts.packageName,
      version: '1.2.3',
      type: 'module',
      main: 'index.js'
    })
  );

  let body: string;
  switch (opts.exportShape) {
    case 'default':
      body = `
        const loader = {
          name: 'fake', version: '1.2.3',
          accepts: { mimeTypes: ['application/x-fake'] },
          async load() { return { documentType: 'fake', blocks: [] }; },
        };
        export default loader;
      `;
      break;
    case 'named':
      body = `
        export const loader = {
          name: 'fake', version: '1.2.3',
          accepts: { mimeTypes: ['application/x-fake'] },
          async load() { return { documentType: 'fake', blocks: [] }; },
        };
      `;
      break;
    case 'cjs-default':
      body = `
        export default {
          default: {
            name: 'fake', version: '1.2.3',
            accepts: { mimeTypes: ['application/x-fake'] },
            async load() { return { documentType: 'fake', blocks: [] }; },
          },
        };
      `;
      break;
    case 'no-loader':
      body = `export const unrelated = 42;`;
      break;
  }
  await writeFile(path.join(pkgDir, 'index.js'), body);
}

describe('importInProcessLoader', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'pgm-importer-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const cfg = (
    overrides: Partial<InProcessLoaderConfig> = {}
  ): InProcessLoaderConfig => ({
    kind: 'in-process',
    name: 'fake',
    package: 'fake-loader',
    accepts: { mimeTypes: ['application/x-fake'] },
    priority: 0,
    options: {},
    enabled: true,
    ...overrides
  });

  it('imports a default export', async () => {
    await setupFakePlugin({
      pluginsDir: dir,
      packageName: 'fake-loader',
      exportShape: 'default'
    });
    const loader = await importInProcessLoader([dir], cfg());
    expect(loader.name).toBe('fake');
    expect(loader.version).toBe('1.2.3');
  });

  it('imports a named `loader` export', async () => {
    await setupFakePlugin({
      pluginsDir: dir,
      packageName: 'fake-loader',
      exportShape: 'named'
    });
    const loader = await importInProcessLoader([dir], cfg());
    expect(loader.name).toBe('fake');
  });

  it('handles a cjs-style `module.exports = { default: ... }`', async () => {
    await setupFakePlugin({
      pluginsDir: dir,
      packageName: 'fake-loader',
      exportShape: 'cjs-default'
    });
    const loader = await importInProcessLoader([dir], cfg());
    expect(loader.name).toBe('fake');
  });

  it('throws when the package does not export a loader', async () => {
    await setupFakePlugin({
      pluginsDir: dir,
      packageName: 'fake-loader',
      exportShape: 'no-loader'
    });
    await expect(importInProcessLoader([dir], cfg())).rejects.toThrow(
      /did not export a DocumentLoader/
    );
  });

  it('throws a clear error when the package is missing', async () => {
    // No package created — pluginsDir exists but is empty.
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'host', version: '0.0.0' })
    );
    await expect(
      importInProcessLoader([dir], cfg({ package: 'nonexistent-pkg-xyz' }))
    ).rejects.toThrow(/cannot resolve package/);
  });

  it('uses the first root that resolves the package', async () => {
    const first = path.join(dir, 'first');
    const second = path.join(dir, 'second');
    await setupFakePlugin({
      pluginsDir: first,
      packageName: 'fake-loader',
      exportShape: 'default'
    });
    await setupFakePlugin({
      pluginsDir: second,
      packageName: 'fake-loader',
      exportShape: 'named'
    });
    // Mark the second plugin so we can tell which one loaded.
    await writeFile(
      path.join(second, 'node_modules', 'fake-loader', 'index.js'),
      `export default { name: 'fake', version: '9.9.9', accepts: { mimeTypes: ['a/b'] }, async load() { return { documentType: 'x', blocks: [] }; } };`
    );
    const loader = await importInProcessLoader([first, second], cfg());
    expect(loader.version).toBe('1.2.3');
  });

  it('falls through to a later root when earlier roots lack the package', async () => {
    const empty = path.join(dir, 'empty');
    const withPlugin = path.join(dir, 'with-plugin');
    await mkdir(empty, { recursive: true });
    await setupFakePlugin({
      pluginsDir: withPlugin,
      packageName: 'fake-loader',
      exportShape: 'default'
    });
    const loader = await importInProcessLoader([empty, withPlugin], cfg());
    expect(loader.name).toBe('fake');
  });

  it('lists every root it tried when the package cannot be resolved', async () => {
    const a = path.join(dir, 'a');
    const b = path.join(dir, 'b');
    await mkdir(a, { recursive: true });
    await mkdir(b, { recursive: true });
    const err = await importInProcessLoader(
      [a, b],
      cfg({ package: 'nonexistent-pkg-xyz' })
    ).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toMatch(/cannot resolve package 'nonexistent-pkg-xyz'/);
    expect(message).toContain(a);
    expect(message).toContain(b);
  });

  it('throws a clear error when no roots are given', async () => {
    await expect(importInProcessLoader([], cfg())).rejects.toThrow(
      /no root directories/
    );
  });

  describe('package resolution contract', () => {
    const loaderBody = `export default { name: 'fake', version: '1.0.0', accepts: { mimeTypes: ['a/b'] }, async load() { return { documentType: 'x', blocks: [] }; } };`;

    async function writePackage(
      pkgJson: Record<string, unknown>
    ): Promise<void> {
      const pkgDir = path.join(dir, 'node_modules', 'fake-loader');
      await mkdir(pkgDir, { recursive: true });
      await writeFile(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'host', version: '0.0.0' })
      );
      await writeFile(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({
          name: 'fake-loader',
          version: '1.0.0',
          type: 'module',
          ...pkgJson
        })
      );
      await writeFile(path.join(pkgDir, 'index.js'), loaderBody);
    }

    it('resolves an exports map with a "default" condition', async () => {
      await writePackage({ exports: { '.': { default: './index.js' } } });
      const loader = await importInProcessLoader([dir], cfg());
      expect(loader.name).toBe('fake');
    });

    it('resolves an exports map with a "require" condition', async () => {
      await writePackage({ exports: { '.': { require: './index.js' } } });
      const loader = await importInProcessLoader([dir], cfg());
      expect(loader.name).toBe('fake');
    });

    it('gives a clear error for an exports map with only an "import" condition', async () => {
      await writePackage({ exports: { '.': { import: './index.js' } } });
      const err = await importInProcessLoader([dir], cfg()).catch(
        (e: Error) => e
      );
      expect(err).toBeInstanceOf(Error);
      const message = (err as Error).message;
      expect(message).toMatch(/cannot resolve package 'fake-loader'/);
      expect(message).toMatch(/"default" or "require"/);
      expect(message).toMatch(/main/);
    });

    it('accepts a loader object that is frozen', async () => {
      await writePackage({ main: 'index.js' });
      await writeFile(
        path.join(dir, 'node_modules', 'fake-loader', 'index.js'),
        `export default Object.freeze({ name: 'other-name', version: '1.0.0', accepts: Object.freeze({ mimeTypes: ['a/b'] }), async load() { return { documentType: 'x', blocks: [] }; } });`
      );
      const loader = await importInProcessLoader([dir], cfg());
      expect(loader.name).toBe('other-name');
      expect(Object.isFrozen(loader)).toBe(true);
    });

    it('does not mutate the loader when its name differs from the config', async () => {
      await writePackage({ main: 'index.js' });
      await writeFile(
        path.join(dir, 'node_modules', 'fake-loader', 'index.js'),
        `export default { name: 'other', version: '1.0.0', accepts: { mimeTypes: ['a/b'] }, async load() { return { documentType: 'x', blocks: [] }; } };`
      );
      const loader = await importInProcessLoader([dir], cfg());
      expect(Object.keys(loader).sort()).toEqual([
        'accepts',
        'load',
        'name',
        'version'
      ]);
    });

    it('reports a module that throws at import with the package name', async () => {
      await writePackage({ main: 'index.js' });
      await writeFile(
        path.join(dir, 'node_modules', 'fake-loader', 'index.js'),
        `throw new Error('kaboom at import');`
      );
      await expect(importInProcessLoader([dir], cfg())).rejects.toThrow(
        /fake-loader.*kaboom at import/
      );
    });
  });
});

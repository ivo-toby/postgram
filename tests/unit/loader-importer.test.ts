import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { importInProcessLoader } from '../../src/services/loaders/in-process-importer.js';
import type { InProcessLoaderConfig } from '../../src/types/postgram-config.js';

async function setupFakePlugin(opts: {
  pluginsDir: string;
  packageName: string;
  exportShape: 'default' | 'named' | 'cjs-default' | 'no-loader';
}): Promise<void> {
  const pkgDir = path.join(
    opts.pluginsDir,
    'node_modules',
    ...opts.packageName.split('/'),
  );
  await mkdir(pkgDir, { recursive: true });

  await writeFile(
    path.join(opts.pluginsDir, 'package.json'),
    JSON.stringify({ name: 'host', version: '0.0.0' }),
  );

  await writeFile(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({
      name: opts.packageName,
      version: '1.2.3',
      type: 'module',
      main: 'index.js',
    }),
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
    overrides: Partial<InProcessLoaderConfig> = {},
  ): InProcessLoaderConfig => ({
    kind: 'in-process',
    name: 'fake',
    package: 'fake-loader',
    accepts: { mimeTypes: ['application/x-fake'] },
    priority: 0,
    options: {},
    enabled: true,
    ...overrides,
  });

  it('imports a default export', async () => {
    await setupFakePlugin({
      pluginsDir: dir,
      packageName: 'fake-loader',
      exportShape: 'default',
    });
    const loader = await importInProcessLoader(dir, cfg());
    expect(loader.name).toBe('fake');
    expect(loader.version).toBe('1.2.3');
  });

  it('imports a named `loader` export', async () => {
    await setupFakePlugin({
      pluginsDir: dir,
      packageName: 'fake-loader',
      exportShape: 'named',
    });
    const loader = await importInProcessLoader(dir, cfg());
    expect(loader.name).toBe('fake');
  });

  it('handles a cjs-style `module.exports = { default: ... }`', async () => {
    await setupFakePlugin({
      pluginsDir: dir,
      packageName: 'fake-loader',
      exportShape: 'cjs-default',
    });
    const loader = await importInProcessLoader(dir, cfg());
    expect(loader.name).toBe('fake');
  });

  it('throws when the package does not export a loader', async () => {
    await setupFakePlugin({
      pluginsDir: dir,
      packageName: 'fake-loader',
      exportShape: 'no-loader',
    });
    await expect(importInProcessLoader(dir, cfg())).rejects.toThrow(
      /did not export a DocumentLoader/,
    );
  });

  it('throws a clear error when the package is missing', async () => {
    // No package created — pluginsDir exists but is empty.
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'host', version: '0.0.0' }),
    );
    await expect(
      importInProcessLoader(
        dir,
        cfg({ package: 'nonexistent-pkg-xyz' }),
      ),
    ).rejects.toThrow(/cannot resolve package/);
  });
});

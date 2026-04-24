import { mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildSyncManifest } from '../../src/sync-walk.js';

describe('buildSyncManifest', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `pgm-sync-test-${randomUUID()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('indexes .md files in a plain directory', async () => {
    await writeFile(path.join(tmpDir, 'note.md'), '# Hello');
    const manifest = await buildSyncManifest(tmpDir);
    expect(manifest.map((f) => f.path)).toEqual(['note.md']);
  });

  it('does not index non-.md files', async () => {
    await writeFile(path.join(tmpDir, 'note.md'), '# Hello');
    await writeFile(path.join(tmpDir, 'image.png'), 'binary');
    await writeFile(path.join(tmpDir, 'config.json'), '{}');
    const manifest = await buildSyncManifest(tmpDir);
    expect(manifest.map((f) => f.path)).toEqual(['note.md']);
  });

  it('skips directory containing .pgmignore', async () => {
    const ignored = path.join(tmpDir, 'private');
    await mkdir(ignored);
    await writeFile(path.join(ignored, '.pgmignore'), '');
    await writeFile(path.join(ignored, 'secret.md'), '# Secret');
    await writeFile(path.join(tmpDir, 'visible.md'), '# Visible');

    const manifest = await buildSyncManifest(tmpDir);
    expect(manifest.map((f) => f.path)).toEqual(['visible.md']);
  });

  it('skips directory containing .noindex', async () => {
    const ignored = path.join(tmpDir, 'drafts');
    await mkdir(ignored);
    await writeFile(path.join(ignored, '.noindex'), '');
    await writeFile(path.join(ignored, 'draft.md'), '# Draft');
    await writeFile(path.join(tmpDir, 'published.md'), '# Published');

    const manifest = await buildSyncManifest(tmpDir);
    expect(manifest.map((f) => f.path)).toEqual(['published.md']);
  });

  it('skips entire subtree when parent has ignore marker', async () => {
    const parent = path.join(tmpDir, 'parent');
    const child = path.join(parent, 'child');
    await mkdir(child, { recursive: true });
    await writeFile(path.join(parent, '.pgmignore'), '');
    await writeFile(path.join(parent, 'parent-note.md'), '# Parent');
    await writeFile(path.join(child, 'child-note.md'), '# Child');
    await writeFile(path.join(tmpDir, 'root.md'), '# Root');

    const manifest = await buildSyncManifest(tmpDir);
    expect(manifest.map((f) => f.path)).toEqual(['root.md']);
  });

  it('does not affect sibling directories', async () => {
    const ignored = path.join(tmpDir, 'ignored');
    const kept = path.join(tmpDir, 'kept');
    await mkdir(ignored);
    await mkdir(kept);
    await writeFile(path.join(ignored, '.noindex'), '');
    await writeFile(path.join(ignored, 'hidden.md'), '# Hidden');
    await writeFile(path.join(kept, 'visible.md'), '# Visible');

    const manifest = await buildSyncManifest(tmpDir);
    expect(manifest.map((f) => f.path)).toEqual(['kept/visible.md']);
  });
});

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FilesystemAttachmentStore } from '../../src/services/loaders/attachment-store.js';

describe('FilesystemAttachmentStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'pgm-att-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes inline bytes to a fanned-out path and returns sha + storage URI', async () => {
    const store = new FilesystemAttachmentStore(dir);
    const bytes = new TextEncoder().encode('hello');
    const persisted = await store.put({
      ref: 'arbitrary',
      kind: 'image',
      mimeType: 'image/png',
      source: { kind: 'bytes', bytes },
    });

    expect(persisted.byteSize).toBe(5);
    expect(persisted.sha256).toMatch(/^[0-9a-f]{64}$/);
    // 2-char fan-out
    const expectedRel = path.join(
      persisted.sha256.slice(0, 2),
      `${persisted.sha256}.bin`,
    );
    expect(persisted.storageUri).toBe(`file://${path.join(dir, expectedRel)}`);
    const onDisk = await readFile(path.join(dir, expectedRel));
    expect(onDisk.toString('utf8')).toBe('hello');
  });

  it('reads bytes from a path source and writes them to the store', async () => {
    const src = path.join(dir, 'src.bin');
    await writeFile(src, 'world');
    const store = new FilesystemAttachmentStore(path.join(dir, 'attach'));
    const persisted = await store.put({
      ref: 'r',
      kind: 'audio',
      mimeType: 'audio/mpeg',
      source: { kind: 'path', path: src },
      metadata: { duration: 60 },
    });
    expect(persisted.byteSize).toBe(5);
    expect(persisted.metadata).toEqual({ duration: 60 });
    expect(persisted.kind).toBe('audio');
  });

  it('produces identical sha256 for identical bytes', async () => {
    const store = new FilesystemAttachmentStore(dir);
    const a = await store.put({
      ref: 'a',
      kind: 'image',
      mimeType: 'image/png',
      source: { kind: 'bytes', bytes: new TextEncoder().encode('same') },
    });
    const b = await store.put({
      ref: 'b',
      kind: 'image',
      mimeType: 'image/png',
      source: { kind: 'bytes', bytes: new TextEncoder().encode('same') },
    });
    expect(a.sha256).toBe(b.sha256);
    expect(a.storageUri).toBe(b.storageUri);
  });
});

import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FilesystemAttachmentStore } from '../../src/services/loaders/attachment-store.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

async function readStream(stream: AsyncIterable<unknown>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}

describe('FilesystemAttachmentStore', () => {
  let dir: string;
  let root: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'pgm-att-'));
    root = path.join(dir, 'store');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('put', () => {
    it('writes bytes to <root>/<2 hex>/<sha256> without extension', async () => {
      const store = new FilesystemAttachmentStore(root);
      const persisted = await store.put(new TextEncoder().encode('hello'));

      expect(persisted.byteSize).toBe(5);
      expect(persisted.sha256).toBe(sha('hello'));
      const expected = path.join(
        root,
        persisted.sha256.slice(0, 2),
        persisted.sha256
      );
      expect(persisted.storageUri).toBe(
        `${persisted.sha256.slice(0, 2)}/${persisted.sha256}`
      );
      expect(persisted.storageUri).not.toContain('file:');
      expect(persisted.storageUri).not.toContain(root);
      expect((await readFile(expected)).toString('utf8')).toBe('hello');
    });

    it('returns the same sha and uri for identical bytes and does not rewrite the file', async () => {
      const store = new FilesystemAttachmentStore(root);
      const a = await store.put(new TextEncoder().encode('same'));
      const file = store.resolvePath(a.storageUri);
      // Backdate the file; a rewrite would bump the mtime.
      const old = new Date('2020-01-01T00:00:00Z');
      await utimes(file, old, old);

      const b = await store.put(new TextEncoder().encode('same'));
      expect(b).toEqual(a);
      expect((await stat(file)).mtime.getTime()).toBe(old.getTime());
    });

    it('does not overwrite an existing target (skip-if-exists)', async () => {
      const store = new FilesystemAttachmentStore(root);
      const digest = sha('payload');
      const target = path.join(root, digest.slice(0, 2), digest);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, 'sentine'); // same size as 'payload'

      await store.put(new TextEncoder().encode('payload'));
      expect((await readFile(target)).toString('utf8')).toBe('sentine');
    });

    it('rewrites an existing file whose size differs (truncated after a crash)', async () => {
      const store = new FilesystemAttachmentStore(root);
      const bytes = new TextEncoder().encode('complete content');
      const first = await store.put(bytes);
      const file = store.resolvePath(first.storageUri);
      await writeFile(file, 'compl'); // simulate a truncated file
      const second = await store.put(bytes);
      expect(second).toEqual(first);
      expect((await readFile(file)).toString('utf8')).toBe('complete content');
      expect(await readdir(path.dirname(file))).toEqual([first.sha256]);
    });

    it('leaves no temporary files behind', async () => {
      const store = new FilesystemAttachmentStore(root);
      const p = await store.put(new TextEncoder().encode('tidy'));
      const entries = await readdir(path.join(root, p.sha256.slice(0, 2)));
      expect(entries).toEqual([p.sha256]);
    });

    it('is safe under concurrent puts of the same bytes', async () => {
      const store = new FilesystemAttachmentStore(root);
      const bytes = new TextEncoder().encode('race');
      const results = await Promise.all(
        Array.from({ length: 8 }, () => store.put(bytes))
      );
      expect(new Set(results.map((r) => r.storageUri)).size).toBe(1);
      const file = store.resolvePath(results[0]!.storageUri);
      expect((await readFile(file)).toString('utf8')).toBe('race');
      const entries = await readdir(path.dirname(file));
      expect(entries).toEqual([results[0]!.sha256]);
    });

    it('stores empty content', async () => {
      const store = new FilesystemAttachmentStore(root);
      const p = await store.put(new Uint8Array());
      expect(p.byteSize).toBe(0);
      expect(p.sha256).toBe(sha(''));
    });

    it('creates the root directory when it does not exist', async () => {
      const store = new FilesystemAttachmentStore(path.join(root, 'a', 'b'));
      await expect(store.put(new Uint8Array([1]))).resolves.toBeDefined();
    });
  });

  describe('resolvePath', () => {
    it('joins a relative key with the root', async () => {
      const store = new FilesystemAttachmentStore(root);
      const p = await store.put(new TextEncoder().encode('x'));
      expect(store.resolvePath(p.storageUri)).toBe(
        path.join(root, p.sha256.slice(0, 2), p.sha256)
      );
    });

    it('keeps rows valid when the store root moves', async () => {
      const first = new FilesystemAttachmentStore(root);
      const p = await first.put(new TextEncoder().encode('movable'));
      const moved = path.join(dir, 'moved');
      await rename(root, moved);
      const second = new FilesystemAttachmentStore(moved);
      expect(await readStream(second.openReadStream(p.storageUri))).toBe(
        'movable'
      );
    });

    const digest = sha('k');
    const bad: [string, string][] = [
      ['an absolute path', '/etc/passwd'],
      ['a file uri', `file://${root}/${digest.slice(0, 2)}/${digest}`],
      ['traversal', `${digest.slice(0, 2)}/../${digest}`],
      ['traversal in the first segment', `../${digest}`],
      ['a mismatched prefix', `00/${digest}`],
      ['a short hash', `${digest.slice(0, 2)}/${digest.slice(0, 63)}`],
      ['a long hash', `${digest.slice(0, 2)}/${digest}0`],
      [
        'uppercase hex',
        `${digest.slice(0, 2).toUpperCase()}/${digest.toUpperCase()}`
      ],
      ['an extension', `${digest.slice(0, 2)}/${digest}.bin`],
      ['a trailing slash', `${digest.slice(0, 2)}/${digest}/`],
      ['a leading slash', `/${digest.slice(0, 2)}/${digest}`],
      ['an extra segment', `x/${digest.slice(0, 2)}/${digest}`],
      ['a backslash separator', `${digest.slice(0, 2)}\\${digest}`],
      ['a newline suffix', `${digest.slice(0, 2)}/${digest}\n`],
      ['an empty string', ''],
      ['a bare hash', digest]
    ];
    it.each(bad)('rejects %s', (_name, uri) => {
      const store = new FilesystemAttachmentStore(root);
      expect(() => store.resolvePath(uri)).toThrow(/storage (uri|key)/);
    });
  });

  describe('openReadStream', () => {
    it('streams the stored bytes', async () => {
      const store = new FilesystemAttachmentStore(root);
      const p = await store.put(new TextEncoder().encode('streamed'));
      expect(await readStream(store.openReadStream(p.storageUri))).toBe(
        'streamed'
      );
    });

    it('rejects a uri outside the root', () => {
      const store = new FilesystemAttachmentStore(root);
      expect(() => store.openReadStream('/etc/passwd')).toThrow(
        /invalid storage key/
      );
    });
  });

  describe('listFiles', () => {
    it('yields nothing when the root does not exist', async () => {
      const store = new FilesystemAttachmentStore(path.join(dir, 'missing'));
      expect(await collect(store.listFiles())).toEqual([]);
    });

    it('yields sha256 and path of every stored file', async () => {
      const store = new FilesystemAttachmentStore(root);
      const a = await store.put(new TextEncoder().encode('a'));
      const b = await store.put(new TextEncoder().encode('b'));
      const listed = await collect(store.listFiles());
      expect(listed.map((f) => f.sha256).sort()).toEqual(
        [a.sha256, b.sha256].sort()
      );
      for (const f of listed) {
        expect(f.path).toBe(path.join(root, f.sha256.slice(0, 2), f.sha256));
      }
    });

    it('skips temporary files and unrelated entries', async () => {
      const store = new FilesystemAttachmentStore(root);
      const a = await store.put(new TextEncoder().encode('a'));
      const sub = path.join(root, a.sha256.slice(0, 2));
      await writeFile(path.join(sub, `${a.sha256}.123.abc.tmp`), 'partial');
      await writeFile(path.join(root, 'README'), 'noise');
      await mkdir(path.join(root, 'not-a-fanout'), { recursive: true });
      await writeFile(path.join(root, 'not-a-fanout', 'x'), 'noise');
      const listed = await collect(store.listFiles());
      expect(listed.map((f) => f.sha256)).toEqual([a.sha256]);
    });
  });

  describe('remove', () => {
    it('deletes the file and reports true', async () => {
      const store = new FilesystemAttachmentStore(root);
      const p = await store.put(new TextEncoder().encode('gone'));
      expect(await store.remove(p.sha256)).toBe(true);
      await expect(stat(store.resolvePath(p.storageUri))).rejects.toThrow();
      expect(await collect(store.listFiles())).toEqual([]);
    });

    it('reports false when the file does not exist', async () => {
      const store = new FilesystemAttachmentStore(root);
      expect(await store.remove(sha('never stored'))).toBe(false);
    });

    it('rejects a value that is not a sha256', async () => {
      const store = new FilesystemAttachmentStore(root);
      await expect(store.remove('../../etc/passwd')).rejects.toThrow(/sha256/);
      await expect(store.remove('abc')).rejects.toThrow(/sha256/);
    });
  });

  describe('removeStaleTempFiles', () => {
    const tmpName = (sha: string) => `${sha}.4242.abcdef012345.tmp`;

    it('removes only temp files older than the limit and returns the count', async () => {
      const store = new FilesystemAttachmentStore(root);
      const kept = await store.put(new TextEncoder().encode('kept'));
      const sub = path.join(root, kept.sha256.slice(0, 2));
      const staleA = path.join(sub, tmpName(kept.sha256));
      const fresh = path.join(sub, `${kept.sha256}.1.ffffffffffff.tmp`);
      const otherDir = path.join(root, 'ff');
      await mkdir(otherDir, { recursive: true });
      const staleB = path.join(otherDir, tmpName('f'.repeat(64)));
      await writeFile(staleA, 'partial');
      await writeFile(fresh, 'in flight');
      await writeFile(staleB, 'partial');
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await utimes(staleA, old, old);
      await utimes(staleB, old, old);

      const removed = await store.removeStaleTempFiles(60 * 60 * 1000);

      expect(removed).toBe(2);
      await expect(stat(staleA)).rejects.toThrow();
      await expect(stat(staleB)).rejects.toThrow();
      await expect(stat(fresh)).resolves.toBeDefined();
      // Real files are never touched.
      await expect(
        stat(store.resolvePath(kept.storageUri))
      ).resolves.toBeDefined();
    });

    it('does not remove files that merely look like temp files in name only', async () => {
      const store = new FilesystemAttachmentStore(root);
      const sub = path.join(root, 'ab');
      await mkdir(sub, { recursive: true });
      const odd = path.join(sub, 'notes.tmp');
      await writeFile(odd, 'user data');
      const old = new Date(0);
      await utimes(odd, old, old);
      expect(await store.removeStaleTempFiles(0)).toBe(0);
      await expect(stat(odd)).resolves.toBeDefined();
    });

    it('returns 0 when the root does not exist', async () => {
      const store = new FilesystemAttachmentStore(path.join(dir, 'missing'));
      expect(await store.removeStaleTempFiles(0)).toBe(0);
    });

    it('rejects a negative age', async () => {
      const store = new FilesystemAttachmentStore(root);
      await expect(store.removeStaleTempFiles(-1)).rejects.toThrow(
        /olderThanMs/
      );
    });
  });
});

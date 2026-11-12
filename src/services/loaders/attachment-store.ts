import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  readdir,
  rename,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';

export type PutResult = {
  sha256: string;
  byteSize: number;
  /**
   * Relative key `<first 2 hex of sha256>/<sha256>`. It carries no root, so
   * the store directory can move without breaking stored rows.
   */
  storageUri: string;
};

export type StoredFile = { sha256: string; path: string };

export interface AttachmentStore {
  put(bytes: Uint8Array): Promise<PutResult>;
  resolvePath(storageUri: string): string;
  openReadStream(storageUri: string): Readable;
  listFiles(): AsyncIterable<StoredFile>;
  remove(sha256: string): Promise<boolean>;
  removeStaleTempFiles(olderThanMs: number): Promise<number>;
}

const SHA256_RE = /^[0-9a-f]{64}$/;
const FANOUT_RE = /^[0-9a-f]{2}$/;
const KEY_RE = /^([0-9a-f]{2})\/([0-9a-f]{64})$/;
const TEMP_RE = /^[0-9a-f]{64}\.\d+\.[0-9a-f]+\.tmp$/;

/**
 * Content-addressed attachment storage on local disk. Files live at
 * `<root>/<first 2 hex of sha256>/<sha256>` with no extension; the original
 * filename and MIME type are kept in the database, not on disk.
 */
export class FilesystemAttachmentStore implements AttachmentStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /**
   * Write the bytes unless an intact file with the same hash already exists.
   * An existing file of a different size (for example truncated by a crash)
   * is replaced. The write goes to a temporary name in the target directory
   * and is renamed into place, so a reader never sees a partial file.
   */
  async put(bytes: Uint8Array): Promise<PutResult> {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const key = `${sha256.slice(0, 2)}/${sha256}`;
    const result: PutResult = {
      sha256,
      byteSize: bytes.byteLength,
      storageUri: key
    };
    const target = this.resolvePath(key);
    const existing = await statOrNull(target);
    if (existing?.isFile() && existing.size === bytes.byteLength) return result;

    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(tmp, bytes, { flag: 'wx' });
      await rename(tmp, target);
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
    return result;
  }

  /**
   * Local path of a storage key. Accepts only `<2 hex>/<64 hex>` where the
   * first segment is the prefix of the second; anything else throws.
   */
  resolvePath(storageUri: string): string {
    const m = KEY_RE.exec(storageUri);
    if (!m || !m[2]!.startsWith(m[1]!)) {
      throw new Error(
        `invalid storage key (expected <2 hex>/<sha256>): ${JSON.stringify(storageUri)}`
      );
    }
    return path.join(this.root, m[1]!, m[2]!);
  }

  openReadStream(storageUri: string): Readable {
    return createReadStream(this.resolvePath(storageUri));
  }

  /** Every stored file, for garbage collection. Temporary files are skipped. */
  async *listFiles(): AsyncIterable<StoredFile> {
    for (const dir of await this.fanoutDirs()) {
      for (const name of await this.readDir(dir)) {
        if (!SHA256_RE.test(name) || !name.startsWith(path.basename(dir)))
          continue;
        yield { sha256: name, path: path.join(dir, name) };
      }
    }
  }

  /** Delete one file. Returns false if it did not exist. */
  async remove(sha256: string): Promise<boolean> {
    if (!SHA256_RE.test(sha256)) {
      throw new Error(`not a sha256 hex digest: ${sha256}`);
    }
    try {
      await unlink(path.join(this.root, sha256.slice(0, 2), sha256));
      return true;
    } catch (err) {
      if (isCode(err, 'ENOENT')) return false;
      throw err;
    }
  }

  /**
   * Delete temporary files (left by a crashed `put`) whose last modification
   * is older than `olderThanMs`. Returns how many were removed. Only names
   * that `put` produces are touched.
   */
  async removeStaleTempFiles(olderThanMs: number): Promise<number> {
    if (!Number.isFinite(olderThanMs) || olderThanMs < 0) {
      throw new Error('olderThanMs must be a non-negative number');
    }
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;
    for (const dir of await this.fanoutDirs()) {
      for (const name of await this.readDir(dir)) {
        if (!TEMP_RE.test(name)) continue;
        const file = path.join(dir, name);
        const info = await statOrNull(file);
        if (!info?.isFile() || info.mtimeMs > cutoff) continue;
        try {
          await unlink(file);
          removed += 1;
        } catch (err) {
          if (!isCode(err, 'ENOENT')) throw err;
        }
      }
    }
    return removed;
  }

  private async fanoutDirs(): Promise<string[]> {
    return (await this.readDir(this.root))
      .filter((n) => FANOUT_RE.test(n))
      .sort()
      .map((n) => path.join(this.root, n));
  }

  /** Sorted directory listing; missing or non-directory paths list as empty. */
  private async readDir(dir: string): Promise<string[]> {
    try {
      return (await readdir(dir)).sort();
    } catch (err) {
      if (isCode(err, 'ENOENT') || isCode(err, 'ENOTDIR')) return [];
      throw err;
    }
  }
}

async function statOrNull(file: string) {
  try {
    return await stat(file);
  } catch (err) {
    if (isCode(err, 'ENOENT')) return null;
    throw err;
  }
}

function isCode(err: unknown, code: string): boolean {
  return (err as { code?: string } | null)?.code === code;
}

import { createHash } from 'node:crypto';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export type FileEntry = { path: string; sha: string; fullPath: string };

const SKIP_DIRS = new Set(['.git', 'node_modules', '.obsidian', '.trash']);
const IGNORE_MARKERS = ['.pgmignore', '.noindex'];

export async function buildSyncManifest(rootDir: string): Promise<FileEntry[]> {
  const manifest: FileEntry[] = [];

  async function walk(dirPath: string, prefix: string): Promise<void> {
    for (const marker of IGNORE_MARKERS) {
      try {
        await access(path.join(dirPath, marker));
        return;
      } catch {
        // marker not present
      }
    }

    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          await walk(
            path.join(dirPath, entry.name),
            prefix ? `${prefix}/${entry.name}` : entry.name
          );
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const fullPath = path.join(dirPath, entry.name);
        const content = await readFile(fullPath, 'utf8');
        const sha = createHash('sha256').update(content).digest('hex');
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        manifest.push({ path: relativePath, sha, fullPath });
      }
    }
  }

  await walk(rootDir, '');
  return manifest;
}

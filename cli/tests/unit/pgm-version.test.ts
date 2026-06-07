import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const CLI_ROOT = path.resolve(import.meta.dirname, '../..');
const REPO_ROOT = path.resolve(CLI_ROOT, '..');
const TSX_BIN = path.join(REPO_ROOT, 'node_modules/.bin/tsx');
const PGM_ENTRYPOINT = path.join(CLI_ROOT, 'src/pgm.ts');

async function readCliPackageVersion(): Promise<string> {
  const rawPackageJson = await readFile(
    path.join(CLI_ROOT, 'package.json'),
    'utf8'
  );
  const packageJson = JSON.parse(rawPackageJson) as { version: string };
  return packageJson.version;
}

describe('pgm --version', () => {
  it('prints the CLI package version', async () => {
    const { stdout, stderr } = await execFileAsync(
      TSX_BIN,
      [PGM_ENTRYPOINT, '--version'],
      {
        cwd: CLI_ROOT,
        env: {
          ...process.env,
          PGM_API_URL: '',
          PGM_API_KEY: ''
        },
        timeout: 10_000
      }
    );

    expect(stdout.trim()).toBe(await readCliPackageVersion());
    expect(stderr).toBe('');
  });
});

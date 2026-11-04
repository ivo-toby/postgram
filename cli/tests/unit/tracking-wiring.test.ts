import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const CLI_ROOT = path.resolve(import.meta.dirname, '../..');
const PGM_ENTRYPOINT = path.join(CLI_ROOT, 'src/pgm.ts');

const NEW_COMMANDS = [
  'here',
  'hooks',
  'where',
  'feature',
  'machine',
  'repo',
  'worktree',
  'scan'
];

const EXISTING_COMMANDS = ['store', 'search', 'task'];

type Run = { code: number | null; stdout: string; stderr: string };

function emptyHome(): string {
  return realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pgm-w1-home-')));
}

function runPgm(
  args: string[],
  homeDir: string,
  options: { input?: string } = {}
): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', PGM_ENTRYPOINT, ...args],
      {
        cwd: CLI_ROOT,
        env: {
          ...process.env,
          HOME: homeDir,
          PGM_API_URL: '',
          PGM_API_KEY: ''
        },
        timeout: 20_000
      }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(options.input ?? '');
  });
}

describe('pgm tracking wiring', () => {
  it('registers the tracking commands next to the existing ones in --help', async () => {
    const homeDir = emptyHome();
    try {
      const { code, stdout } = await runPgm(['--help'], homeDir);
      expect(code).toBe(0);
      for (const name of [...NEW_COMMANDS, ...EXISTING_COMMANDS]) {
        expect(stdout).toContain(name);
      }
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('exits 2 for a usage error on a tracking command', async () => {
    const homeDir = emptyHome();
    try {
      const { code } = await runPgm(['where', '--bogus'], homeDir);
      expect(code).toBe(2);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('exits 0 with empty stdout for here --hook with empty stdin and no config', async () => {
    const homeDir = emptyHome();
    try {
      const { code, stdout } = await runPgm(['here', '--hook'], homeDir, {
        input: ''
      });
      expect(code).toBe(0);
      expect(stdout).toBe('');
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});

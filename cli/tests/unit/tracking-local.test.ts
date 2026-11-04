import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  MARKER_DIR,
  readBootId,
  readMarker,
  removeMarker,
  resolveLocalWorkspace,
  writeMarker
} from '../../src/tracking/local.js';
import type { GitResult, GitRunner } from '../../src/tracking/local.js';

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Slice Test',
  GIT_AUTHOR_EMAIL: 'slice-test@example.com',
  GIT_COMMITTER_NAME: 'Slice Test',
  GIT_COMMITTER_EMAIL: 'slice-test@example.com'
};

let gitAvailable = false;
try {
  execFileSync('git', ['--version'], { env: GIT_ENV, stdio: 'pipe' });
  gitAvailable = true;
} catch {
  gitAvailable = false;
}

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { env: GIT_ENV, cwd, stdio: 'pipe' });
}

function makeRepo(): string {
  const root = tempDir('pgm-t4-repo-');
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(root, 'file.txt'), 'hello\n');
  git(root, 'add', 'file.txt');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

function fakeRun(results: Record<string, GitResult>): {
  run: GitRunner;
  timeouts: number[];
} {
  const timeouts: number[] = [];
  const run: GitRunner = (args, options) => {
    timeouts.push(options.timeoutMs);
    const found = results[args.join(' ')];
    return Promise.resolve(found ?? { ok: false, timedOut: false });
  };
  return { run, timeouts };
}

describe('resolveLocalWorkspace (real git)', () => {
  it('resolves root, branch, remote and counts from a subdirectory', async () => {
    if (!gitAvailable) return;
    const root = makeRepo();
    git(root, 'remote', 'add', 'origin', 'git@example.com:org/repo.git');
    mkdirSync(path.join(root, 'sub'));
    writeFileSync(path.join(root, 'dirty.txt'), 'x\n');

    const result = await resolveLocalWorkspace(path.join(root, 'sub'));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.path).toBe(root);
    expect(result.repoRoot).toBe(root);
    expect(result.workspace.path).toBe(root);
    expect(result.workspace.repo_root).toBe(root);
    expect(result.workspace.branch).toBe('main');
    expect(result.workspace.repo_remote).toBe('git@example.com:org/repo.git');
    expect(result.workspace.git).toEqual({
      dirty_count: 1,
      unpushed_count: 1,
      has_upstream: false
    });
  }, 20000);

  it('reports git null for a plain directory', async () => {
    const dir = tempDir('pgm-t4-plain-');
    const result = await resolveLocalWorkspace(dir);
    expect(result).toEqual({
      kind: 'ok',
      path: dir,
      repoRoot: null,
      workspace: { path: dir, git: null }
    });
  });

  it('reports null branch and remote when detached without origin', async () => {
    if (!gitAvailable) return;
    const root = makeRepo();
    git(root, 'checkout', '-q', '--detach');

    const result = await resolveLocalWorkspace(root);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.workspace.path).toBe(root);
    expect(result.workspace.repo_root).toBe(root);
    expect(result.workspace.branch).toBeNull();
    expect(result.workspace.repo_remote).toBeNull();
    expect(result.workspace.git).toEqual({
      dirty_count: 0,
      unpushed_count: 1,
      has_upstream: false
    });
  }, 20000);
});

describe('resolveLocalWorkspace (fake runner, budget)', () => {
  it('returns timeout when the worktree root is not resolved in time', async () => {
    const { run, timeouts } = fakeRun({
      'rev-parse --show-toplevel': { ok: false, timedOut: true }
    });
    const result = await resolveLocalWorkspace('/tmp', { run });
    expect(result).toEqual({ kind: 'timeout' });
    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]).toBeGreaterThanOrEqual(1);
    expect(timeouts[0]).toBeLessThanOrEqual(500);
  });

  it('omits the git key when a count times out', async () => {
    const root = tempDir('pgm-t4-fake-');
    const { run, timeouts } = fakeRun({
      'rev-parse --show-toplevel': { ok: true, stdout: root },
      'rev-parse --path-format=absolute --git-common-dir': {
        ok: true,
        stdout: `${root}/.git`
      },
      'symbolic-ref --short -q HEAD': { ok: true, stdout: 'main' },
      'remote get-url origin': { ok: true, stdout: 'git@example.com:org/repo.git' },
      'status --porcelain=v1 --untracked-files=normal': {
        ok: false,
        timedOut: true
      }
    });

    const result = await resolveLocalWorkspace(root, { run });

    expect(result).toEqual({
      kind: 'ok',
      path: root,
      repoRoot: root,
      workspace: {
        path: root,
        repo_root: root,
        branch: 'main',
        repo_remote: 'git@example.com:org/repo.git'
      }
    });
    for (const timeoutMs of timeouts) {
      expect(timeoutMs).toBeGreaterThanOrEqual(1);
      expect(timeoutMs).toBeLessThanOrEqual(500);
    }
  });

  it('omits the branch key when branch resolution times out', async () => {
    const root = tempDir('pgm-t4-fake-');
    const { run } = fakeRun({
      'rev-parse --show-toplevel': { ok: true, stdout: root },
      'rev-parse --path-format=absolute --git-common-dir': {
        ok: true,
        stdout: `${root}/.git`
      },
      'symbolic-ref --short -q HEAD': { ok: false, timedOut: true },
      'remote get-url origin': { ok: false, timedOut: false },
      'status --porcelain=v1 --untracked-files=normal': { ok: true, stdout: '' },
      'rev-list --count @{upstream}..HEAD': { ok: true, stdout: '3' }
    });

    const result = await resolveLocalWorkspace(root, { run });

    expect(result).toEqual({
      kind: 'ok',
      path: root,
      repoRoot: root,
      workspace: {
        path: root,
        repo_root: root,
        repo_remote: null,
        git: { dirty_count: 0, unpushed_count: 3, has_upstream: true }
      }
    });
    if (result.kind === 'ok') {
      expect(result.workspace.branch).toBeUndefined();
    }
  });

  it('caps each call at 500 ms and honors a smaller budget', async () => {
    const root = tempDir('pgm-t4-fake-');
    const { run, timeouts } = fakeRun({
      'rev-parse --show-toplevel': { ok: true, stdout: root },
      'rev-parse --path-format=absolute --git-common-dir': {
        ok: true,
        stdout: `${root}/.git`
      },
      'symbolic-ref --short -q HEAD': { ok: true, stdout: 'main' },
      'remote get-url origin': { ok: true, stdout: 'git@example.com:org/repo.git' },
      'status --porcelain=v1 --untracked-files=normal': { ok: true, stdout: '' },
      'rev-list --count @{upstream}..HEAD': { ok: true, stdout: '0' }
    });
    await resolveLocalWorkspace(root, { run, budgetMs: 40 });
    for (const timeoutMs of timeouts) {
      expect(timeoutMs).toBeGreaterThanOrEqual(1);
      expect(timeoutMs).toBeLessThanOrEqual(40);
    }
  });
});

describe('readBootId', () => {
  it('returns the trimmed linux boot id', async () => {
    const result = await readBootId({
      platform: 'linux',
      readFile: () => Promise.resolve('  9f86d081-8d45-4b47-9f86-6d0818d45b47\n')
    });
    expect(result).toBe('9f86d081-8d45-4b47-9f86-6d0818d45b47');
  });

  it('returns the sha256 of the darwin kern.boottime sec/usec part', async () => {
    const output =
      'kern.boottime: { sec = 1729000000, usec = 12345 } Wed Oct 15 12:26:40 2026';
    const expected = createHash('sha256')
      .update('{ sec = 1729000000, usec = 12345 }')
      .digest('hex');
    const result = await readBootId({
      platform: 'darwin',
      exec: () => Promise.resolve(output)
    });
    expect(result).toBe(expected);
  });

  it('returns null when the darwin output has no sec/usec part', async () => {
    const result = await readBootId({
      platform: 'darwin',
      exec: () => Promise.resolve('garbage')
    });
    expect(result).toBeNull();
  });

  it('returns null on read failure', async () => {
    const result = await readBootId({
      platform: 'linux',
      readFile: () => Promise.reject(new Error('unavailable'))
    });
    expect(result).toBeNull();
  });

  it('returns null on win32', async () => {
    const result = await readBootId({ platform: 'win32' });
    expect(result).toBeNull();
  });
});

describe('feature marker', () => {
  it('writes and reads a marker with created_at and a self-ignoring .gitignore', async () => {
    const dir = tempDir('pgm-t4-marker-');
    const now = new Date('2026-10-15T12:00:00.000Z');
    await writeMarker(dir, UUID, now);

    expect(await readMarker(dir)).toBe(UUID);
    const doc = JSON.parse(
      await readFile(path.join(dir, MARKER_DIR, 'feature.json'), 'utf8')
    ) as { feature_id: string; created_at: string };
    expect(doc.feature_id).toBe(UUID);
    expect(doc.created_at).toBe('2026-10-15T12:00:00.000Z');
    expect(
      await readFile(path.join(dir, MARKER_DIR, '.gitignore'), 'utf8')
    ).toBe('*\n');
  });

  it('reads invalid, non-UUID and missing content as none', async () => {
    const dir = tempDir('pgm-t4-marker-');
    expect(await readMarker(dir)).toBeNull();

    mkdirSync(path.join(dir, MARKER_DIR), { recursive: true });
    const file = path.join(dir, MARKER_DIR, 'feature.json');
    writeFileSync(file, 'not json');
    expect(await readMarker(dir)).toBeNull();

    writeFileSync(file, JSON.stringify({ feature_id: 'not-a-uuid' }));
    expect(await readMarker(dir)).toBeNull();
  });

  it('removes the marker and tolerates absence', async () => {
    const dir = tempDir('pgm-t4-marker-');
    await writeMarker(dir, UUID);
    await removeMarker(dir);
    expect(await readMarker(dir)).toBeNull();
    await expect(removeMarker(dir)).resolves.toBeUndefined();
  });
});

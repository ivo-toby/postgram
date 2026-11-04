// cli/src/tracking/local.ts: local machine/workspace resolution (research R6-R8).
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ReportGit, ReportWorkspace } from './types.js';

export type GitResult =
  | { ok: true; stdout: string }
  | { ok: false; timedOut: boolean };

export type GitRunner = (
  args: string[],
  options: { cwd: string; timeoutMs: number }
) => Promise<GitResult>;

export const runGit: GitRunner = (args, options) =>
  new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
      },
      (error, stdout) => {
        if (error !== null) {
          resolve({ ok: false, timedOut: error.killed === true });
        } else {
          resolve({ ok: true, stdout: stdout.replace(/\n$/, '') });
        }
      }
    );
  });

export type LocalWorkspace =
  | {
      kind: 'ok';
      path: string;
      repoRoot: string | null;
      workspace: ReportWorkspace;
    }
  | { kind: 'timeout' };

function parseCount(stdout: string): number | null {
  const value = Number.parseInt(stdout.trim(), 10);
  return Number.isSafeInteger(value) ? value : null;
}

export async function resolveLocalWorkspace(
  cwd: string,
  options?: { budgetMs?: number; run?: GitRunner }
): Promise<LocalWorkspace> {
  const budgetMs = options?.budgetMs ?? 800;
  const run = options?.run ?? runGit;
  const startedAt = Date.now();
  const nextTimeoutMs = () =>
    Math.max(1, Math.min(500, budgetMs - (Date.now() - startedAt)));

  const toplevel = await run(['rev-parse', '--show-toplevel'], {
    cwd,
    timeoutMs: nextTimeoutMs()
  });

  if (toplevel.ok === false) {
    if (toplevel.timedOut) {
      return { kind: 'timeout' };
    }
    const outside = await realpath(cwd);
    return {
      kind: 'ok',
      path: outside,
      repoRoot: null,
      workspace: { path: outside, git: null }
    };
  }

  const root = await realpath(toplevel.stdout);
  const commonDir = run(
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: root, timeoutMs: nextTimeoutMs() }
  );
  const branch = run(['symbolic-ref', '--short', '-q', 'HEAD'], {
    cwd: root,
    timeoutMs: nextTimeoutMs()
  });
  const remote = run(['remote', 'get-url', 'origin'], {
    cwd: root,
    timeoutMs: nextTimeoutMs()
  });
  const status = run(
    ['status', '--porcelain=v1', '--untracked-files=normal'],
    { cwd: root, timeoutMs: nextTimeoutMs() }
  );
  const upstream = run(['rev-list', '--count', '@{upstream}..HEAD'], {
    cwd: root,
    timeoutMs: nextTimeoutMs()
  });

  const [commonDirResult, branchResult, remoteResult, statusResult, upstreamResult] =
    await Promise.all([commonDir, branch, remote, status, upstream]);

  const workspace: ReportWorkspace = { path: root };
  let repoRoot: string | null = null;
  if (commonDirResult.ok) {
    repoRoot = path.dirname(commonDirResult.stdout);
    workspace.repo_root = repoRoot;
  }
  if (branchResult.ok) {
    workspace.branch = branchResult.stdout === '' ? null : branchResult.stdout;
  } else if (branchResult.timedOut === false) {
    workspace.branch = null;
  }
  if (remoteResult.ok) {
    workspace.repo_remote = remoteResult.stdout;
  } else if (remoteResult.timedOut === false) {
    workspace.repo_remote = null;
  }

  let git: ReportGit | null = null;
  if (statusResult.ok) {
    const dirtyCount = statusResult.stdout
      .split('\n')
      .filter((line) => line !== '')
      .length;
    if (upstreamResult.ok) {
      const unpushed = parseCount(upstreamResult.stdout);
      if (unpushed !== null) {
        git = { dirty_count: dirtyCount, unpushed_count: unpushed, has_upstream: true };
      }
    } else if (upstreamResult.timedOut === false) {
      const fallback = await run(
        ['rev-list', '--count', 'HEAD', '--not', '--remotes'],
        { cwd: root, timeoutMs: nextTimeoutMs() }
      );
      if (fallback.ok) {
        const unpushed = parseCount(fallback.stdout);
        if (unpushed !== null) {
          git = { dirty_count: dirtyCount, unpushed_count: unpushed, has_upstream: false };
        }
      }
    }
  }
  if (git !== null) {
    workspace.git = git;
  }

  return { kind: 'ok', path: root, repoRoot, workspace };
}

function defaultExec(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (error, stdout) => {
      if (error !== null) {
        reject(error instanceof Error ? error : new Error('exec failed'));
      } else {
        resolve(stdout);
      }
    });
  });
}

export async function readBootId(options?: {
  platform?: NodeJS.Platform;
  readFile?: (file: string) => Promise<string>;
  exec?: (cmd: string, args: string[]) => Promise<string>;
}): Promise<string | null> {
  const platform = options?.platform ?? process.platform;
  const readFileFn = options?.readFile ?? ((file: string) => readFile(file, 'utf8'));
  const execFn = options?.exec ?? defaultExec;
  try {
    if (platform === 'linux') {
      return (await readFileFn('/proc/sys/kernel/random/boot_id')).trim();
    }
    if (platform === 'darwin') {
      const output = await execFn('sysctl', ['-n', 'kern.boottime']);
      const match = output.match(/\{[^}]*\}/);
      if (match === null || match[0] === undefined) {
        return null;
      }
      return createHash('sha256').update(match[0]).digest('hex');
    }
    return null;
  } catch {
    return null;
  }
}

export const MARKER_DIR = '.postgram';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function markerFile(worktree: string): string {
  return path.join(worktree, MARKER_DIR, 'feature.json');
}

export async function readMarker(worktree: string): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(markerFile(worktree), 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const id = (parsed as Record<string, unknown>).feature_id;
  return typeof id === 'string' && UUID_RE.test(id) ? id : null;
}

export async function writeMarker(
  worktree: string,
  featureId: string,
  now?: Date
): Promise<void> {
  const dir = path.join(worktree, MARKER_DIR);
  await mkdir(dir, { recursive: true });
  const createdAt = (now ?? new Date()).toISOString();
  await writeFile(
    path.join(dir, 'feature.json'),
    `${JSON.stringify({ feature_id: featureId, created_at: createdAt }, null, 2)}\n`,
    'utf8'
  );
  await writeFile(path.join(dir, '.gitignore'), '*\n', 'utf8');
}

export async function removeMarker(worktree: string): Promise<void> {
  await rm(markerFile(worktree), { force: true });
}

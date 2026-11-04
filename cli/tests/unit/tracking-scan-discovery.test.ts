import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import type { GitResult, GitRunner } from '../../src/tracking/local.js';
import {
  claudeEncode,
  discoverWorktrees,
  findClaudeSessions,
  findPiSessions,
  findRepositories,
  listWorktrees
} from '../../src/tracking/scan-discovery.js';

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Slice Test',
  GIT_AUTHOR_EMAIL: 'slice-test@example.com',
  GIT_COMMITTER_NAME: 'Slice Test',
  GIT_COMMITTER_EMAIL: 'slice-test@example.com'
};

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

let gitAvailable = false;
try {
  const probe = tempDir('pgm-t10-gitprobe-');
  git(probe, 'init', '-q', '-b', 'main');
  gitAvailable = true;
} catch {
  gitAvailable = false;
}

function fakeRepo(dir: string): void {
  mkdirSync(path.join(dir, '.git'));
}

function makeRealRepo(dir: string, branch = 'main'): void {
  git(dir, 'init', '-q', '-b', branch);
  writeFileSync(path.join(dir, 'file.txt'), 'hello\n');
  git(dir, 'add', 'file.txt');
  git(dir, 'commit', '-q', '-m', 'init');
}

function writeLines(file: string, lines: unknown[]): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    lines.map((line) => JSON.stringify(line)).join('\n') + '\n',
    'utf8'
  );
}

describe('findRepositories', () => {
  it('stops at repositories, skips node_modules and dot-directories and honors depth', async () => {
    const root = tempDir('pgm-t10-roots-');
    const outer = path.join(root, 'outer');
    mkdirSync(outer);
    fakeRepo(outer);
    const nested = path.join(outer, 'nested');
    mkdirSync(nested);
    fakeRepo(nested);
    const deep = path.join(root, 'a', 'b', 'c', 'deep');
    mkdirSync(deep, { recursive: true });
    fakeRepo(deep);
    const hidden = path.join(root, 'node_modules', 'hidden');
    mkdirSync(hidden, { recursive: true });
    fakeRepo(hidden);
    const dot = path.join(root, '.hidden');
    mkdirSync(dot);
    fakeRepo(dot);

    await expect(findRepositories([root], 1)).resolves.toEqual([outer]);
  });

  it('finds repositories up to the depth', async () => {
    const root = tempDir('pgm-t10-depth-');
    const shallow = path.join(root, 'shallow');
    mkdirSync(shallow);
    fakeRepo(shallow);
    const deep = path.join(root, 'a', 'b', 'deep');
    mkdirSync(deep, { recursive: true });
    fakeRepo(deep);

    await expect(findRepositories([root], 1)).resolves.toEqual([shallow]);
    await expect(findRepositories([root], 3)).resolves.toEqual([deep, shallow]);
  });

  it('returns the root itself when it is a repository and skips missing roots', async () => {
    const repo = tempDir('pgm-t10-root-repo-');
    fakeRepo(repo);
    await expect(findRepositories([repo], 3)).resolves.toEqual([repo]);
    await expect(
      findRepositories([path.join(repo, 'missing')], 3)
    ).resolves.toEqual([]);
  });
});

describe('listWorktrees', () => {
  it('lists the main repository and linked worktrees with branches', async () => {
    if (!gitAvailable) {
      return;
    }
    const repo = tempDir('pgm-t10-wt-');
    makeRealRepo(repo, 'main');
    const worktree = path.join(repo, '..', 'wt-second');
    git(repo, 'worktree', 'add', '-q', '-b', 'side', worktree);
    tempDirs.push(realpathSync(worktree));

    const result = await listWorktrees(repo);
    const byPath = new Map(result.map((entry) => [entry.path, entry]));
    expect(byPath.get(realpathSync(repo))).toEqual({
      path: realpathSync(repo),
      branch: 'main'
    });
    expect(byPath.get(realpathSync(worktree))).toEqual({
      path: realpathSync(worktree),
      branch: 'side'
    });
    expect(result).toHaveLength(2);
  });

  it('parses porcelain blocks, skipping bare and missing worktrees', async () => {
    const second = tempDir('pgm-t10-second-');
    const run: GitRunner = (args, options) => {
      if (args.join(' ') !== 'worktree list --porcelain') {
        return Promise.reject(new Error('unexpected git args'));
      }
      if (options.timeoutMs !== 5000) {
        return Promise.reject(new Error('expected 5000ms timeout'));
      }
      const stdout = [
        `worktree ${second}`,
        'branch refs/heads/second',
        '',
        'worktree /definitely/not/here',
        'branch refs/heads/gone',
        '',
        'worktree /somewhere/bare',
        'bare'
      ].join('\n');
      const result: GitResult = { ok: true, stdout };
      return Promise.resolve(result);
    };

    const result = await listWorktrees('/anywhere', run);
    expect(result).toEqual([{ path: second, branch: 'second' }]);
  });

  it('returns an empty list when git fails', async () => {
    const run: GitRunner = () => Promise.resolve({ ok: false, timedOut: false });
    await expect(listWorktrees('/anywhere', run)).resolves.toEqual([]);
  });
});

describe('discoverWorktrees', () => {
  it('deduplicates worktrees reachable from the repository and the walk', async () => {
    const root = tempDir('pgm-t10-discover-');
    const repo = path.join(root, 'alpha');
    mkdirSync(repo);
    fakeRepo(repo);
    const worktree = path.join(root, 'alpha.worktrees', 'x');
    mkdirSync(path.join(worktree, '.git'), { recursive: true });
    const porcelain = [
      `worktree ${repo}`,
      'branch refs/heads/main',
      '',
      `worktree ${worktree}`,
      'branch refs/heads/side'
    ].join('\n');
    const run: GitRunner = (args) => {
      if (args.join(' ') !== 'worktree list --porcelain') {
        return Promise.reject(new Error('unexpected git args'));
      }
      const result: GitResult = { ok: true, stdout: porcelain };
      return Promise.resolve(result);
    };

    const result = await discoverWorktrees([root], 3, run);
    expect(result).toEqual([
      { path: repo, branch: 'main' },
      { path: worktree, branch: 'side' }
    ]);
  });

  it('lists real linked worktrees when git is runnable', async () => {
    if (!gitAvailable) {
      return;
    }
    const root = tempDir('pgm-t10-discover-real-');
    const repo = path.join(root, 'alpha');
    mkdirSync(repo);
    makeRealRepo(repo, 'main');
    const worktree = path.join(root, 'alpha.worktrees', 'x');
    git(repo, 'worktree', 'add', '-q', '-b', 'side', worktree);

    const result = await discoverWorktrees([root], 3);
    expect(result).toEqual([
      { path: realpathSync(repo), branch: 'main' },
      { path: realpathSync(worktree), branch: 'side' }
    ]);
  });
});

describe('findClaudeSessions', () => {
  const r = tempDir('pgm-t10-claude-r-');
  const alpha = path.join(r, 'alpha');
  const x = path.join(r, 'alpha.worktrees', 'x');
  const beta = path.join(r, 'beta');
  const longWorktree = path.join(r, 'long'.repeat(40));
  const claudeDir = tempDir('pgm-t10-claude-');
  const projects = path.join(claudeDir, 'projects');
  const encA = claudeEncode(alpha);
  const encX = claudeEncode(x);

  it('assigns each project directory to the longest matching worktree', async () => {
    writeLines(path.join(projects, encA, 'sess-a.jsonl'), [
      { type: 'user', cwd: alpha, sessionId: 'sess-a' }
    ]);
    writeLines(path.join(projects, `${encA}-sub`, 'sess-b.jsonl'), [
      { type: 'user', cwd: path.join(alpha, 'sub'), sessionId: 'sess-b' }
    ]);
    writeLines(path.join(projects, `${encA}-sub`, 'sess-c.jsonl'), [
      { type: 'user', cwd: '/elsewhere', sessionId: 'sess-c' }
    ]);
    writeLines(path.join(projects, encX, 'sess-x.jsonl'), [
      { type: 'summary', summary: 'no cwd here' }
    ]);

    const { sessions, notes } = await findClaudeSessions(
      [alpha, x, beta, longWorktree],
      claudeDir
    );

    expect(notes).toEqual([`skipped ${longWorktree}: encoded path too long`]);
    expect(sessions.size).toBe(2);
    expect(
      sessions.get(alpha)?.map((s) => ({
        agent_kind: s.agent_kind,
        agent_session_id: s.agent_session_id,
        cwd: s.cwd,
        transcript_path: s.transcript_path
      }))
    ).toEqual([
      {
        agent_kind: 'claude-code',
        agent_session_id: 'sess-a',
        cwd: alpha,
        transcript_path: path.join(projects, encA, 'sess-a.jsonl')
      },
      {
        agent_kind: 'claude-code',
        agent_session_id: 'sess-b',
        cwd: path.join(alpha, 'sub'),
        transcript_path: path.join(projects, `${encA}-sub`, 'sess-b.jsonl')
      }
    ]);
    expect(
      sessions.get(x)?.map((s) => ({
        agent_kind: s.agent_kind,
        agent_session_id: s.agent_session_id,
        cwd: s.cwd,
        transcript_path: s.transcript_path
      }))
    ).toEqual([
      {
        agent_kind: 'claude-code',
        agent_session_id: 'sess-x',
        cwd: null,
        transcript_path: path.join(projects, encX, 'sess-x.jsonl')
      }
    ]);
    expect(sessions.has(beta)).toBe(false);
    for (const list of sessions.values()) {
      for (const session of list) {
        expect(Number.isNaN(Date.parse(session.observed_at))).toBe(false);
      }
    }
  });
});

describe('findPiSessions', () => {
  const alpha = path.join(tempDir('pgm-t10-pi-r-'), 'alpha');
  const piDir = tempDir('pgm-t10-pi-');
  const dir = path.join(
    piDir,
    'sessions',
    `--${alpha.slice(1).replaceAll('/', '-')}--`
  );

  it('reads the id and cwd from the header line and skips files without an id', async () => {
    writeLines(path.join(dir, '2026-10-01T10-00-00-000Z_pi-1.jsonl'), [
      {
        type: 'session',
        version: 3,
        id: 'pi-1',
        timestamp: '2026-10-01T10:00:00.000Z',
        cwd: alpha
      }
    ]);
    writeLines(path.join(dir, '2026-10-01T11-00-00-000Z_pi-2.jsonl'), [
      { type: 'session', version: 3, timestamp: '2026-10-01T11:00:00.000Z' }
    ]);

    const sessions = await findPiSessions([alpha], piDir);
    expect(sessions.size).toBe(1);
    expect(
      sessions.get(alpha)?.map((s) => ({
        agent_kind: s.agent_kind,
        agent_session_id: s.agent_session_id,
        cwd: s.cwd,
        transcript_path: s.transcript_path
      }))
    ).toEqual([
      {
        agent_kind: 'pi',
        agent_session_id: 'pi-1',
        cwd: alpha,
        transcript_path: path.join(dir, '2026-10-01T10-00-00-000Z_pi-1.jsonl')
      }
    ]);
    const first = sessions.get(alpha)?.[0];
    expect(Number.isNaN(Date.parse(first?.observed_at ?? ''))).toBe(false);
  });

  it('sorts sessions by id and omits worktrees without sessions', async () => {
    writeLines(path.join(dir, 'zz_second.jsonl'), [
      { type: 'session', id: 'zz-second', cwd: null }
    ]);
    const sessions = await findPiSessions(
      [alpha, path.join(alpha, 'none')],
      piDir
    );
    expect(sessions.get(alpha)?.map((s) => s.agent_session_id)).toEqual([
      'pi-1',
      'zz-second'
    ]);
    expect(sessions.size).toBe(1);
  });
});

// cli/tests/unit/tracking-worktree.test.ts
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import type { StoredEntityResponse } from '../../src/client.js';
import { ErrorCode } from '../../src/errors.js';
import type { TrackingClient } from '../../src/tracking/api.js';
import { DEFAULT_RESUME, UsageError } from '../../src/tracking/config.js';
import {
  resolveLocalWorkspace,
  runGit,
  writeMarker
} from '../../src/tracking/local.js';
import type { GitResult, GitRunner } from '../../src/tracking/local.js';
import type { ReportBody, ReportResponse } from '../../src/tracking/types.js';
import {
  listTaskSummaries,
  matchFeature,
  registerWorktreeCommand,
  runWorktreeNew,
  taskTitle
} from '../../src/tracking/worktree.js';
import type { TaskSummary, WorktreeDeps } from '../../src/tracking/worktree.js';

const FEATURE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

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

type ReportFn = (
  body: ReportBody,
  options?: { timeoutMs?: number }
) => Promise<ReportResponse>;

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function defaultReport(): ReportResponse {
  return {
    workspace: null,
    feature: null,
    interrupted_sessions: 0,
    warnings: []
  };
}

function makeEntity(id: string): StoredEntityResponse['entity'] {
  return {
    id,
    type: 'task',
    content: null,
    visibility: 'personal',
    owner: null,
    status: null,
    enrichment_status: null,
    version: 1,
    tags: [],
    source: null,
    metadata: {},
    created_at: '2026-10-31T12:00:00Z',
    updated_at: '2026-10-31T12:00:00Z'
  };
}

function makeDeps(overrides: Partial<WorktreeDeps> = {}): WorktreeDeps {
  return {
    client: {} as TrackingClient,
    config: {
      alias: 'me',
      connectTarget: 'me',
      scanRoots: [],
      worktreeRoot: null,
      hereTimeoutMs: 2000,
      resume: DEFAULT_RESUME
    },
    cwd: '/repo',
    hostname: 'me-host',
    listTasks: () => Promise.resolve({ items: [], total: 0 }),
    run: () => Promise.resolve({ ok: false, timedOut: false }),
    exists: () => false,
    confirm: () => Promise.resolve(false),
    bootId: () => Promise.resolve('boot-1'),
    resolveWorkspace: (cwd) =>
      Promise.resolve({
        kind: 'ok',
        path: cwd,
        repoRoot: null,
        workspace: { path: cwd, git: null }
      }),
    writeMarker: async () => {},
    warn: () => {},
    ...overrides
  };
}

function gitRunnerInRepo(): GitRunner {
  return (args) => {
    const key = args.join(' ');
    if (key === 'rev-parse --show-toplevel') {
      return Promise.resolve({ ok: true, stdout: '/repo' });
    }
    if (key === 'rev-parse --path-format=absolute --git-common-dir') {
      return Promise.resolve({ ok: true, stdout: '/repo/.git' });
    }
    return Promise.resolve({ ok: false, timedOut: false });
  };
}

describe('taskTitle', () => {
  it('takes the trimmed first line, capped at 80 characters', () => {
    expect(taskTitle('Hello\nWorld')).toBe('Hello');
    expect(taskTitle('  spaced  ')).toBe('spaced');
    expect(taskTitle(null)).toBe('');
    expect(taskTitle('a'.repeat(100))).toHaveLength(80);
  });
});

describe('matchFeature', () => {
  const TASKS: TaskSummary[] = [
    { id: FEATURE_ID, title: 'Tracking CLI', isFeature: true },
    { id: 'deadbeef-1111-2222-3333-444455556666', title: 'Other', isFeature: true },
    {
      id: 'c0ffee00-1234-5678-9abc-def012345678',
      title: 'Tracking CLI',
      isFeature: false
    }
  ];

  it('matches a full UUID exactly', () => {
    expect(matchFeature(FEATURE_ID, TASKS).map((task) => task.id)).toEqual([
      FEATURE_ID
    ]);
  });

  it('matches an 8-hex short id', () => {
    expect(matchFeature('a1b2c3d4', TASKS).map((task) => task.id)).toEqual([
      FEATURE_ID
    ]);
    expect(matchFeature('deadbeef', TASKS).map((task) => task.id)).toEqual([
      'deadbeef-1111-2222-3333-444455556666'
    ]);
  });

  it('matches a feature title case-insensitively, excluding plain tasks', () => {
    expect(matchFeature('tracking cli', TASKS).map((task) => task.id)).toEqual(
      [FEATURE_ID]
    );
    expect(matchFeature('Tracking CLI', TASKS).map((task) => task.id)).toEqual(
      [FEATURE_ID]
    );
  });
});

describe('listTaskSummaries', () => {
  it('pages with limit 100 over offsets 0/100/200', async () => {
    type Item = {
      id: string;
      content: string | null;
      metadata: Record<string, unknown>;
    };
    const all: Item[] = [];
    for (let i = 0; i < 250; i++) {
      all.push({
        id: `id-${i}`,
        content: i % 3 === 0 ? `Title ${i}` : null,
        metadata: i % 2 === 0 ? { kind: 'feature' } : {}
      });
    }
    const offsets: number[] = [];
    const tasks = await listTaskSummaries(({ limit, offset }) => {
      expect(limit).toBe(100);
      offsets.push(offset);
      return Promise.resolve({
        items: all.slice(offset, offset + 100),
        total: all.length
      });
    });
    expect(offsets).toEqual([0, 100, 200]);
    expect(tasks).toHaveLength(250);
    expect(tasks[0]).toEqual({ id: 'id-0', title: 'Title 0', isFeature: true });
    expect(tasks[1]).toEqual({ id: 'id-1', title: '', isFeature: false });
    expect(tasks[249]).toEqual({
      id: 'id-249',
      title: 'Title 249',
      isFeature: false
    });
  });
});

describe('runWorktreeNew', () => {
  it('refuses when not in a git repository', async () => {
    const deps = makeDeps();
    await expect(
      runWorktreeNew('anything', { create: false }, deps)
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION,
      message: 'not in a git repository'
    });
  });

  it('conflicts and lists candidates on stderr when two features match', async () => {
    const warn = vi.fn();
    const deps = makeDeps({
      run: gitRunnerInRepo(),
      warn,
      listTasks: () =>
        Promise.resolve({
          items: [
            {
              id: FEATURE_ID,
              content: 'Same',
              metadata: { kind: 'feature' }
            },
            {
              id: 'deadbeef-1111-2222-3333-444455556666',
              content: 'Same',
              metadata: { kind: 'feature' }
            }
          ],
          total: 2
        })
    });
    await expect(
      runWorktreeNew('Same', { create: false }, deps)
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    expect(warn).toHaveBeenCalledWith('a1b2c3d4 Same');
    expect(warn).toHaveBeenCalledWith('deadbeef Same');
  });

  it('refuses a no-match without --create or confirmation', async () => {
    const createFeature = vi.fn();
    const confirm = vi.fn(() => Promise.resolve(false));
    const deps = makeDeps({
      run: gitRunnerInRepo(),
      confirm,
      client: { createFeature } as unknown as TrackingClient
    });
    await expect(
      runWorktreeNew('Brand new idea', { create: false }, deps)
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    expect(confirm).toHaveBeenCalledWith(
      'Create feature "Brand new idea"?'
    );
    expect(createFeature).not.toHaveBeenCalled();
  });

  it('creates the feature when confirmed, then the worktree, marker and report', async () => {
    const newId = 'abcdef01-2222-3333-4444-555566667777';
    const createFeature = vi
      .fn<(input: { content: string }) => Promise<StoredEntityResponse>>()
      .mockResolvedValue({ entity: makeEntity(newId) });
    const report = vi.fn<ReportFn>().mockResolvedValue(defaultReport());
    const writeMarkerMock = vi.fn();
    const run: GitRunner = (args) => {
      const key = args.join(' ');
      const table: Record<string, GitResult> = {
        'rev-parse --show-toplevel': { ok: true, stdout: '/repo' },
        'rev-parse --path-format=absolute --git-common-dir': {
          ok: true,
          stdout: '/repo/.git'
        },
        'rev-parse --verify --quiet refs/heads/feat/abcdef01-new-idea': {
          ok: false,
          timedOut: false
        },
        'rev-parse --verify --quiet refs/remotes/origin/HEAD': {
          ok: false,
          timedOut: false
        },
        'worktree add -b feat/abcdef01-new-idea /repo.worktrees/abcdef01-new-idea HEAD':
          { ok: true, stdout: '' }
      };
      const result = table[key];
      if (result === undefined) {
        throw new Error(`unexpected git args: ${key}`);
      }
      return Promise.resolve(result);
    };
    const deps = makeDeps({
      run,
      confirm: vi.fn(() => Promise.resolve(true)),
      client: { createFeature, report } as unknown as TrackingClient,
      writeMarker: writeMarkerMock
    });
    const result = await runWorktreeNew('New Idea', { create: false }, deps);
    expect(result).toEqual(['/repo.worktrees/abcdef01-new-idea']);
    expect(createFeature).toHaveBeenCalledWith({ content: 'New Idea' });
    expect(writeMarkerMock).toHaveBeenCalledWith(
      '/repo.worktrees/abcdef01-new-idea',
      newId
    );
    const body = report.mock.calls[0]?.[0];
    expect(body).toMatchObject({
      source: 'hook',
      feature_id: newId,
      machine: { alias: 'me', hostname: 'me-host', boot_id: 'boot-1' },
      workspace: { path: '/repo.worktrees/abcdef01-new-idea' }
    });
  });

  it('refuses an existing path before creating anything', async () => {
    if (!gitAvailable) return;
    const repo = makeTempRepo();
    const createFeature = vi.fn();
    const expected = `${repo}.worktrees/a1b2c3d4-tracking-cli`;
    mkdirSync(expected, { recursive: true });
    const { deps, report } = realDeps(repo, {}, { createFeature });
    await expect(
      runWorktreeNew('a1b2c3d4', { create: false }, deps)
    ).rejects.toBeInstanceOf(UsageError);
    expect(createFeature).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
    expect(existsSync(path.join(expected, '.git'))).toBe(false);
  });

  it('refuses an existing branch without creating the worktree', async () => {
    if (!gitAvailable) return;
    const repo = makeTempRepo();
    gitExec(repo, ['branch', 'feat/a1b2c3d4-tracking-cli']);
    const expected = `${repo}.worktrees/a1b2c3d4-tracking-cli`;
    const { deps } = realDeps(repo);
    await expect(
      runWorktreeNew('a1b2c3d4', { create: false }, deps)
    ).rejects.toBeInstanceOf(UsageError);
    expect(existsSync(expected)).toBe(false);
  });

  it('creates an existing feature worktree with branch, path, marker and report', async () => {
    if (!gitAvailable) return;
    const repo = makeTempRepo();
    const { deps, report } = realDeps(repo);
    const expected = `${repo}.worktrees/a1b2c3d4-tracking-cli`;
    const result = await runWorktreeNew('a1b2c3d4', { create: false }, deps);
    expect(result).toEqual([expected]);
    expect(gitExec(expected, ['symbolic-ref', '--short', 'HEAD'])).toBe(
      'feat/a1b2c3d4-tracking-cli'
    );
    const marker = JSON.parse(
      readFileSync(path.join(expected, '.postgram/feature.json'), 'utf8')
    ) as { feature_id: string };
    expect(marker.feature_id).toBe(FEATURE_ID);
    const body = report.mock.calls[0]?.[0];
    expect(body).toMatchObject({
      source: 'hook',
      feature_id: FEATURE_ID,
      workspace: { path: expected },
      machine: { alias: 'me', hostname: 'me-host', boot_id: 'boot-1' }
    });
  });

  it('creates the feature with --create and only warns when the report fails', async () => {
    if (!gitAvailable) return;
    const repo = makeTempRepo();
    const newId = 'abcdef01-2222-3333-4444-555566667777';
    const createFeature = vi
      .fn<(input: { content: string }) => Promise<StoredEntityResponse>>()
      .mockResolvedValue({ entity: makeEntity(newId) });
    const report = vi.fn<ReportFn>().mockRejectedValue(new Error('boom'));
    const warn = vi.fn();
    const { deps } = realDeps(repo, { warn }, { createFeature, report });
    const expected = `${repo}.worktrees/abcdef01-brand-new-idea`;
    const result = await runWorktreeNew('Brand New Idea', { create: true }, deps);
    expect(result).toEqual([expected]);
    expect(createFeature).toHaveBeenCalledWith({ content: 'Brand New Idea' });
    expect(
      existsSync(path.join(expected, '.postgram/feature.json'))
    ).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('report failed')
    );
  });
});

function gitExec(cwd: string, args: string[]): string {
  const output = execFileSync('git', args, {
    cwd,
    env: GIT_ENV,
    encoding: 'utf8',
    stdio: 'pipe'
  });
  return output.replace(/\n$/, '');
}

function makeTempRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wt-'));
  tempDirs.push(dir);
  const repo = path.join(dir, 'repo');
  mkdirSync(repo);
  gitExec(repo, ['init', '-q', '-b', 'main']);
  gitExec(repo, ['commit', '-q', '--allow-empty', '-m', 'init']);
  return realpathSync(repo);
}

function realDeps(
  repo: string,
  overrides: Partial<WorktreeDeps> = {},
  clientExtras: Partial<TrackingClient> = {}
): { deps: WorktreeDeps; report: Mock<ReportFn> } {
  const report = vi.fn<ReportFn>().mockResolvedValue(defaultReport());
  const deps: WorktreeDeps = {
    client: { report, ...clientExtras } as TrackingClient,
    config: {
      alias: 'me',
      connectTarget: 'me',
      scanRoots: [],
      worktreeRoot: null,
      hereTimeoutMs: 2000,
      resume: DEFAULT_RESUME
    },
    cwd: repo,
    hostname: 'me-host',
    listTasks: () =>
      Promise.resolve({
        items: [
          { id: FEATURE_ID, content: 'Tracking CLI', metadata: { kind: 'feature' } }
        ],
        total: 1
      }),
    run: runGit,
    exists: existsSync,
    confirm: () => Promise.resolve(true),
    bootId: () => Promise.resolve('boot-1'),
    resolveWorkspace: (cwd) => resolveLocalWorkspace(cwd),
    writeMarker,
    warn: vi.fn(),
    ...overrides
  };
  return { deps, report };
}

describe('registerWorktreeCommand', () => {
  it('registers worktree new with --base, --path and --create', () => {
    const program = new Command().name('pgm');
    registerWorktreeCommand(program);
    const worktree = program.commands.find(
      (command) => command.name() === 'worktree'
    );
    expect(worktree).toBeDefined();
    const sub = worktree?.commands.find((command) => command.name() === 'new');
    expect(sub).toBeDefined();
    const longs = sub?.options.map((option) => option.long) ?? [];
    expect(longs).toEqual(
      expect.arrayContaining(['--base', '--path', '--create'])
    );
  });
});

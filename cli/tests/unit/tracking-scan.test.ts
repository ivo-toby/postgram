// cli/tests/unit/tracking-scan.test.ts
import { describe, expect, it, vi } from 'vitest';

import type { StoredEntityResponse } from '../../src/client.js';
import type { TrackingClient } from '../../src/tracking/api.js';
import { DEFAULT_RESUME, UsageError } from '../../src/tracking/config.js';
import type { TrackingConfig } from '../../src/tracking/config.js';
import type { ScannedSession, ScannedWorktree } from '../../src/tracking/scan-discovery.js';
import {
  BRANCH_SHORT_ID,
  runScan,
  runScanApply,
  runScanInventory
} from '../../src/tracking/scan.js';
import type { ScanDeps } from '../../src/tracking/scan.js';
import type {
  ReportBody,
  ReportResponse,
  WorkspaceView
} from '../../src/tracking/types.js';

const CONFIG: TrackingConfig = {
  alias: 'me',
  connectTarget: 'me',
  scanRoots: [],
  worktreeRoot: null,
  hereTimeoutMs: 2000,
  ignorePaths: [],
  resume: DEFAULT_RESUME
};

const MARKER_ID = '11111111-2222-3333-4444-555555555555';
const SHORT_ID_TASK = 'abc12345-6666-7777-8888-999999999999';
const CREATED_ID = '44444444-0000-0000-0000-000000000000';

function makeWorkspace(overrides: Partial<WorkspaceView> = {}): WorkspaceView {
  return {
    id: 'ws-1',
    machine: 'me',
    connect_target: 'me',
    path: '/w/a',
    repo_remote: null,
    branch: null,
    feature_id: null,
    last_activity_at: '2026-10-31T14:00:00Z',
    git: null,
    git_state_at: null,
    missing_since: null,
    risks: [],
    resume_session: null,
    sessions: [],
    ...overrides
  };
}

function makeEntity(content: string): StoredEntityResponse {
  return {
    entity: {
      id: CREATED_ID,
      type: 'feature',
      content,
      visibility: 'personal',
      owner: null,
      status: null,
      enrichment_status: null,
      version: 1,
      tags: [],
      source: null,
      metadata: {},
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z'
    }
  };
}

type ScanCalls = {
  report: ReportBody[];
  patch: Array<{ id: string; body: { feature_id?: string | null; missing?: boolean } }>;
  listWorkspaces: Array<{ machine?: string; repo?: string; featureId?: string; unassigned?: boolean; includeEnded?: boolean }>;
  created: Array<{ content: string; tags?: string[]; visibility?: string }>;
  searched: string[];
  asked: string[];
  resolved: string[];
  markersWritten: Array<{ worktree: string; featureId: string }>;
  info: string[];
  discovered: Array<{ roots: readonly string[]; depth: number }>;
};

function makeDeps(
  overrides: Partial<ScanDeps> = {},
  known: WorkspaceView[] = []
) {
  const calls: ScanCalls = {
    report: [],
    patch: [],
    listWorkspaces: [],
    created: [],
    searched: [],
    asked: [],
    resolved: [],
    markersWritten: [],
    info: [],
    discovered: []
  };
  const answers: string[] = [];
  const tasks: Array<{ id: string; title: string }> = [];
  let searchResult: (
    query: string
  ) => Array<{ id: string; title: string }> = () => [];

  const client = {
    report: (body: ReportBody): Promise<ReportResponse> => {
      calls.report.push(body);
      return Promise.resolve({
        workspace: null,
        feature: null,
        interrupted_sessions: 0,
        warnings: []
      });
    },
    patchWorkspace: (
      id: string,
      body: { feature_id?: string | null; missing?: boolean }
    ): Promise<{ workspace: WorkspaceView }> => {
      calls.patch.push({ id, body });
      return Promise.resolve({ workspace: makeWorkspace({ id }) });
    },
    listWorkspaces: (query: {
      machine?: string;
      repo?: string;
      featureId?: string;
      unassigned?: boolean;
      includeEnded?: boolean;
    }): Promise<{ workspaces: WorkspaceView[] }> => {
      calls.listWorkspaces.push(query);
      return Promise.resolve({ workspaces: known });
    },
    createFeature: (input: {
      content: string;
      tags?: string[];
      visibility?: string;
    }): Promise<StoredEntityResponse> => {
      calls.created.push(input);
      return Promise.resolve(makeEntity(input.content));
    },
    putMachine: vi.fn(),
    listMachines: vi.fn(),
    putRepository: vi.fn(),
    setStage: vi.fn(),
    addPullRequest: vi.fn(),
    lookup: vi.fn(),
    where: vi.fn()
  } as unknown as TrackingClient;

  const deps: ScanDeps = {
    client,
    config: CONFIG,
    hostname: 'host',
    env: {},
    homeDir: '/home',
    tasks: (): Promise<Array<{ id: string; title: string }>> =>
      Promise.resolve(tasks),
    search: (
      query: string
    ): Promise<Array<{ id: string; title: string }>> => {
      calls.searched.push(query);
      return Promise.resolve(searchResult(query));
    },
    ask: (question: string): Promise<string> => {
      calls.asked.push(question);
      return Promise.resolve(answers.shift() ?? '');
    },
    discover: (
      roots: readonly string[],
      depth: number
    ): Promise<ScannedWorktree[]> => {
      calls.discovered.push({ roots, depth });
      return Promise.resolve([]);
    },
    claudeSessions: (): Promise<{
      sessions: Map<string, ScannedSession[]>;
      notes: string[];
    }> => Promise.resolve({ sessions: new Map(), notes: [] }),
    piSessions: (): Promise<Map<string, ScannedSession[]>> =>
      Promise.resolve(new Map<string, ScannedSession[]>()),
    resolveWorkspace: (p: string) => {
      calls.resolved.push(p);
      return Promise.resolve({
        kind: 'ok' as const,
        path: p,
        repoRoot: null,
        workspace: { path: p, git: null }
      });
    },
    readMarker: (): Promise<string | null> => Promise.resolve(null),
    writeMarker: (worktree: string, featureId: string): Promise<void> => {
      calls.markersWritten.push({ worktree, featureId });
      return Promise.resolve();
    },
    exists: (): boolean => true,
    isTty: (): boolean => true,
    realpath: (p: string): Promise<string> => Promise.resolve(p),
    lastCommit: (): Promise<{ date: string; subject: string } | null> =>
      Promise.resolve(null),
    info: (line: string): void => {
      calls.info.push(line);
    },
    ...overrides
  };

  return {
    deps,
    calls,
    answers,
    tasks,
    setSearchResult: (
      fn: (query: string) => Array<{ id: string; title: string }>
    ): void => {
      searchResult = fn;
    }
  };
}

describe('BRANCH_SHORT_ID', () => {
  it('matches an 8-hex short id at the start, after a slash, or before a dash', () => {
    expect(BRANCH_SHORT_ID.exec('abc12345-thing')?.[1]).toBe('abc12345');
    expect(BRANCH_SHORT_ID.exec('feat/abc12345-thing')?.[1]).toBe('abc12345');
    expect(BRANCH_SHORT_ID.exec('x/abc12345')?.[1]).toBe('abc12345');
    expect(BRANCH_SHORT_ID.exec('feat/abc1234-thing')).toBeNull();
    expect(BRANCH_SHORT_ID.exec('feat/abcg2345-thing')).toBeNull();
  });
});

describe('runScan validation', () => {
  it('throws UsageError when no roots are available', async () => {
    const { deps } = makeDeps();
    await expect(
      runScan({ root: [], yesExact: false, dryRun: false }, deps)
    ).rejects.toThrow(UsageError);
  });

  it('falls back to config scan roots and the default depth', async () => {
    const { deps, calls } = makeDeps({
      config: { ...CONFIG, scanRoots: ['/w'] }
    });
    await runScan({ root: [], yesExact: true, dryRun: false }, deps);
    expect(calls.discovered).toEqual([{ roots: ['/w'], depth: 3 }]);
  });

  it('throws UsageError for a non-positive depth', async () => {
    for (const depth of ['0', 'x', '-1']) {
      const { deps } = makeDeps();
      await expect(
        runScan({ root: ['/w'], depth, yesExact: false, dryRun: false }, deps)
      ).rejects.toThrow(UsageError);
    }
  });
});

describe('runScan --yes-exact', () => {
  it('records marker and short-id worktrees, skips the plain one, and never searches', async () => {
    const alpha = '/w/alpha';
    const beta = '/w/beta';
    const gamma = '/w/gamma';
    const worktrees: ScannedWorktree[] = [
      { path: alpha, branch: 'main' },
      { path: beta, branch: 'feat/abc12345-thing' },
      { path: gamma, branch: 'plain' }
    ];
    const claudeSess: ScannedSession = {
      agent_kind: 'claude-code',
      agent_session_id: 'sess-a',
      cwd: alpha,
      transcript_path: '/home/.claude/projects/-w-alpha/sess-a.jsonl',
      observed_at: '2026-10-01T10:00:00.000Z'
    };
    const piSess: ScannedSession = {
      agent_kind: 'pi',
      agent_session_id: 'pi-1',
      cwd: alpha,
      transcript_path: '/home/.pi/agent/sessions/--w-alpha--/pi-1.jsonl',
      observed_at: '2026-10-01T10:00:00.000Z'
    };
    const { deps, calls, tasks } = makeDeps({
      discover: () => Promise.resolve(worktrees),
      readMarker: (p: string) =>
        Promise.resolve(p === alpha ? MARKER_ID : null),
      claudeSessions: () =>
        Promise.resolve({
          sessions: new Map([[alpha, [claudeSess]]]),
          notes: ['note-a']
        }),
      piSessions: () => Promise.resolve(new Map([[alpha, [piSess]]]))
    });
    tasks.push(
      { id: MARKER_ID, title: 'Marker feature' },
      { id: SHORT_ID_TASK, title: 'Branch thing' },
      { id: 'e0000000-0000-0000-0000-000000000000', title: 'Other' }
    );

    const lines = await runScan(
      { root: ['/w'], yesExact: true, dryRun: false },
      deps
    );

    expect(lines).toEqual([
      `recorded ${alpha} → 11111111`,
      `recorded ${beta} → abc12345`,
      `skipped ${gamma}`
    ]);
    expect(calls.searched).toEqual([]);
    expect(calls.asked).toEqual([]);
    expect(calls.info).toEqual(['note-a']);

    expect(calls.report).toEqual([
      {
        source: 'scan',
        machine: { alias: 'me', hostname: 'host', boot_id: null },
        workspace: { path: alpha, git: null },
        feature_id: MARKER_ID,
        sessions: [claudeSess, piSess]
      },
      {
        source: 'scan',
        machine: { alias: 'me', hostname: 'host', boot_id: null },
        workspace: { path: beta, git: null },
        feature_id: SHORT_ID_TASK,
        sessions: []
      }
    ]);

    // alpha already holds the marker id; beta gets a new marker
    expect(calls.markersWritten).toEqual([
      { worktree: beta, featureId: SHORT_ID_TASK }
    ]);
  });
});

describe('runScan interactive', () => {
  it('accepts a, 2, n and s answers and lists proposals in order', async () => {
    const [w1, w2, w3, w4] = ['/w/w1', '/w/w2', '/w/w3', '/w/w4'];
    const hit1 = '22222222-0000-0000-0000-000000000000';
    const hit2 = '33333333-0000-0000-0000-000000000000';
    const worktrees: ScannedWorktree[] = [
      { path: w1, branch: 'feat/one-two' },
      { path: w2, branch: 'feat/three-four' },
      { path: w3, branch: 'feat/cool-stuff' },
      { path: w4, branch: 'feat/five-six' }
    ];
    const { deps, calls, tasks, answers, setSearchResult } = makeDeps({
      discover: () => Promise.resolve(worktrees),
      readMarker: (p: string) => Promise.resolve(p === w1 ? MARKER_ID : null)
    });
    tasks.push({ id: MARKER_ID, title: 'Marker feature' });
    setSearchResult((query) => [
      { id: hit1, title: `hit1 ${query}` },
      { id: hit2, title: `hit2 ${query}` }
    ]);
    answers.push('a', '2', 'n', 's');

    const lines = await runScan(
      { root: ['/w'], yesExact: false, dryRun: false },
      deps
    );

    expect(calls.asked).toEqual([
      '[a]ccept, [1-3] pick, [n]ew feature, [s]kip',
      '[a]ccept, [1-3] pick, [n]ew feature, [s]kip',
      '[a]ccept, [1-3] pick, [n]ew feature, [s]kip',
      '[a]ccept, [1-3] pick, [n]ew feature, [s]kip'
    ]);
    expect(lines).toEqual([
      `recorded ${w1} → ${MARKER_ID.slice(0, 8)}`,
      `recorded ${w2} → ${hit2.slice(0, 8)}`,
      `recorded ${w3} → ${CREATED_ID.slice(0, 8)}`,
      `skipped ${w4}`
    ]);
    expect(calls.created).toEqual([{ content: 'cool stuff' }]);
    expect(calls.searched).toEqual(['one-two', 'three-four', 'cool-stuff', 'five-six']);

    // proposals are listed marker first, then the search hits, in order
    const infoCalls = calls.info;
    const m = infoCalls.indexOf('  1. marker: Marker feature');
    const h1 = infoCalls.indexOf('  2. search: hit1 one-two');
    const h2 = infoCalls.indexOf('  3. search: hit2 one-two');
    expect(m).toBeGreaterThan(-1);
    expect(h1).toBe(m + 1);
    expect(h2).toBe(h1 + 1);

    expect(calls.report.map((body) => body.feature_id)).toEqual([
      MARKER_ID,
      hit2,
      CREATED_ID
    ]);
  });

  it('skips when the answer is empty and the search fails', async () => {
    const alpha = '/w/alpha';
    const { deps, calls, setSearchResult } = makeDeps({
      discover: () => Promise.resolve([{ path: alpha, branch: 'feat/one-two' }])
    });
    setSearchResult(() => {
      throw new Error('search down');
    });

    const lines = await runScan(
      { root: ['/w'], yesExact: false, dryRun: false },
      deps
    );

    expect(lines).toEqual([`skipped ${alpha}`]);
    expect(calls.report).toEqual([]);
    expect(calls.info).toEqual([`${alpha} (feat/one-two)`]);
  });
});

describe('runScan --dry-run', () => {
  it('sends nothing, writes nothing, and prints would-record lines', async () => {
    const alpha = '/w/alpha';
    const { deps, calls } = makeDeps({
      discover: () => Promise.resolve([{ path: alpha, branch: 'main' }]),
      readMarker: () => Promise.resolve(MARKER_ID)
    });
    const lines = await runScan(
      { root: ['/w'], yesExact: true, dryRun: true },
      deps
    );
    expect(lines).toEqual([`would record ${alpha} → 11111111`]);
    expect(calls.report).toEqual([]);
    expect(calls.markersWritten).toEqual([]);
    expect(calls.patch).toEqual([]);
    expect(calls.resolved).toEqual([]);
  });
});

describe('runScan known workspaces', () => {
  it('lists known worktrees, does not prompt them, and patches the disk check', async () => {
    const alpha = '/w/alpha';
    const beta = '/w/beta';
    const gone = '/w/gone';
    const back = '/w/back';
    const known: WorkspaceView[] = [
      makeWorkspace({ id: 'ws-a', path: alpha, missing_since: null }),
      makeWorkspace({ id: 'ws-g', path: gone, missing_since: null }),
      makeWorkspace({
        id: 'ws-b',
        path: back,
        missing_since: '2026-10-01T00:00:00.000Z'
      })
    ];
    const { deps, calls } = makeDeps(
      {
        discover: () =>
          Promise.resolve([
            { path: alpha, branch: 'main' },
            { path: beta, branch: 'plain' }
          ]),
        exists: (p: string) => p !== gone
      },
      known
    );

    const lines = await runScan(
      { root: ['/w'], yesExact: true, dryRun: false },
      deps
    );

    expect(calls.listWorkspaces).toEqual([{ machine: 'me' }]);
    expect(lines).toEqual([`known ${alpha}`, `skipped ${beta}`]);
    expect(calls.asked).toEqual([]);
    expect(calls.patch).toEqual([
      { id: 'ws-g', body: { missing: true } },
      { id: 'ws-b', body: { missing: false } }
    ]);
  });
});

describe('runScan without a terminal', () => {
  it('fails cleanly before discovering anything and names the alternatives', async () => {
    const { deps, calls } = makeDeps({ isTty: () => false });
    const failure = runScan({ root: ['/w'], yesExact: false, dryRun: false }, deps);
    await expect(failure).rejects.toThrow(UsageError);
    await expect(failure).rejects.toThrow(/--json.*--yes-exact|--yes-exact.*--json/);
    expect(calls.discovered).toEqual([]);
    expect(calls.asked).toEqual([]);
  });

  it('still allows --yes-exact without a terminal', async () => {
    const { deps } = makeDeps({ isTty: () => false });
    await expect(
      runScan({ root: ['/w'], yesExact: true, dryRun: false }, deps)
    ).resolves.toEqual([]);
  });
});

describe('runScan ignore_paths', () => {
  it('drops ignored worktrees from the run', async () => {
    const { deps, calls } = makeDeps({
      config: { ...CONFIG, ignorePaths: ['/w/root', '/w/tmp/**'] },
      discover: () =>
        Promise.resolve([
          { path: '/w/root', branch: 'main' },
          { path: '/w/tmp/x', branch: 'main' },
          { path: '/w/keep', branch: 'main' }
        ])
    });
    const lines = await runScan({ root: ['/w'], yesExact: true, dryRun: false }, deps);
    expect(lines).toEqual(['skipped /w/keep']);
    expect(calls.report).toEqual([]);
  });
});

describe('runScanInventory', () => {
  it('describes every worktree without sending anything', async () => {
    const known: WorkspaceView[] = [
      makeWorkspace({ id: 'ws-known', path: '/w/known', feature_id: MARKER_ID }),
      makeWorkspace({ id: 'ws-gone', path: '/w/gone', missing_since: null })
    ];
    const claudeSess: ScannedSession = {
      agent_kind: 'claude-code',
      agent_session_id: 'sess-1',
      cwd: '/w/new',
      transcript_path: '/t/1.jsonl',
      observed_at: '2026-10-30T10:00:00.000Z'
    };
    const { deps, calls, tasks, setSearchResult } = makeDeps(
      {
        config: { ...CONFIG, ignorePaths: ['/w/ignored'] },
        discover: () =>
          Promise.resolve([
            { path: '/w/known', branch: 'feat/known' },
            { path: '/w/new', branch: 'feat/abc12345-thing' },
            { path: '/w/ignored', branch: 'main' }
          ]),
        claudeSessions: () =>
          Promise.resolve({
            sessions: new Map([['/w/new', [claudeSess]]]),
            notes: []
          }),
        resolveWorkspace: (p: string) =>
          Promise.resolve({
            kind: 'ok' as const,
            path: p,
            repoRoot: '/w/repo',
            workspace: {
              path: p,
              repo_remote: 'git@github.com:example/repo.git',
              branch: p === '/w/new' ? 'feat/abc12345-thing' : 'feat/known',
              git: { dirty_count: 2, unpushed_count: 1, has_upstream: false }
            }
          }),
        lastCommit: () =>
          Promise.resolve({ date: '2026-10-29T09:00:00+00:00', subject: 'fix: thing' }),
        readMarker: (p: string) => Promise.resolve(p === '/w/new' ? MARKER_ID : null)
      },
      known
    );
    tasks.push(
      { id: MARKER_ID, title: 'Marker feature' },
      { id: SHORT_ID_TASK, title: 'Short id feature' }
    );
    setSearchResult(() => [{ id: CREATED_ID, title: 'Searched' }]);

    const inventory = await runScanInventory({ root: ['/w'], dryRun: false, yesExact: false }, deps);

    expect(calls.report).toEqual([]);
    expect(calls.patch).toEqual([]);
    expect(calls.created).toEqual([]);
    expect(calls.markersWritten).toEqual([]);
    expect(inventory.machine).toBe('me');
    expect(inventory.worktrees.map((w) => w.path)).toEqual(['/w/known', '/w/new']);

    const [linked, fresh] = inventory.worktrees;
    expect(linked).toMatchObject({
      path: '/w/known',
      repo_remote: 'git@github.com:example/repo.git',
      branch: 'feat/known',
      workspace_id: 'ws-known',
      feature: { id: MARKER_ID, title: 'Marker feature' },
      candidates: [],
      git: { dirty_count: 2, unpushed_count: 1, has_upstream: false },
      last_commit: { date: '2026-10-29T09:00:00+00:00', subject: 'fix: thing' }
    });
    expect(fresh).toMatchObject({
      path: '/w/new',
      workspace_id: null,
      feature: null,
      marker_feature_id: MARKER_ID,
      sessions: { count: 1, last_activity_at: '2026-10-30T10:00:00.000Z' },
      candidates: [
        { kind: 'marker', feature_id: MARKER_ID, title: 'Marker feature' },
        { kind: 'short-id', feature_id: SHORT_ID_TASK, title: 'Short id feature' },
        { kind: 'search', feature_id: CREATED_ID, title: 'Searched' }
      ]
    });
  });

  it('reports git as null on a timeout and keeps going', async () => {
    const { deps } = makeDeps({
      discover: () => Promise.resolve([{ path: '/w/slow', branch: 'main' }]),
      resolveWorkspace: () => Promise.resolve({ kind: 'timeout' as const })
    });
    const inventory = await runScanInventory({ root: ['/w'], dryRun: false, yesExact: false }, deps);
    expect(inventory.worktrees[0]).toMatchObject({
      path: '/w/slow',
      branch: 'main',
      git: null,
      note: 'git timeout'
    });
  });

  it('needs no terminal', async () => {
    const { deps } = makeDeps({ isTty: () => false });
    await expect(
      runScanInventory({ root: ['/w'], dryRun: false, yesExact: false }, deps)
    ).resolves.toMatchObject({ worktrees: [] });
  });
});

describe('runScanApply', () => {
  const FEATURE = MARKER_ID;

  function applyDeps(overrides: Partial<ScanDeps> = {}) {
    const made = makeDeps(
      {
        resolveWorkspace: (p: string) =>
          Promise.resolve({
            kind: 'ok' as const,
            path: p,
            repoRoot: '/w/repo',
            workspace: { path: p, branch: 'b', git: null }
          }),
        ...overrides
      },
      []
    );
    made.tasks.push({ id: FEATURE, title: 'Existing feature' });
    return made;
  }

  it('validates the whole plan before writing anything', async () => {
    const { deps, calls } = applyDeps();
    const plan = {
      entries: [
        { path: '/w/ok', action: 'link', feature_id: FEATURE },
        { path: '/w/ok', action: 'skip' },
        { path: 'relative', action: 'skip' },
        { path: '/w/nofeature', action: 'link' },
        { path: '/w/unknown', action: 'link', feature_id: 'deadbeef' },
        { path: '/w/notitle', action: 'create', title: '  ' },
        { path: '/w/bad', action: 'explode' }
      ]
    };
    const failure = runScanApply(plan, { dryRun: false }, deps);
    await expect(failure).rejects.toThrow(UsageError);
    const message = await failure.catch((error: Error) => error.message);
    expect(message).toContain('duplicate path /w/ok');
    expect(message).toContain('relative: path must be absolute');
    expect(message).toContain('/w/nofeature: link needs feature_id');
    expect(message).toContain('/w/unknown: no feature matches deadbeef');
    expect(message).toContain('/w/notitle: create needs a non-empty title');
    expect(message).toContain("/w/bad: unknown action 'explode'");
    expect(calls.report).toEqual([]);
    expect(calls.created).toEqual([]);
  });

  it('rejects a path that is missing, ignored, not a git worktree root or a timeout', async () => {
    const { deps, calls } = applyDeps({
      config: { ...CONFIG, ignorePaths: ['/w/ignored'] },
      exists: (p: string) => p !== '/w/missing',
      realpath: (p: string) => Promise.resolve(p === '/w/link' ? '/w/real' : p),
      resolveWorkspace: (p: string) => {
        if (p === '/w/slow') {
          return Promise.resolve({ kind: 'timeout' as const });
        }
        const top = p === '/w/sub' ? '/w' : p;
        return Promise.resolve({
          kind: 'ok' as const,
          path: top,
          repoRoot: p === '/w/plain' ? null : '/w/repo',
          workspace: { path: top, git: null }
        });
      }
    });
    const entries = ['/w/missing', '/w/ignored', '/w/plain', '/w/sub', '/w/slow'].map(
      (p) => ({ path: p, action: 'link', feature_id: FEATURE })
    );
    const message = await runScanApply({ entries }, { dryRun: false }, deps).catch(
      (error: Error) => error.message
    );
    expect(message).toContain('/w/missing: path does not exist');
    expect(message).toContain('/w/ignored: path is in ignore_paths');
    expect(message).toContain('/w/plain: not a git worktree');
    expect(message).toContain('/w/sub: not the root of a worktree');
    expect(message).toContain('/w/slow: git timed out');
    expect(calls.report).toEqual([]);
  });

  it('links, creates and skips, reporting each entry', async () => {
    const claudeSess: ScannedSession = {
      agent_kind: 'claude-code',
      agent_session_id: 'sess-1',
      cwd: '/w/a',
      transcript_path: '/t/1.jsonl',
      observed_at: '2026-10-30T10:00:00.000Z'
    };
    const { deps, calls } = applyDeps({
      claudeSessions: () =>
        Promise.resolve({ sessions: new Map([['/w/a', [claudeSess]]]), notes: [] })
    });
    const plan = {
      entries: [
        { path: '/w/a', action: 'link', feature_id: FEATURE.slice(0, 8) },
        { path: '/w/b', action: 'create', title: ' New thing ' },
        { path: '/w/c', action: 'skip' }
      ]
    };

    const result = await runScanApply(plan, { dryRun: false }, deps);

    expect(result.failed).toBe(0);
    expect(result.results).toEqual([
      { path: '/w/a', action: 'link', status: 'linked', feature_id: FEATURE },
      { path: '/w/b', action: 'create', status: 'created', feature_id: CREATED_ID },
      { path: '/w/c', action: 'skip', status: 'skipped' }
    ]);
    expect(calls.created).toEqual([{ content: 'New thing' }]);
    expect(calls.report.map((r) => [r.workspace?.path, r.feature_id, r.source])).toEqual([
      ['/w/a', FEATURE, 'scan'],
      ['/w/b', CREATED_ID, 'scan']
    ]);
    expect(calls.report[0]?.sessions?.map((x) => x.agent_session_id)).toEqual(['sess-1']);
    expect(calls.markersWritten).toEqual([
      { worktree: '/w/a', featureId: FEATURE },
      { worktree: '/w/b', featureId: CREATED_ID }
    ]);
  });

  it('keeps going after a failed entry and counts it', async () => {
    const { deps, calls } = applyDeps();
    let first = true;
    const original = deps.client.report.bind(deps.client);
    deps.client.report = (body: ReportBody) => {
      if (first) {
        first = false;
        return Promise.reject(new Error('boom'));
      }
      return original(body);
    };
    const plan = [
      { path: '/w/a', action: 'link', feature_id: FEATURE },
      { path: '/w/b', action: 'link', feature_id: FEATURE }
    ];

    const result = await runScanApply(plan, { dryRun: false }, deps);

    expect(result.failed).toBe(1);
    expect(result.results[0]).toEqual({
      path: '/w/a',
      action: 'link',
      status: 'failed',
      feature_id: FEATURE,
      error: 'boom'
    });
    expect(result.results[1]).toMatchObject({ path: '/w/b', status: 'linked' });
    expect(calls.report).toHaveLength(1);
  });

  it('writes nothing with dryRun and does not create features', async () => {
    const { deps, calls } = applyDeps();
    const plan = {
      entries: [
        { path: '/w/a', action: 'link', feature_id: FEATURE },
        { path: '/w/b', action: 'create', title: 'New' }
      ]
    };
    const result = await runScanApply(plan, { dryRun: true }, deps);
    expect(result.results.map((r) => r.status)).toEqual(['would link', 'would create']);
    expect(calls.report).toEqual([]);
    expect(calls.created).toEqual([]);
    expect(calls.markersWritten).toEqual([]);
  });

  it('rejects a plan that is not an entries list', async () => {
    const { deps } = applyDeps();
    await expect(runScanApply({ foo: 1 }, { dryRun: false }, deps)).rejects.toThrow(UsageError);
    await expect(runScanApply('x', { dryRun: false }, deps)).rejects.toThrow(UsageError);
  });
});

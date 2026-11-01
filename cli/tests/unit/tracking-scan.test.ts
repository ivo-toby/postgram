// cli/tests/unit/tracking-scan.test.ts
import { describe, expect, it, vi } from 'vitest';

import type { StoredEntityResponse } from '../../src/client.js';
import type { TrackingClient } from '../../src/tracking/api.js';
import { DEFAULT_RESUME, UsageError } from '../../src/tracking/config.js';
import type { TrackingConfig } from '../../src/tracking/config.js';
import type { ScannedSession, ScannedWorktree } from '../../src/tracking/scan-discovery.js';
import { BRANCH_SHORT_ID, runScan } from '../../src/tracking/scan.js';
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

// cli/tests/unit/tracking-where.test.ts
import { describe, expect, it } from 'vitest';

import type { TrackingClient } from '../../src/tracking/api.js';
import { DEFAULT_RESUME, shq } from '../../src/tracking/config.js';
import {
  augmentWhere,
  collectWorkspaces,
  renderWhere,
  runWhere,
  syncMissing
} from '../../src/tracking/where.js';
import type { RenderInput } from '../../src/tracking/where.js';
import type {
  SessionView,
  WhereGroup,
  WhereResponse,
  WorkspaceView
} from '../../src/tracking/types.js';

const NOW = new Date('2026-10-31T15:00:00Z');

function makeSession(overrides?: Partial<SessionView>): SessionView {
  return {
    id: 'sess-1',
    agent_kind: 'claude-code',
    agent_session_id: 's-1',
    status: 'running',
    dormant: false,
    cwd: null,
    transcript_path: null,
    started_at: '2026-10-31T14:00:00Z',
    last_activity_at: '2026-10-31T14:30:00Z',
    ended_at: null,
    end_reason: null,
    ...overrides
  };
}

function makeWorkspace(overrides?: Partial<WorkspaceView>): WorkspaceView {
  return {
    id: 'ws-1',
    machine: 'me',
    connect_target: 'me',
    path: '/w/a',
    repo_remote: null,
    branch: null,
    feature_id: null,
    last_activity_at: '2026-10-31T14:30:00Z',
    git: null,
    git_state_at: null,
    missing_since: null,
    risks: [],
    resume_session: null,
    sessions: [],
    ...overrides
  };
}

function makeResponse(groups: WhereGroup[]): WhereResponse {
  return {
    view: 'stage',
    generated_at: '2026-10-31T15:00:00Z',
    dormant_after_days: 30,
    groups
  };
}

function makeInput(overrides?: Partial<RenderInput>): RenderInput {
  return {
    localAlias: 'me',
    templates: DEFAULT_RESUME,
    now: NOW,
    exists: () => true,
    failedIds: new Set<string>(),
    ...overrides
  };
}

type WhereQuery = Parameters<TrackingClient['where']>[0];

function makeClient(
  responses: WhereResponse[],
  patch?: (id: string, missing: boolean) => Promise<unknown>
): {
  client: TrackingClient;
  whereCalls: WhereQuery[];
  patchCalls: Array<{ id: string; missing: boolean }>;
} {
  const whereCalls: WhereQuery[] = [];
  const patchCalls: Array<{ id: string; missing: boolean }> = [];
  let whereIndex = 0;
  const client = {
    where: (query: WhereQuery): Promise<WhereResponse> => {
      whereCalls.push(query);
      const next =
        whereIndex < responses.length
          ? responses[whereIndex]
          : responses[responses.length - 1];
      whereIndex += 1;
      if (next === undefined) {
        throw new Error('expected at least one response');
      }
      return Promise.resolve(next);
    },
    patchWorkspace: (
      id: string,
      body: { feature_id?: string | null; missing?: boolean }
    ): Promise<{ workspace: WorkspaceView }> => {
      const missing = body.missing === true;
      const result = patch !== undefined ? patch(id, missing) : Promise.resolve();
      return result.then(() => {
        patchCalls.push({ id, missing });
        return { workspace: makeWorkspace({ id }) };
      });
    }
  } as TrackingClient;
  return { client, whereCalls, patchCalls };
}

describe('collectWorkspaces', () => {
  it('gathers workspaces from feature groups and the unassigned group', () => {
    const a = makeWorkspace({ id: 'a' });
    const b = makeWorkspace({ id: 'b' });
    const c = makeWorkspace({ id: 'c' });
    const response = makeResponse([
      {
        key: 'building',
        label: 'Building',
        features: [
          {
            id: 'f1',
            title: 'F1',
            stage: 'building',
            stage_source: null,
            stage_set_at: null,
            task_status: null,
            pull_requests: [],
            workspaces: [a]
          },
          {
            id: 'f2',
            title: 'F2',
            stage: 'building',
            stage_source: null,
            stage_set_at: null,
            task_status: null,
            pull_requests: [],
            workspaces: [b]
          }
        ]
      },
      { key: 'unassigned', label: 'Unassigned', workspaces: [c] }
    ]);
    expect(collectWorkspaces(response).map((w) => w.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('syncMissing', () => {
  it('marks a gone local workspace missing and clears a returned one', async () => {
    const calls: Array<{ id: string; missing: boolean }> = [];
    const patch = (id: string, missing: boolean): Promise<unknown> => {
      calls.push({ id, missing });
      return Promise.resolve();
    };
    const result = await syncMissing(
      [
        makeWorkspace({ id: 'w1', path: '/gone', missing_since: null }),
        makeWorkspace({
          id: 'w2',
          path: '/present',
          missing_since: '2026-01-01T00:00:00Z'
        })
      ],
      {
        localAlias: 'me',
        exists: (p) => p === '/present',
        patch
      }
    );
    expect(calls).toEqual([
      { id: 'w1', missing: true },
      { id: 'w2', missing: false }
    ]);
    expect(result.changed).toBe(true);
    expect(result.failedIds).toEqual(new Set<string>());
  });

  it('ignores remote workspaces and workspaces already in the right state', async () => {
    const calls: Array<{ id: string; missing: boolean }> = [];
    const result = await syncMissing(
      [
        makeWorkspace({ id: 'r1', machine: 'other', path: '/gone' }),
        makeWorkspace({ id: 's1', path: '/gone', missing_since: '2026-01-01T00:00:00Z' }),
        makeWorkspace({ id: 's2', path: '/present' })
      ],
      {
        localAlias: 'me',
        exists: (p) => p === '/present',
        patch: (id, missing) => {
          calls.push({ id, missing });
          return Promise.resolve();
        }
      }
    );
    expect(calls).toEqual([]);
    expect(result.changed).toBe(false);
    expect(result.failedIds).toEqual(new Set<string>());
  });

  it('records a failed patch for a missing path and keeps going', async () => {
    const calls: Array<{ id: string; missing: boolean }> = [];
    const patch = (id: string, missing: boolean): Promise<unknown> => {
      if (id === 'w1') {
        return Promise.reject(new Error('403'));
      }
      calls.push({ id, missing });
      return Promise.resolve();
    };
    const result = await syncMissing(
      [
        makeWorkspace({ id: 'w1', path: '/gone', missing_since: null }),
        makeWorkspace({
          id: 'w2',
          path: '/present',
          missing_since: '2026-01-01T00:00:00Z'
        })
      ],
      {
        localAlias: 'me',
        exists: (p) => p === '/present',
        patch
      }
    );
    expect(result.failedIds).toEqual(new Set<string>(['w1']));
    expect(result.changed).toBe(true);
    expect(calls).toEqual([{ id: 'w2', missing: false }]);
  });

  it('does not record a failed patch for a present path', async () => {
    const patch = (id: string): Promise<unknown> => {
      if (id === 'w2') {
        return Promise.reject(new Error('403'));
      }
      return Promise.resolve();
    };
    const result = await syncMissing(
      [
        makeWorkspace({ id: 'w1', path: '/gone', missing_since: null }),
        makeWorkspace({
          id: 'w2',
          path: '/present',
          missing_since: '2026-01-01T00:00:00Z'
        })
      ],
      {
        localAlias: 'me',
        exists: (p) => p === '/present',
        patch
      }
    );
    expect(result.failedIds).toEqual(new Set<string>());
    expect(result.changed).toBe(true);
  });
});

describe('renderWhere', () => {
  it('renders group headers, feature lines and three workspace lines', () => {
    const featureWorkspace = makeWorkspace({
      id: 'w1',
      machine: 'devbox',
      branch: 'main',
      risks: ['unpushed', 'no_upstream'],
      git: { dirty_count: 0, unpushed_count: 1, has_upstream: false },
      git_state_at: '2026-10-31T12:00:00Z',
      resume_session: {
        id: 'sess-1',
        agent_kind: 'claude-code',
        agent_session_id: 's-1',
        status: 'running',
        cwd: null,
        transcript_path: null,
        last_activity_at: '2026-10-31T14:30:00Z'
      },
      sessions: [
        makeSession({
          id: 'sess-1',
          agent_session_id: 's-1',
          last_activity_at: '2026-10-31T14:30:00Z'
        }),
        makeSession({
          id: 'sess-2',
          agent_kind: 'pi',
          agent_session_id: 'p-1',
          status: 'idle',
          dormant: true,
          last_activity_at: '2026-10-19T15:00:00Z'
        })
      ]
    });
    const dirtyWorkspace = makeWorkspace({
      id: 'w2',
      machine: 'devbox',
      branch: 'main',
      path: '/w/d',
      risks: ['dirty'],
      git: { dirty_count: 2, unpushed_count: 0, has_upstream: true }
    });
    const longPath = '/very/long/path/to/make/line/two/overflow/here/!';
    const longWorkspace = makeWorkspace({ id: 'w3', machine: 'devbox', path: longPath });
    const longLine2 = `  ${longPath}  git ?  no sessions`;
    const response = makeResponse([
      {
        key: 'building',
        label: 'Building',
        features: [
          {
            id: '1a2b3c4d-0000-4000-8000-000000000000',
            title: 'My Feature',
            stage: 'building',
            stage_source: 'manual',
            stage_set_at: null,
            task_status: 'active',
            pull_requests: [
              { url: 'https://github.com/ivo-toby/postgram/pull/1', state: 'open', updated_at: '2026-10-31T12:00:00Z' }
            ],
            workspaces: [featureWorkspace]
          }
        ]
      },
      {
        key: 'review',
        label: 'Review',
        features: [
          {
            id: 'deadbeef-0000-4000-8000-000000000000',
            title: 'Dirty Feature',
            stage: 'review',
            stage_source: null,
            stage_set_at: null,
            task_status: null,
            pull_requests: [],
            workspaces: [dirtyWorkspace]
          }
        ]
      },
      { key: 'functional_test', label: 'Functional test', features: [] },
      { key: 'unassigned', label: 'Unassigned', workspaces: [longWorkspace] }
    ]);

    expect(renderWhere(response, makeInput({ localAlias: 'devbox' }))).toEqual([
      '== Building (1) ==',
      '1a2b3c4d My Feature  [building] PR:open',
      '  devbox  main  unpushed:1 no_upstream',
      '  /w/a  git 3h  claude-code/running 30m, pi/idle 12d dormant',
      "  resume: cd '/w/a' && claude --resume 's-1'",
      '== Review (1) ==',
      'deadbeef Dirty Feature  [review]',
      '  devbox  main  dirty:2',
      '  /w/d  git ?  no sessions',
      "  resume: cd '/w/d' && claude",
      '== Unassigned (1) ==',
      '  devbox  -',
      longLine2,
      `  resume: cd '${longPath}' && claude`
    ]);
  });

  it('marks the resume session transcript gone in the session line', () => {
    const workspace = makeWorkspace({
      id: 'w1',
      resume_session: {
        id: 'sess-1',
        agent_kind: 'claude-code',
        agent_session_id: 's-1',
        status: 'ended',
        cwd: null,
        transcript_path: '/t/s-1.jsonl',
        last_activity_at: '2026-10-31T14:30:00Z'
      },
      sessions: [
        makeSession({
          id: 'sess-1',
          agent_session_id: 's-1',
          status: 'ended',
          last_activity_at: '2026-10-31T14:30:00Z'
        })
      ]
    });
    const response = makeResponse([
      { key: 'unassigned', label: 'Unassigned', workspaces: [workspace] }
    ]);
    expect(renderWhere(response, makeInput({ exists: () => false }))).toEqual([
      '== Unassigned (1) ==',
      '  me  -',
      '  /w/a  git ?  claude-code/ended 30m transcript gone',
      "  resume: cd '/w/a' && claude"
    ]);
  });

  it('appends a local missing risk for a failed patch without mutating the input', () => {
    const workspace = makeWorkspace({ id: 'w1', path: '/gone', risks: [] });
    const response = makeResponse([
      { key: 'unassigned', label: 'Unassigned', workspaces: [workspace] }
    ]);
    const before = JSON.stringify(response);
    const lines = renderWhere(response, makeInput({
      exists: () => false,
      failedIds: new Set<string>(['w1'])
    }));
    expect(lines).toEqual([
      '== Unassigned (1) ==',
      '  me  -  missing',
      '  /gone  git ?  no sessions',
      "  resume: cd '/gone' && claude"
    ]);
    expect(JSON.stringify(response)).toBe(before);
  });
});

type AugmentedWorkspace = WorkspaceView & { resume: string; transcript_gone: boolean };

describe('augmentWhere', () => {
  it('adds resume and transcript_gone to every workspace and leaves the input alone', () => {
    const localWorkspace = makeWorkspace({
      id: 'w1',
      resume_session: {
        id: 'sess-1',
        agent_kind: 'claude-code',
        agent_session_id: 's-1',
        status: 'ended',
        cwd: null,
        transcript_path: '/t/s-1.jsonl',
        last_activity_at: '2026-10-31T14:30:00Z'
      }
    });
    const remoteWorkspace = makeWorkspace({
      id: 'w2',
      machine: 'other',
      connect_target: 'otherbox',
      path: '/w/b',
      resume_session: {
        id: 'sess-2',
        agent_kind: 'pi',
        agent_session_id: 's-2',
        status: 'ended',
        cwd: null,
        transcript_path: '/t/s-2.jsonl',
        last_activity_at: '2026-10-31T14:30:00Z'
      }
    });
    const response = makeResponse([
      {
        key: 'building',
        label: 'Building',
        features: [
          {
            id: '1a2b3c4d-0000-4000-8000-000000000000',
            title: 'My Feature',
            stage: 'building',
            stage_source: null,
            stage_set_at: null,
            task_status: null,
            pull_requests: [],
            workspaces: [localWorkspace]
          }
        ]
      },
      { key: 'unassigned', label: 'Unassigned', workspaces: [remoteWorkspace] }
    ]);
    const before = JSON.stringify(response);
    const remoteLocal = `cd ${shq('/w/b')} && pi --session ${shq('s-2')}`;

    const out = augmentWhere(
      response,
      makeInput({ exists: (p) => p === '/w/a' })
    ) as {
      groups: Array<
        | { key: string; features: Array<{ workspaces: AugmentedWorkspace[] }> }
        | { key: string; workspaces: AugmentedWorkspace[] }
      >;
    };
    const featureGroup = out.groups[0];
    const unassignedGroup = out.groups[1];
    if (featureGroup === undefined || 'features' in featureGroup === false) {
      throw new Error('expected the first group to hold features');
    }
    const local = featureGroup.features[0]?.workspaces[0];
    expect(local).toMatchObject({
      resume: "cd '/w/a' && claude",
      transcript_gone: true
    });
    if (unassignedGroup === undefined || 'workspaces' in unassignedGroup === false) {
      throw new Error('expected the second group to hold workspaces');
    }
    const remote = unassignedGroup.workspaces[0];
    expect(remote).toMatchObject({
      resume: `ssh -t otherbox ${shq(remoteLocal)}`,
      transcript_gone: false
    });
    expect(JSON.stringify(response)).toBe(before);
  });
});

function manyWorkspaces(): WorkspaceView[] {
  return [
    makeWorkspace({
      id: 'w1',
      path: '/home/u/wt/one',
      branch: 'feat/one',
      last_activity_at: '2026-10-31T10:00:00Z'
    }),
    makeWorkspace({
      id: 'w2',
      path: '/home/u/wt/two',
      branch: 'feat/two',
      risks: ['dirty'],
      git: { dirty_count: 3, unpushed_count: 0, has_upstream: true },
      last_activity_at: '2026-10-31T14:00:00Z',
      resume_session: {
        id: 'sess-9',
        agent_kind: 'claude-code',
        agent_session_id: 's-9',
        status: 'idle',
        cwd: null,
        transcript_path: null,
        last_activity_at: '2026-10-31T14:00:00Z'
      },
      sessions: [makeSession({ id: 'sess-9', agent_session_id: 's-9' })]
    }),
    makeWorkspace({
      id: 'w3',
      path: '/home/u/wt/three',
      branch: 'feat/three',
      risks: ['unpushed', 'missing'],
      last_activity_at: '2026-10-30T10:00:00Z'
    })
  ];
}

function featureGroup(workspaces: WorkspaceView[]): WhereResponse {
  return makeResponse([
    {
      key: 'building',
      label: 'Building',
      features: [
        {
          id: '1a2b3c4d-0000-4000-8000-000000000000',
          title: 'Big Feature',
          stage: 'building',
          stage_source: 'manual',
          stage_set_at: null,
          task_status: null,
          pull_requests: [],
          workspaces
        }
      ]
    }
  ]);
}

describe('renderWhere compact view', () => {
  it('summarises a feature with several workspaces and resumes the most recent', () => {
    const lines = renderWhere(
      featureGroup(manyWorkspaces()),
      makeInput({ homeDir: '/home/u' })
    );
    expect(lines).toEqual([
      '== Building (1) ==',
      '1a2b3c4d Big Feature  [building]',
      '  3 workspaces, 2 with risks (--expand lists them)',
      '  latest: me  feat/two  ~/wt/two  1h',
      "  resume: cd '/home/u/wt/two' && claude --resume 's-9'"
    ]);
  });

  it('lists every workspace with --expand', () => {
    const lines = renderWhere(
      featureGroup(manyWorkspaces()),
      makeInput({ homeDir: '/home/u', expand: true })
    );
    expect(lines.filter((line) => line.startsWith('  resume:'))).toHaveLength(3);
    expect(lines.some((line) => line.includes('workspaces,'))).toBe(false);
    expect(lines).toContain('  me  feat/three  unpushed missing');
    expect(lines.some((line) => line.startsWith('  ~/wt/one  git ?'))).toBe(true);
  });

  it('keeps the full block for a feature with one workspace', () => {
    const lines = renderWhere(
      featureGroup([manyWorkspaces()[0] as WorkspaceView]),
      makeInput({ homeDir: '/home/u' })
    );
    expect(lines).toEqual([
      '== Building (1) ==',
      '1a2b3c4d Big Feature  [building]',
      '  me  feat/one',
      '  ~/wt/one  git ?  no sessions',
      "  resume: cd '/home/u/wt/one' && claude"
    ]);
  });

  it('lists unassigned workspaces one per line unless expanded', () => {
    const response = makeResponse([
      { key: 'unassigned', label: 'Unassigned', workspaces: manyWorkspaces() }
    ]);
    expect(renderWhere(response, makeInput({ homeDir: '/home/u' }))).toEqual([
      '== Unassigned (3) ==',
      '  ~/wt/one  me  feat/one',
      '  ~/wt/two  me  feat/two  dirty:3',
      '  ~/wt/three  me  feat/three  unpushed missing'
    ]);
  });

  it('never cuts the end of a path: it keeps the tail and drops leading segments', () => {
    const long = `/home/u/${'deeply/'.repeat(12)}feat-abc12345-keyword-fusion`;
    const lines = renderWhere(
      makeResponse([
        {
          key: 'unassigned',
          label: 'Unassigned',
          workspaces: [makeWorkspace({ path: long }), makeWorkspace({ id: 'w2', path: '/x' })]
        }
      ]),
      makeInput({ homeDir: '/home/u' })
    );
    const line = lines[1] ?? '';
    expect(line.startsWith('  …/')).toBe(true);
    expect(line).toContain('/feat-abc12345-keyword-fusion  me');
  });

  it('leaves remote paths alone', () => {
    const lines = renderWhere(
      makeResponse([
        {
          key: 'unassigned',
          label: 'Unassigned',
          workspaces: [
            makeWorkspace({ machine: 'devbox', path: '/home/u/wt/x' }),
            makeWorkspace({ id: 'w2', machine: 'devbox', path: '/home/u/wt/y' })
          ]
        }
      ]),
      makeInput({ homeDir: '/home/u' })
    );
    expect(lines[1]).toBe('  /home/u/wt/x  devbox  -');
  });
});

describe('runWhere', () => {
  it('refetches and renders the refreshed data after a missing patch', async () => {
    const first = makeResponse([
      {
        key: 'unassigned',
        label: 'Unassigned',
        workspaces: [makeWorkspace({ id: 'w1', path: '/gone' })]
      }
    ]);
    const second = makeResponse([
      {
        key: 'unassigned',
        label: 'Unassigned',
        workspaces: [
          makeWorkspace({
            id: 'w1',
            path: '/gone',
            missing_since: '2026-10-31T14:00:00Z',
            risks: ['missing']
          })
        ]
      }
    ]);
    const { client, whereCalls, patchCalls } = makeClient([first, second]);
    const result = await runWhere(
      { actions: false, all: false, includeEnded: false },
      {
        client,
        json: false,
        localAlias: 'me',
        templates: DEFAULT_RESUME,
        now: NOW,
        exists: () => false
      }
    );
    expect(whereCalls).toHaveLength(2);
    expect(patchCalls).toEqual([{ id: 'w1', missing: true }]);
    const lines = result as string[];
    expect(lines).toContain('  me  -  missing');
  });

  it('does not refetch when no patch was needed', async () => {
    const first = makeResponse([
      {
        key: 'unassigned',
        label: 'Unassigned',
        workspaces: [makeWorkspace({ id: 'w1', path: '/present' })]
      }
    ]);
    const { client, whereCalls, patchCalls } = makeClient([first]);
    const result = await runWhere(
      { actions: false, all: false, includeEnded: false },
      {
        client,
        json: false,
        localAlias: 'me',
        templates: DEFAULT_RESUME,
        now: NOW,
        exists: () => true
      }
    );
    expect(whereCalls).toHaveLength(1);
    expect(patchCalls).toEqual([]);
    expect((result as string[]).length).toBeGreaterThan(0);
  });

  it('passes expand and the home directory to the renderer', async () => {
    const response = featureGroup(manyWorkspaces());
    const { client } = makeClient([response]);
    const result = await runWhere(
      { actions: false, all: false, includeEnded: false, expand: true },
      {
        client,
        json: false,
        localAlias: 'me',
        templates: DEFAULT_RESUME,
        now: NOW,
        exists: () => true,
        homeDir: '/home/u'
      }
    );
    expect((result as string[]).filter((line) => line.startsWith('  resume:'))).toHaveLength(3);
  });

  it('maps flags to the where query and returns the augmented body in json mode', async () => {
    const { client, whereCalls } = makeClient([makeResponse([])]);
    const result = await runWhere(
      {
        actions: true,
        machine: 'me',
        repo: 'github.com/ivo-toby/postgram',
        all: true,
        includeEnded: true
      },
      {
        client,
        json: true,
        localAlias: 'me',
        templates: DEFAULT_RESUME,
        now: NOW,
        exists: () => false
      }
    );
    expect(whereCalls[0]).toEqual({
      view: 'actions',
      machine: 'me',
      repo: 'github.com/ivo-toby/postgram',
      includeReleased: true,
      includeDone: true,
      includeEnded: true
    });
    expect((result as { groups: unknown[] }).groups).toEqual([]);
  });
});

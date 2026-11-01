import { describe, expect, it, vi } from 'vitest';

import { Command } from 'commander';
import type { StoredEntityResponse } from '../../src/client.js';
import { ErrorCode } from '../../src/errors.js';
import { runTrackingCommand } from '../../src/tracking/api.js';
import type { TrackingClient } from '../../src/tracking/api.js';
import { DEFAULT_RESUME, UsageError } from '../../src/tracking/config.js';
import {
  registerFeatureCommands,
  runFeatureAdd,
  runFeatureLink,
  runFeaturePr,
  runFeatureStage,
  runMachineList,
  runMachineSet,
  runRepoSet
} from '../../src/tracking/feature-commands.js';

vi.mock('../../src/tracking/api.js', () => ({
  runTrackingCommand: vi.fn(() => Promise.resolve())
}));
import type { FeatureDeps } from '../../src/tracking/feature-commands.js';
import type {
  LookupResponse,
  MachineView,
  ReportResponse,
  WhereResponse,
  WorkspaceView
} from '../../src/tracking/types.js';

const FEATURE_ID = '1a2b3c4d-0000-4000-8000-000000000001';
const SHORT = '1a2b3c4d';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

const WORKSPACE: WorkspaceView = {
  id: WORKSPACE_ID,
  machine: 'devbox',
  connect_target: 'devbox.lan',
  path: '/w',
  repo_remote: null,
  branch: 'main',
  feature_id: null,
  last_activity_at: '2026-01-01T00:00:00.000Z',
  git: null,
  git_state_at: null,
  missing_since: null,
  risks: [],
  resume_session: null,
  sessions: []
};

const DEVBOX: MachineView = {
  alias: 'devbox',
  hostname: 'host',
  connect_target: 'devbox.lan',
  last_seen_at: '2026-01-01T00:00:00.000Z'
};
const LAPTOP: MachineView = {
  alias: 'laptop',
  hostname: 'host2',
  connect_target: null,
  last_seen_at: '2026-01-02T00:00:00.000Z'
};
const MACHINES: MachineView[] = [DEVBOX, LAPTOP];

function entity(): StoredEntityResponse['entity'] {
  return {
    id: FEATURE_ID,
    type: 'task',
    content: 'feature',
    visibility: 'shared',
    owner: null,
    status: 'inbox',
    enrichment_status: null,
    version: 1,
    tags: [],
    source: null,
    metadata: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z'
  };
}

function makeClient(overrides: Partial<TrackingClient> = {}) {
  const fns = {
    report: vi.fn((): Promise<ReportResponse> =>
      Promise.resolve({
        workspace: { ...WORKSPACE },
        feature: null,
        interrupted_sessions: 0,
        warnings: []
      })
    ),
    patchWorkspace: vi.fn((): Promise<{ workspace: WorkspaceView }> =>
      Promise.resolve({ workspace: { ...WORKSPACE, feature_id: FEATURE_ID } })
    ),
    putMachine: vi.fn(
      (alias: string, connectTarget: string | null): Promise<{ machine: MachineView }> =>
        Promise.resolve({
          machine: { alias, hostname: 'host', connect_target: connectTarget, last_seen_at: DEVBOX.last_seen_at }
        })
    ),
    listMachines: vi.fn((): Promise<{ machines: MachineView[] }> => Promise.resolve({ machines: MACHINES })),
    putRepository: vi.fn(
      (remote: string, releaseOnMerge: boolean): Promise<{
        repository: { remote: string; release_on_merge: boolean };
      }> => Promise.resolve({ repository: { remote, release_on_merge: releaseOnMerge } })
    ),
    createFeature: vi.fn((): Promise<StoredEntityResponse> => Promise.resolve({ entity: entity() })),
    setStage: vi.fn(
      (): Promise<StoredEntityResponse & { previous_stage: string | null }> =>
        Promise.resolve({ entity: entity(), previous_stage: null })
    ),
    addPullRequest: vi.fn(
      (): Promise<StoredEntityResponse & { stage_changed: boolean; from: string; to: string }> =>
        Promise.resolve({ entity: entity(), stage_changed: true, from: 'building', to: 'review' })
    ),
    lookup: vi.fn((): Promise<LookupResponse> => Promise.resolve({ workspace: null, feature: null })),
    listWorkspaces: vi.fn((): Promise<{ workspaces: WorkspaceView[] }> => Promise.resolve({ workspaces: [] })),
    where: vi.fn((): Promise<WhereResponse> =>
      Promise.resolve({
        view: 'stage',
        generated_at: '2026-01-01T00:00:00.000Z',
        dormant_after_days: 14,
        groups: []
      })
    )
  };
  const client = { ...fns, ...overrides } as TrackingClient;
  return { client, fns };
}

function makeDeps(overrides: Partial<FeatureDeps> = {}): FeatureDeps {
  return {
    client: makeClient().client,
    config: {
      alias: 'devbox',
      connectTarget: 'devbox',
      scanRoots: [],
      worktreeRoot: null,
      hereTimeoutMs: 2000,
      resume: DEFAULT_RESUME
    },
    json: false,
    cwd: '/w',
    hostname: 'host',
    homeDir: '/home/test',
    bootId: () => Promise.resolve('boot-id'),
    resolveWorkspace: () =>
      Promise.resolve({ kind: 'ok', path: '/w', repoRoot: null, workspace: { path: '/w' } }),
    writeMarker: vi.fn((): Promise<void> => Promise.resolve()),
    removeMarker: vi.fn((): Promise<void> => Promise.resolve()),
    exists: () => true,
    warn: vi.fn(),
    ...overrides
  };
}

describe('runFeatureAdd', () => {
  it('prints the full new id in human mode', async () => {
    const { client, fns } = makeClient();
    const deps = makeDeps({ client });
    const result = await runFeatureAdd('My feature', {}, deps);
    expect(result).toEqual([FEATURE_ID]);
    expect(fns.createFeature).toHaveBeenCalledWith({ content: 'My feature' });
  });

  it('returns the response body in json mode and splits tags', async () => {
    const { client, fns } = makeClient();
    const deps = makeDeps({ client, json: true });
    const result = await runFeatureAdd('My feature', { tags: 'a, b', visibility: 'work' }, deps);
    expect(result).toEqual({ entity: entity() });
    expect(fns.createFeature).toHaveBeenCalledWith({
      content: 'My feature',
      tags: ['a', 'b'],
      visibility: 'work'
    });
  });
});

describe('runFeatureStage', () => {
  it('sets a valid stage and prints previous → new', async () => {
    const { client, fns } = makeClient();
    const deps = makeDeps({ client });
    const result = await runFeatureStage('abc', 'functional_test', deps);
    expect(fns.setStage).toHaveBeenCalledWith('abc', 'functional_test');
    expect(result).toEqual([`${SHORT} - → functional_test`]);
  });

  it('prints the previous stage when the server returns one', async () => {
    const setStage = vi.fn(
      (): Promise<StoredEntityResponse & { previous_stage: string | null }> =>
        Promise.resolve({ entity: entity(), previous_stage: 'building' })
    );
    const { client } = makeClient({ setStage });
    const deps = makeDeps({ client });
    const result = await runFeatureStage(FEATURE_ID, 'review', deps);
    expect(result).toEqual([`${SHORT} building → review`]);
  });

  it('rejects an invalid stage with UsageError', async () => {
    const { client, fns } = makeClient();
    const deps = makeDeps({ client });
    await expect(runFeatureStage(FEATURE_ID, 'done', deps)).rejects.toThrow(UsageError);
    expect(fns.setStage).not.toHaveBeenCalled();
  });
});

describe('runFeaturePr', () => {
  it('defaults the PR state to open', async () => {
    const { client, fns } = makeClient();
    const deps = makeDeps({ client });
    const result = await runFeaturePr(FEATURE_ID, 'https://x/pull/1', {}, deps);
    expect(fns.addPullRequest).toHaveBeenCalledWith(FEATURE_ID, {
      url: 'https://x/pull/1',
      state: 'open'
    });
    expect(result).toEqual([`${SHORT} PR open, stage review`]);
  });

  it('passes an explicit state through', async () => {
    const { client, fns } = makeClient();
    const deps = makeDeps({ client });
    const result = await runFeaturePr(FEATURE_ID, 'https://x/pull/1', { state: 'merged' }, deps);
    expect(fns.addPullRequest).toHaveBeenCalledWith(FEATURE_ID, {
      url: 'https://x/pull/1',
      state: 'merged'
    });
    expect(result).toEqual([`${SHORT} PR merged, stage review`]);
  });

  it('rejects an invalid state with UsageError', async () => {
    const { client, fns } = makeClient();
    const deps = makeDeps({ client });
    await expect(
      runFeaturePr(FEATURE_ID, 'https://x/pull/1', { state: 'shipped' }, deps)
    ).rejects.toThrow(UsageError);
    expect(fns.addPullRequest).not.toHaveBeenCalled();
  });
});

describe('runFeatureLink', () => {
  it('reports an unknown workspace before patching and writes the marker', async () => {
    const order: string[] = [];
    const report = vi.fn((): Promise<ReportResponse> => {
      order.push('report');
      return Promise.resolve({
        workspace: { ...WORKSPACE, id: 'ws-new' },
        feature: null,
        interrupted_sessions: 0,
        warnings: []
      });
    });
    const patchWorkspace = vi.fn((): Promise<{ workspace: WorkspaceView }> => {
      order.push('patch');
      return Promise.resolve({ workspace: { ...WORKSPACE, id: 'ws-new', feature_id: FEATURE_ID } });
    });
    const writeMarker = vi.fn((): Promise<void> => {
      order.push('marker');
      return Promise.resolve();
    });
    const { client } = makeClient({ report, patchWorkspace });
    const deps = makeDeps({ client, writeMarker });

    const result = await runFeatureLink(FEATURE_ID, {}, deps);

    expect(order).toEqual(['report', 'patch', 'marker']);
    expect(report).toHaveBeenCalledWith({
      source: 'hook',
      machine: { alias: 'devbox', hostname: 'host', boot_id: 'boot-id' },
      workspace: { path: '/w' }
    });
    expect(patchWorkspace).toHaveBeenCalledWith('ws-new', { feature_id: FEATURE_ID });
    expect(writeMarker).toHaveBeenCalledWith('/w', FEATURE_ID);
    expect(result).toEqual([`linked /w → ${SHORT}`]);
  });

  it('patches a known workspace without reporting and writes the marker', async () => {
    const lookup = vi.fn((): Promise<LookupResponse> =>
      Promise.resolve({ workspace: { ...WORKSPACE, id: 'ws-known' }, feature: null })
    );
    const patchWorkspace = vi.fn((): Promise<{ workspace: WorkspaceView }> =>
      Promise.resolve({ workspace: { ...WORKSPACE, id: 'ws-known', feature_id: FEATURE_ID } })
    );
    const writeMarker = vi.fn((): Promise<void> => Promise.resolve());
    const { client, fns } = makeClient({ lookup, patchWorkspace });
    const deps = makeDeps({ client, writeMarker });

    const result = await runFeatureLink(FEATURE_ID, { path: '/w' }, deps);

    expect(fns.report).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledWith('devbox', '/w');
    expect(patchWorkspace).toHaveBeenCalledWith('ws-known', { feature_id: FEATURE_ID });
    expect(writeMarker).toHaveBeenCalledWith('/w', FEATURE_ID);
    expect(result).toEqual([`linked /w → ${SHORT}`]);
  });

  it('unlinks by patching feature_id to null and removing the marker', async () => {
    const lookup = vi.fn((): Promise<LookupResponse> =>
      Promise.resolve({ workspace: { ...WORKSPACE, id: 'ws-known' }, feature: null })
    );
    const patchWorkspace = vi.fn((): Promise<{ workspace: WorkspaceView }> =>
      Promise.resolve({ workspace: { ...WORKSPACE, id: 'ws-known', feature_id: null } })
    );
    const writeMarker = vi.fn((): Promise<void> => Promise.resolve());
    const removeMarker = vi.fn((): Promise<void> => Promise.resolve());
    const { client } = makeClient({ lookup, patchWorkspace });
    const deps = makeDeps({ client, writeMarker, removeMarker });

    const result = await runFeatureLink(null, {}, deps);

    expect(patchWorkspace).toHaveBeenCalledWith('ws-known', { feature_id: null });
    expect(removeMarker).toHaveBeenCalledWith('/w');
    expect(writeMarker).not.toHaveBeenCalled();
    expect(result).toEqual(['unlinked /w']);
  });

  it('fails with AppError INTERNAL when git times out', async () => {
    const deps = makeDeps({ resolveWorkspace: () => Promise.resolve({ kind: 'timeout' }) });
    await expect(runFeatureLink(FEATURE_ID, {}, deps)).rejects.toMatchObject({
      code: ErrorCode.INTERNAL,
      message: 'git timeout'
    });
  });

  it('updates the marker for a local existing --workspace', async () => {
    const patchWorkspace = vi.fn((): Promise<{ workspace: WorkspaceView }> =>
      Promise.resolve({ workspace: { ...WORKSPACE, feature_id: FEATURE_ID } })
    );
    const writeMarker = vi.fn((): Promise<void> => Promise.resolve());
    const warn = vi.fn();
    const { client } = makeClient({ patchWorkspace });
    const deps = makeDeps({ client, writeMarker, warn, exists: () => true });

    const result = await runFeatureLink(FEATURE_ID, { workspace: WORKSPACE_ID }, deps);

    expect(patchWorkspace).toHaveBeenCalledWith(WORKSPACE_ID, { feature_id: FEATURE_ID });
    expect(writeMarker).toHaveBeenCalledWith('/w', FEATURE_ID);
    expect(warn).not.toHaveBeenCalled();
    expect(result).toEqual([`linked /w → ${SHORT}`]);
  });

  it('warns and touches no marker for a remote --workspace', async () => {
    const patchWorkspace = vi.fn((): Promise<{ workspace: WorkspaceView }> =>
      Promise.resolve({
        workspace: { ...WORKSPACE, machine: 'otherbox', path: '/remote', feature_id: FEATURE_ID }
      })
    );
    const writeMarker = vi.fn((): Promise<void> => Promise.resolve());
    const removeMarker = vi.fn((): Promise<void> => Promise.resolve());
    const warn = vi.fn();
    const { client } = makeClient({ patchWorkspace });
    const deps = makeDeps({ client, writeMarker, removeMarker, warn });

    const result = await runFeatureLink(FEATURE_ID, { workspace: WORKSPACE_ID }, deps);

    expect(writeMarker).not.toHaveBeenCalled();
    expect(removeMarker).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "warning: otherbox may have a feature marker; its next registration will restore the marker's link"
    );
    expect(result).toEqual([`linked /remote → ${SHORT}`]);
  });
});

describe('runMachineSet', () => {
  it('writes config, reports without a workspace, puts the machine and warns on alias change', async () => {
    const writeConfig = vi.fn(
      (): Promise<{ previousAlias: string | null; alias: string; connectTarget: string }> =>
        Promise.resolve({ previousAlias: 'oldbox', alias: 'newbox', connectTarget: 'newbox.lan' })
    );
    const warn = vi.fn();
    const report = vi.fn((): Promise<ReportResponse> =>
      Promise.resolve({ workspace: null, feature: null, interrupted_sessions: 0, warnings: [] })
    );
    const putMachine = vi.fn((): Promise<{ machine: MachineView }> => Promise.resolve({ machine: DEVBOX }));
    const { client } = makeClient({ report, putMachine });
    const deps = makeDeps({ client, warn });

    const result = await runMachineSet(
      { alias: 'newbox', connect: 'newbox.lan' },
      { ...deps, writeConfig }
    );

    expect(writeConfig).toHaveBeenCalledWith({
      alias: 'newbox',
      connectTarget: 'newbox.lan',
      homeDir: '/home/test'
    });
    expect(warn).toHaveBeenCalledWith("warning: history stays under the old alias 'oldbox'");
    expect(report).toHaveBeenCalledWith({
      source: 'hook',
      machine: { alias: 'newbox', hostname: 'host', boot_id: 'boot-id' }
    });
    expect(putMachine).toHaveBeenCalledWith('newbox', 'newbox.lan');
    expect(result).toEqual(['machine newbox → newbox.lan']);
  });

  it('does not warn when the alias is unchanged', async () => {
    const writeConfig = vi.fn(
      (): Promise<{ previousAlias: string | null; alias: string; connectTarget: string }> =>
        Promise.resolve({ previousAlias: 'devbox', alias: 'devbox', connectTarget: 'devbox.lan' })
    );
    const warn = vi.fn();
    const { client } = makeClient();
    const deps = makeDeps({ client, warn });

    const result = await runMachineSet({ connect: 'devbox.lan' }, { ...deps, writeConfig });

    expect(writeConfig).toHaveBeenCalledWith({ connectTarget: 'devbox.lan', homeDir: '/home/test' });
    expect(warn).not.toHaveBeenCalled();
    expect(result).toEqual(['machine devbox → devbox.lan']);
  });
});

describe('runMachineList', () => {
  it('prints one line per machine, falling back to the alias', async () => {
    const { client } = makeClient();
    const deps = makeDeps({ client });
    const result = await runMachineList(deps);
    expect(result).toEqual([
      'devbox  devbox.lan  2026-01-01T00:00:00.000Z',
      'laptop  laptop  2026-01-02T00:00:00.000Z'
    ]);
  });

  it('returns the machines body in json mode', async () => {
    const { client } = makeClient();
    const deps = makeDeps({ client, json: true });
    const result = await runMachineList(deps);
    expect(result).toEqual({ machines: MACHINES });
  });
});

describe('registerFeatureCommands', () => {
  it('passes a Command as the last argument to the feature stage action', async () => {
    vi.mocked(runTrackingCommand).mockClear();
    const program = new Command();
    program.option('--json');
    registerFeatureCommands(program);
    await program.parseAsync(['node', 'pgm', 'feature', 'stage', 'abcd1234', 'review']);
    const calls = vi.mocked(runTrackingCommand).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0]?.[0]).toBeInstanceOf(Command);
  });
});

describe('runRepoSet', () => {
  it('sets the repository flag for true and false', async () => {
    const { client, fns } = makeClient();
    const deps = makeDeps({ client });
    const result = await runRepoSet('git@github.com:x/y.git', { releaseOnMerge: 'true' }, deps);
    expect(fns.putRepository).toHaveBeenCalledWith('git@github.com:x/y.git', true);
    expect(result).toEqual(['git@github.com:x/y.git release_on_merge=true']);

    await runRepoSet('git@github.com:x/y.git', { releaseOnMerge: 'false' }, deps);
    expect(fns.putRepository).toHaveBeenLastCalledWith('git@github.com:x/y.git', false);
  });

  it('rejects any other --release-on-merge value with UsageError', async () => {
    const { client, fns } = makeClient();
    const deps = makeDeps({ client });
    await expect(runRepoSet('x', { releaseOnMerge: 'maybe' }, deps)).rejects.toThrow(UsageError);
    expect(fns.putRepository).not.toHaveBeenCalled();
  });
});

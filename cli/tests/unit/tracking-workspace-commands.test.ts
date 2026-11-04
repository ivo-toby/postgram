// cli/tests/unit/tracking-workspace-commands.test.ts
import { describe, expect, it } from 'vitest';

import type { TrackingClient } from '../../src/tracking/api.js';
import { DEFAULT_RESUME } from '../../src/tracking/config.js';
import type { TrackingConfig } from '../../src/tracking/config.js';
import { runWorkspacePrune } from '../../src/tracking/workspace-commands.js';
import type { PruneDeps } from '../../src/tracking/workspace-commands.js';
import type { WorkspaceView } from '../../src/tracking/types.js';

const CONFIG: TrackingConfig = {
  alias: 'me',
  connectTarget: 'me',
  scanRoots: [],
  worktreeRoot: null,
  hereTimeoutMs: 2000,
  ignorePaths: ['/w/root'],
  resume: DEFAULT_RESUME
};

function workspace(overrides: Partial<WorkspaceView>): WorkspaceView {
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

function setup(
  known: WorkspaceView[],
  present: string[],
  failOn: string[] = []
) {
  const deleted: string[] = [];
  const listed: unknown[] = [];
  const client = {
    listWorkspaces: (query: unknown) => {
      listed.push(query);
      return Promise.resolve({ workspaces: known });
    },
    deleteWorkspace: (id: string) => {
      if (failOn.includes(id)) {
        return Promise.reject(new Error('forbidden'));
      }
      deleted.push(id);
      return Promise.resolve({ deleted: true as const, workspace: workspace({ id }) });
    }
  } as unknown as TrackingClient;
  const deps: PruneDeps = {
    client,
    config: CONFIG,
    exists: (p) => present.includes(p)
  };
  return { deps, deleted, listed };
}

describe('runWorkspacePrune', () => {
  const FEATURE = '1a2b3c4d-0000-4000-8000-000000000000';

  it('removes local workspaces whose directory is gone and leaves everything else', async () => {
    const { deps, deleted, listed } = setup(
      [
        workspace({ id: 'gone', path: '/w/gone', feature_id: FEATURE }),
        workspace({ id: 'here', path: '/w/here' }),
        workspace({ id: 'remote', machine: 'devbox', path: '/w/remote-gone' })
      ],
      ['/w/here']
    );

    const result = await runWorkspacePrune({ dryRun: false }, deps);

    expect(listed).toEqual([{ machine: 'me' }]);
    expect(deleted).toEqual(['gone']);
    expect(result).toEqual({
      removed: [{ id: 'gone', path: '/w/gone', feature_id: FEATURE, reason: 'missing' }],
      failed: [],
      dry_run: false
    });
  });

  it('deletes nothing with --dry-run', async () => {
    const { deps, deleted } = setup([workspace({ id: 'gone', path: '/w/gone' })], []);
    const result = await runWorkspacePrune({ dryRun: true }, deps);
    expect(deleted).toEqual([]);
    expect(result.removed).toHaveLength(1);
    expect(result.dry_run).toBe(true);
  });

  it('removes workspaces under ignore_paths only with --ignored', async () => {
    const known = [workspace({ id: 'root', path: '/w/root' })];
    const without = setup(known, ['/w/root']);
    expect((await runWorkspacePrune({ dryRun: false }, without.deps)).removed).toEqual([]);

    const withFlag = setup(known, ['/w/root']);
    const result = await runWorkspacePrune({ dryRun: false, ignored: true }, withFlag.deps);
    expect(withFlag.deleted).toEqual(['root']);
    expect(result.removed[0]).toMatchObject({ id: 'root', reason: 'ignored' });
  });

  it('keeps going when one delete fails and reports it', async () => {
    const { deps, deleted } = setup(
      [
        workspace({ id: 'a', path: '/w/a' }),
        workspace({ id: 'b', path: '/w/b' })
      ],
      [],
      ['a']
    );
    const result = await runWorkspacePrune({ dryRun: false }, deps);
    expect(deleted).toEqual(['b']);
    expect(result.failed).toEqual([{ id: 'a', path: '/w/a', error: 'forbidden' }]);
    expect(result.removed.map((entry) => entry.id)).toEqual(['b']);
  });
});

// cli/tests/unit/tracking-feature-done-sync.test.ts
import { describe, expect, it, vi } from 'vitest';

import type { StoredEntityResponse } from '../../src/client.js';
import type { TrackingClient } from '../../src/tracking/api.js';
import { UsageError } from '../../src/tracking/config.js';
import { runFeatureDone } from '../../src/tracking/feature-commands.js';
import type { FeatureDoneDeps } from '../../src/tracking/feature-commands.js';
import {
  classifyGhFailure,
  parseGhState,
  runFeatureSync,
  runGhPrState
} from '../../src/tracking/feature-sync.js';
import type { GhResult } from '../../src/tracking/feature-sync.js';
import type {
  PullRequestView,
  WhereFeature,
  WhereResponse
} from '../../src/tracking/types.js';

const FEATURE_ID = '1a2b3c4d-0000-4000-8000-000000000001';
const OTHER_ID = '9f9f9f9f-0000-4000-8000-000000000002';

function entity(overrides: Partial<StoredEntityResponse['entity']> = {}): StoredEntityResponse {
  return {
    entity: {
      id: FEATURE_ID,
      type: 'task',
      content: 'Feature',
      visibility: 'shared',
      owner: null,
      status: 'active',
      enrichment_status: null,
      version: 7,
      tags: [],
      source: null,
      metadata: { kind: 'feature' },
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      ...overrides
    }
  };
}

describe('runFeatureDone', () => {
  function setup(items: Array<{ id: string }> = [{ id: FEATURE_ID }]) {
    const recallEntity = vi.fn(() => Promise.resolve(entity()));
    const completeTask = vi.fn(() => Promise.resolve(entity({ status: 'done', version: 8 })));
    const listTasks = vi.fn(() =>
      Promise.resolve({
        items: items.map((item) => ({ ...entity().entity, id: item.id })),
        total: items.length,
        limit: 100,
        offset: 0
      })
    );
    const deps: FeatureDoneDeps = {
      pgm: { recallEntity, completeTask, listTasks },
      json: false
    };
    return { deps, recallEntity, completeTask, listTasks };
  }

  it('completes the task with its current version by full id', async () => {
    const { deps, recallEntity, completeTask, listTasks } = setup();
    const lines = await runFeatureDone(FEATURE_ID, deps);
    expect(listTasks).not.toHaveBeenCalled();
    expect(recallEntity).toHaveBeenCalledWith(FEATURE_ID);
    expect(completeTask).toHaveBeenCalledWith(FEATURE_ID, 7);
    expect(lines).toEqual(['1a2b3c4d done']);
  });

  it('resolves an 8-hex short id and rejects an ambiguous or unknown one', async () => {
    const { deps, completeTask } = setup();
    await runFeatureDone('1a2b3c4d', deps);
    expect(completeTask).toHaveBeenCalledWith(FEATURE_ID, 7);

    const ambiguous = setup([{ id: FEATURE_ID }, { id: '1a2b3c4d-1111-4000-8000-000000000003' }]);
    await expect(runFeatureDone('1a2b3c4d', ambiguous.deps)).rejects.toThrow(/ambiguous/);
    expect(ambiguous.completeTask).not.toHaveBeenCalled();

    const none = setup([]);
    await expect(runFeatureDone('deadbeef', none.deps)).rejects.toThrow(/no feature matches/);
  });

  it('rejects ids that are neither uuid nor 8-hex', async () => {
    const { deps } = setup();
    await expect(runFeatureDone('nope', deps)).rejects.toBeInstanceOf(UsageError);
  });

  it('does nothing when the feature is already done', async () => {
    const { deps, completeTask, recallEntity } = setup();
    recallEntity.mockResolvedValue(entity({ status: 'done' }));
    const lines = await runFeatureDone(FEATURE_ID, deps);
    expect(completeTask).not.toHaveBeenCalled();
    expect(lines).toEqual(['1a2b3c4d already done']);
  });
});

describe('parseGhState', () => {
  it('maps gh states to PR states', () => {
    expect(parseGhState('{"state":"OPEN"}')).toBe('open');
    expect(parseGhState('{"state":"MERGED"}')).toBe('merged');
    expect(parseGhState('{"state":"CLOSED"}')).toBe('closed');
  });

  it('returns null for anything else', () => {
    expect(parseGhState('')).toBeNull();
    expect(parseGhState('not json')).toBeNull();
    expect(parseGhState('{"state":"WEIRD"}')).toBeNull();
    expect(parseGhState('[]')).toBeNull();
  });
});

describe('classifyGhFailure', () => {
  it('detects a missing gh binary', () => {
    expect(classifyGhFailure({ code: 'ENOENT', stderr: '' }).kind).toBe('missing');
  });

  it('detects missing authentication from stderr', () => {
    const text = 'To get started with GitHub CLI, please run:  gh auth login';
    expect(classifyGhFailure({ code: 1, stderr: text }).kind).toBe('unauthenticated');
    expect(
      classifyGhFailure({ code: 4, stderr: 'You are not logged into any GitHub hosts.' }).kind
    ).toBe('unauthenticated');
  });

  it('keeps other failures as per-PR errors with the first stderr line', () => {
    const failure = classifyGhFailure({
      code: 1,
      stderr: 'GraphQL: Could not resolve to a PullRequest\nmore'
    });
    expect(failure).toEqual({
      ok: false,
      kind: 'error',
      message: 'GraphQL: Could not resolve to a PullRequest'
    });
  });
});

describe('runGhPrState', () => {
  const URL = 'https://github.com/o/r/pull/1';

  it('runs gh pr view --json state and parses the answer', async () => {
    const exec = vi.fn(() => Promise.resolve({ stdout: '{"state":"MERGED"}' }));
    const result = await runGhPrState(URL, exec);
    expect(exec).toHaveBeenCalledWith('gh', ['pr', 'view', URL, '--json', 'state']);
    expect(result).toEqual({ ok: true, state: 'merged' });
  });

  it('classifies a failing exec and unparsable output', async () => {
    const missing = await runGhPrState(URL, () =>
      Promise.reject(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT', stderr: '' }))
    );
    expect(missing).toMatchObject({ ok: false, kind: 'missing' });
    const garbage = await runGhPrState(URL, () => Promise.resolve({ stdout: 'hm' }));
    expect(garbage).toMatchObject({ ok: false, kind: 'error' });
  });
});

describe('runFeatureSync', () => {
  function pr(url: string, state: PullRequestView['state']): PullRequestView {
    return { url, state, updated_at: '2026-10-01T00:00:00.000Z' };
  }

  function feature(id: string, title: string, pulls: PullRequestView[]): WhereFeature {
    return {
      id,
      title,
      stage: 'review',
      stage_source: 'derived',
      stage_set_at: null,
      task_status: null,
      pull_requests: pulls,
      workspaces: []
    };
  }

  function setup(features: WhereFeature[], gh: (url: string) => Promise<GhResult>) {
    const where = vi.fn(
      (): Promise<WhereResponse> =>
        Promise.resolve({
          view: 'stage',
          generated_at: '2026-10-31T00:00:00Z',
          dormant_after_days: 30,
          groups: [{ key: 'review', label: 'Review', features }]
        })
    );
    const addPullRequest = vi.fn(
      (id: string, input: { url: string; state?: 'open' | 'merged' | 'closed' }) =>
        Promise.resolve({
          ...entity({ id }),
          stage_changed: input.state === 'merged',
          from: 'review',
          to: input.state === 'merged' ? 'awaiting_release' : 'review'
        })
    );
    const client = { where, addPullRequest } as unknown as TrackingClient;
    return { deps: { client, gh: vi.fn(gh) }, where, addPullRequest };
  }

  const A = 'https://github.com/o/r/pull/1';
  const B = 'https://github.com/o/r/pull/2';
  const C = 'https://github.com/o/r/pull/3';

  it('reports only changed states through the feature PR endpoint', async () => {
    const { deps, addPullRequest } = setup(
      [
        feature(FEATURE_ID, 'One', [pr(A, 'open'), pr(B, 'open')]),
        feature(OTHER_ID, 'Two', [pr(C, 'closed')])
      ],
      (url) =>
        Promise.resolve(
          url === A
            ? { ok: true, state: 'merged' }
            : url === B
              ? { ok: true, state: 'open' }
              : { ok: true, state: 'closed' }
        )
    );

    const result = await runFeatureSync(undefined, deps);

    expect(addPullRequest).toHaveBeenCalledTimes(1);
    expect(addPullRequest).toHaveBeenCalledWith(FEATURE_ID, { url: A, state: 'merged' });
    expect(result).toEqual({
      checked: 3,
      unchanged: 2,
      changed: [
        {
          feature_id: FEATURE_ID,
          url: A,
          from: 'open',
          to: 'merged',
          stage_from: 'review',
          stage_to: 'awaiting_release'
        }
      ],
      errors: []
    });
  });

  it('skips merged pull requests, which cannot change', async () => {
    const { deps } = setup([feature(FEATURE_ID, 'One', [pr(A, 'merged')])], () =>
      Promise.reject(new Error('must not be called'))
    );
    const result = await runFeatureSync(undefined, deps);
    expect(result.checked).toBe(0);
    expect(deps.gh).not.toHaveBeenCalled();
  });

  it('limits the run to one feature by short id and then includes released and done ones', async () => {
    const { deps, where } = setup(
      [
        feature(FEATURE_ID, 'One', [pr(A, 'open')]),
        feature(OTHER_ID, 'Two', [pr(C, 'open')])
      ],
      () => Promise.resolve({ ok: true, state: 'open' })
    );
    const result = await runFeatureSync('1a2b3c4d', deps);
    expect(deps.gh).toHaveBeenCalledTimes(1);
    expect(result.checked).toBe(1);
    expect(where).toHaveBeenCalledWith({
      view: 'stage',
      includeReleased: true,
      includeDone: true
    });
  });

  it('fails when the named feature is not found', async () => {
    const { deps } = setup([], () => Promise.resolve({ ok: true, state: 'open' }));
    await expect(runFeatureSync('deadbeef', deps)).rejects.toThrow(/no feature matches/);
  });

  it('asks the default view only for active features without an id', async () => {
    const { deps, where } = setup([], () => Promise.resolve({ ok: true, state: 'open' }));
    await runFeatureSync(undefined, deps);
    expect(where).toHaveBeenCalledWith({ view: 'stage' });
  });

  it('aborts before any write when gh is missing or unauthenticated', async () => {
    for (const kind of ['missing', 'unauthenticated'] as const) {
      const { deps, addPullRequest } = setup(
        [feature(FEATURE_ID, 'One', [pr(A, 'open'), pr(B, 'open')])],
        () => Promise.resolve({ ok: false, kind, message: 'x' })
      );
      const failure = runFeatureSync(undefined, deps);
      await expect(failure).rejects.toBeInstanceOf(UsageError);
      await expect(failure).rejects.toThrow(kind === 'missing' ? /gh/ : /gh auth login/);
      expect(addPullRequest).not.toHaveBeenCalled();
    }
  });

  it('records a per-PR error and keeps going', async () => {
    const { deps, addPullRequest } = setup(
      [feature(FEATURE_ID, 'One', [pr(A, 'open'), pr(B, 'open')])],
      (url) =>
        Promise.resolve(
          url === A
            ? { ok: false, kind: 'error', message: 'not found' }
            : { ok: true, state: 'closed' }
        )
    );
    const result = await runFeatureSync(undefined, deps);
    expect(result.errors).toEqual([{ feature_id: FEATURE_ID, url: A, error: 'not found' }]);
    expect(result.changed.map((c) => c.url)).toEqual([B]);
    expect(addPullRequest).toHaveBeenCalledWith(FEATURE_ID, { url: B, state: 'closed' });
  });

  it('asks gh once per url', async () => {
    const { deps } = setup(
      [feature(FEATURE_ID, 'One', [pr(A, 'open')]), feature(OTHER_ID, 'Two', [pr(A, 'open')])],
      () => Promise.resolve({ ok: true, state: 'open' })
    );
    await runFeatureSync(undefined, deps);
    expect(deps.gh).toHaveBeenCalledTimes(1);
  });
});

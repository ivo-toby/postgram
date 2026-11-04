import { describe, expect, it } from 'vitest';

import {
  canonicalizePullRequestUrl,
  compareStages,
  deriveStage,
  featureDefaults,
  isFeatureStage,
  isPullRequestState,
  normalizeFeatureMetadata,
  upsertPullRequest
} from '../../src/services/feature-rules.js';
import { FEATURE_STAGES, PULL_REQUEST_STATES } from '../../src/types/features.js';
import type {
  FeaturePullRequest,
  FeatureStage,
  PullRequestState
} from '../../src/types/features.js';
import { AppError, ErrorCode } from '../../src/util/errors.js';

const NOW = '2026-10-31T12:00:00.000Z';
const PR_URL = 'https://github.com/ivo-toby/postgram/pull/12';

const asAppError = (value: unknown): AppError => {
  expect(value).toBeInstanceOf(AppError);
  return value as AppError;
};

describe('isFeatureStage / isPullRequestState', () => {
  it('accepts every contract member and rejects others', () => {
    for (const stage of FEATURE_STAGES) {
      expect(isFeatureStage(stage)).toBe(true);
    }
    expect(isFeatureStage('shipping')).toBe(false);
    expect(isFeatureStage(undefined)).toBe(false);
    expect(isFeatureStage(3)).toBe(false);

    for (const state of PULL_REQUEST_STATES) {
      expect(isPullRequestState(state)).toBe(true);
    }
    expect(isPullRequestState('reopened')).toBe(false);
    expect(isPullRequestState(null)).toBe(false);
  });
});

describe('compareStages', () => {
  it('follows the FEATURE_STAGES order', () => {
    expect(compareStages('building', 'review')).toBeLessThan(0);
    expect(compareStages('review', 'building')).toBeGreaterThan(0);
    expect(compareStages('released', 'released')).toBe(0);
    expect(compareStages('building', 'released')).toBeLessThan(0);
    expect(compareStages('ready_to_merge', 'awaiting_release')).toBeLessThan(
      0
    );
  });
});

describe('featureDefaults', () => {
  it('returns the contract defaults with the given now', () => {
    expect(featureDefaults(NOW)).toEqual({
      kind: 'feature',
      stage: 'building',
      stage_source: 'manual',
      stage_set_at: NOW,
      pull_requests: []
    });
  });

  it('returns a fresh pull_requests array each call', () => {
    const a = featureDefaults(NOW);
    const b = featureDefaults(NOW);
    expect(a.pull_requests).not.toBe(b.pull_requests);
    a.pull_requests.push({ url: PR_URL, state: 'open', updated_at: NOW });
    expect(b.pull_requests).toEqual([]);
  });
});

describe('canonicalizePullRequestUrl', () => {
  it('lowercases and strips anything after the number', () => {
    const result = canonicalizePullRequestUrl(
      'https://github.com/Ivo-Toby/Postgram/pull/12/files#discussion'
    );
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      url: 'https://github.com/ivo-toby/postgram/pull/12',
      repository: 'github.com/ivo-toby/postgram'
    });
  });

  it('keeps a plain canonical url unchanged', () => {
    const result = canonicalizePullRequestUrl(PR_URL);
    expect(result._unsafeUnwrap()).toEqual({
      url: PR_URL,
      repository: 'github.com/ivo-toby/postgram'
    });
  });

  it('rejects non-GitHub and malformed urls with VALIDATION', () => {
    const bad = [
      'https://gitlab.com/ivo-toby/postgram/-/merge_requests/12',
      'https://github.com/ivo-toby/postgram/pulls/12',
      'http://github.com/ivo-toby/postgram/pull/12',
      'git@github.com:ivo-toby/postgram.git',
      'https://github.com/ivo-toby/pull/12',
      'https://github.com/ivo-toby/postgram/pull/abc',
      ''
    ];
    for (const url of bad) {
      const result = canonicalizePullRequestUrl(url);
      expect(result.isErr(), url).toBe(true);
      const error = asAppError(result._unsafeUnwrapErr());
      expect(error.code).toBe(ErrorCode.VALIDATION);
    }
  });
});

describe('deriveStage', () => {
  const cases: Array<{
    name: string;
    current: FeatureStage;
    previousState: FeaturePullRequest['state'] | null;
    nextState: FeaturePullRequest['state'];
    releaseOnMerge: boolean;
    expected: FeatureStage;
  }> = [
    {
      name: 'new open while building goes to review',
      current: 'building',
      previousState: null,
      nextState: 'open',
      releaseOnMerge: false,
      expected: 'review'
    },
    {
      name: 'changed to open while building goes to review',
      current: 'building',
      previousState: 'closed',
      nextState: 'open',
      releaseOnMerge: false,
      expected: 'review'
    },
    ...(['review', 'functional_test', 'ready_to_merge', 'awaiting_release', 'released'] as const).map(
      (current) => ({
        name: `open while ${current} stays`,
        current,
        previousState: null,
        nextState: 'open' as const,
        releaseOnMerge: false,
        expected: current
      })
    ),
    ...(['building', 'review', 'functional_test', 'ready_to_merge'] as const).map(
      (current) => ({
        name: 'merged before awaiting_release goes to awaiting_release',
        current,
        previousState: null,
        nextState: 'merged' as const,
        releaseOnMerge: false,
        expected: 'awaiting_release' as const
      })
    ),
    ...(['building', 'review', 'functional_test', 'ready_to_merge'] as const).map(
      (current) => ({
        name: 'merged with releaseOnMerge goes to released',
        current,
        previousState: null,
        nextState: 'merged' as const,
        releaseOnMerge: true,
        expected: 'released' as const
      })
    ),
    {
      name: 'merged while awaiting_release stays',
      current: 'awaiting_release',
      previousState: null,
      nextState: 'merged',
      releaseOnMerge: false,
      expected: 'awaiting_release'
    },
    {
      name: 'merged while awaiting_release stays even with releaseOnMerge',
      current: 'awaiting_release',
      previousState: null,
      nextState: 'merged',
      releaseOnMerge: true,
      expected: 'awaiting_release'
    },
    {
      name: 'merged while released stays',
      current: 'released',
      previousState: null,
      nextState: 'merged',
      releaseOnMerge: true,
      expected: 'released'
    },
    ...FEATURE_STAGES.map((current) => ({
      name: `closed while ${current} stays`,
      current,
      previousState: null,
      nextState: 'closed' as const,
      releaseOnMerge: true,
      expected: current
    })),
    ...(['building', 'review', 'functional_test', 'ready_to_merge', 'awaiting_release', 'released'] as const).map(
      (current) => ({
        name: `same state while ${current} stays`,
        current,
        previousState: 'open' as const,
        nextState: 'open' as const,
        releaseOnMerge: true,
        expected: current
      })
    )
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(
        deriveStage({
          current: testCase.current,
          previousState: testCase.previousState,
          nextState: testCase.nextState,
          releaseOnMerge: testCase.releaseOnMerge
        })
      ).toBe(testCase.expected);
    });
  }

  it('never returns a stage before current', () => {
    const states: readonly PullRequestState[] = PULL_REQUEST_STATES;
    const previousStates: Array<PullRequestState | null> = [
      null,
      'open',
      'merged',
      'closed'
    ];
    for (const current of FEATURE_STAGES) {
      for (const previousState of previousStates) {
        for (const nextState of states) {
          for (const releaseOnMerge of [false, true]) {
            const next = deriveStage({
              current,
              previousState,
              nextState,
              releaseOnMerge
            });
            expect(compareStages(next, current)).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it('moves forward after a manual stage (functional_test then merged)', () => {
    expect(
      deriveStage({
        current: 'functional_test',
        previousState: 'open',
        nextState: 'merged',
        releaseOnMerge: false
      })
    ).toBe('awaiting_release');
  });
});

describe('upsertPullRequest', () => {
  const existing: FeaturePullRequest = {
    url: PR_URL,
    state: 'open',
    updated_at: '2026-01-01T00:00:00.000Z'
  };
  const other: FeaturePullRequest = {
    url: 'https://github.com/ivo-toby/postgram/pull/7',
    state: 'closed',
    updated_at: '2026-01-01T00:00:00.000Z'
  };

  it('replaces an existing url in place with previousState', () => {
    const list = [existing, other];
    const result = upsertPullRequest(list, { url: PR_URL, state: 'merged' }, NOW);
    expect(result.previousState).toBe('open');
    expect(result.pullRequests).toHaveLength(2);
    expect(result.pullRequests[0]).toEqual({
      url: PR_URL,
      state: 'merged',
      updated_at: NOW
    });
    expect(result.pullRequests[1]).toBe(other);
  });

  it('appends a new url with previousState null and never duplicates', () => {
    const list = [existing];
    const newPr = {
      url: 'https://github.com/ivo-toby/postgram/pull/9',
      state: 'open' as const
    };
    const result = upsertPullRequest(list, newPr, NOW);
    expect(result.previousState).toBeNull();
    expect(result.pullRequests).toHaveLength(2);
    expect(result.pullRequests[1]).toEqual({ ...newPr, updated_at: NOW });
    expect(
      result.pullRequests.filter((entry) => entry.url === newPr.url)
    ).toHaveLength(1);
  });

  it('does not mutate the input list or entries', () => {
    const list = [existing, other];
    const snapshot = list.map((entry) => ({ ...entry }));
    upsertPullRequest(list, { url: PR_URL, state: 'merged' }, NOW);
    upsertPullRequest(
      list,
      { url: 'https://github.com/ivo-toby/postgram/pull/9', state: 'open' },
      NOW
    );
    expect(list).toEqual(snapshot);
  });

  it('handles an empty list', () => {
    const result = upsertPullRequest([], { url: PR_URL, state: 'closed' }, NOW);
    expect(result.previousState).toBeNull();
    expect(result.pullRequests).toEqual([
      { url: PR_URL, state: 'closed', updated_at: NOW }
    ]);
  });
});

describe('normalizeFeatureMetadata', () => {
  it('adds defaults for a feature with no other keys', () => {
    const result = normalizeFeatureMetadata({
      next: { kind: 'feature' },
      previous: null,
      now: NOW
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      kind: 'feature',
      stage: 'building',
      stage_source: 'manual',
      stage_set_at: NOW,
      pull_requests: []
    });
  });

  it('keeps other keys of next', () => {
    const result = normalizeFeatureMetadata({
      next: { kind: 'feature', x: 1 },
      previous: null,
      now: NOW
    });
    expect(result._unsafeUnwrap().x).toBe(1);
  });

  it('returns a non-feature unchanged', () => {
    const next = { kind: 'task', stage: 'shipping', pull_requests: 'x' };
    const result = normalizeFeatureMetadata({ next, previous: null, now: NOW });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(next);
  });

  it('keeps valid present values as-is on create', () => {
    const next = {
      kind: 'feature',
      stage: 'review',
      stage_source: 'derived',
      stage_set_at: '2026-01-01T00:00:00.000Z',
      pull_requests: [
        { url: PR_URL, state: 'open', updated_at: '2026-10-31T10:00:00.000Z' }
      ]
    };
    const result = normalizeFeatureMetadata({ next, previous: null, now: NOW });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(next);
  });

  it('rejects an invalid stage with VALIDATION', () => {
    const result = normalizeFeatureMetadata({
      next: { kind: 'feature', stage: 'shipping' },
      previous: null,
      now: NOW
    });
    expect(result.isErr()).toBe(true);
    const error = asAppError(result._unsafeUnwrapErr());
    expect(error.code).toBe(ErrorCode.VALIDATION);
    expect(error.details.field).toBe('stage');
  });

  it('rejects an invalid stage_source with VALIDATION', () => {
    const result = normalizeFeatureMetadata({
      next: { kind: 'feature', stage_source: 'robot' },
      previous: null,
      now: NOW
    });
    expect(result.isErr()).toBe(true);
    const error = asAppError(result._unsafeUnwrapErr());
    expect(error.code).toBe(ErrorCode.VALIDATION);
    expect(error.details.field).toBe('stage_source');
  });

  it('rejects a non-string stage_set_at with VALIDATION', () => {
    const result = normalizeFeatureMetadata({
      next: { kind: 'feature', stage_set_at: 1730000000000 },
      previous: null,
      now: NOW
    });
    expect(result.isErr()).toBe(true);
    const error = asAppError(result._unsafeUnwrapErr());
    expect(error.code).toBe(ErrorCode.VALIDATION);
    expect(error.details.field).toBe('stage_set_at');
  });

  it('rejects pull_requests that is not an array with VALIDATION', () => {
    for (const bad of ['x', 1, {}, null]) {
      const result = normalizeFeatureMetadata({
        next: { kind: 'feature', pull_requests: bad },
        previous: null,
        now: NOW
      });
      expect(result.isErr(), JSON.stringify(bad)).toBe(true);
      const error = asAppError(result._unsafeUnwrapErr());
      expect(error.code).toBe(ErrorCode.VALIDATION);
      expect(error.details.field).toBe('pull_requests');
    }
  });

  it('rejects malformed pull_request entries with VALIDATION', () => {
    const badEntries: unknown[] = [
      'not-an-object',
      { url: 1, state: 'open', updated_at: NOW },
      { url: PR_URL, state: 'reopened', updated_at: NOW },
      { url: PR_URL, state: 'open', updated_at: 42 },
      { state: 'open', updated_at: NOW }
    ];
    for (const entry of badEntries) {
      const result = normalizeFeatureMetadata({
        next: { kind: 'feature', pull_requests: [entry] },
        previous: null,
        now: NOW
      });
      expect(result.isErr(), JSON.stringify(entry)).toBe(true);
      const error = asAppError(result._unsafeUnwrapErr());
      expect(error.code).toBe(ErrorCode.VALIDATION);
      expect(error.details.field).toBe('pull_requests');
    }
  });

  it('rejects a non-canonical pull request url without coercing it', () => {
    const result = normalizeFeatureMetadata({
      next: {
        kind: 'feature',
        pull_requests: [
          {
            url: 'https://github.com/Ivo-Toby/postgram/pull/12/files',
            state: 'open',
            updated_at: '2026-10-31T10:00:00.000Z'
          }
        ]
      },
      previous: null,
      now: NOW
    });
    expect(result.isErr()).toBe(true);
    const error = asAppError(result._unsafeUnwrapErr());
    expect(error.code).toBe(ErrorCode.VALIDATION);
    expect(error.details.field).toBe('pull_requests');
  });

  it('marks a stage change against previous as manual with now', () => {
    const result = normalizeFeatureMetadata({
      next: { kind: 'feature', stage: 'building' },
      previous: {
        kind: 'feature',
        stage: 'review',
        stage_source: 'derived',
        stage_set_at: '2026-01-01T00:00:00.000Z',
        pull_requests: []
      },
      now: NOW
    });
    expect(result.isOk()).toBe(true);
    const metadata = result._unsafeUnwrap();
    expect(metadata.stage).toBe('building');
    expect(metadata.stage_source).toBe('manual');
    expect(metadata.stage_set_at).toBe(NOW);
  });

  it('keeps stage_source and stage_set_at when the stage did not change', () => {
    const result = normalizeFeatureMetadata({
      next: {
        kind: 'feature',
        stage: 'review',
        stage_source: 'derived',
        stage_set_at: '2026-01-01T00:00:00.000Z'
      },
      previous: {
        kind: 'feature',
        stage: 'review',
        stage_source: 'derived',
        stage_set_at: '2026-01-01T00:00:00.000Z',
        pull_requests: []
      },
      now: NOW
    });
    const metadata = result._unsafeUnwrap();
    expect(metadata.stage_source).toBe('derived');
    expect(metadata.stage_set_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('never derives a stage from pull requests', () => {
    const result = normalizeFeatureMetadata({
      next: {
        kind: 'feature',
        stage: 'building',
        pull_requests: [{ url: PR_URL, state: 'merged', updated_at: NOW }]
      },
      previous: {
        kind: 'feature',
        stage: 'building',
        stage_source: 'manual',
        stage_set_at: '2026-01-01T00:00:00.000Z',
        pull_requests: []
      },
      now: NOW
    });
    const metadata = result._unsafeUnwrap();
    expect(metadata.stage).toBe('building');
  });

  it('does not treat a previous non-feature as a stage change', () => {
    const result = normalizeFeatureMetadata({
      next: { kind: 'feature', stage: 'review' },
      previous: { kind: 'task', stage: 'building' },
      now: NOW
    });
    const metadata = result._unsafeUnwrap();
    expect(metadata.stage_source).toBe('manual');
    expect(metadata.stage_set_at).toBe(NOW);
  });

  it('does not mutate the input metadata objects', () => {
    const next = { kind: 'feature' };
    const previous = { kind: 'feature', stage: 'review' };
    normalizeFeatureMetadata({ next, previous, now: NOW });
    expect(next).toEqual({ kind: 'feature' });
    expect(previous).toEqual({ kind: 'feature', stage: 'review' });
  });
});

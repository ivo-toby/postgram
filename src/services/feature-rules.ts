import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import {
  FEATURE_STAGES,
  PULL_REQUEST_STATES
} from '../types/features.js';
import type {
  FeaturePullRequest,
  FeatureMetadata,
  FeatureStage,
  PullRequestState
} from '../types/features.js';
import { AppError, ErrorCode } from '../util/errors.js';

const PR_URL_REGEX = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

const validationError = (field: string, message: string): AppError =>
  new AppError(ErrorCode.VALIDATION, message, { field });

export function isFeatureStage(value: unknown): value is FeatureStage {
  return (
    typeof value === 'string' &&
    (FEATURE_STAGES as readonly string[]).includes(value)
  );
}

export function isPullRequestState(
  value: unknown
): value is PullRequestState {
  return (
    typeof value === 'string' &&
    (PULL_REQUEST_STATES as readonly string[]).includes(value)
  );
}

export function compareStages(a: FeatureStage, b: FeatureStage): number {
  return FEATURE_STAGES.indexOf(a) - FEATURE_STAGES.indexOf(b);
}

export function featureDefaults(now: string): FeatureMetadata {
  return {
    kind: 'feature',
    stage: 'building',
    stage_source: 'manual',
    stage_set_at: now,
    pull_requests: []
  };
}

export function canonicalizePullRequestUrl(
  raw: string
): Result<{ url: string; repository: string }, AppError> {
  const match = PR_URL_REGEX.exec(raw);
  const owner = match?.[1];
  const repo = match?.[2];
  const number = match?.[3];
  if (owner === undefined || repo === undefined || number === undefined) {
    return err(
      new AppError(
        ErrorCode.VALIDATION,
        `pull request URL must match https://github.com/<owner>/<repo>/pull/<n>: ${raw}`,
        { field: 'pull_requests' }
      )
    );
  }
  const lowerOwner = owner.toLowerCase();
  const lowerRepo = repo.toLowerCase();
  return ok({
    url: `https://github.com/${lowerOwner}/${lowerRepo}/pull/${number}`,
    repository: `github.com/${lowerOwner}/${lowerRepo}`
  });
}

export function deriveStage(input: {
  current: FeatureStage;
  previousState: PullRequestState | null;
  nextState: PullRequestState;
  releaseOnMerge: boolean;
}): FeatureStage {
  const { current, previousState, nextState, releaseOnMerge } = input;
  if (previousState === nextState) return current;

  if (nextState === 'open') {
    if (current === 'building') return 'review';
    return current;
  }

  if (nextState === 'merged') {
    if (compareStages(current, 'awaiting_release') < 0) {
      const target: FeatureStage = releaseOnMerge
        ? 'released'
        : 'awaiting_release';
      return compareStages(current, target) < 0 ? target : current;
    }
    return current;
  }

  return current;
}

export function upsertPullRequest(
  list: readonly FeaturePullRequest[],
  pr: { url: string; state: PullRequestState },
  now: string
): {
  pullRequests: FeaturePullRequest[];
  previousState: PullRequestState | null;
} {
  const existing = list.find((entry) => entry.url === pr.url);
  if (existing !== undefined) {
    const pullRequests = list.map((entry) =>
      entry.url === pr.url
        ? { url: pr.url, state: pr.state, updated_at: now }
        : entry
    );
    return { pullRequests, previousState: existing.state };
  }
  return {
    pullRequests: [...list, { url: pr.url, state: pr.state, updated_at: now }],
    previousState: null
  };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function normalizeFeatureMetadata(input: {
  next: Record<string, unknown>;
  previous: Record<string, unknown> | null;
  now: string;
}): Result<Record<string, unknown>, AppError> {
  const { next, previous, now } = input;

  if (next.kind !== 'feature') return ok(next);

  const result: Record<string, unknown> = { ...next };

  if (result.stage !== undefined) {
    if (!isFeatureStage(result.stage)) {
      return err(validationError('stage', 'invalid feature stage'));
    }
  } else {
    result.stage = 'building';
  }

  if (result.stage_source !== undefined) {
    if (result.stage_source !== 'manual' && result.stage_source !== 'derived') {
      return err(validationError('stage_source', 'invalid stage_source'));
    }
  } else {
    result.stage_source = 'manual';
  }

  if (result.stage_set_at !== undefined) {
    if (typeof result.stage_set_at !== 'string') {
      return err(
        validationError('stage_set_at', 'stage_set_at must be a string')
      );
    }
  } else {
    result.stage_set_at = now;
  }

  if (result.pull_requests !== undefined) {
    if (!Array.isArray(result.pull_requests)) {
      return err(
        validationError('pull_requests', 'pull_requests must be an array')
      );
    }
    for (const raw of result.pull_requests as readonly unknown[]) {
      if (!isPlainObject(raw)) {
        return err(
          validationError(
            'pull_requests',
            'each pull request must be an object'
          )
        );
      }
      const url = raw.url;
      const state = raw.state;
      const updatedAt = raw.updated_at;
      if (typeof url !== 'string') {
        return err(
          validationError('pull_requests', 'pull request url must be a string')
        );
      }
      const canonical = canonicalizePullRequestUrl(url);
      if (canonical.isErr() || canonical.value.url !== url) {
        return err(
          validationError(
            'pull_requests',
            `pull request url must be in canonical form: ${url}`
          )
        );
      }
      if (!isPullRequestState(state)) {
        return err(
          validationError('pull_requests', 'invalid pull request state')
        );
      }
      if (typeof updatedAt !== 'string') {
        return err(
          validationError(
            'pull_requests',
            'pull request updated_at must be a string'
          )
        );
      }
    }
  } else {
    result.pull_requests = [];
  }

  const previousStage = previous?.stage;
  if (
    previous?.kind === 'feature' &&
    isFeatureStage(previousStage) &&
    previousStage !== result.stage
  ) {
    result.stage_source = 'manual';
    result.stage_set_at = now;
  }

  return ok(result);
}

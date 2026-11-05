// cli/src/tracking/feature-sync.ts: pgm feature sync — follow GitHub PR state.
import { execFile } from 'node:child_process';

import { AppError, ErrorCode } from '../errors.js';
import { shortId } from '../shared.js';
import type { TrackingClient } from './api.js';
import { UsageError } from './config.js';
import type { WhereFeature } from './types.js';

type PullState = 'open' | 'merged' | 'closed';

const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_HEX = /^[0-9a-f]{8}$/i;

export type GhResult =
  | { ok: true; state: PullState }
  | { ok: false; kind: 'missing' | 'unauthenticated' | 'error'; message: string };

type Exec = (cmd: string, args: string[]) => Promise<{ stdout: string }>;

const GH_STATES: Record<string, PullState> = {
  OPEN: 'open',
  MERGED: 'merged',
  CLOSED: 'closed'
};

export function parseGhState(stdout: string): PullState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const state = (parsed as { state?: unknown }).state;
  return typeof state === 'string' ? (GH_STATES[state] ?? null) : null;
}

export function classifyGhFailure(error: {
  code?: string | number | undefined;
  stderr?: string | undefined;
}): Extract<GhResult, { ok: false }> {
  const stderr = error.stderr ?? '';
  if (error.code === 'ENOENT') {
    return { ok: false, kind: 'missing', message: 'gh is not installed' };
  }
  if (/gh auth login|not logged in|not logged into|authentication/i.test(stderr)) {
    return { ok: false, kind: 'unauthenticated', message: 'gh is not logged in' };
  }
  const first = stderr.split('\n').find((line) => line.trim() !== '');
  return { ok: false, kind: 'error', message: first?.trim() ?? 'gh failed' };
}

const defaultExec: Exec = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 20_000 }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(Object.assign(error, { stderr }) as Error);
      } else {
        resolve({ stdout });
      }
    });
  });

export async function runGhPrState(
  url: string,
  exec: Exec = defaultExec
): Promise<GhResult> {
  let stdout: string;
  try {
    ({ stdout } = await exec('gh', ['pr', 'view', url, '--json', 'state']));
  } catch (error) {
    const failure = error as { code?: string | number; stderr?: string };
    return classifyGhFailure({ code: failure.code, stderr: failure.stderr });
  }
  const state = parseGhState(stdout);
  return state === null
    ? { ok: false, kind: 'error', message: 'unexpected output from gh pr view' }
    : { ok: true, state };
}

export type SyncDeps = {
  client: TrackingClient;
  gh: (url: string) => Promise<GhResult>;
};

export type SyncResult = {
  checked: number;
  unchanged: number;
  changed: Array<{
    feature_id: string;
    url: string;
    from: PullState;
    to: PullState;
    stage_from: string;
    stage_to: string;
  }>;
  errors: Array<{ feature_id: string; url: string; error: string }>;
};

function collectFeatures(
  response: Awaited<ReturnType<TrackingClient['where']>>
): WhereFeature[] {
  const features: WhereFeature[] = [];
  for (const group of response.groups) {
    if ('features' in group) {
      features.push(...group.features);
    }
  }
  return features;
}

/**
 * Asks gh for the state of every PR that is not merged yet and sends changes
 * through the feature PR endpoint, so the server's derived-stage rules apply.
 * A merged PR is final and is not asked again.
 */
export async function runFeatureSync(
  id: string | undefined,
  deps: SyncDeps
): Promise<SyncResult> {
  const response = await deps.client.where(
    id === undefined
      ? { view: 'stage' }
      : { view: 'stage', includeReleased: true, includeDone: true }
  );
  let features = collectFeatures(response);
  if (id !== undefined) {
    const wanted = id.toLowerCase();
    if (!FULL_UUID.test(wanted) && !SHORT_HEX.test(wanted)) {
      throw new UsageError('feature id must be a full UUID or an 8-hex short id');
    }
    features = features.filter((feature) =>
      FULL_UUID.test(wanted) ? feature.id === wanted : feature.id.startsWith(wanted)
    );
    if (features.length === 0) {
      throw new AppError(ErrorCode.NOT_FOUND, `no feature matches ${id}`);
    }
    if (features.length > 1) {
      throw new AppError(ErrorCode.CONFLICT, `feature id ${id} is ambiguous`);
    }
  }

  const result: SyncResult = { checked: 0, unchanged: 0, changed: [], errors: [] };
  const answers = new Map<string, GhResult>();

  for (const feature of features) {
    for (const pull of feature.pull_requests) {
      if (pull.state === 'merged') {
        continue;
      }
      let answer = answers.get(pull.url);
      if (answer === undefined) {
        answer = await deps.gh(pull.url);
        answers.set(pull.url, answer);
      }
      if (!answer.ok && answer.kind === 'missing') {
        throw new UsageError(
          'gh (GitHub CLI) was not found on PATH. Install it from https://cli.github.com to use `pgm feature sync`.'
        );
      }
      if (!answer.ok && answer.kind === 'unauthenticated') {
        throw new UsageError(
          'gh is not logged in. Run `gh auth login`, then retry `pgm feature sync`.'
        );
      }
      result.checked += 1;
      if (!answer.ok) {
        result.errors.push({
          feature_id: feature.id,
          url: pull.url,
          error: answer.message
        });
        continue;
      }
      if (answer.state === pull.state) {
        result.unchanged += 1;
        continue;
      }
      try {
        const updated = await deps.client.addPullRequest(feature.id, {
          url: pull.url,
          state: answer.state
        });
        result.changed.push({
          feature_id: feature.id,
          url: pull.url,
          from: pull.state,
          to: answer.state,
          stage_from: updated.from,
          stage_to: updated.to
        });
      } catch (error) {
        result.errors.push({
          feature_id: feature.id,
          url: pull.url,
          error: error instanceof Error ? error.message : 'update failed'
        });
      }
    }
  }

  return result;
}

export function formatSync(result: SyncResult): string[] {
  const lines = result.changed.map(
    (change) =>
      `${shortId(change.feature_id)} ${change.url} ${change.from} → ${change.to}${
        change.stage_from !== change.stage_to
          ? `, stage ${change.stage_from} → ${change.stage_to}`
          : ''
      }`
  );
  for (const error of result.errors) {
    lines.push(`error ${shortId(error.feature_id)} ${error.url}: ${error.error}`);
  }
  lines.push(
    `checked ${result.checked} pull ${result.checked === 1 ? 'request' : 'requests'}: ${result.changed.length} changed, ${result.unchanged} unchanged, ${result.errors.length} failed`
  );
  return lines;
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthContext } from '../../src/auth/types.js';
import {
  addFeaturePullRequest,
  createFeature,
  setFeatureStage,
  setRepositoryReleaseOnMerge
} from '../../src/services/feature-service.js';
import { createTask } from '../../src/services/task-service.js';
import type { FeaturePullRequest, FeatureStage } from '../../src/types/features.js';
import { ErrorCode } from '../../src/util/errors.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

const KEY_ID = '00000000-0000-0000-0000-000000000502';
const PR_URL = 'https://github.com/ivo-toby/postgram/pull/12';

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    apiKeyId: KEY_ID,
    keyName: 'feature-pr-key',
    clientId: 'feature-pr-key',
    scopes: ['read', 'write'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared'],
    ...overrides
  };
}

type AuditRow = {
  operation: string;
  entity_id: string | null;
  details: Record<string, unknown>;
};

type EntitySnapshot = {
  version: number;
  status: string | null;
  metadata: Record<string, unknown>;
};

function errorCode(
  result: { isErr(): boolean; _unsafeUnwrapErr(): unknown }
): unknown {
  expect(result.isErr()).toBe(true);
  const error = result._unsafeUnwrapErr() as { code?: unknown };
  return error.code;
}

function pullRequestsOf(metadata: Record<string, unknown>): FeaturePullRequest[] {
  const raw = metadata.pull_requests;
  if (!Array.isArray(raw)) {
    throw new Error(`pull_requests must be an array, got ${typeof raw}`);
  }
  return raw as FeaturePullRequest[];
}

describe('addFeaturePullRequest', () => {
  let database: TestDatabase | undefined;

  function db(): TestDatabase {
    if (!database) {
      throw new Error('test database not initialized');
    }
    return database;
  }

  async function entityRow(id: string): Promise<EntitySnapshot | undefined> {
    const result = await db().pool.query<EntitySnapshot>(
      'SELECT version, status, metadata FROM entities WHERE id = $1',
      [id]
    );
    return result.rows[0];
  }

  async function auditRows(operation: string): Promise<AuditRow[]> {
    const result = await db().pool.query<AuditRow>(
      `SELECT operation, entity_id, details FROM audit_log
       WHERE operation = $1 ORDER BY timestamp, id`,
      [operation]
    );
    return result.rows;
  }

  async function auditCount(operation: string): Promise<number> {
    const result = await db().pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM audit_log WHERE operation = $1',
      [operation]
    );
    return Number(result.rows[0]?.n ?? '0');
  }

  async function newFeature(content: string) {
    return (
      await createFeature(db().pool, auth(), { content })
    )._unsafeUnwrap();
  }

  async function addPr(
    id: string,
    url: string,
    state?: 'open' | 'merged' | 'closed'
  ) {
    return (
      await addFeaturePullRequest(db().pool, auth(), {
        id,
        url,
        ...(state === undefined ? {} : { state })
      })
    )._unsafeUnwrap();
  }

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    await resetTestDatabase(db().pool);
    await seedApiKey(db().pool, { id: KEY_ID, name: 'feature-pr-key' });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('canonicalizes the url and derives review from building (pr-canonical, stage-derive)', async () => {
    const feature = await newFeature('Feature A');
    const stageSetAt = feature.metadata.stage_set_at;

    const opened = await addPr(
      feature.id,
      'https://github.com/Ivo-Toby/Postgram/pull/12/files#diff-header'
    );

    expect(opened).toMatchObject({
      stage_changed: true,
      from: 'building',
      to: 'review'
    });
    expect(opened.entity.metadata).toMatchObject({
      kind: 'feature',
      stage: 'review',
      stage_source: 'derived'
    });
    expect(opened.entity.metadata.stage_set_at).not.toBe(stageSetAt);
    expect(opened.entity.metadata.pull_requests).toEqual([
      { url: PR_URL, state: 'open', updated_at: expect.any(String) as string }
    ]);
    expect(opened.entity.status).toBe('inbox');

    const stored = await entityRow(feature.id);
    expect(pullRequestsOf(stored?.metadata ?? {})).toEqual([
      { url: PR_URL, state: 'open', updated_at: expect.any(String) as string }
    ]);

    expect((await auditRows('feature_pr')).map((row) => [row.entity_id, row.details])).toEqual([
      [feature.id, { url: PR_URL, state: 'open' }]
    ]);
    expect(
      (await auditRows('feature_stage')).map((row) => [row.entity_id, row.details])
    ).toEqual([[feature.id, { from: 'building', to: 'review', source: 'derived' }]]);
  }, 120_000);

  it('walks the worked example and audits every derived move (feature-audit)', async () => {
    const feature = await newFeature('Feature A');

    const opened = await addPr(feature.id, PR_URL);
    expect(opened).toMatchObject({ stage_changed: true, from: 'building', to: 'review' });

    (await setFeatureStage(db().pool, auth(), { id: feature.id, stage: 'building' }))._unsafeUnwrap();

    const reReported = await addPr(feature.id, PR_URL, 'open');
    expect(reReported).toMatchObject({
      stage_changed: false,
      from: 'building',
      to: 'building'
    });
    expect(reReported.entity.metadata).toMatchObject({ stage: 'building', stage_source: 'manual' });
    expect(reReported.entity.metadata.pull_requests).toHaveLength(1);

    const merged = await addPr(feature.id, PR_URL, 'merged');
    expect(merged).toMatchObject({ stage_changed: true, from: 'building', to: 'awaiting_release' });
    expect(merged.entity.metadata.pull_requests).toEqual([
      { url: PR_URL, state: 'merged', updated_at: expect.any(String) as string }
    ]);

    expect((await auditRows('feature_pr')).map((row) => row.details)).toEqual([
      { url: PR_URL, state: 'open' },
      { url: PR_URL, state: 'merged' }
    ]);
    expect((await auditRows('feature_stage')).map((row) => row.details)).toEqual([
      { from: 'building', to: 'review', source: 'derived' },
      { from: 'review', to: 'building', source: 'manual' },
      { from: 'building', to: 'awaiting_release', source: 'derived' }
    ]);
  }, 120_000);

  it('keeps the stage on a same-state re-report, refreshes updated_at and writes no audit (pr-upsert)', async () => {
    const past = '2020-01-01T00:00:00.000Z';
    const runStart = new Date().toISOString();
    const feature = (
      await createTask(db().pool, auth(), {
        content: 'Feature A',
        metadata: {
          kind: 'feature',
          stage: 'building',
          stage_source: 'manual',
          stage_set_at: past,
          pull_requests: [{ url: PR_URL, state: 'open', updated_at: past }]
        }
      })
    )._unsafeUnwrap();

    const prAuditBefore = await auditCount('feature_pr');
    const stageAuditBefore = await auditCount('feature_stage');
    const before = await entityRow(feature.id);
    expect(pullRequestsOf(before?.metadata ?? {})[0]?.updated_at).toBe(past);

    const reReported = await addPr(
      feature.id,
      'https://github.com/Ivo-Toby/Postgram/pull/12/files#note',
      'open'
    );

    expect(reReported).toMatchObject({
      stage_changed: false,
      from: 'building',
      to: 'building'
    });
    expect(reReported.entity.metadata).toMatchObject({
      kind: 'feature',
      stage: 'building',
      stage_source: 'manual'
    });

    const entries = pullRequestsOf(reReported.entity.metadata);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.url).toBe(PR_URL);
    expect(entries[0]?.state).toBe('open');
    expect(entries[0]?.updated_at).not.toBe(past);
    expect((entries[0]?.updated_at ?? '') >= runStart).toBe(true);

    const after = await entityRow(feature.id);
    expect(after?.version).toBe((before?.version ?? 0) + 1);
    expect(after?.status).toBe(before?.status);
    expect(after?.metadata.stage_set_at).toBe(past);
    expect(await auditCount('feature_pr')).toBe(prAuditBefore);
    expect(await auditCount('feature_stage')).toBe(stageAuditBefore);
  }, 120_000);

  it('derives awaiting_release from building, review and ready_to_merge (stage-derive)', async () => {
    const stages: FeatureStage[] = ['building', 'review', 'ready_to_merge'];
    let number = 100;

    for (const stage of stages) {
      number += 1;
      const feature = await newFeature(`Feature at ${stage}`);
      (await setFeatureStage(db().pool, auth(), { id: feature.id, stage }))._unsafeUnwrap();

      const url = `https://github.com/ivo-toby/postgram/pull/${number}`;
      const merged = await addPr(feature.id, url, 'merged');
      expect(merged).toMatchObject({ stage_changed: true, from: stage, to: 'awaiting_release' });
      expect(merged.entity.metadata).toMatchObject({
        stage: 'awaiting_release',
        stage_source: 'derived'
      });
      expect(pullRequestsOf(merged.entity.metadata)[0]?.url).toBe(url);
    }
  }, 120_000);

  it('keeps the stage for every other transition and never moves backwards (stage-derive)', async () => {
    const openOnReady = await newFeature('Open on ready_to_merge');
    (
      await setFeatureStage(db().pool, auth(), {
        id: openOnReady.id,
        stage: 'ready_to_merge'
      })
    )._unsafeUnwrap();
    const unchangedOpen = await addPr(
      openOnReady.id,
      'https://github.com/ivo-toby/postgram/pull/201'
    );
    expect(unchangedOpen).toMatchObject({
      stage_changed: false,
      from: 'ready_to_merge',
      to: 'ready_to_merge'
    });
    expect(unchangedOpen.entity.metadata.stage_source).not.toBe('derived');

    const closedFeature = await newFeature('Closed pull request');
    const closed = await addPr(
      closedFeature.id,
      'https://github.com/ivo-toby/postgram/pull/202',
      'closed'
    );
    expect(closed).toMatchObject({ stage_changed: false, from: 'building', to: 'building' });
    expect(closed.entity.metadata).toMatchObject({ stage: 'building' });
    expect(pullRequestsOf(closed.entity.metadata)).toHaveLength(1);

    const secondPr = await addPr(
      closedFeature.id,
      'https://github.com/ivo-toby/postgram/pull/203'
    );
    expect(secondPr).toMatchObject({ stage_changed: true, from: 'building', to: 'review' });
    expect(pullRequestsOf(secondPr.entity.metadata)).toHaveLength(2);

    const awaiting = await newFeature('Awaiting release');
    (
      await setFeatureStage(db().pool, auth(), {
        id: awaiting.id,
        stage: 'awaiting_release'
      })
    )._unsafeUnwrap();
    const mergedWhileAwaiting = await addPr(
      awaiting.id,
      'https://github.com/ivo-toby/postgram/pull/204',
      'merged'
    );
    expect(mergedWhileAwaiting).toMatchObject({
      stage_changed: false,
      from: 'awaiting_release',
      to: 'awaiting_release'
    });

    const released = await newFeature('Already released');
    (
      await setFeatureStage(db().pool, auth(), { id: released.id, stage: 'released' })
    )._unsafeUnwrap();
    const mergedWhileReleased = await addPr(
      released.id,
      'https://github.com/ivo-toby/postgram/pull/205',
      'merged'
    );
    expect(mergedWhileReleased).toMatchObject({
      stage_changed: false,
      from: 'released',
      to: 'released'
    });

    const backward = await newFeature('Backwards guard');
    (
      await setFeatureStage(db().pool, auth(), {
        id: backward.id,
        stage: 'functional_test'
      })
    )._unsafeUnwrap();
    const mergedAfterManual = await addPr(
      backward.id,
      'https://github.com/ivo-toby/postgram/pull/206',
      'merged'
    );
    expect(mergedAfterManual).toMatchObject({
      stage_changed: true,
      from: 'functional_test',
      to: 'awaiting_release'
    });
    const reopened = await addPr(
      backward.id,
      'https://github.com/ivo-toby/postgram/pull/206',
      'open'
    );
    expect(reopened).toMatchObject({
      stage_changed: false,
      from: 'awaiting_release',
      to: 'awaiting_release'
    });
  }, 120_000);

  it('releases on merge when the repository has release_on_merge and keeps the status (released-status)', async () => {
    const setting = (
      await setRepositoryReleaseOnMerge(db().pool, auth(), {
        remote: 'git@github.com:Ivo-Toby/postgram.git',
        releaseOnMerge: true
      })
    )._unsafeUnwrap();
    expect(setting).toEqual({
      remote: 'github.com/ivo-toby/postgram',
      release_on_merge: true
    });
    expect(
      (await auditRows('repository_update')).map((row) => [row.entity_id, row.details])
    ).toEqual([[null, { remote: 'github.com/ivo-toby/postgram', release_on_merge: true }]]);

    const feature = await newFeature('Feature C');
    (await setFeatureStage(db().pool, auth(), { id: feature.id, stage: 'review' }))._unsafeUnwrap();

    const merged = await addPr(feature.id, PR_URL, 'merged');
    expect(merged).toMatchObject({ stage_changed: true, from: 'review', to: 'released' });
    expect(merged.entity.metadata).toMatchObject({
      stage: 'released',
      stage_source: 'derived'
    });
    expect(merged.entity.status).toBe('inbox');
    expect((await entityRow(feature.id))?.status).toBe('inbox');

    const other = await newFeature('Feature D');
    const otherMerged = await addPr(
      other.id,
      'https://github.com/ivo-toby/other-repo/pull/1',
      'merged'
    );
    expect(otherMerged).toMatchObject({ stage_changed: true, from: 'building', to: 'awaiting_release' });
  }, 120_000);

  it('rejects a non-github url, a bad state and a read-only key without writing (pr-canonical, feature-audit)', async () => {
    const feature = await newFeature('Feature E');
    const before = await entityRow(feature.id);

    const gitlab = await addFeaturePullRequest(db().pool, auth(), {
      id: feature.id,
      url: 'https://gitlab.com/ivo-toby/postgram/-/merge_requests/1'
    });
    expect(errorCode(gitlab)).toBe(ErrorCode.VALIDATION);

    const badState = await addFeaturePullRequest(db().pool, auth(), {
      id: feature.id,
      url: PR_URL,
      state: 'reopened'
    });
    expect(errorCode(badState)).toBe(ErrorCode.VALIDATION);

    const readOnly = await addFeaturePullRequest(db().pool, auth({ scopes: ['read'] }), {
      id: feature.id,
      url: PR_URL,
      state: 'merged'
    });
    expect(errorCode(readOnly)).toBe(ErrorCode.FORBIDDEN);

    expect(await entityRow(feature.id)).toEqual(before);
    expect(await auditCount('feature_pr')).toBe(0);
    expect(await auditCount('feature_stage')).toBe(0);
  }, 120_000);
});

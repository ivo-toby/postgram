import { describe, expect, it } from 'vitest';

import {
  buildWhereGroups,
  featureTitle,
  isWhereView,
  toWhereFeature
} from '../../src/services/where-rules.js';
import type {
  WhereFeatureSummary,
  WhereGroup
} from '../../src/services/where-rules.js';
import type { EntityStatus } from '../../src/types/entities.js';
import type { FeatureStage } from '../../src/types/features.js';
import type { WorkspaceView } from '../../src/types/workspaces.js';

const NOW = '2026-10-31T12:00:00.000Z';

const workspace = (
  id: string,
  featureId: string | null,
  lastActivityAt: string
): WorkspaceView => ({
  id,
  machine: 'local',
  connect_target: 'local',
  path: `/home/u/${id}`,
  repo_remote: null,
  branch: null,
  feature_id: featureId,
  last_activity_at: lastActivityAt,
  git: null,
  git_state_at: null,
  missing_since: null,
  risks: [],
  resume_session: null,
  sessions: []
});

const feature = (
  id: string,
  stage: FeatureStage = 'building',
  options: { stageSetAt?: string | null; taskStatus?: EntityStatus | null } = {}
): WhereFeatureSummary => ({
  id,
  title: id,
  stage,
  stage_source: null,
  stage_set_at: options.stageSetAt ?? null,
  task_status: options.taskStatus ?? null,
  pull_requests: []
});

const featureIds = (group: WhereGroup | undefined): string[] | null =>
  group !== undefined && 'features' in group
    ? group.features.map((f) => f.id)
    : null;

const unassignedIds = (group: WhereGroup | undefined): string[] | null =>
  group !== undefined && 'workspaces' in group
    ? group.workspaces.map((w) => w.id)
    : null;

const byKey = (groups: WhereGroup[]): Map<string, WhereGroup> =>
  new Map(groups.map((group) => [group.key, group]));

describe('isWhereView', () => {
  it('accepts stage and actions only', () => {
    expect(isWhereView('stage')).toBe(true);
    expect(isWhereView('actions')).toBe(true);
    expect(isWhereView('kanban')).toBe(false);
    expect(isWhereView('')).toBe(false);
    expect(isWhereView(undefined)).toBe(false);
    expect(isWhereView(3)).toBe(false);
  });
});

describe('featureTitle', () => {
  it('returns the first line trimmed', () => {
    expect(featureTitle('  Keyword rank fusion\nbody')).toBe(
      'Keyword rank fusion'
    );
  });

  it('returns empty string for null content', () => {
    expect(featureTitle(null)).toBe('');
  });

  it('cuts at 80 characters without an ellipsis', () => {
    expect(featureTitle('a'.repeat(80))).toBe('a'.repeat(80));
    const cut = featureTitle('a'.repeat(81) + '\nsecond');
    expect(cut).toBe('a'.repeat(80));
    expect(cut.endsWith('…')).toBe(false);
  });
});

describe('toWhereFeature', () => {
  it('treats a plain task (null metadata) as building with null stage info', () => {
    expect(
      toWhereFeature({ id: 't1', content: '  Plain linked task\nbody', status: 'inbox', metadata: null })
    ).toEqual({
      id: 't1',
      title: 'Plain linked task',
      stage: 'building',
      stage_source: null,
      stage_set_at: null,
      task_status: 'inbox',
      pull_requests: []
    });
  });

  it('treats an invalid stored stage as building', () => {
    expect(
      toWhereFeature({
        id: 't2',
        content: null,
        status: 'active',
        metadata: { kind: 'feature', stage: 'shipping' }
      })
    ).toEqual({
      id: 't2',
      title: '',
      stage: 'building',
      stage_source: null,
      stage_set_at: null,
      task_status: 'active',
      pull_requests: []
    });
  });

  it('copies valid metadata and keeps only valid pull request entries', () => {
    const valid = {
      url: 'https://github.com/ivo-toby/postgram/pull/12',
      state: 'open',
      updated_at: NOW,
      extra: 'dropped'
    };
    const junk = [
      'not-an-object',
      { url: 1, state: 'open', updated_at: NOW },
      { url: 'https://github.com/ivo-toby/postgram/pull/13', state: 'reopened', updated_at: NOW },
      { url: 'https://github.com/ivo-toby/postgram/pull/14', state: 'open', updated_at: 42 }
    ];
    const result = toWhereFeature({
      id: 'f1',
      content: 'Feature\nbody',
      status: 'active',
      metadata: {
        kind: 'feature',
        stage: 'review',
        stage_source: 'derived',
        stage_set_at: NOW,
        pull_requests: [valid, ...junk]
      }
    });
    expect(result).toEqual({
      id: 'f1',
      title: 'Feature',
      stage: 'review',
      stage_source: 'derived',
      stage_set_at: NOW,
      task_status: 'active',
      pull_requests: [{ url: valid.url, state: 'open', updated_at: NOW }]
    });
  });

  it('nulls out an invalid stage_source or non-string stage_set_at', () => {
    const result = toWhereFeature({
      id: 'f2',
      content: null,
      status: null,
      metadata: {
        stage: 'review',
        stage_source: 'robot',
        stage_set_at: 1730000000000,
        pull_requests: 'nope'
      }
    });
    expect(result.stage).toBe('review');
    expect(result.stage_source).toBeNull();
    expect(result.stage_set_at).toBeNull();
    expect(result.pull_requests).toEqual([]);
  });
});

describe('buildWhereGroups', () => {
  it('returns every stage group in contract order without released', () => {
    const building = feature('b1', 'building');
    const review = feature('r1', 'review');
    const groups = buildWhereGroups({
      view: 'stage',
      features: [building, review],
      workspaces: [
        workspace('wb', 'b1', '2026-10-02T10:00:00.000Z'),
        workspace('wr', 'r1', '2026-10-03T10:00:00.000Z'),
        workspace('free', null, '2026-10-01T10:00:00.000Z')
      ],
      includeReleased: false,
      includeDone: false,
      filtered: false
    });
    expect(groups.map((g) => g.key)).toEqual([
      'building',
      'review',
      'functional_test',
      'ready_to_merge',
      'awaiting_release',
      'unassigned'
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      'Building',
      'Review',
      'Functional test',
      'Ready to merge',
      'Awaiting release',
      'Unassigned'
    ]);

    const groupsByKey = byKey(groups);
    const buildingGroup = groupsByKey.get('building');
    expect(featureIds(buildingGroup)).toEqual(['b1']);
    expect(
      buildingGroup !== undefined && 'features' in buildingGroup
        ? buildingGroup.features[0]?.workspaces.map((w) => w.id)
        : null
    ).toEqual(['wb']);
    expect(featureIds(groupsByKey.get('review'))).toEqual(['r1']);
    expect(unassignedIds(groupsByKey.get('unassigned'))).toEqual(['free']);
  });

  it('adds the released group between awaiting_release and unassigned with includeReleased', () => {
    const released = feature('rel1', 'released');
    const groups = buildWhereGroups({
      view: 'stage',
      features: [released],
      workspaces: [workspace('wr', 'rel1', NOW)],
      includeReleased: true,
      includeDone: false,
      filtered: false
    });
    expect(groups.map((g) => g.key)).toEqual([
      'building',
      'review',
      'functional_test',
      'ready_to_merge',
      'awaiting_release',
      'released',
      'unassigned'
    ]);
    expect(featureIds(byKey(groups).get('released'))).toEqual(['rel1']);
  });

  it('never has a released group or released features in the actions view', () => {
    const released = feature('rel1', 'released');
    const building = feature('b1', 'building');
    const groups = buildWhereGroups({
      view: 'actions',
      features: [released, building],
      workspaces: [
        workspace('wr', 'rel1', NOW),
        workspace('wb', 'b1', NOW)
      ],
      includeReleased: true,
      includeDone: false,
      filtered: false
    });
    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ['review', 'Review'],
      ['test', 'Test'],
      ['merge', 'Merge'],
      ['release', 'Release'],
      ['in_progress', 'In progress'],
      ['unassigned', 'Unassigned']
    ]);
    const groupsByKey = byKey(groups);
    expect(featureIds(groupsByKey.get('in_progress'))).toEqual(['b1']);
    const shown = groups.flatMap((g) =>
      'features' in g ? g.features.map((f) => f.id) : []
    );
    expect(shown).not.toContain('rel1');
    expect(unassignedIds(groupsByKey.get('unassigned'))).toEqual([]);
  });

  it('hides done and archived features with their workspaces unless includeDone', () => {
    const done = feature('d1', 'building', { taskStatus: 'done' });
    const archived = feature('a1', 'review', { taskStatus: 'archived' });
    const active = feature('x1', 'building');
    const workspaces = [
      workspace('wd', 'd1', NOW),
      workspace('wa', 'a1', NOW),
      workspace('wx', 'x1', NOW)
    ];

    const hidden = buildWhereGroups({
      view: 'stage',
      features: [done, archived, active],
      workspaces,
      includeReleased: false,
      includeDone: false,
      filtered: false
    });
    const shownIds = hidden.flatMap((g) =>
      'features' in g ? g.features.map((f) => f.id) : []
    );
    expect(shownIds).toEqual(['x1']);
    const allWorkspaceIds = hidden.flatMap((g) =>
      'features' in g
        ? g.features.flatMap((f) => f.workspaces.map((w) => w.id))
        : g.workspaces.map((w) => w.id)
    );
    expect(allWorkspaceIds).toEqual(['wx']);

    const withDone = buildWhereGroups({
      view: 'stage',
      features: [done, archived, active],
      workspaces,
      includeReleased: false,
      includeDone: true,
      filtered: false
    });
    const withDoneIds = withDone.flatMap((g) =>
      'features' in g ? g.features.map((f) => f.id) : []
    );
    expect(withDoneIds).toContain('d1');
    expect(withDoneIds).toContain('a1');
  });

  it('hides released features unless stage view with includeReleased', () => {
    const released = feature('rel1', 'released');
    const base = {
      view: 'stage' as const,
      features: [released],
      workspaces: [workspace('wr', 'rel1', NOW)],
      includeDone: false,
      filtered: false
    };
    expect(
      buildWhereGroups({ ...base, includeReleased: false }).flatMap((g) =>
        'features' in g ? g.features.map((f) => f.id) : []
      )
    ).toEqual([]);
    expect(
      buildWhereGroups({ ...base, includeReleased: true }).flatMap((g) =>
        'features' in g ? g.features.map((f) => f.id) : []
      )
    ).toEqual(['rel1']);
  });

  it('drops features without workspaces when filtered and lists them with [] otherwise', () => {
    const withWs = feature('w1', 'building');
    const withoutWs = feature('n1', 'review');
    const workspaces = [workspace('ws1', 'w1', NOW)];

    const filtered = buildWhereGroups({
      view: 'stage',
      features: [withWs, withoutWs],
      workspaces,
      includeReleased: false,
      includeDone: false,
      filtered: true
    });
    const filteredIds = filtered.flatMap((g) =>
      'features' in g ? g.features.map((f) => f.id) : []
    );
    expect(filteredIds).toEqual(['w1']);

    const unfiltered = buildWhereGroups({
      view: 'stage',
      features: [withWs, withoutWs],
      workspaces,
      includeReleased: false,
      includeDone: false,
      filtered: false
    });
    const reviewGroup = byKey(unfiltered).get('review');
    expect(featureIds(reviewGroup)).toEqual(['n1']);
    expect(
      reviewGroup !== undefined && 'features' in reviewGroup
        ? reviewGroup.features[0]?.workspaces
        : null
    ).toEqual([]);
  });

  it('orders features by newest workspace desc, no workspaces last, stage_set_at desc, id asc', () => {
    const a = feature('fa', 'building', {
      stageSetAt: '2026-09-01T00:00:00.000Z'
    });
    const b = feature('fb', 'building', {
      stageSetAt: '2026-09-02T00:00:00.000Z'
    });
    const c = feature('fc', 'building', {
      stageSetAt: '2026-09-01T00:00:00.000Z'
    });
    const e = feature('fe', 'building');
    const d = feature('fd', 'building');
    const workspaces = [
      workspace('wa', 'fa', '2026-10-03T10:00:00.000Z'),
      workspace('wb', 'fb', '2026-10-02T10:00:00.000Z'),
      workspace('wc', 'fc', '2026-10-02T10:00:00.000Z'),
      workspace('we', 'fe', '2026-10-02T10:00:00.000Z')
    ];
    const groups = buildWhereGroups({
      view: 'stage',
      features: [d, c, a, b, e],
      workspaces,
      includeReleased: false,
      includeDone: false,
      filtered: false
    });
    expect(featureIds(byKey(groups).get('building'))).toEqual([
      'fa',
      'fb',
      'fc',
      'fe',
      'fd'
    ]);
  });

  it('breaks ties on newest workspace and stage_set_at by id ascending', () => {
    const zz = feature('zz', 'building');
    const aa = feature('aa', 'building');
    const groups = buildWhereGroups({
      view: 'stage',
      features: [zz, aa],
      workspaces: [
        workspace('wz', 'zz', NOW),
        workspace('wa', 'aa', NOW)
      ],
      includeReleased: false,
      includeDone: false,
      filtered: false
    });
    expect(featureIds(byKey(groups).get('building'))).toEqual(['aa', 'zz']);
  });

  it('sorts workspaces by last_activity_at desc then id asc', () => {
    const f = feature('f1', 'building');
    const groups = buildWhereGroups({
      view: 'stage',
      features: [f],
      workspaces: [
        workspace('w1', 'f1', '2026-10-02T10:00:00.000Z'),
        workspace('w2', 'f1', '2026-10-02T10:00:00.000Z'),
        workspace('w3', 'f1', '2026-10-01T10:00:00.000Z')
      ],
      includeReleased: false,
      includeDone: false,
      filtered: false
    });
    const group = byKey(groups).get('building');
    expect(
      group !== undefined && 'features' in group
        ? group.features[0]?.workspaces.map((w) => w.id)
        : null
    ).toEqual(['w1', 'w2', 'w3']);
  });

  it('never shows workspaces linked to hidden or unknown features anywhere', () => {
    const done = feature('d1', 'building', { taskStatus: 'done' });
    const groups = buildWhereGroups({
      view: 'stage',
      features: [done],
      workspaces: [
        workspace('wd', 'd1', NOW),
        workspace('wo', 'unknown-feature', NOW)
      ],
      includeReleased: false,
      includeDone: false,
      filtered: false
    });
    const allWorkspaceIds = groups.flatMap((g) =>
      'features' in g
        ? g.features.flatMap((f) => f.workspaces.map((w) => w.id))
        : g.workspaces.map((w) => w.id)
    );
    expect(allWorkspaceIds).toEqual([]);
  });

  it('does not mutate the input features or workspaces', () => {
    const a = feature('fa', 'building', {
      stageSetAt: '2026-09-02T00:00:00.000Z'
    });
    const b = feature('fb', 'building');
    const workspaces = [
      workspace('wb', 'fb', '2026-10-02T10:00:00.000Z'),
      workspace('wa', 'fa', '2026-10-03T10:00:00.000Z'),
      workspace('free', null, '2026-10-01T10:00:00.000Z')
    ];
    const features = [b, a];
    const featuresSnapshot = JSON.stringify(features);
    const workspacesSnapshot = JSON.stringify(workspaces);
    buildWhereGroups({
      view: 'stage',
      features,
      workspaces,
      includeReleased: false,
      includeDone: false,
      filtered: true
    });
    expect(JSON.stringify(features)).toBe(featuresSnapshot);
    expect(JSON.stringify(workspaces)).toBe(workspacesSnapshot);
  });
});

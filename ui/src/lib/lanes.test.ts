import { describe, expect, it } from 'vitest';
import {
  buildLanes,
  featureRepo,
  featureRiskLabel,
  projectName,
  pullRequestRepo,
} from './lanes.ts';
import type { WhereFeature, WhereResponse, WorkspaceView } from './where.ts';

function workspace(overrides: Partial<WorkspaceView> = {}): WorkspaceView {
  return {
    id: 'ws-1',
    machine: 'codebox',
    connect_target: 'codebox',
    path: '/w/a',
    repo_remote: 'github.com/ivo-toby/postgram',
    branch: 'feat/a',
    feature_id: 'f-1',
    last_activity_at: '2026-11-05T10:00:00.000Z',
    git: { dirty_count: 0, unpushed_count: 0, has_upstream: true },
    git_state_at: '2026-11-05T10:00:00.000Z',
    missing_since: null,
    risks: [],
    resume_session: null,
    sessions: [],
    ...overrides,
  };
}

function feature(overrides: Partial<WhereFeature> = {}): WhereFeature {
  return {
    id: 'f-1',
    title: 'A',
    stage: 'building',
    stage_source: 'manual',
    stage_set_at: '2026-11-05T09:00:00.000Z',
    task_status: 'active',
    pull_requests: [],
    workspaces: [],
    ...overrides,
  };
}

function stageResponse(byStage: Partial<Record<string, WhereFeature[]>>, unassigned: WorkspaceView[] = []): WhereResponse {
  const keys = ['building', 'review', 'functional_test', 'ready_to_merge', 'awaiting_release', 'released'];
  return {
    view: 'stage',
    generated_at: '2026-11-05T12:00:00.000Z',
    dormant_after_days: 30,
    groups: [
      ...keys.filter((key) => byStage[key] !== undefined).map((key) => ({ key, label: key, features: byStage[key] })),
      { key: 'unassigned', label: 'Unassigned', workspaces: unassigned },
    ],
  } as WhereResponse;
}

describe('pullRequestRepo', () => {
  it('takes host, owner and repo from a pull request url, lowercased', () => {
    expect(pullRequestRepo('https://github.com/Ivo-Toby/Postgram/pull/126')).toBe('github.com/ivo-toby/postgram');
    expect(pullRequestRepo('https://github.com/ivo-toby/talon/pull/3/files')).toBe('github.com/ivo-toby/talon');
    expect(pullRequestRepo('https://example.com/x')).toBeNull();
  });
});

describe('featureRepo and projectName', () => {
  it('prefers a worktree remote, then a pull request repo, else none', () => {
    const pr = { url: 'https://github.com/ivo-toby/talon/pull/3', state: 'open' as const, updated_at: '' };
    expect(featureRepo(feature({ workspaces: [workspace({ repo_remote: null }), workspace()], pull_requests: [pr] }))).toBe(
      'github.com/ivo-toby/postgram'
    );
    expect(featureRepo(feature({ pull_requests: [pr] }))).toBe('github.com/ivo-toby/talon');
    expect(featureRepo(feature())).toBeNull();
  });

  it('names a project after the last part of its repo, or Other', () => {
    expect(projectName('github.com/ivo-toby/picnic-mcp')).toBe('picnic-mcp');
    expect(projectName(null)).toBe('Other');
  });
});

describe('featureRiskLabel', () => {
  it('shows the worst risk over all worktrees and how many other kinds there are', () => {
    expect(featureRiskLabel(feature())).toBeNull();
    expect(featureRiskLabel(feature({ workspaces: [workspace({ risks: ['unpushed'] })] }))).toBe('unpushed');
    expect(
      featureRiskLabel(
        feature({ workspaces: [workspace({ risks: ['dirty', 'no_upstream'] }), workspace({ risks: ['interrupted', 'dirty'] })] })
      )
    ).toBe('interrupted +2');
  });
});

describe('buildLanes', () => {
  const postgramReview = feature({ id: 'p-r', stage: 'review', workspaces: [workspace({ last_activity_at: '2026-11-05T11:00:00.000Z' })] });
  const postgramBuild = feature({ id: 'p-b', stage: 'building', workspaces: [workspace()] });
  const talonTest = feature({
    id: 't-t',
    stage: 'functional_test',
    stage_set_at: '2026-11-01T00:00:00.000Z',
    pull_requests: [{ url: 'https://github.com/ivo-toby/talon/pull/3', state: 'open', updated_at: '' }],
  });
  const loose = feature({ id: 'x', stage: 'ready_to_merge', stage_set_at: '2026-11-05T11:59:00.000Z' });
  const released = feature({ id: 'p-done', stage: 'released', workspaces: [workspace()] });

  const response = stageResponse(
    {
      building: [postgramBuild],
      review: [postgramReview],
      functional_test: [talonTest],
      ready_to_merge: [loose],
      released: [released],
    },
    [workspace({ id: 'ws-loose', feature_id: null })]
  );

  it('groups features per repo, most recent project first and Other last', () => {
    const lanes = buildLanes(response, { includeReleased: false });
    expect(lanes.projects.map((project) => project.name)).toEqual(['postgram', 'talon', 'Other']);
    expect(lanes.featureCount).toBe(4);
    expect(lanes.unassigned.map((ws) => ws.id)).toEqual(['ws-loose']);
  });

  it('gives every project the same columns, with released only when asked', () => {
    const without = buildLanes(response, { includeReleased: false });
    expect(without.projects[0]?.columns.map((column) => column.label)).toEqual([
      'Building',
      'Review',
      'Test',
      'Merge',
      'Release',
    ]);
    const withReleased = buildLanes(response, { includeReleased: true });
    const postgram = withReleased.projects.find((project) => project.name === 'postgram');
    expect(postgram?.columns.map((column) => column.label).at(-1)).toBe('Released');
    expect(postgram?.columns.at(-1)?.features.map((f) => f.id)).toEqual(['p-done']);
  });

  it('counts the review, test and merge cards as needing you', () => {
    const lanes = buildLanes(response, { includeReleased: false });
    expect(lanes.projects.map((project) => project.needsYouCount)).toEqual([1, 1, 1]);
    expect(lanes.needsYouCount).toBe(3);
    expect(lanes.projects[0]?.columns.filter((column) => column.needsYou).map((column) => column.label)).toEqual([
      'Review',
      'Test',
      'Merge',
    ]);
  });

  it('returns no projects for an empty response', () => {
    const lanes = buildLanes(stageResponse({ building: [] }), { includeReleased: false });
    expect(lanes.projects).toEqual([]);
    expect(lanes.featureCount).toBe(0);
  });
});

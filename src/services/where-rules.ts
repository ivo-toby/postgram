import { isFeatureStage, isPullRequestState } from './feature-rules.js';
import type { EntityStatus } from '../types/entities.js';
import type {
  FeaturePullRequest,
  FeatureStage,
  StageSource
} from '../types/features.js';
import type { WorkspaceView } from '../types/workspaces.js';

export type WhereView = 'stage' | 'actions';

export type FeatureTaskRow = {
  id: string;
  content: string | null;
  status: EntityStatus | null;
  metadata: Record<string, unknown> | null;
};

export type WhereFeatureSummary = {
  id: string;
  title: string;
  stage: FeatureStage;
  stage_source: StageSource | null;
  stage_set_at: string | null;
  task_status: EntityStatus | null;
  pull_requests: FeaturePullRequest[];
};

export type WhereFeature = WhereFeatureSummary & { workspaces: WorkspaceView[] };

export type WhereFeatureGroup = {
  key: string;
  label: string;
  features: WhereFeature[];
};

export type WhereUnassignedGroup = {
  key: 'unassigned';
  label: 'Unassigned';
  workspaces: WorkspaceView[];
};

export type WhereGroup = WhereFeatureGroup | WhereUnassignedGroup;

const WHERE_VIEWS = ['stage', 'actions'] as const;

export function isWhereView(value: unknown): value is WhereView {
  return (
    typeof value === 'string' &&
    (WHERE_VIEWS as readonly string[]).includes(value)
  );
}

export function featureTitle(content: string | null): string {
  return ((content ?? '').split('\n')[0] ?? '').trim().slice(0, 80);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toPullRequest = (entry: unknown): FeaturePullRequest | null => {
  if (!isPlainObject(entry)) return null;
  const url = entry.url;
  const state = entry.state;
  const updatedAt = entry.updated_at;
  if (
    typeof url !== 'string' ||
    !isPullRequestState(state) ||
    typeof updatedAt !== 'string'
  ) {
    return null;
  }
  return { url, state, updated_at: updatedAt };
};

export function toWhereFeature(row: FeatureTaskRow): WhereFeatureSummary {
  let stage: FeatureStage = 'building';
  let stageSource: StageSource | null = null;
  let stageSetAt: string | null = null;
  let pullRequests: FeaturePullRequest[] = [];

  const metadata = row.metadata;
  if (metadata !== null) {
    const stageValue = metadata.stage;
    if (isFeatureStage(stageValue)) {
      stage = stageValue;
      const source = metadata.stage_source;
      if (source === 'manual' || source === 'derived') {
        stageSource = source;
      }
      const setAt = metadata.stage_set_at;
      if (typeof setAt === 'string') {
        stageSetAt = setAt;
      }
    }

    const rawPullRequests = metadata.pull_requests;
    pullRequests = Array.isArray(rawPullRequests)
      ? rawPullRequests
          .map(toPullRequest)
          .filter((entry): entry is FeaturePullRequest => entry !== null)
      : [];
  }

  return {
    id: row.id,
    title: featureTitle(row.content),
    stage,
    stage_source: stageSource,
    stage_set_at: stageSetAt,
    task_status: row.status,
    pull_requests: pullRequests
  };
}

type GroupDef = { key: string; label: string; stage: FeatureStage | null };

const STAGE_GROUPS: readonly GroupDef[] = [
  { key: 'building', label: 'Building', stage: 'building' },
  { key: 'review', label: 'Review', stage: 'review' },
  { key: 'functional_test', label: 'Functional test', stage: 'functional_test' },
  { key: 'ready_to_merge', label: 'Ready to merge', stage: 'ready_to_merge' },
  { key: 'awaiting_release', label: 'Awaiting release', stage: 'awaiting_release' },
  { key: 'released', label: 'Released', stage: 'released' },
  { key: 'unassigned', label: 'Unassigned', stage: null }
];

const ACTION_GROUPS: readonly GroupDef[] = [
  { key: 'review', label: 'Review', stage: 'review' },
  { key: 'test', label: 'Test', stage: 'functional_test' },
  { key: 'merge', label: 'Merge', stage: 'ready_to_merge' },
  { key: 'release', label: 'Release', stage: 'awaiting_release' },
  { key: 'in_progress', label: 'In progress', stage: 'building' },
  { key: 'unassigned', label: 'Unassigned', stage: null }
];

const compareWorkspace = (a: WorkspaceView, b: WorkspaceView): number => {
  const ta = Date.parse(a.last_activity_at);
  const tb = Date.parse(b.last_activity_at);
  if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) {
    return tb - ta;
  }
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
};

type FeatureSlot = {
  summary: WhereFeatureSummary;
  workspaces: WorkspaceView[];
};

const newestActivity = (list: readonly WorkspaceView[]): number => {
  if (list.length === 0) return Number.NaN;
  let newest = Number.NEGATIVE_INFINITY;
  for (const workspace of list) {
    const time = Date.parse(workspace.last_activity_at);
    if (!Number.isNaN(time) && time > newest) {
      newest = time;
    }
  }
  return newest;
};

const parseTime = (value: string | null): number => {
  if (value === null) return Number.NEGATIVE_INFINITY;
  const time = Date.parse(value);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
};

const compareFeature = (a: FeatureSlot, b: FeatureSlot): number => {
  const na = newestActivity(a.workspaces);
  const nb = newestActivity(b.workspaces);
  if (Number.isNaN(na) || Number.isNaN(nb)) {
    if (Number.isNaN(na) && Number.isNaN(nb)) {
      // both have no workspaces; fall through to stage_set_at
    } else {
      return Number.isNaN(na) ? 1 : -1;
    }
  } else if (na !== nb) {
    return nb - na;
  }

  const sa = parseTime(a.summary.stage_set_at);
  const sb = parseTime(b.summary.stage_set_at);
  if (sa !== sb) {
    return sb - sa;
  }

  if (a.summary.id < b.summary.id) return -1;
  if (a.summary.id > b.summary.id) return 1;
  return 0;
};

export function buildWhereGroups(input: {
  view: WhereView;
  features: readonly WhereFeatureSummary[];
  workspaces: readonly WorkspaceView[];
  includeReleased: boolean;
  includeDone: boolean;
  filtered: boolean;
}): WhereGroup[] {
  const { view, features, workspaces, includeReleased, includeDone, filtered } =
    input;

  const defs: readonly GroupDef[] =
    view === 'actions'
      ? ACTION_GROUPS
      : includeReleased
        ? STAGE_GROUPS
        : STAGE_GROUPS.filter((def) => def.key !== 'released');

  const isHidden = (feature: WhereFeatureSummary): boolean => {
    if (
      (feature.task_status === 'done' || feature.task_status === 'archived') &&
      !includeDone
    ) {
      return true;
    }
    if (feature.stage === 'released' && !(view === 'stage' && includeReleased)) {
      return true;
    }
    return false;
  };

  const visible: FeatureSlot[] = features
    .filter((summary) => !isHidden(summary))
    .map((summary) => ({
      summary,
      workspaces: workspaces
        .filter((workspace) => workspace.feature_id === summary.id)
        .sort(compareWorkspace)
    }))
    .filter((slot) => !filtered || slot.workspaces.length > 0);

  const unassigned = workspaces
    .filter((workspace) => workspace.feature_id === null)
    .sort(compareWorkspace);

  return defs.map((def) => {
    if (def.key === 'unassigned') {
      return { key: 'unassigned', label: 'Unassigned', workspaces: unassigned };
    }
    return {
      key: def.key,
      label: def.label,
      features: visible
        .filter((slot) => slot.summary.stage === def.stage)
        .sort(compareFeature)
        .map((slot) => ({ ...slot.summary, workspaces: slot.workspaces }))
    };
  });
}

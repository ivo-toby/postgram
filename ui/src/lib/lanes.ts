// Turns the stage view of GET /api/where into swimlanes per project.
// A project is a repository: the workspace's repo_remote, else the repo of the
// first pull request. Features with neither go into "Other".
import type {
  FeatureStage,
  Risk,
  WhereFeature,
  WhereGroup,
  WhereResponse,
  WorkspaceView,
} from './where.ts';

export type LaneColumn = {
  stage: FeatureStage;
  label: string;
  needsYou: boolean;
  features: WhereFeature[];
};

export type ProjectLanes = {
  key: string;
  name: string;
  repo: string | null;
  featureCount: number;
  needsYouCount: number;
  columns: LaneColumn[];
};

export type Lanes = {
  projects: ProjectLanes[];
  unassigned: WorkspaceView[];
  featureCount: number;
  needsYouCount: number;
};

const COLUMNS: { stage: FeatureStage; label: string; needsYou: boolean }[] = [
  { stage: 'building', label: 'Building', needsYou: false },
  { stage: 'review', label: 'Review', needsYou: true },
  { stage: 'functional_test', label: 'Test', needsYou: true },
  { stage: 'ready_to_merge', label: 'Merge', needsYou: true },
  { stage: 'awaiting_release', label: 'Release', needsYou: false },
  { stage: 'released', label: 'Released', needsYou: false },
];

export const OTHER_PROJECT = 'Other';

// Worst first: the card shows only the first one.
const RISK_ORDER: Risk[] = ['missing', 'interrupted', 'dirty', 'unpushed', 'no_upstream'];

const RISK_TEXT: Record<Risk, string> = {
  missing: 'missing',
  interrupted: 'interrupted',
  dirty: 'uncommitted',
  unpushed: 'unpushed',
  no_upstream: 'no upstream',
};

export function pullRequestRepo(url: string): string | null {
  const match = /^https?:\/\/(github\.com\/[^/]+\/[^/]+)\/pull\/\d+/iu.exec(url);
  return match?.[1]?.toLowerCase() ?? null;
}

export function featureRepo(feature: WhereFeature): string | null {
  for (const workspace of feature.workspaces) {
    if (workspace.repo_remote !== null) return workspace.repo_remote;
  }
  for (const pr of feature.pull_requests) {
    const repo = pullRequestRepo(pr.url);
    if (repo !== null) return repo;
  }
  return null;
}

export function projectName(repo: string | null): string {
  if (repo === null) return OTHER_PROJECT;
  const parts = repo.split('/');
  return parts[parts.length - 1] || repo;
}

// The worst risk over all worktrees of a feature, plus how many more kinds there are.
export function featureRiskLabel(feature: WhereFeature): string | null {
  const found = new Set<Risk>();
  for (const workspace of feature.workspaces) {
    for (const risk of workspace.risks) found.add(risk);
  }
  const ordered = RISK_ORDER.filter((risk) => found.has(risk));
  const first = ordered[0];
  if (first === undefined) return null;
  return ordered.length > 1 ? `${RISK_TEXT[first]} +${ordered.length - 1}` : RISK_TEXT[first];
}

function latestActivity(feature: WhereFeature): number {
  let latest = feature.stage_set_at === null ? 0 : Date.parse(feature.stage_set_at);
  for (const workspace of feature.workspaces) {
    latest = Math.max(latest, Date.parse(workspace.last_activity_at));
  }
  return Number.isNaN(latest) ? 0 : latest;
}

export function buildLanes(response: WhereResponse, options: { includeReleased: boolean }): Lanes {
  const columns = COLUMNS.filter((column) => options.includeReleased || column.stage !== 'released');
  const byStage = new Map<string, WhereGroup>();
  let unassigned: WorkspaceView[] = [];
  for (const group of response.groups) {
    if (group.key === 'unassigned') unassigned = group.workspaces ?? [];
    else byStage.set(group.key, group);
  }

  type Bucket = { repo: string | null; features: WhereFeature[]; latest: number };
  const buckets = new Map<string, Bucket>();
  for (const column of columns) {
    for (const feature of byStage.get(column.stage)?.features ?? []) {
      const repo = featureRepo(feature);
      const key = repo ?? '';
      const bucket = buckets.get(key) ?? { repo, features: [], latest: 0 };
      bucket.features.push(feature);
      bucket.latest = Math.max(bucket.latest, latestActivity(feature));
      buckets.set(key, bucket);
    }
  }

  const projects = [...buckets.entries()]
    .map(([key, bucket]): ProjectLanes => {
      const projectColumns = columns.map((column) => ({
        ...column,
        features: bucket.features.filter((feature) => feature.stage === column.stage),
      }));
      return {
        key: key === '' ? 'other' : key,
        name: projectName(bucket.repo),
        repo: bucket.repo,
        featureCount: bucket.features.length,
        needsYouCount: projectColumns
          .filter((column) => column.needsYou)
          .reduce((sum, column) => sum + column.features.length, 0),
        columns: projectColumns,
      };
    })
    .sort((a, b) => {
      // "Other" last, then most recent activity first, then by name.
      if ((a.repo === null) !== (b.repo === null)) return a.repo === null ? 1 : -1;
      const latestA = buckets.get(a.repo ?? '')?.latest ?? 0;
      const latestB = buckets.get(b.repo ?? '')?.latest ?? 0;
      return latestB - latestA || a.name.localeCompare(b.name);
    });

  return {
    projects,
    unassigned,
    featureCount: projects.reduce((sum, project) => sum + project.featureCount, 0),
    needsYouCount: projects.reduce((sum, project) => sum + project.needsYouCount, 0),
  };
}

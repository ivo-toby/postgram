import type { Entity } from './entities.js';

export const FEATURE_STAGES = [
  'building',
  'review',
  'functional_test',
  'ready_to_merge',
  'awaiting_release',
  'released'
] as const;

export type FeatureStage = (typeof FEATURE_STAGES)[number];

export const PULL_REQUEST_STATES = ['open', 'merged', 'closed'] as const;

export type PullRequestState = (typeof PULL_REQUEST_STATES)[number];

export type StageSource = 'manual' | 'derived';

export type FeaturePullRequest = {
  url: string;
  state: PullRequestState;
  updated_at: string;
};

export type FeatureMetadata = {
  kind: 'feature';
  stage: FeatureStage;
  stage_source: StageSource;
  stage_set_at: string;
  pull_requests: FeaturePullRequest[];
};

export type SetStageResult = {
  entity: Entity;
  previous_stage: FeatureStage | null;
};

export type AddPullRequestResult = {
  entity: Entity;
  stage_changed: boolean;
  from: FeatureStage;
  to: FeatureStage;
};

export type RepositorySetting = {
  remote: string;
  release_on_merge: boolean;
};

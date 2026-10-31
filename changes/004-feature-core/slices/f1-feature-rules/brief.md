# Slice brief: feature-f1

Status: draft

## Outcome and boundaries

Create the pure feature rules. No database, no clock reads: `now` is always passed in.

1. `src/types/features.ts` with exactly these exports (formatting may differ):

```ts
import type { Entity } from './entities.js';

export const FEATURE_STAGES = ['building', 'review', 'functional_test', 'ready_to_merge', 'awaiting_release', 'released'] as const;
export type FeatureStage = (typeof FEATURE_STAGES)[number];
export const PULL_REQUEST_STATES = ['open', 'merged', 'closed'] as const;
export type PullRequestState = (typeof PULL_REQUEST_STATES)[number];
export type StageSource = 'manual' | 'derived';
export type FeaturePullRequest = { url: string; state: PullRequestState; updated_at: string };
export type FeatureMetadata = {
  kind: 'feature'; stage: FeatureStage; stage_source: StageSource;
  stage_set_at: string; pull_requests: FeaturePullRequest[];
};
export type SetStageResult = { entity: Entity; previous_stage: FeatureStage | null };
export type AddPullRequestResult = { entity: Entity; stage_changed: boolean; from: FeatureStage; to: FeatureStage };
export type RepositorySetting = { remote: string; release_on_merge: boolean };
```

2. `src/services/feature-rules.ts` exporting exactly:

```ts
export function isFeatureStage(value: unknown): value is FeatureStage;
export function isPullRequestState(value: unknown): value is PullRequestState;
export function compareStages(a: FeatureStage, b: FeatureStage): number; // < 0 when a comes before b
export function featureDefaults(now: string): FeatureMetadata;
export function canonicalizePullRequestUrl(raw: string): Result<{ url: string; repository: string }, AppError>;
export function deriveStage(input: { current: FeatureStage; previousState: PullRequestState | null; nextState: PullRequestState; releaseOnMerge: boolean }): FeatureStage;
export function upsertPullRequest(list: readonly FeaturePullRequest[], pr: { url: string; state: PullRequestState }, now: string): { pullRequests: FeaturePullRequest[]; previousState: PullRequestState | null };
export function normalizeFeatureMetadata(input: { next: Record<string, unknown>; previous: Record<string, unknown> | null; now: string }): Result<Record<string, unknown>, AppError>;
```

Rules:
- `compareStages` follows the order of `FEATURE_STAGES`.
- `featureDefaults(now)` returns `{ kind: 'feature', stage: 'building', stage_source: 'manual', stage_set_at: now, pull_requests: [] }` (a fresh array each call).
- `canonicalizePullRequestUrl`: the input must match `^https://github\.com/([^/]+)/([^/]+)/pull/(\d+)`; anything after the number (`/files`, `#…`, `?…`) is dropped. Returns `url = https://github.com/<owner>/<repo>/pull/<n>` and `repository = github.com/<owner>/<repo>`, owner and repo lowercased. Any other input is `err(new AppError(ErrorCode.VALIDATION, …))`.
- `deriveStage`: when `previousState === nextState` the stage stays. Otherwise: `open` while `building` → `review`; `merged` while before `awaiting_release` → `released` when `releaseOnMerge`, else `awaiting_release`; every other case (including `closed`) keeps `current`. It never returns a stage before `current`.
- `upsertPullRequest`: replaces the entry with the same `url` in place (new state, `updated_at = now`) or appends a new one; never duplicates; does not mutate `list`. `previousState` is the old state, or `null` for a new URL.
- `normalizeFeatureMetadata`: `next` is the complete resulting metadata, `previous` the stored metadata (`null` on create). When `next.kind !== 'feature'` return `ok(next)` unchanged. Otherwise validate the present keys and return `err` VALIDATION (details: `{ field }`) for: a `stage` that is not a FeatureStage; a `stage_source` other than `manual`/`derived`; a `stage_set_at` that is not a string; `pull_requests` that is not an array, or an entry that is not an object with a string `url` equal to its canonical form, a valid `state` and a string `updated_at`. Never coerce. Then add the defaults for absent keys (keep every other key of `next`). Finally, when `previous?.kind === 'feature'` and `previous.stage !== result.stage`, set `stage_source = 'manual'` and `stage_set_at = now`. It never derives a stage from pull requests.

Write the slice test `tests/unit/feature-rules.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/feature-service.feature.test.ts`, `changes/004-feature-core/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/data-model.md`, `specs/004-workspace-session-tracking/contracts/rest.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| canonicalize https://github.com/Ivo-Toby/Postgram/pull/12/files#x | url https://github.com/ivo-toby/postgram/pull/12, repository github.com/ivo-toby/postgram | pr-canonical | feature-f1 |
| canonicalize a gitlab merge request or /pulls/12 | err VALIDATION | pr-canonical | feature-f1 |
| every row of the data-model transition table, plus releaseOnMerge | the table result; never backwards | stage-derive | feature-f1 |
| upsert an existing URL with a new state, and a new URL | replaced in place with previousState; appended with null; input not mutated | pr-upsert | feature-f1 |
| normalize kind feature with no other keys; a non-feature | defaults added; non-feature returned unchanged | feature-defaults | feature-f1 |
| normalize stage shipping, pull_requests "x", non-canonical PR url | err VALIDATION each | feature-validate | feature-f1 |
| normalize with previous stage review/derived and next stage building | stage_source manual, stage_set_at now | feature-manual-update | feature-f1 |

The check `feature-f1` runs `node changes/004-feature-core/slice-check.mjs src/types/features.ts src/services/feature-rules.ts tests/unit/feature-rules.test.ts`: Vitest on the slice test, ESLint with zero allowed problems on the listed files, and tsc on the whole project. Run it with run_checks before you finish and fix every ESLint and tsc error it reports. Integration tests show as SKIPPED in your sandbox (no Docker); the controller runs them on the host.

## Stop conditions

- Stop and report if a cited excerpt contradicts this brief.
- Stop if the work would need a change to a protected file or a deletion.
- Report every file you created or changed.

## Slice test review contract

The JSON block must exactly match slice.json.testReview.

```json
{
  "schemaVersion": 1,
  "workflow": "slice-tests",
  "criteria": [
    {
      "id": "feature-f1-tests",
      "requirementIds": [
        "feature-defaults",
        "feature-validate",
        "feature-manual-update",
        "pr-canonical",
        "pr-upsert",
        "stage-derive"
      ],
      "question": "Do the tests pin every transition-table row, never-backwards, PR canonicalization and rejection, upsert immutability, defaults, each validation failure and the manual-stage rule?",
      "interfaces": [
        "specs/004-workspace-session-tracking/data-model.md",
        "specs/004-workspace-session-tracking/contracts/rest.md"
      ],
      "testPaths": [
        "tests/unit/feature-rules.test.ts"
      ]
    }
  ]
}
```

## Approved slice requirements

The JSON array must exactly match the requirement records referenced by
slice.json.testReview.

```json
[
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "feature-defaults",
    "text": "When the resulting metadata of createTask or updateTask has kind feature, absent keys get the defaults stage building, stage_source manual, stage_set_at now and pull_requests []; tasks without kind feature are unchanged."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "feature-validate",
    "text": "A present but invalid stage or stage_source, or malformed pull_requests (not an array of canonical GitHub PR URLs with state open, merged or closed and a string updated_at), is rejected with VALIDATION and nothing is written; values are never coerced."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "feature-manual-update",
    "text": "A stage changed through updateTask sets stage_source manual and stage_set_at now; updateTask never derives a stage."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "pr-canonical",
    "text": "A pull request URL must match https://github.com/<owner>/<repo>/pull/<n>; anything after the number is stripped and owner and repo are lowercased; any other URL is VALIDATION."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "pr-upsert",
    "text": "addFeaturePullRequest upserts by canonical URL with state open by default, writes the complete pull_requests array, refreshes updated_at on a re-report and never duplicates a URL."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "stage-derive",
    "text": "Only a new URL or a changed state derives a stage: open while building gives review; merged before awaiting_release gives awaiting_release, or released when the PR repository has release_on_merge; every other case and every closed state keeps the stage; a derived move never goes backwards and sets stage_source derived."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.

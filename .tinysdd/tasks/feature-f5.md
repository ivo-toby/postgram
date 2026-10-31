# Slice brief: feature-f5

Status: draft

## Outcome and boundaries

Add to `src/services/feature-service.ts`:

```ts
export function addFeaturePullRequest(pool: Pool, auth: AuthContext, input: { id: string; url: string; state?: string | undefined }): ServiceResult<AddPullRequestResult>;
```

Order: `requireScope(auth, 'write')`; `state = input.state ?? 'open'` must pass `isPullRequestState` (VALIDATION); `canonicalizePullRequestUrl(input.url)` (VALIDATION); `resolveFeatureId`. Nothing is written on any failure.

Base metadata as in setFeatureStage: a feature keeps its metadata, a plain task gets `{ ...m, ...featureDefaults(now) }`. `current = base.stage`. `{ pullRequests, previousState } = upsertPullRequest(base.pull_requests, { url, state }, now)`. The PR changed when `previousState !== state`. Only then derive: `releaseOnMerge` is `SELECT release_on_merge FROM repositories WHERE remote = $1` with the PR repository (missing row → false), and `to = deriveStage({ current, previousState, nextState: state, releaseOnMerge })`; otherwise `to = current`. Write `{ ...base, pull_requests: pullRequests }` plus, when `to !== current`, `stage: to, stage_source: 'derived', stage_set_at: now`, through the retry helper (a same-state re-report still writes, to refresh `updated_at`).

After the write: when the PR changed, audit `feature_pr` details `{ url, state }`; when `to !== current`, audit `feature_stage` details `{ from: current, to, source: 'derived' }`. Both use the task id as `entityId`. Return `{ entity, stage_changed: to !== current, from: current, to }`. The task status never changes.

Write the slice test `tests/integration/feature-pull-request.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/feature-service.feature.test.ts`, `changes/004-feature-core/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/rest.md`, `specs/004-workspace-session-tracking/data-model.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| open PR on a building feature (URL with /files#x and mixed case) | review, derived; stored canonical URL | stage-derive | feature-f5 |
| same URL, same state after a manual building | stage stays building; one PR entry; updated_at refreshed; no audit rows | pr-upsert | feature-f5 |
| merged from building / review / ready_to_merge | awaiting_release | stage-derive | feature-f5 |
| merged with release_on_merge for that repository | released; status unchanged | released-status | feature-f5 |
| open on ready_to_merge; closed on any stage; merged on released | stage unchanged | stage-derive | feature-f5 |
| gitlab URL, bad state, read-only key | VALIDATION, VALIDATION, FORBIDDEN; row unchanged | pr-canonical | feature-f5 |
| new PR and changed state | feature_pr rows with url and state; feature_stage only on a stage change | feature-audit | feature-f5 |

The check `feature-f5` runs `node changes/004-feature-core/slice-check.mjs src/services/feature-service.ts tests/integration/feature-pull-request.test.ts`: Vitest on the slice test, ESLint with zero allowed problems on the listed files, and tsc on the whole project. Run it with run_checks before you finish and fix every ESLint and tsc error it reports. Integration tests show as SKIPPED in your sandbox (no Docker); the controller runs them on the host.

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
      "id": "feature-f5-tests",
      "requirementIds": [
        "pr-canonical",
        "pr-upsert",
        "stage-derive",
        "released-status",
        "feature-audit"
      ],
      "question": "Do the tests walk the worked example and every transition-table row through the service, including release_on_merge, same-state re-reports, rejection without writes and the feature_pr/feature_stage audit rows?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/rest.md",
        "specs/004-workspace-session-tracking/data-model.md"
      ],
      "testPaths": [
        "tests/integration/feature-pull-request.test.ts"
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
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "released-status",
    "text": "Reaching released, by hand or derived, never changes the task status."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "feature-audit",
    "text": "A stage change writes feature_stage with from, to and source; a new or changed PR writes feature_pr with url and state; a repository setting change writes repository_update with remote and release_on_merge; a same-state PR re-report writes neither feature_stage nor feature_pr."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.

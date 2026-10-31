# Proposal: 004 phase 2, feature core

Status: draft

## Outcome

Postgram tasks can be features with a delivery stage and pull requests. The
service layer gains, in `src/services/feature-service.ts`:

- `createFeature`: a task with status `inbox` and the feature defaults.
- `resolveFeatureId`: a full UUID or an 8-hex short id to a visible task.
- `setFeatureStage`: any stage by hand, backwards too.
- `addFeaturePullRequest`: upsert a GitHub PR by canonical URL and derive a
  forward-only stage change (FR-005).
- `setRepositoryReleaseOnMerge`: the per-repository setting the derivation
  reads.

The generic task tools (`createTask`, `updateTask`) normalize feature metadata:
defaults when absent, `VALIDATION` for invalid values, and a stage changed
through `updateTask` is marked manual. Tasks that are not features are
untouched.

Rejections: invalid input is `VALIDATION`, a missing scope is `FORBIDDEN`, an
unknown or invisible feature is `NOT_FOUND`, an ambiguous short id is
`CONFLICT` with candidates, and nothing is written in any of these cases.

Preserved: existing task and entity behaviour, the report transaction from
phase 1 (it still never writes `entities`), the `entities` schema, migrations
001–018.

Out of scope (later 004 phases): REST and MCP adapters, `where`/`actions`
views, all CLI work.

## Clarifications

- Q1 (deferred from phase 1, D2): when a report links a task that is not yet a
  feature, are the feature defaults applied?
  - Answer: Ivo, 2026-10-31: no. A report never writes `entities`; views treat
    a linked task without `metadata.stage` as `building`.
  - Decision: D1 accepted. `data-model.md` report step 4 is updated to match.

## Source facts

- `specs/004-workspace-session-tracking/data-model.md:24-92`: feature
  metadata keys, normalization in the task tools, writes with one retry, and
  the stage transition table with the worked example.
- `specs/004-workspace-session-tracking/contracts/rest.md:17-48`: feature id
  forms and their error table, title rule, PR URL canonicalization.
- `specs/004-workspace-session-tracking/contracts/rest.md:105-121`: audit
  operation names `feature_stage`, `feature_pr`, `repository_update`.
- `specs/004-workspace-session-tracking/contracts/rest.md:220-246`: request
  and response shapes for repositories, features, stage and pull requests.
- `specs/004-workspace-session-tracking/research.md:105-112`: short-id lookup
  query (`id::text LIKE`, task, not archived, unique).
- `src/services/entity-service.ts:302-424`: `updateEntity` checks the version,
  merges metadata shallowly, bumps the version, writes an `update` audit row
  and does not re-embed when content is unchanged.
- `src/services/task-service.ts:132-228`: `createTask` and `updateTask` pass
  merged metadata straight to `storeEntity`/`updateEntity`.
- `src/util/git-remote.ts`: `normalizeRemote` from phase 1.

## Proposed decisions

- D1 (accepted): no feature defaults on a report link (see Q1).
- D2: Service inputs `stage` and `state` are strings validated at runtime,
  because REST and MCP pass untrusted values.
- D3: Pure rules (stage order, derivation, PR canonicalization, metadata
  normalization, defaults) live in `src/services/feature-rules.ts` with unit
  tests; feature types live in `src/types/features.ts`.
- D4: Feature writes go through `updateEntity` with the full metadata object.
  On `CONFLICT` the service re-reads and retries once; a second conflict is
  returned as `CONFLICT`.
- D5: Audit rows besides the `update` row of `updateEntity`:
  `feature_stage` `{from, to, source}` when the stage changes (in
  `setFeatureStage` a plain task counts as `from: null`), `feature_pr` `{url, state}` when a PR is new or its state
  changes, `repository_update` `{remote, release_on_merge}` with
  `entity_id = null` when a repository row is created or its value changes.
- D6: `setFeatureStage` and `addFeaturePullRequest` accept either id form and
  turn a plain task into a feature (defaults first). `previous_stage` is
  `null` for a plain task.
- D7: `updateTask` reads the current row to compute the resulting metadata.
  When the row is missing or not visible to the caller, it skips normalization
  and lets `updateEntity` return its error, so validation never leaks
  existence.
- D8: `setRepositoryReleaseOnMerge` belongs to this change, because the
  derivation needs it; its REST route stays in phase 3.

## Unknowns and stop conditions

- Stop if a feature write would need content changes or re-embedding.
- Stop if normalization in `updateTask` would change behaviour for tasks
  without `kind = 'feature'`.

## Requirements

See `deltas/feature-core.json`.

## Acceptance criteria

- C1: the task tools fill feature defaults, reject invalid feature metadata
  without writing, mark a stage changed through `updateTask` as manual, and
  never derive.
- C2: `createFeature` creates an `inbox` feature; ids resolve per the rest.md
  table (short ids, ambiguity with candidates, archived excluded, invisible as
  not found).
- C3: `setFeatureStage` moves any to any, records `feature_stage` audit rows
  and never changes status.
- C4: `addFeaturePullRequest` follows the transition table and the worked
  example, never derives backwards, ignores closed PRs, and rejects non-GitHub
  URLs without writing.
- C5: with `release_on_merge`, a merge moves the feature to `released` without
  changing its status; other repositories go to `awaiting_release`.

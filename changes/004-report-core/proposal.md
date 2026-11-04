# Proposal: 004 phase 1, workspace report core

Status: draft

## Outcome

Postgram can record where agent work happens. A single service call,
`reportWorkspace(pool, auth, input)`, takes one report from a machine and, in
one database transaction, upserts the machine, applies the reboot rule,
upserts the workspace and its git snapshot, updates the feature link and
records the agent session(s). It returns the response object from
`specs/004-workspace-session-tracking/contracts/rest.md` (POST
/api/workspaces/report).

Rejections: invalid input is a `VALIDATION` error, a key without `write` scope
is `FORBIDDEN`, and nothing is written in either case. A failure inside the
transaction rolls back every step.

Preserved: no write to `entities` on any report (FR-016, SC-006). Existing
tasks, task tools, migrations 001–017 and the audit log format are unchanged.

Out of scope for this change (later 004 phases): REST and MCP routes, the
where/actions views, feature-service (stages, pull requests, derivation, short
ids), feature normalization in the task tools, all CLI work, hooks, the pi
extension and scan discovery.

## Clarifications

- Q1: How does a report link a task that is not yet a feature? data-model.md
  step 4 says "apply the feature defaults", but `updateEntity`
  (`src/services/entity-service.ts:302`) takes a `Pool` and runs its own
  query, so it cannot join the report transaction.
  - Answer: Ivo, 2026-10-31: defer to phase 2.
  - Decision: D2 accepted.
- Q2: Does the response carry the full workspace object (risks,
  resume_session, sessions, dormant) in this phase?
  - Answer: Ivo, 2026-10-31: full object in phase 1.
  - Decision: D4 accepted.

## Source facts

- `specs/004-workspace-session-tracking/data-model.md:176-208`: report
  transaction steps 1–6, audit operations and the reboot worked example.
- `specs/004-workspace-session-tracking/data-model.md:94-175`: columns,
  constraints and indexes of `machines`, `workspaces`, `agent_sessions`,
  `repositories`, and the session state machine.
- `specs/004-workspace-session-tracking/contracts/rest.md:125-201`: report
  request validation, git snapshot semantics, session forms and the response.
- `specs/004-workspace-session-tracking/contracts/rest.md:49-121`: workspace
  object, risks, visibility and audit operation names.
- `specs/004-workspace-session-tracking/plan.md:133`: audit waiver for
  activity-only refreshes; allowed by constitution 1.1.0 principle 4.
- `src/db/migrate.ts:17-60`: `runMigrations` applies `NNN_*.sql` files in
  order, each in its own transaction; it is the existing caller that wires the
  new migration.
- `src/util/audit.ts:10-31`: `appendAuditEntry(pool: Pool, …)` accepts only a
  `Pool`, so it cannot write inside a `PoolClient` transaction.
- `src/services/task-service.ts:158-160`, `src/auth/types.ts:19-26`: scope and
  visibility come from `AuthContext` (`requireScope`, `allowedTypes`,
  `allowedVisibility`).
- `src/services/admin-job-service.ts:769-772`: existing transaction pattern
  (`pool.connect()`, `BEGIN`, `FOR UPDATE`, `COMMIT`/`ROLLBACK`, `release`).
- `tests/helpers/postgres.ts:65-90`: `resetTestDatabase` truncates a fixed
  table list; new tables must be added or tests leak state.
- `src/config.ts:13`: zod config schema; `WORKSPACE_DORMANT_AFTER_DAYS` does
  not exist yet.
- Installed: `neverthrow ^8.2.0`, `zod ^3.25.76`, `pg ^8.16.3`,
  `vitest ^3.2.4`, `testcontainers ^11.8.1` (`package.json`).
- `eslint.config.js`: `recommendedTypeChecked`, `consistent-type-imports`,
  `no-floating-promises` (and therefore `require-await`) apply to `src/**`.

## Proposed decisions

- D1: This change ends at the service. Its protected feature test runs the
  real `runMigrations` and calls `reportWorkspace` against Postgres
  (testcontainers). Wiring to REST and MCP is an obligation of phase 3.
- D2 (accepted): A report links any visible task and does not apply
  feature defaults. The response reports `feature.stage` as
  `metadata.stage ?? null`. Phase 2 (feature-service) adds the defaults in its
  own versioned write, outside the report transaction.
- D3: Widen `appendAuditEntry` to accept `Pool | PoolClient`, so audit rows are
  written in the report transaction and roll back with it. Callers are
  unchanged.
- D4 (accepted): The response carries the full workspace object. That needs
  `WORKSPACE_DORMANT_AFTER_DAYS` (default 30, integer ≥ 1) in `src/config.ts`,
  `.env.example`, `docker-compose.yml` and the README table in this change
  (constitution principle 8). The pure mapper (risks, resume_session, sessions,
  dormant) is reused by the where views in phase 3.
- D5: Remote normalization lives in `src/util/git-remote.ts` with the
  rest.md test vectors. How the CLI shares it is decided in phase 4.
- D6: Input validation is a zod schema in the service, so REST and MCP get the
  same rules (constitution principle 2).

## Unknowns and stop conditions

- Resolved in research: no page under `docs/` lists environment variables;
  the README configuration table is the deployment documentation.
- Stop if a report path would need to write `entities`.
- Stop if the reboot rule cannot exclude the reported session S within one
  statement order inside the transaction.

## Requirements

- R-report-validate: invalid reports are rejected with `VALIDATION` per the
  rest.md table and session-form rules; nothing is written.
- R-report-scope: reports require `write` scope; otherwise `FORBIDDEN`.
- R-machine-upsert: machine upserted by alias; `boot_id` set only for a hook
  report with a non-null boot id.
- R-reboot-rule: on a hook report with a non-null boot id, every other
  `running`/`idle` session on that machine with a different non-null boot id
  becomes `interrupted` (`end_reason = 'reboot'`, `ended_at = now()`);
  `interrupted_sessions` counts them; the reported session is never
  interrupted.
- R-workspace-upsert: workspace upserted by (machine, path) with trailing
  slash stripped; omitted keys keep values, `null` clears; the git rule
  (`null` clears, omitted keeps, object sets); `missing_since` cleared;
  `last_activity_at` per source.
- R-feature-link: a visible task id links; unknown/invisible gives
  `feature_not_found`, a non-task gives `feature_not_task`, both leave the link
  unchanged; absent keeps the link; a report never creates or unlinks.
- R-session-hook: hook sessions follow the event→status table, keyed by
  (workspace, agent_kind, agent_session_id), with the id-less rules.
- R-session-scan: scan sessions insert as `idle` with null boot id and
  `observed_at` times; existing rows only move `last_activity_at` forward and
  fill null `cwd`/`transcript_path`.
- R-audit-structural: audit rows only for `machine_create`,
  `workspace_create`, `workspace_link`, `session_create`, `session_end`,
  `session_interrupt`; activity-only reports write none.
- R-no-entity-write: no report writes `entities` (no version bump, no
  enrichment change).
- R-response: the response matches rest.md (workspace object, session,
  sessions, feature, interrupted_sessions, warnings).

## Acceptance criteria

- C1: Given s1 and s2 `running` on boot A, when a hook `start` for s1 arrives
  with boot B, then s2 is `interrupted`/`reboot`, s1 is `running` on B,
  `interrupted_sessions = 1` and the machine's boot id is B.
- C2: Given a workspace with a git snapshot, when a report omits `git`, then
  the snapshot and `git_state_at` are unchanged; with `git: null` both are
  cleared/reset.
- C3: Given 50 activity reports for one session, then `entities` rows,
  versions and `enrichment_status` are unchanged and no audit rows are added
  after the first report's structural rows.
- C4: Given a report with an invalid field or a read-only key, then the call
  fails and no table changes.
- C5: Given a scan report, then new sessions are `idle` with null boot id and
  a later hook report with a new boot id does not interrupt them.

## Approval and evidence

Approval: pending operator review.

Evidence: sources read in this session; no command run against the new code.

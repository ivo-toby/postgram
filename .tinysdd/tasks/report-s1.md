# Slice brief: report-s1

Status: draft

## Outcome and boundaries

Create the phase 1 schema and shared types.

1. `src/db/migrations/018_workspace_tracking.sql`: tables `machines`, `workspaces`, `agent_sessions`, `repositories` exactly as the cited data-model sections say. Include: `machines.alias` UNIQUE with CHECK `alias ~ '^[a-z0-9._-]{1,64}$'`; `workspaces` UNIQUE (machine_id, path), FK machine_id → machines(id), FK feature_id → entities(id) ON DELETE SET NULL, indexes on feature_id and repo_remote; `agent_sessions` FK workspace_id → workspaces(id) ON DELETE CASCADE, CHECKs on agent_kind and status, partial UNIQUE index on (workspace_id, agent_kind, agent_session_id) WHERE agent_session_id IS NOT NULL, index on (status) and on (workspace_id, last_activity_at DESC); `repositories` with remote text PK, release_on_merge boolean NOT NULL DEFAULT false, updated_at. Timestamps are timestamptz; created_at/updated_at default now(). Do not touch `entities`.
2. `src/types/workspaces.ts` with exactly these exported types (formatting may differ):

```ts
export type AgentKind = 'claude-code' | 'pi' | 'talon' | 'other';
export type SessionStatus = 'running' | 'idle' | 'ended' | 'interrupted';
export type SessionEvent = 'start' | 'activity' | 'stop' | 'end';
export type ReportSource = 'hook' | 'scan';
export type Risk = 'dirty' | 'unpushed' | 'no_upstream' | 'interrupted' | 'missing';
export type ReportWarning = 'feature_not_found' | 'feature_not_task';

export type MachineRow = {
  id: string; alias: string; hostname: string; connect_target: string | null;
  boot_id: string | null; last_seen_at: Date; created_at: Date; updated_at: Date;
};
export type WorkspaceRow = {
  id: string; machine_id: string; path: string; repo_remote: string | null;
  repo_root: string | null; branch: string | null; git_dirty_count: number | null;
  git_unpushed_count: number | null; git_has_upstream: boolean | null;
  git_state_at: Date | null; feature_id: string | null; missing_since: Date | null;
  last_activity_at: Date; created_at: Date; updated_at: Date;
};
export type AgentSessionRow = {
  id: string; workspace_id: string; agent_kind: AgentKind; agent_session_id: string | null;
  status: SessionStatus; boot_id: string | null; cwd: string | null;
  transcript_path: string | null; started_at: Date; last_activity_at: Date;
  ended_at: Date | null; end_reason: string | null;
};

export type GitSnapshot = {
  dirty_count: number | null; unpushed_count: number | null; has_upstream: boolean | null;
};
export type SessionView = {
  id: string; agent_kind: AgentKind; agent_session_id: string | null; status: SessionStatus;
  dormant: boolean; cwd: string | null; transcript_path: string | null; started_at: string;
  last_activity_at: string; ended_at: string | null; end_reason: string | null;
};
export type ResumeSessionView = {
  id: string; agent_kind: AgentKind; agent_session_id: string; status: SessionStatus;
  cwd: string | null; transcript_path: string | null; last_activity_at: string;
};
export type WorkspaceView = {
  id: string; machine: string; connect_target: string; path: string;
  repo_remote: string | null; branch: string | null; feature_id: string | null;
  last_activity_at: string; git: GitSnapshot | null; git_state_at: string | null;
  missing_since: string | null; risks: Risk[]; resume_session: ResumeSessionView | null;
  sessions: SessionView[];
};
export type ReportFeature = { id: string; title: string; stage: string | null };
export type SessionRef = { id: string; status: SessionStatus };
export type ReportResult = {
  workspace: WorkspaceView | null;
  session?: SessionRef;
  sessions?: SessionRef[];
  feature: ReportFeature | null;
  interrupted_sessions: number;
  warnings: ReportWarning[];
};
```

3. `src/util/audit.ts`: change the first parameter type to `Pool | PoolClient` (both from 'pg', type-only import). The body and all callers stay unchanged.
4. `tests/helpers/postgres.ts`: add `agent_sessions, workspaces, machines, repositories` to the TRUNCATE list in `resetTestDatabase`. Change nothing else.

Write the slice test `tests/integration/workspace-migration.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/workspace-report.feature.test.ts`, `specs/constitution.md`, `specs/constitution.approval.json`, anything under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `src/db/migrate.ts`, `src/util/audit.ts`, `tests/helpers/postgres.ts`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| migrations run | the four tables exist after createTestDatabase() | workspace-upsert | report-s1 |
| duplicate (machine_id, path) | insert fails with a unique violation | workspace-upsert | report-s1 |
| duplicate session id per workspace and kind | insert fails; same id with another agent_kind or a null id succeeds | session-hook | report-s1 |
| invalid alias, status or agent_kind | insert fails with a check violation | machine-upsert | report-s1 |
| appendAuditEntry with a PoolClient inside BEGIN/ROLLBACK | the audit row is rolled back | audit-structural | report-s1 |

The check `report-s1` runs `node changes/004-report-core/slice-check.mjs src/types/workspaces.ts src/util/audit.ts tests/helpers/postgres.ts tests/integration/workspace-migration.test.ts`: Vitest on the slice test and ESLint with zero allowed problems on the listed TypeScript files. It needs Docker for integration tests and is run by the controller on the host; report what you expect it to show.

## Stop conditions

- Stop and report if a cited excerpt contradicts this brief.
- Stop if the work would need a change to a protected file, a deletion or a write to `entities`.
- Report every file you created or changed.

## Slice test review contract

The JSON block must exactly match slice.json.testReview.

```json
{
  "schemaVersion": 1,
  "workflow": "slice-tests",
  "criteria": [
    {
      "id": "report-s1-tests",
      "requirementIds": [
        "machine-upsert",
        "workspace-upsert",
        "session-hook",
        "audit-structural"
      ],
      "question": "Do the slice tests prove the unique keys, checks, cascade/set-null foreign keys and that appendAuditEntry joins a client transaction?",
      "interfaces": [
        "src/db/migrate.ts",
        "src/util/audit.ts",
        "tests/helpers/postgres.ts"
      ],
      "testPaths": [
        "tests/integration/workspace-migration.test.ts"
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
    "id": "machine-upsert",
    "text": "Each report upserts its machine by alias with hostname and last_seen_at; the machine boot_id is set only by a hook report with a non-null boot id."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "workspace-upsert",
    "text": "A report upserts the workspace by machine and path with a trailing slash stripped; omitted repo keys keep stored values and null clears them; git null clears the snapshot, an omitted git keeps it and an object replaces it; missing_since is cleared; last_activity_at is now for hook reports and the newest observed time for scan reports."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "session-hook",
    "text": "Hook reports upsert the session keyed by workspace, agent kind and agent session id; start and activity set running, stop sets idle, end sets ended with ended_at and end_reason, and any non-end event clears ended_at and end_reason; id-less start inserts, other id-less events update the newest id-less session of that kind or insert one."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "audit-structural",
    "text": "Reports write audit rows only for machine_create, workspace_create, workspace_link, session_create, session_end and session_interrupt; activity-only reports write none."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.

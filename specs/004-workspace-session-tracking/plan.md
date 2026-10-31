# Implementation Plan: Workspace & Agent-Session Tracking

**Branch**: `004-workspace-session-tracking` | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-workspace-session-tracking/spec.md`

## Summary

Postgram learns where work happens. Coding-agent sessions on any machine report themselves through Claude Code hooks and a pi extension. Each report goes through `pgm here` to one transactional endpoint, which upserts the machine, the workspace (machine + worktree path + git snapshot) and the agent session. It detects reboots by a change of boot id. A feature is an existing task with `metadata.kind = 'feature'` and a delivery stage. The stage moves by hand, or forward automatically on PR events.

Activity data lives in dedicated operational tables, so heartbeats never touch versioned, embedded entities. `pgm where` and its action view turn this into a phone-friendly recovery list with ready-to-run resume commands. `pgm scan` bootstraps the work already in flight.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 22+ (LTS)
**Primary Dependencies**: Hono (REST), `@modelcontextprotocol/sdk` (MCP), `zod`, `neverthrow`, `pg`, `commander` (CLI). No new runtime dependencies.
**Storage**: PostgreSQL 16+. New migration `018_workspace_tracking.sql` adds `machines`, `workspaces`, `agent_sessions` and `repositories`. `entities` is unchanged. Features use task metadata.
**Testing**: Vitest:
- integration tests against Postgres via testcontainers (`tests/integration/workspace-service.test.ts`)
- contract tests for REST and MCP (`tests/contract/rest-api.test.ts`, `tests/contract/mcp-tools.test.ts`)
- CLI integration (`tests/integration/cli-pgm.test.ts`, plus a new `cli-where.test.ts`)
- unit tests for pure helpers (git parsing, remote normalization, stage transitions, resume rendering, path encoding)

**Target Platform**: The server runs on a Linux container. The CLI runs on macOS and Linux.
**Project Type**: Web service, plus a CLI workspace package (`cli/`), plus a small pi extension file.
**Performance Goals**:
- `pgm here` finishes in under 1 s end to end with the server reachable, with a hard 2 s cap.
- The report endpoint is under 50 ms p95.
- `GET /api/where` is under 200 ms p95 at personal scale (≤ 50 machines × workspaces, ≤ 5k sessions).

**Constraints**:
- `pgm here --hook` always exits 0 and prints nothing except an optional single context line on SessionStart.
- Git calls use `GIT_OPTIONAL_LOCKS=0`.
- No writes to `entities` on activity.

**Scale/Scope**: single user, 3 machines, ~10 concurrent sessions, ~7–20 active features.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | How |
|-----------|--------|-----|
| I. Spec before implementation | ✅ | `spec.md` approved by the user, including the dormancy revision. Any divergence found during implementation updates the spec in the same PR. |
| II. Service-layer canonical logic | ✅ | New `src/services/workspace-service.ts` (report transaction, link, lookup, where/actions grouping, risk computation) and `src/services/feature-service.ts` (stage set, PR events, stage derivation). REST, MCP and CLI are adapters. The CLI only does local concerns: git/boot-id resolution, disk checks, resume rendering. |
| III. Schema & migration discipline | ✅ | Numbered forward-only migration `018_workspace_tracking.sql` with no backfill. Typed query helpers co-located in the services. The `entities` versioning rules are unchanged. Stage updates use the existing optimistic version with an internal retry. |
| IV. Scoped security & auditability | ⚠️ waiver | Read/write scopes enforced in the service. Workspace visibility is inherited from the linked feature, and unlinked counts as personal. Structural changes are audited. **Activity refreshes are not audited.** See Complexity Tracking. No admin surface is added. |
| V. Verification with contract coverage | ✅ | Contract tests for every new REST route and MCP tool. Integration tests for the report transaction (including the reboot rule and "no entity write on activity"). CLI tests for `here` timeout and exit-0 behaviour. Sprite smoke test per quickstart. |

**Verification commands**: `npm run lint && npm run typecheck && npm test`, `npm run test --workspace @ivotoby/postgram-cli`, `npm run test:coverage` (80% gate), and the sprite smoke test in `quickstart.md`.

**Post-design re-check**: ✅. The design adds no ORM and no new dependency. Admin stays container-local. The only exception is the documented audit waiver.

## Project Structure

### Documentation (this feature)

```text
specs/004-workspace-session-tracking/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R11
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── rest.md
│   ├── mcp.md
│   └── cli.md
├── checklists/requirements.md
└── tasks.md             # /speckit.tasks (not yet created)
```

### Source Code (repository root)

```text
src/
├── db/migrations/018_workspace_tracking.sql     # new
├── services/
│   ├── workspace-service.ts                     # new: report tx, link, lookup, list, where/actions, risks
│   ├── feature-service.ts                       # new: create, setStage, addPullRequest, deriveStage, resolveShortId
│   └── task-service.ts                          # touch: default stage when metadata.kind === 'feature'
├── types/workspaces.ts                          # new: Machine, Workspace, AgentSession, Stage, Risk, WhereView
├── transport/
│   ├── rest.ts                                  # + /api/workspaces*, /api/machines, /api/repositories, /api/features*, /api/where
│   └── mcp.ts                                   # + workspace_report, workspace_lookup, workspace_link, feature_stage, feature_pr, where
└── config.ts                                    # + WORKSPACE_DORMANT_AFTER_DAYS

cli/src/
├── pgm.ts                                       # + here, hooks, worktree, where, scan, feature, machine, repo commands
├── client.ts                                    # + typed calls; per-request AbortSignal timeout
├── local/
│   ├── git-state.ts                             # new: R7 resolution
│   ├── boot-id.ts                               # new: R6
│   ├── marker.ts                                # new: R8 read/write .postgram/
│   ├── agent-sessions.ts                        # new: R9 Claude/pi session discovery + transcript existence
│   ├── claude-settings.ts                       # new: hooks install/uninstall diff+merge, cleanupPeriodDays
│   └── resume.ts                                # new: R5 templates + shell quoting
└── where-output.ts                              # new: human/phone layout + JSON

integrations/pi/postgram.ts                      # new: pi extension (R3)

skill/postgram/SKILL.md                          # + register/stage/worktree guidance for coding agents (FR-041)

tests/
├── integration/workspace-service.test.ts        # new
├── integration/feature-service.test.ts          # new
├── contract/rest-api.test.ts                    # extend
├── contract/mcp-tools.test.ts                   # extend
└── unit/{stage-transitions,remote-normalize}.test.ts
cli/tests/
├── here.test.ts, where-output.test.ts, resume.test.ts,
├── git-state.test.ts, claude-settings.test.ts, agent-sessions.test.ts

.env.example, docker-compose.yml, README.md, docs/  # + WORKSPACE_DORMANT_AFTER_DAYS, new CLI commands
```

**Structure Decision**: keep the existing single-service layout (`src/` server, `cli/` workspace package). Machine-local logic goes in a new `cli/src/local/` folder, so pure helpers are unit-testable without a server. The pi extension lives in `integrations/pi/` because it is distributed by copying, not as part of the npm CLI bundle. It is still included in the CLI package `files` so `pgm hooks install --pi` can copy it.

## Implementation Order (for /speckit.tasks)

1. Migration, types, and `workspace-service` report transaction, with tests for the reboot rule and "no entity write" (US2 core).
2. `feature-service` (stages, PRs, derivation, short-id) plus the task-service default (US3 core).
3. `where`/`actions` grouping and risks in the service. REST and MCP adapters plus contract tests (US1, US3, US6).
4. CLI local helpers (git, boot id, marker, resume), then `pgm here` with the timeout and exit-0 guarantee, then `pgm where` (US1, US2).
5. `pgm hooks install` (Claude) and the pi extension (US2).
6. `pgm worktree new`, `pgm feature …`, `pgm machine`, `pgm repo` (US4).
7. `pgm scan` (US5).
8. Skill update, docs, Docker/config propagation, sprite smoke test.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Constitution IV "audit everything": activity refreshes (`activity`/`stop` events that only update timestamps and git counts) are not written to `audit_log` | ~10 sessions × every turn × every day would produce tens of thousands of audit rows a month with no forensic value, drowning meaningful entries. All structural changes (create, link, end, interrupt, stage, PR, settings) **are** audited | Auditing every report: rejected for volume. Sampling: rejected because it is non-deterministic and confusing during forensics. A separate activity log table: possible later, but it adds a table with no consumer in phase 1. |

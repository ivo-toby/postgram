---
id: EPIC-search-cleanup-basket-VALIDATION
kind: validation_checklist
epic: EPIC-search-cleanup-basket
status: wave_003_reconciled
created_at: 2026-06-14
updated_at: 2026-06-14
---

# Planning Validation Checklist: EPIC-search-cleanup-basket

## Epic Readiness

- [x] Epic has concrete deliverables.
- [x] Definition of done is testable.
- [x] Non-goals are explicit.
- [x] Major risks and constraints are recorded.
- [x] Epic profile is recorded as `lite`, `standard`, or `full`.
- [x] Review mode and monitoring mode are recorded.

## Ticket And Task Structure

- [x] Each ticket folder has `ticket.md`.
- [x] Each ticket contains kanban folders.
- [x] Each task file has required frontmatter.
- [x] Each task file has required body sections.
- [x] Task files live in a status folder matching their status.

## Dependency And Conflict Soundness

- [x] Every task dependency references an existing task.
- [x] No dependency cycles exist.
- [x] Conflict domains are explicit.
- [x] Shared files, migrations, schemas, config, generated code, and shared
      tests are called out where relevant.

## Wave Readiness

- [x] Waves schedule tasks, not tickets.
- [x] Each wave records a strategy with profile, execution mode, review mode,
      monitoring mode, confidence, and rationale.
- [x] Execution mode is `bundled`, `hybrid`, or `parallel`.
- [x] Confirmation requirements are recorded when strategy requires them.
- [x] WAVE-001 user confirmation is recorded as
      `override WAVE-001 standard parallel`.
- [x] WAVE-002 user confirmation is recorded as
      `ok, full parallel for wave 2`.
- [x] Active-wave tasks can run concurrently only when dependencies,
      conflict-domain blockers, prerequisites, and blocked status allow it.
- [x] Stop conditions require reconciliation before the next wave starts.

## Orchestration Readiness

- [x] `orchestration.json` exists.
- [x] `orchestration.json` includes `schemaVersion: 1`.
- [x] `orchestration.json` records profile, review mode, and monitoring mode.
- [x] `orchestration.json` records wave strategy and override history.
- [x] Every planned task appears in orchestration state.
- [x] Branch, worker worktree, PR or patch, gate, branch freshness, feedback,
      and verification fields are represented.
- [x] Epic branch creation or verification before worker dispatch is recorded.
- [x] Activation artifact state is required to sync to the epic branch before
      task branches and worktrees are created.
- [x] One isolated worktree per repository-writing task is required before
      dispatch.
- [x] Monitoring execution mode is `manual` with adaptive cadence.
- [x] Monitoring fallback prompt is durable enough for a fresh controller to run
      the next heartbeat tick.
- [x] Monitoring stop condition and next check are recorded.

## Shared Context

- [x] `shared-context/index.md` exists.
- [x] Shared-context resources are focused.
- [x] Durable worker memory format is documented in task findings.
- [x] Controller reconciliation rules are documented in task findings and
      controller state.

## Text-Only Portability

- [x] Workflow does not require a CLI.
- [x] Workflow does not require scripts.
- [x] Workflow does not require Node.js or npm.
- [x] Repo-native verification commands are optional and project-specific.

## Review And Merge Gates

- [x] P1/P2 review policy is explicit.
- [x] Workers do not merge their own PRs.
- [x] Workers receive an assigned worktree path before starting.
- [x] Workers must not switch branches in the controller checkout.
- [x] Task PRs target the epic branch.
- [x] Stale task branches are rebased or merged with the latest epic branch
      before merge.
- [x] Relevant tests and review are rerun after material branch freshness
      updates.

## Planning Result

WAVE-002 is active after user confirmation. Heartbeat automation was attempted
again during activation but no dedicated automation/heartbeat tool was exposed;
the controller used manual direct agent polling for this wave. WAVE-002 is now
reconciled. WAVE-003 used manual direct worker polling, is now reconciled, and
WAVE-004 is ready with no user confirmation requirement.

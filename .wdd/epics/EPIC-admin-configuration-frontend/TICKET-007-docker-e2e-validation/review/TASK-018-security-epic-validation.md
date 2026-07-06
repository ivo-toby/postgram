---
id: TASK-018-security-epic-validation
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-007-docker-e2e-validation
wave: WAVE-011
slug: security-epic-validation
title: Security And Epic Validation
status: review
depends_on:
  - TASK-017-docker-first-run-no-cli
conflict_domains:
  - .wdd/epics/EPIC-admin-configuration-frontend/**
  - README.md
  - docs/**
  - docker-compose.yml
  - docker/**
  - tests/**
assigned_model_class: epicValidation
review_model_class: review
branch: codex/task/TASK-018-security-epic-validation
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/TASK-018-security-epic-validation
worktree_status: clean_pushed
pr: https://github.com/ivo-toby/postgram/pull/93
worker_thread_id: 019f39b8-b83d-7350-b93e-c037b63ab845
review_thread_id: 019f398f-98c3-7350-be3f-1cb4af8aab75
current_gate: review_passed_freshness_pending
branch_freshness: stale_dirty_wdd_conflicts_pending_refresh
verification:
  - npm run typecheck
  - npm test
  - npm run lint
  - npm run build
  - npm --prefix ui run typecheck
  - npm --prefix ui run test -- --run
  - npm --prefix ui run build
  - docker compose config
  - git diff --check
---

# TASK-018-security-epic-validation: Security And Epic Validation

## Status

review

## Parent Ticket

TICKET-007-docker-e2e-validation

## Wave

WAVE-011

## Objective

Run final security review, broad verification, hypothesis assessment, and epic
handoff preparation.

## Scope

- Included:
  - Security review of admin auth, sessions, MFA, CSRF, bootstrap, secrets,
    admin APIs, maintenance jobs, and Docker exposure.
  - Broad repository verification.
  - Update WDD validation artifacts.
  - Record whether the feasibility hypothesis is proven, partially proven, or
    rejected.
  - Prepare final PR/handoff notes.
- Excluded:
  - New feature implementation except narrowly scoped validation fixes.

## Non-Scope

- Do not mark the epic complete with unresolved P1/P2 security findings.

## Relevant Context

### Local Context

- All files touched by this epic.
- `.wdd/epics/EPIC-admin-configuration-frontend/**`

### Shared Context References

- `../../shared-context/index.md`
- `../../shared-context/resources/security-model.md`
- `../../shared-context/resources/testing-validation.md`

## Likely Files / Areas

- `.wdd/epics/EPIC-admin-configuration-frontend/validation-checklist.md`
- `.wdd/epics/EPIC-admin-configuration-frontend/epic-validation.md`
- `.wdd/epics/EPIC-admin-configuration-frontend/final-pr.md`
- `README.md`
- `ui/src/components/admin/AdminDashboard.tsx`
- `ui/src/components/admin/AdminConfig.tsx`
- `ui/src/components/admin/AdminMaintenance.tsx`
- `ui/src/lib/adminApi.ts`
- `docker-compose.yml`
- `docker/postgram-ensure-secrets.sh`
- `docker/postgram-entrypoint.sh`
- `tests/unit/docker-first-run.test.ts`

## Dependencies

- TASK-017-docker-first-run-no-cli

## Conflict Domains

- `.wdd/epics/EPIC-admin-configuration-frontend/**`
- `README.md`
- `docs/**`

## Assigned Model Class

epicValidation

## Branch

codex/task/TASK-018-security-epic-validation

## Worker Worktree

/Users/ivo.toby/workspace/postgram/.worktrees/TASK-018-security-epic-validation

## PR / Patch Reference

Draft PR #93: https://github.com/ivo-toby/postgram/pull/93

Review requested from Dewey (`019f398f-98c3-7350-be3f-1cb4af8aab75`) in
submission `019f39ca-0519-7b52-b809-b87323bb4ec5`, then updated to the final
worker head in submission `019f39cd-142a-7630-a41c-fb3c1433e979`.

## RED-GREEN TDD Plan

### RED

Run broad validation and security review to surface remaining failures or
unproven claims.

### GREEN

Address only validation-blocking issues or route them as explicit follow-ups if
non-blocking.

### REFACTOR

Keep final artifacts concise and evidence-based.

## Implementation Notes

- Treat this as a validation and review task, not a feature-building task.
- Include exact verification evidence in completion notes.
- Include the WAVE-008 frontend admin surfaces in the final security review:
  `AdminDashboard`, `AdminConfig`, API-key UI, audit/stats/status panels, and
  the shared `ui/src/lib/adminApi.ts` client.
- Confirm browser storage does not contain admin session tokens, bootstrap
  tokens, TOTP seeds, provider secrets, one-time API-key plaintext, auth
  headers, or reusable token prefixes after auth, dashboard, config, and
  maintenance UI flows.
- Validate provider-config redaction/write-only behavior, stale-validation
  apply blocking, restart/reembed warnings, one-time API-key plaintext display,
  preview-before-apply maintenance controls, step-up gating, safe job summary
  rendering, and preservation of all dashboard panels after TASK-016.
- Include the WAVE-009 maintenance UI specifics: a fresh matching
  `previewJobId` before apply, recent step-up before apply, scoped idempotency
  behavior, `/admin/api/jobs/:jobId` polling, transient polling recovery,
  in-flight request-scope locking, `llm-extraction` edge-prune constraint, and
  no rendering of provider bodies, auth headers, token prefixes, ciphertext,
  arbitrary validation metadata, or hidden secret-derived material.
- Treat the Docker no-CLI claim as proven only if TASK-017 recorded a
  clean-volume browser smoke for bootstrap/login/MFA, Config tab redaction,
  API-key creation, dashboard status, and a safe maintenance dry-run without
  normal `pgm-admin` use.
- Include the WAVE-010 Docker specifics: `postgram-secrets` persistent secret
  generation for `postgres-password`, `admin-mfa-secret-key`, and
  `admin-settings-encryption-key`; entrypoint loading before server bind;
  strict `ADMIN_SETTINGS_ENCRYPTION_KEY` parsing; fail-closed startup when admin
  key material is missing/invalid; and `DATABASE_URL` construction from the
  Postgres secret when absent.
- Recheck the WAVE-010 upgrade fixes: legacy Compose installs with initialized
  `pgdata` and `POSTGRES_PASSWORD` must keep database access, and OpenAI-backed
  installs with `OPENAI_API_KEY` but blank `EMBEDDING_PROVIDER` must keep the
  OpenAI embedding provider instead of silently switching to Ollama.
- Verify the no-normal-CLI claim remains scoped: browser Admin UI bootstrap,
  MFA, provider secret entry, API-key creation, dashboard inspection, and safe
  maintenance dry-run are the supported happy path; `pgm-admin` remains
  documented only as emergency/advanced fallback.

## Durable Memory Notes To Consider

- Store concise durable memory for the final outcome, root causes, constraints,
  and verified no-CLI Docker path.

## Task-Level Definition of Done

- [ ] Security review has no unresolved P1/P2 findings.
- [ ] Broad verification evidence is recorded.
- [ ] Hypothesis result is explicit.
- [ ] Final WDD validation artifacts are ready.

## Validation Steps

- `npm run typecheck`
- `npm test`
- `npm run lint`
- `npm run build`
- `npm --prefix ui run typecheck`
- `npm --prefix ui run test -- --run`
- `npm --prefix ui run build`
- `docker compose config`
- clean-volume Docker/browser smoke replay or explicit review of TASK-017
  recorded smoke evidence
- `git diff --check`

## Verification Evidence

- Worker evidence is in PR #93 at final head
  `b9a19e946a1efa7e907e333556a4679ad2c12acf`.
- Controller verification at 2026-07-06T23:33:02Z:
  `git diff --check` passed in the assigned task worktree, PR #93 exists, and
  the worktree is clean/pushed.
- PR #93 is currently `DIRTY`; local merge-tree conflicts are limited to WDD
  controller artifacts (`TASK-018-security-epic-validation.md`,
  `controller-state.md`, and `orchestration.json`). Final branch freshness
  refresh and verification are required before merge.
- Ramanujan returned `DONE_WITH_CONCERNS`: no unresolved P1/P2 security
  findings, production audits clean, and only P3/non-blocking lint/dev-tooling
  audit concerns remain.

## Review Feedback

### P1

- None.

### P2

- None.

### P3

- Dewey noted `.wdd/epics/EPIC-admin-configuration-frontend/epic-validation.md`
  labels the TASK-017 upgrade blockers as P1 in one spot even though they were
  P2.
- Dewey noted the draft final PR body should include the root full-audit
  dev-tooling caveat alongside the UI dev-audit caveat.

## Completion Notes

- Dewey returned `REVIEW_PASS` for PR #93 at final head `b9a19e9`. Final branch
  freshness is still required because PR #93 is dirty on WDD/controller
  artifacts.

---
id: TASK-018-security-epic-validation
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-007-docker-e2e-validation
wave: WAVE-011
slug: security-epic-validation
title: Security And Epic Validation
status: todo
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
worker_worktree: null
worktree_status: unassigned
pr: null
worker_thread_id: null
review_thread_id: null
current_gate: not_started
branch_freshness: unknown
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

todo

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

None assigned yet.

## PR / Patch Reference

None yet.

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

- Not run yet.

## Review Feedback

### P1

- None.

### P2

- None.

### P3

- None.

## Completion Notes

- None yet.

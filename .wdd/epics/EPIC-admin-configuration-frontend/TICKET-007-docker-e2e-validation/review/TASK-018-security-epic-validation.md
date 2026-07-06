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
worktree_status: review_ready
pr: pending
worker_thread_id: null
review_thread_id: null
current_gate: review_ready
branch_freshness: current_at_activation
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

Pending draft PR creation against `codex/epic/admin-configuration-frontend`.

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

- [x] Security review has no unresolved P1/P2 findings.
- [x] Broad verification evidence is recorded.
- [x] Hypothesis result is explicit.
- [x] Final WDD validation artifacts are ready.

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

Fresh TASK-018 validation on 2026-07-06 UTC:

- Pre-edit worktree/branch preflight: confirmed cwd
  `/Users/ivo.toby/workspace/postgram/.worktrees/TASK-018-security-epic-validation`,
  branch `codex/task/TASK-018-security-epic-validation`, and presence of the
  task file, `orchestration.json`, and `controller-state.md`.
- `git fetch origin`: passed.
- `git rev-list --left-right --count origin/codex/epic/admin-configuration-frontend...HEAD`:
  reported `1 0` before TASK-018 artifact commits.
- `git merge-tree --write-tree origin/codex/epic/admin-configuration-frontend HEAD`:
  returned tree `80b719f3f2e9fdf46aae650b26c478235ac3e436`.
- `npm ci`: completed. Initial production audit found runtime dependency
  advisories; fixed with non-force `npm audit fix`.
- `npm --prefix ui ci`: completed. Initial production audit found
  markdown/linkify advisories; fixed with non-force `npm --prefix ui audit fix`.
- `npm audit --omit=dev --audit-level=high`: passed after lockfile refresh,
  0 vulnerabilities.
- `npm --prefix ui audit --omit=dev --audit-level=high`: passed after
  lockfile refresh, 0 vulnerabilities.
- Dependency-fix evidence: root runtime tree now uses
  `@hono/node-server@1.19.14`, `hono@4.12.28`, `fast-uri@3.1.3`, and
  `path-to-regexp@8.4.2`; UI markdown runtime tree now uses
  `markdown-it@14.3.0` and `linkify-it@5.0.2`.
- `npm run typecheck`: passed, including `@ivotoby/postgram-cli` typecheck.
- `npm test`: passed, 45 test files and 491 tests.
- `npm run build`: passed.
- `npm --prefix ui run typecheck`: passed.
- `npm --prefix ui run test -- --run`: passed, 15 test files and 125 tests.
- `npm --prefix ui run build`: passed with the existing Vite large-chunk
  warning.
- `docker compose config >/tmp/task018-docker-compose-config.yml`: passed.
- `jq empty .wdd/epics/EPIC-admin-configuration-frontend/orchestration.json`:
  passed.
- `git diff --check`: passed.
- `npm run lint`: failed with 22 existing repo-wide lint errors outside
  TASK-018 product changes: older unsafe assignments, async test helpers
  without `await`, missing `react-hooks/exhaustive-deps` rule setup, UI
  floating promises/unnecessary assertions, `tailwind.config.js` `require`
  globals, and `ui/vite.config.ts` project-service inclusion.
- Full `npm audit --audit-level=high`: exited 0 with remaining moderate/low
  dev-tooling advisories only.
- Full `npm --prefix ui audit --audit-level=high`: failed on dev-tooling
  Vitest/Vite/esbuild advisories that require a breaking
  `npm audit fix --force`; production audit is clean.

## Review Feedback

### P1

- None.

### P2

- None.

### P3

- Repo-wide `npm run lint` remains blocked by existing lint baseline unrelated
  to TASK-018 product behavior.
- Full UI dev dependency audit remains blocked by Vitest/Vite/esbuild
  dev-tooling advisories requiring a breaking toolchain upgrade; production
  audit is clean.

## Completion Notes

- Final security review found no unresolved P1/P2 security issue in the admin
  auth/session/MFA/CSRF/bootstrap/secrets/admin API/maintenance/frontend
  storage/Docker surfaces.
- Applied narrowly scoped production audit fixes through non-force lockfile
  updates in `package-lock.json` and `ui/package-lock.json`.
- Reviewed WAVE-010 Docker gates: clean-volume browser smoke evidence, legacy
  `POSTGRES_PASSWORD` upgrade preservation, OpenAI provider default
  preservation, admin key fail-closed behavior, Config secret redaction after
  restart, browser storage non-persistence, and emergency `pgm-admin` fallback
  wording.
- Hypothesis result: proven for the supported happy path. The browser Admin UI
  covers bootstrap, MFA, provider configuration, API-key creation, dashboard
  inspection, and safe maintenance dry-runs without normal `pgm-admin` use;
  advanced/emergency CLI operations remain intentionally outside the normal
  path.
- Created `epic-validation.md` and `final-pr.md`; updated
  `validation-checklist.md`, `wave-plan.md`, and TICKET-007 state.

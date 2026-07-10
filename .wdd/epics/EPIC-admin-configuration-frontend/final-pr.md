---
id: EPIC-admin-configuration-frontend-FINAL-PR
kind: final_pr_handoff
epic: EPIC-admin-configuration-frontend
status: draft_pr_open
created_at: 2026-07-06
updated_at: 2026-07-06
---

# Final PR Handoff: EPIC-admin-configuration-frontend

## Proposed PR

- Base: `main`
- Head: `codex/epic/admin-configuration-frontend`
- URL: https://github.com/ivo-toby/postgram/pull/94
- State: draft/open
- Draft title: `feat: add safe admin configuration frontend`
- Open after: WAVE-011 reconciliation and epic validation pass, completed at
  2026-07-06T23:56:58Z.
- Opened at: 2026-07-06T23:59:01Z from head
  `a7343934a2a451d80eb40db7941668e223ac857d`.

## Summary

This epic adds a hardened browser admin plane for Postgram. It separates admin
auth from ordinary API-key bearer auth, adds first-run bootstrap with MFA,
builds typed admin APIs for diagnostics, provider configuration, API-key
management, audit/stats, jobs, and approved maintenance operations, adds the
protected admin UI, and proves the Docker happy path without normal
`pgm-admin` use.

## Hypothesis Assessment

Proven for the supported happy path:

- Docker starts with generated persistent installation secrets.
- The operator reads a one-time bootstrap token from local logs.
- Browser admin setup creates the first admin and completes MFA.
- Admin UI configures provider settings/secrets with redaction and step-up.
- Admin UI creates a Postgram API key with one-time plaintext display.
- Admin dashboard shows health, queue, stats, config/model/job, key, and audit
  state.
- Admin maintenance can run a safe dry-run and poll job status.
- No admin session token, bootstrap token, TOTP seed, provider secret,
  one-time API-key plaintext, auth header, or reusable token prefix is stored
  in browser local/session storage in the covered flows.

Not claimed:

- Web parity with all `pgm-admin` commands.
- Raw SQL or shell command execution from the web UI.
- Browser-managed database targets, bind hosts, ports, or production proxy
  trust policy.
- Completed admin OIDC/SSO or MFA recovery.

## Verification Summary

Fresh TASK-018 verification:

- `npm run typecheck`: passed.
- `npm test`: passed, 45 files and 491 tests.
- `npm run build`: passed.
- `npm --prefix ui run typecheck`: passed.
- `npm --prefix ui run test -- --run`: passed, 15 files and 125 tests.
- `npm --prefix ui run build`: passed with existing chunk-size warning.
- `docker compose config`: passed.
- `git diff --check`: passed.
- `jq empty .wdd/epics/EPIC-admin-configuration-frontend/orchestration.json`:
  passed.
- Root and UI production audits after non-force fixes:
  `npm audit --omit=dev --audit-level=high` and
  `npm --prefix ui audit --omit=dev --audit-level=high` both passed with 0
  vulnerabilities.
- WAVE-011 reconciliation confirmed PR #93 merged, TASK-018 is in `done/`,
  shared context is reconciled, and monitoring is stopped.
- Final controller validation at 2026-07-06T23:56:58Z passed: orchestration
  JSON parse, WDD conflict-marker scan, `git diff --check`, root production
  audit, UI production audit, root typecheck, UI typecheck, TASK-018 worktree
  cleanup check, and final PR existence check. The epic branch is `0 233`
  against `origin/main`.

Non-blocking concerns to mention in the final PR:

- `npm run lint` still fails on existing repo-wide lint baseline unrelated to
  TASK-018 product behavior.
- Full UI audit still has dev-tooling advisories that require a breaking
  Vitest/Vite upgrade; production audit is clean.
- Full root audit still has moderate/low dev-tooling advisories; production
  audit is clean.

## Security Notes For Reviewers

- Admin authority is a cookie-session plus active-MFA boundary, never ordinary
  API-key or MCP OAuth bearer auth.
- Unsafe admin methods require `X-CSRF-Token`; sensitive mutations require
  recent TOTP step-up.
- Provider secrets are encrypted in DB with an outside-database installation
  key and remain write-only after save.
- Maintenance applies require preview evidence, scoped idempotency, step-up,
  jobs, and safe summaries.
- Docker defaults remain loopback-bound; reverse-proxy exposure remains an
  operator deployment decision and still requires the bootstrap token.

## Draft PR Body

```markdown
## Summary

- add a separate MFA-backed admin plane for Postgram
- add typed admin APIs for diagnostics, provider config, API keys, audit/stats,
  jobs, and approved maintenance flows
- add the protected admin UI for bootstrap/login/MFA, dashboard, Config, API
  keys, audit/stats, and maintenance dry-runs
- add Docker first-run secret generation and docs for the no-normal-CLI happy
  path

## Security

- ordinary API-key and MCP OAuth bearer tokens do not authorize admin routes
- admin sessions use HttpOnly cookies plus CSRF, with recent MFA step-up for
  sensitive mutations
- provider secrets stay encrypted/write-only and are redacted from reads,
  audit/job summaries, logs, and browser storage
- maintenance applies require dry-run preview evidence, idempotency, step-up,
  jobs, and safe summaries

## Verification

- npm run typecheck
- npm test
- npm run build
- npm --prefix ui run typecheck
- npm --prefix ui run test -- --run
- npm --prefix ui run build
- docker compose config
- git diff --check
- npm audit --omit=dev --audit-level=high
- npm --prefix ui audit --omit=dev --audit-level=high

## Known Non-Blocking Concerns

- npm run lint still fails on existing repo-wide lint baseline
- full UI audit still has dev-tooling advisories that require a breaking
  Vitest/Vite upgrade; production audit is clean
- full root audit still has moderate/low dev-tooling advisories; production
  audit is clean
```

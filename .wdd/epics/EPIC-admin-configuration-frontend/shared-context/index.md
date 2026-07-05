---
id: EPIC-admin-configuration-frontend-SHARED-CONTEXT
kind: shared_context_index
epic: EPIC-admin-configuration-frontend
updated_at: 2026-07-05
---

# Shared Context: EPIC-admin-configuration-frontend

## Overview

This epic explores and implements a hardened web administration plane for
Postgram. The central risk is that admin UI convenience could turn Postgram into
an unsafe web-exposed single point of failure, so workers should read the
security and architecture resources before changing auth, admin APIs,
configuration, maintenance jobs, or Docker behavior.

## Resource Index

| Resource | Summary | Read When |
|----------|---------|-----------|
| resources/admin-surface-inventory.md | Current `pgm-admin` command inventory and initial web eligibility | Planning or implementing admin API/UI scope |
| resources/architecture.md | Proposed admin-plane architecture, config model, and service boundaries | Touching backend, config, Docker, or UI architecture |
| resources/api-contracts.md | Admin API route and response conventions for this epic | Adding or consuming admin endpoints |
| resources/migration-config-notes.md | Persistence, runtime settings, secret storage, and Docker config notes | Touching migrations, settings, secrets, or deployment |
| resources/security-model.md | Threat model seed and hard security requirements | Touching auth, sessions, MFA, admin APIs, secrets, or bootstrap |
| resources/testing-validation.md | Verification strategy and expected test coverage | Planning tasks, writing tests, or validating the epic |

## Key Decisions

- Epic profile is `full` because the work touches auth, secrets, privileged
  mutations, persistence, Docker, and broad UI.
- Admin auth must be separate from ordinary Postgram API-key bearer auth.
- Existing MCP connector OAuth is not an admin-login system. If admin
  OAuth/OIDC is added, it must be modeled separately.
- Web admin implementation should refactor shared services from `pgm-admin`
  behavior rather than shelling out to the CLI.
- Raw SQL and generic shell command execution are out of scope for the web UI.
- WAVE-001 first-scope admin surface is diagnostics plus API-key
  create/list/revoke, audit query, stats/health, read-only model list, and
  safe config read/validate. Destructive maintenance operations wait for job,
  dry-run, confirmation, step-up, and audit foundations.
- First-run bootstrap posture is a generated one-time token delivered through a
  trusted local operator channel, stored hash-only, required before first admin
  creation, and invalidated after first active MFA-backed admin setup.
- Runtime configuration should be installation-wide DB-backed settings plus
  encrypted write-only secrets. One minimal installation encryption key may
  remain outside the DB through env/Docker secret.
- Provider/config applies use explicit save/validate/apply states. Extraction
  tuning can reload the worker once implemented; embedding identity changes are
  migration-sensitive and require dedicated dry-run/apply jobs.

## Key Warnings

- First-run bootstrap is a takeover risk if exposed publicly before an admin
  user exists.
- Runtime provider settings are currently env-driven and constructed at
  startup; DB-backed config needs explicit lifecycle design.
- Embedding dimension changes are data migrations, not simple settings edits.
- Same-dimension embedding provider/model changes still invalidate existing
  embedding spaces and require migration/reembedding treatment.
- Secrets stored through the UI create backup, encryption, and rotation
  obligations.
- `LLM_REQUEST_TIMEOUT_MS` is documented/Docker-wired but currently read
  directly from `process.env`; formalize it before admin UI ownership.

## Known Constraints

- `docker-compose.yml` currently starts Postgres, backend, and UI separately.
- The existing UI stores API keys in localStorage and cannot be reused as an
  admin auth boundary.
- Current Compose binds backend/UI to loopback by default, but reverse proxies
  can still expose setup. Loopback binding is not the admin security boundary.
- Runtime configuration value changes must update Docker and deployment-facing
  docs in the same change.
- The epic branch convention is `codex/epic/admin-configuration-frontend`.
- Wave 1 is a bundled feasibility/security gate. Broad implementation should
  start only after its reconciled decisions are read and the next wave is
  explicitly confirmed.

## Reconciliation History

### WAVE-001 Feasibility And Security Gate

- Status: done and reconciled on 2026-07-05.
- PR: https://github.com/ivo-toby/postgram/pull/78, merged at
  2026-07-05T12:39:56Z.
- Go/no-go: go for implementation, with a separate admin auth/session/MFA plane
  and no reuse of ordinary API-key bearer auth as admin identity.
- First implementation wave: TASK-004-admin-auth-persistence is ready for user
  confirmation as WAVE-002.
- Required carry-forward gates: TASK-004/TASK-005/TASK-006 must preserve the
  bootstrap ownership split, and TASK-010 must prove provider URL/egress/SSRF
  safety for admin-configured provider endpoints.

## Recent Durable Memory

- Durable memory `1f10a9c4-432b-42a2-a5f0-32505100e756`: this full-profile
  epic exists to prove whether `pgm-admin` and env-file operations can move
  into a hardened web admin plane without an unsafe single point of failure.
- Postgram's commercial direction favors managed private instances and private
  knowledge-base / private-intranet positioning.
- Existing OAuth/DCR support is opt-in for native remote MCP connectors and is
  live-bound to source API keys.
- Search-cleanup work added audited backend mutations plus API-key-scoped UI
  localStorage patterns, but localStorage is not a security boundary for admin.

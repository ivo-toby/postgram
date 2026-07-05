---
id: EPIC-admin-configuration-frontend-RESOURCE-security-model
kind: shared_context_resource
epic: EPIC-admin-configuration-frontend
resource: security-model
updated_at: 2026-07-05
---

# Shared Context Resource: Security Model

## Purpose

Seed the threat model and hard requirements for the admin frontend.

## Summary

The admin frontend is a high-value target because it can create API keys,
change providers and secrets, trigger expensive jobs, mutate memory/graph data,
and potentially affect every agent connected to the instance. Treat the admin
plane like an operations console, not a convenience page.

## Threats To Cover

- First-run takeover by a remote visitor before the real operator creates an
  admin user.
- Brute-force or credential-stuffing against the admin login.
- Session theft or fixation.
- CSRF against destructive admin endpoints.
- XSS leading to admin action execution.
- Ordinary API key or OAuth token being accepted as admin authority.
- MFA bypass, reset abuse, or weak recovery path.
- Secret disclosure through API responses, logs, browser storage, audit rows,
  or backups.
- Dangerous operation misuse: broad purge, reembedding, reextraction, edge
  pruning, model migration, or memory grooming.
- Long-running job confusion: repeated clicks, duplicate jobs, lost progress,
  unclear partial failure, or hidden cost.
- Public exposure through Docker/reverse proxy defaults.

## Hard Requirements

- Admin auth must not use localStorage API keys.
- Admin sessions should use HttpOnly, SameSite cookies with secure settings
  when served over HTTPS.
- Mutating admin endpoints must require CSRF protection.
- Login, MFA, and sensitive mutation endpoints must be rate-limited.
- Passwords must be hashed with Argon2id or an equivalently strong password
  hashing strategy.
- Password policy must reject obviously weak passwords.
- MFA must be required for the supported production/admin posture.
- Step-up auth or recent re-auth must protect secret changes, key creation,
  key revocation, destructive maintenance, and broad data operations.
- Ordinary API keys and OAuth access tokens must receive 401/403 on admin
  endpoints.
- Secrets must be write-only after storage and redacted in logs, audit, API
  responses, and UI.
- Every admin mutation must write an audit event with actor, operation, target,
  request summary, result, and failure where appropriate.
- Raw SQL and shell execution must not be web-exposed.

## Bootstrap Requirements

The bootstrap design must prove:

- Only the legitimate operator can create the first admin account.
- Setup cannot be claimed remotely just because no admin exists yet.
- The bootstrap token or equivalent secret expires or is invalidated after use.
- Bootstrap attempts are logged and rate-limited.
- The UI clearly signals whether the instance is unbootstrapped, locked,
  configured, or misconfigured.

Candidate bootstrap patterns for planning:

- Loopback-only setup wizard by default.
- Generated one-time bootstrap token shown through a trusted local channel.
- Docker secret or generated persistent volume secret.
- Reverse-proxy aware setup mode with explicit operator confirmation.

The planner must choose one pattern and document tradeoffs before
implementation.

## OAuth/OIDC Boundary

Existing OAuth/DCR is for native remote MCP connectors. It lets external clients
obtain OAuth tokens that resolve to an API-key-derived `AuthContext`.

Admin OAuth/OIDC login, if implemented, must be separate:

- Different tables or clearly separate records.
- Different routes and issuer/client semantics as needed.
- Different session creation flow.
- No path where MCP connector OAuth grants become admin sessions.

## Durable Memory

### First-Run Bootstrap Is The Highest-Risk UX

- Source task: epic creation
- Source PR/branch: none
- Status: planning
- Summary: The first admin setup flow must prevent public takeover before any
  admin user exists.
- Why it matters: A web setup wizard that appears safe on localhost can become
  dangerous when deployed behind a public reverse proxy.
- Affected files or areas: Docker defaults, admin auth routes, setup UI,
  documentation, deployment guidance.
- Follow-up implications: Bootstrap design should be a first-wave gate.

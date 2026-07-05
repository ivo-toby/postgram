---
id: EPIC-admin-configuration-frontend-RESOURCE-api-contracts
kind: shared_context_resource
epic: EPIC-admin-configuration-frontend
resource: api-contracts
updated_at: 2026-07-05
---

# Shared Context Resource: API Contracts

## Purpose

Record admin API contract conventions for this epic.

## Summary

Admin endpoints must be a dedicated browser-session API, separate from the
existing `/api/*` bearer API used by agents and the existing `/oauth/*` MCP
connector flow. Use typed request/response schemas, explicit security headers,
CSRF protection for mutations, and audit-friendly operation names.

## Route Shape

Preferred namespace:

- `/admin/api/bootstrap/*` for first-run setup and bootstrap status.
- `/admin/api/session/*` for login, MFA challenge, logout, current session, and
  CSRF token refresh.
- `/admin/api/*` for authenticated admin operations.

Avoid:

- Reusing ordinary `/api/*` bearer auth for admin operations.
- Accepting Postgram API keys as admin credentials.
- Adding generic command execution routes.
- Adding SQL routes.

WAVE-001 route implications:

- Bootstrap status may be public but must expose only state, never token
  material.
- First admin creation must require bootstrap token proof and MFA enrollment.
- Admin routes should ignore/reject `Authorization: Bearer` API keys or MCP
  OAuth access tokens rather than treating them as admin credentials.
- Maintenance routes must be typed operation routes, not CLI command passthrough
  routes.

## Response Shape

Use the existing app error response style where practical:

- Success payloads should be JSON objects with stable top-level keys.
- Validation errors should identify the invalid field where feasible.
- Mutations should include the operation result and enough metadata for UI
  confirmation, but never return stored secret values.
- Dry-run responses should be explicit: `dryRun: true`, counts, target scope,
  and candidate summaries.
- Long-running operations should return a job ID and initial status rather than
  blocking request threads.
- Secret fields must be write-only. Read responses may include
  `configured: true`, validation status, timestamps, provider identity, and
  safe metadata, but never plaintext, hashes, ciphertext, or token prefixes
  unless a later security review explicitly allows a non-sensitive prefix.

## Security Contract

Admin API clients should rely on:

- HttpOnly admin session cookie.
- CSRF token for unsafe methods.
- SameSite cookie settings.
- Optional step-up token or recent-auth marker for sensitive actions.

Endpoints should reject:

- Missing admin session.
- Expired admin session.
- Missing or invalid CSRF token on mutation.
- Ordinary Postgram API-key bearer token.
- MCP OAuth bearer token.
- Missing or stale step-up state for sensitive mutations.

## Audit Contract

Every admin mutation should record:

- Admin actor ID.
- Operation name.
- Target ID or target scope.
- Safe request summary.
- Result summary.
- Failure summary where relevant.
- Whether the request was dry-run, apply, retry, cancel, or rollback where that
  applies.

Existing `audit_log` can be extended or complemented, but admin actor
attribution must not be hidden inside free-form details only.

## Open Contract Questions

- Should the admin route namespace be served by the backend only, or should the
  UI have a separate `/admin` build route?
- What job response model is needed for maintenance operations?

## WAVE-001 Contract Preferences

- Prefer a synchronizer CSRF token stored with the server-side admin session
  unless a later route task chooses and tests a different pattern.
- Prefer job responses for any operation that calls providers, scans many rows,
  deletes data, changes embedding identity, or may outlive a short HTTP
  request.
- Prefer separate dry-run and apply endpoints or an explicit `mode` field with
  strict enum validation. Apply requests should reference recent dry-run/job
  evidence where practical.

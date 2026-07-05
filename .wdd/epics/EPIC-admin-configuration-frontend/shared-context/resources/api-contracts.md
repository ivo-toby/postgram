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

## Audit Contract

Every admin mutation should record:

- Admin actor ID.
- Operation name.
- Target ID or target scope.
- Safe request summary.
- Result summary.
- Failure summary where relevant.

Existing `audit_log` can be extended or complemented, but admin actor
attribution must not be hidden inside free-form details only.

## Open Contract Questions

- Should the admin route namespace be served by the backend only, or should the
  UI have a separate `/admin` build route?
- Should CSRF tokens be double-submit cookie, synchronizer token, or session
  stored token?
- What job response model is needed for maintenance operations?

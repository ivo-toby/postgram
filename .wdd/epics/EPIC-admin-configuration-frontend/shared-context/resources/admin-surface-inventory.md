---
id: EPIC-admin-configuration-frontend-RESOURCE-admin-surface-inventory
kind: shared_context_resource
epic: EPIC-admin-configuration-frontend
resource: admin-surface-inventory
updated_at: 2026-07-05
---

# Shared Context Resource: Admin Surface Inventory

## Purpose

Seed the inventory of current `pgm-admin` capabilities so later WDD planning can
decide which operations belong in the web admin plane.

## Summary

`src/cli/admin/pgm-admin.ts` is currently the operational source of truth for
privileged management. The web implementation should not shell out to this CLI.
Instead, workers should extract or reuse service-layer logic and keep CLI and
web behavior consistent through shared services and tests.

## Command Inventory

Initial command surface:

- `key create`, `key list`, `key revoke`
- `audit`
- `model list`, `model set-active`
- `reembed`
- `reextract`
- `prune-edges`
- `validate-edges`
- `improve-graph`
- `link-neighbors`
- `stats`
- `embeddings migrate`
- `memory groom`
- `memory groom-durable`
- `memory apply-durable-grooming`
- `purge`
- `sql`

## Initial Web Eligibility

Likely safe web candidates with normal admin auth:

- API-key create/list/revoke, with one-time plaintext key display.
- Audit query, with filters and pagination.
- Stats, health, queue state, and read-only model list.
- Configuration read and validation endpoints that do not reveal stored
  secrets.

Likely safe only with dry-run, explicit confirmation, audit, and step-up auth:

- `model set-active`
- `reembed`
- `reextract`
- `improve-graph`
- `link-neighbors`
- `prune-edges`
- `validate-edges`
- `embeddings migrate`
- `memory groom`
- `memory groom-durable`
- `memory apply-durable-grooming`
- `purge`

Likely out of scope for web:

- `sql`
- Generic shell execution.
- Any operation that cannot be expressed as typed input plus service-layer
  authorization, validation, audit, and bounded execution.

## Details

Important behavior to preserve when moving operations behind admin APIs:

- CLI commands already use explicit scoping flags such as `--all`, `--type`,
  `--id`, `--only-failed`, `--limit`, and `--dry-run` for dangerous or broad
  operations.
- Some commands depend on runtime provider configuration and external model
  availability.
- Some commands write audit entries with operation names that should remain
  recognizable.
- Some operations are long-running or expensive and should become jobs rather
  than blocking HTTP requests.
- The CLI direct-DB model does not automatically translate into a safe
  browser-facing API model.

## Durable Memory

### Admin Web Eligibility Is Not CLI Parity

- Source task: epic creation
- Source PR/branch: none
- Status: planning
- Summary: The safe web surface should be a curated admin API, not a
  one-to-one CLI wrapper.
- Why it matters: CLI commands assume trusted local operator execution; web
  endpoints need browser-session security, CSRF protection, typed validation,
  audit, rate limiting, and bounded execution.
- Affected files or areas: `src/cli/admin/pgm-admin.ts`, admin API routes,
  admin services, UI admin pages, tests.
- Follow-up implications: WDD planning should split inventory/design from
  implementation and exclude raw SQL from the web.

---
id: EPIC-admin-configuration-frontend-RESOURCE-admin-surface-inventory
kind: shared_context_resource
epic: EPIC-admin-configuration-frontend
resource: admin-surface-inventory
updated_at: 2026-07-05
---

# Shared Context Resource: Admin Surface Inventory

## Purpose

Record the authoritative WAVE-001 feasibility inventory of current
`pgm-admin` capabilities so later workers can implement a curated web admin
surface instead of CLI parity.

## Summary

`src/cli/admin/pgm-admin.ts` is currently the operational source of truth for
privileged management. The web implementation must not shell out to this CLI.
Instead, workers should extract or reuse service-layer logic and keep CLI and
web behavior consistent through shared services and tests.

WAVE-001 inspected:

- `src/cli/admin/pgm-admin.ts`
- `tests/integration/cli-admin.test.ts`
- `README.md`
- `docs/manual-test-plan.md`

The safe admin surface is intentionally smaller than the CLI. CLI commands
assume a trusted local operator with direct database access; browser admin APIs
need admin sessions, CSRF protection, typed inputs, rate limits, audit
attribution, step-up auth, dry-run previews, bounded jobs, and redaction.

## RED Findings Resolved By This Inventory

- The seed inventory listed command names but did not classify every command by
  web eligibility.
- The seed inventory did not separate first-scope admin UI from later
  maintenance jobs and manual-only operations.
- The service extraction boundary was not explicit enough for later API tasks.

## Command Classification

| Command | Current CLI behavior | Web classification | First scope? | Required service/API boundary |
|---------|----------------------|--------------------|--------------|-------------------------------|
| `key create` | Creates an API key with name, client id, scopes, allowed types, and visibility; returns plaintext once; writes `key.create` audit. | First-scope web candidate, sensitive mutation. | Yes. | Reuse/extract key service. Require admin session, CSRF, recent auth or step-up, typed scope/visibility/type validation, one-time plaintext display, and audit actor attribution. |
| `key list` | Lists active/inactive API-key metadata without plaintext key values; writes `key.list` audit. | First-scope web candidate, read operation. | Yes. | Extract list service with pagination/filtering. Never expose key hashes; key prefixes only if explicitly needed for operator diagnosis. |
| `key revoke` | Revokes API key by id; writes `key.revoke` audit. | First-scope web candidate, sensitive mutation. | Yes. | Reuse/extract revoke service. Require CSRF, confirmation, recent auth or step-up, and clear impact copy because OAuth tokens derived from the key also stop working. |
| `audit` | Queries `audit_log` with since/key/operation/entity/limit filters; writes `audit.query` audit. | First-scope web candidate, read operation. | Yes. | Extract audit query service with pagination, stable filters, redacted details, and admin actor visibility once admin audit attribution exists. |
| `model list` | Lists embedding models and active state; writes `model.list` audit. | First-scope web candidate, read operation. | Yes. | Extract model list service. Use as diagnostics for provider/config pages. |
| `stats` | Reads entity counts, chunk count, key count, database size, and uptime; writes `stats.view` audit. | First-scope web candidate, read operation. | Yes. | Extract stats service and combine with health/queue status for the admin dashboard. |
| `model set-active` | Directly flips the active embedding model row in a transaction; no dry-run; writes `model.set_active`. | Later web candidate through controlled provider/config apply, not a standalone first-scope endpoint. | No. | Replace with settings/apply flow that validates embedding identity, explains reembedding impact, and requires step-up. Same-dimension provider/model switches are still incompatible embedding-space changes. |
| `reembed` | Optionally switches active model, deletes chunks for selected entities, marks enrichment pending, and writes `reembed.start`; requires selector but has no dry-run. | Later dangerous job candidate. | No. | Extract service with dry-run counts, job record, confirmation, step-up, audit, progress, cancellation/duplicate protection, and chunk-loss warning. |
| `reextract` | Marks extraction pending, clears errors, can clean LLM edges, excludes archived and auto-created stubs by default, supports limits and skipped breakdown; no dry-run. | Later dangerous job candidate. | No. | Extract service with preview/dry-run, job record, guardrail visibility, confirmation, step-up, audit, and LLM-cost warning. |
| `improve-graph` | Queues entities for extraction with optional model/provider override and optional clean-edges; no dry-run; writes `improve-graph.queue`. | Later dangerous job candidate. | No. | Extract service with provider override validation, dry-run, job record, cost estimate, confirmation, step-up, and audit. |
| `link-neighbors` | Creates semantic-neighbor edges from stored vectors without LLM calls; supports dry-run; writes `link-neighbors.run`. | Later maintenance job candidate. | No. | Extract service with dry-run first, job record for apply, threshold validation, duplicate-job prevention, step-up for apply, and audit. |
| `prune-edges` | Deletes edges below threshold, scoped to LLM extraction by default; supports dry-run; writes `edges.prune`. | Later dangerous job candidate. | No. | Extract service with mandatory dry-run preview before apply, source/relation validation, confirmation, step-up, and audit. |
| `validate-edges` | Uses configured extraction LLM to validate edges; supports dry-run; writes `edges.validate` on apply; requires extraction config. | Later LLM-cost maintenance job candidate. | No. | Reuse edge-validation service through job API with provider readiness check, dry-run, cost/progress display, confirmation, step-up for apply, and audit. |
| `embeddings migrate` | Validates configured embedding identity, can dry-run, and on apply truncates chunks, alters vector dimension, creates a new active model, and marks entities pending. | Dangerous migration. Future dedicated migration wizard only; acceptable to keep manual-only until the admin job/migration gate is proven. | No. | Reuse `runMigrate` behind a migration-specific flow with backup warning, dry-run, step-up, maintenance-mode messaging, progress, and rollback/failure evidence. |
| `memory groom` | Archives or promotes eligible session-context memories for one client or all clients; dry-run available; promotion may call extraction LLM. | Later maintenance job candidate. | No. | Reuse memory grooming service with dry-run, scoped previews, LLM availability check for promote, job/audit trail, and step-up for mutation. |
| `memory groom-durable` | Reviews or marks durable memories for grooming; dry-run/review mode available; mark mode can call LLM. | Later maintenance job candidate with durable-memory risk. | No. | Reuse durable grooming service with dry-run, explicit filters, review outcome display, confirmation, step-up, and audit. |
| `memory apply-durable-grooming` | Applies durable grooming labels by rewriting or archiving durable memories; dry-run available; may call LLM. | Later dangerous maintenance job candidate. | No. | Reuse apply service with mandatory preview, step-up, per-row outcomes, rollback-safe audit, and clear distinction between rewrite and archive. |
| `purge` | Permanently deletes archived entities using selector flags; dry-run available; writes `purge` or `purge.dry_run`. | Later dangerous job candidate. | No. | Extract purge service with mandatory dry-run, typed selectors, explicit permanent-delete confirmation, step-up, and audit. |
| `sql` | Executes arbitrary SQL from an argument or stdin. | Excluded. | No. | Do not expose in web admin. Use typed service/API operations only. |

## First-Scope Web Surface

WAVE-001 recommends first implementation scope:

- Admin auth/bootstrap/session foundation first.
- Admin dashboard shell with health, stats, queue/config status, and active
  embedding model readouts.
- API-key create/list/revoke with one-time plaintext display and step-up for
  create/revoke.
- Audit log read view with filters and pagination.
- Read-only model list and configuration diagnostics.
- Runtime configuration read/validate/save for safe settings only after the
  settings/secret-store task lands.

Maintenance operations that mutate data or trigger LLM/provider work should
wait for the admin job foundation. They should not be implemented as blocking
HTTP requests.

## Exclusions

- `sql` is excluded from the web admin plane.
- Generic shell execution is excluded from the web admin plane.
- CLI JSON output must not become an internal web API contract.
- No web endpoint should accept an arbitrary command name plus arguments.
- Operations without typed validation, authorization, audit, and bounded
  execution stay manual-only.

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

## Service Extraction Notes

Existing reusable services:

- `src/auth/key-service.ts`: `createKey`, `revokeKey`, and key validation.
- `src/services/embeddings/admin.ts`: embedding identity checks and
  `runMigrate`.
- `src/services/edge-validation-service.ts`: edge validation batch logic.
- `src/services/memory-grooming-service.ts`: session-context and durable
  grooming flows.
- `src/services/extraction-service.ts` and `src/services/edge-service.ts`:
  semantic-neighbor support and edge creation.

Services still needed before web exposure:

- API-key list service with safe metadata only.
- Audit query service with pagination, filters, and admin actor support.
- Stats/health/queue diagnostics service.
- Model list and controlled active-model/config apply service.
- Reembed, reextract, improve-graph, prune-edges, link-neighbors, purge, and
  grooming job wrappers with dry-run/apply split.
- Admin job/progress persistence for long-running or expensive operations.

Later workers should add tests around the extracted service boundary rather
than only testing route handlers. Existing `tests/integration/cli-admin.test.ts`
is useful regression coverage, but web admin tests must additionally prove
admin-session auth, CSRF, step-up, redaction, and audit attribution.

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

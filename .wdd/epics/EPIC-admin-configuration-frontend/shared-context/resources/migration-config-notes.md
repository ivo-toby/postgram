---
id: EPIC-admin-configuration-frontend-RESOURCE-migration-config-notes
kind: shared_context_resource
epic: EPIC-admin-configuration-frontend
resource: migration-config-notes
updated_at: 2026-07-05
---

# Shared Context Resource: Migration And Configuration Notes

## Purpose

Capture persistence and configuration constraints before workers add admin
tables, runtime settings, or secret storage.

## Summary

The current application reads operational settings from process env and builds
providers at startup. Moving setup into the frontend requires careful
classification of settings, a DB-backed configuration model, secret handling,
and an apply/reload strategy.

WAVE-001 inspected:

- `src/config.ts`
- `src/index.ts`
- `src/services/embeddings/providers.ts`
- `src/services/llm-provider.ts`
- `docker-compose.yml`
- `.env.example`
- `README.md`

Current code validates most server settings through `loadConfig()`, constructs
embedding and extraction providers during `startServer()`, and passes resolved
values into the enrichment worker. `LLM_REQUEST_TIMEOUT_MS` is an observed
exception: it is documented and wired through Docker, but the LLM provider
reads it directly from `process.env` instead of `src/config.ts`.

## RED Findings Resolved By This Classification

- The seed notes did not classify each current env/Docker setting by lifecycle.
- The seed notes did not choose the initial secret-storage/key-management
  posture.
- The seed notes did not choose an apply/reload strategy for provider changes.

## Current Config Surface

Important env-driven areas include:

- Database and server: `DATABASE_URL`, `PORT`, `LOG_LEVEL`.
- OAuth connector: `OAUTH_ENABLED`, `PUBLIC_BASE_URL`.
- Embeddings: `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`,
  `EMBEDDING_DIMENSIONS`, `EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`,
  `OPENAI_API_KEY`, `OLLAMA_BASE_URL`, `OLLAMA_API_KEY`.
- Extraction: `EXTRACTION_ENABLED`, `EXTRACTION_MEMORY_MODE`,
  `EXTRACTION_PROVIDER`, `EXTRACTION_MODEL`, `EXTRACTION_BASE_URL`,
  `EXTRACTION_API_KEY`, `ANTHROPIC_API_KEY`, and extraction tuning flags.
- Docker/operator-only values: `POSTGRES_PASSWORD`, `PORT_BIND_HOST`,
  `UI_BIND_HOST`, `PGM_API_URL`, and `PGM_API_KEY`.
- LLM timeout: `LLM_REQUEST_TIMEOUT_MS` is currently read directly by
  `src/services/llm-provider.ts`.

## Setting Classes

Feasibility work should classify each setting as:

- Bootstrap-only: cannot reasonably be changed from the UI after startup.
- Runtime editable: can be safely applied without restart.
- Restart/reinitialize required: can be edited in UI but must trigger a
  controlled apply flow.
- Dangerous migration: affects stored data, dimensions, chunks, or graph state
  and needs dry-run, backup warning, confirmation, and progress tracking.

## WAVE-001 Setting Classification

| Setting | Current source | Classification | First admin UI posture |
|---------|----------------|----------------|------------------------|
| `DATABASE_URL` | `src/config.ts`, Compose internal URL | Bootstrap-only | Never browser-editable. Changing DB target is deployment work. |
| `POSTGRES_PASSWORD` | Compose/Postgres | Bootstrap-only secret | Never browser-editable for the running app. Use Docker secret/env outside admin UI. |
| `PORT` | `src/config.ts`, Compose | Bootstrap-only/restart required | Not first-scope editable. Server bind changes require process/container restart. |
| `PORT_BIND_HOST` | Compose only | Bootstrap-only exposure control | Not browser-editable. Keep loopback default; public exposure is deployment/proxy work. |
| `UI_BIND_HOST` | Compose only | Bootstrap-only exposure control | Not browser-editable. Keep loopback default. |
| `LOG_LEVEL` | `src/config.ts` | Restart/reinitialize required in current code; runtime-editable later if logger becomes reloadable | Later low-risk setting. If exposed, apply through config reload and audit. |
| `ENRICHMENT_POLL_INTERVAL_MS` | `src/config.ts` | Restart/reinitialize required in current code; runtime-editable later through worker reload | Later setting. Validate bounds and apply by worker reconfiguration. |
| `OAUTH_ENABLED` | `src/config.ts` | Restart/reinitialize required | Not first-scope editable. Routes are registered at app creation. |
| `PUBLIC_BASE_URL` | `src/config.ts` | Restart/reinitialize required | Later editable only with OAuth route/metadata reload or controlled restart. Validate HTTPS public origin for production. |
| `OPENAI_API_KEY` | `src/config.ts` | Secret; provider reinitialize required | DB-backed write-only secret. Used by OpenAI embeddings and OpenAI extraction. Validate before apply. |
| `ANTHROPIC_API_KEY` | `src/config.ts` | Secret; extraction provider reinitialize required | DB-backed write-only secret. Validate before apply when Anthropic extraction is selected. |
| `OLLAMA_API_KEY` | `src/config.ts` | Secret; provider reinitialize required | DB-backed write-only secret. Optional bearer for Ollama-compatible extraction. |
| `EMBEDDING_API_KEY` | `src/config.ts` | Secret; embedding provider reinitialize required | DB-backed write-only secret. Applies to Ollama embedding host. |
| `EXTRACTION_API_KEY` | `src/config.ts` | Secret; extraction provider reinitialize required | DB-backed write-only secret. Applies to OpenAI-compatible extraction host. |
| `EMBEDDING_PROVIDER` | `src/config.ts` | Restart/reinitialize plus possible dangerous migration | Later provider-config flow. Same-dimension provider switches still require embedding-space migration/reembedding. |
| `EMBEDDING_MODEL` | `src/config.ts` | Restart/reinitialize plus possible dangerous migration | Later provider-config flow. Explicit model requires explicit dimensions in current code. |
| `EMBEDDING_DIMENSIONS` | `src/config.ts` | Dangerous migration | Not a simple setting. Use embedding migration dry-run/apply job and backup warning. |
| `EMBEDDING_BASE_URL` | `src/config.ts` | Restart/reinitialize required | Later provider-config flow with URL validation and connection test. |
| `EXTRACTION_ENABLED` | `src/config.ts` | Restart/reinitialize required in current code; runtime worker reload target | Later provider-config flow. Applying should rebuild/pause/resume extraction worker state. |
| `EXTRACTION_MEMORY_MODE` | `src/config.ts` | Runtime-editable after worker reload service; current code startup-only | Later setting with clear graph extraction impact. |
| `EXTRACTION_PROVIDER` | `src/config.ts` | Runtime-editable after LLM factory reload; current code startup-only | Later provider-config flow with connection/schema-output validation. |
| `EXTRACTION_MODEL` | `src/config.ts` | Runtime-editable after LLM factory reload; current code startup-only | Later provider-config flow with model validation. |
| `EXTRACTION_BASE_URL` | `src/config.ts` | Runtime-editable after LLM factory reload; current code startup-only | Later setting with URL allow/deny review and SSRF-aware validation. |
| `EXTRACTION_DISABLE_THINKING` | `src/config.ts` | Runtime-editable after LLM factory reload; current code startup-only | Later tuning setting. |
| `EXTRACTION_REASONING_EFFORT` | `src/config.ts` | Runtime-editable after LLM factory reload; current code startup-only | Later tuning setting. |
| `EXTRACTION_AUTO_CREATE_ENTITIES` | `src/config.ts` | Runtime-editable after worker reload; current code startup-only | Later setting with data-quality warning. |
| `EXTRACTION_AUTO_CREATE_TYPES` | `src/config.ts` | Runtime-editable after worker reload; current code startup-only | Later setting; validate allowed entity types. |
| `EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE` | `src/config.ts` | Runtime-editable after worker reload; current code startup-only | Later tuning setting with bounds. |
| `EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE_BY_TYPE` | `src/config.ts` | Runtime-editable after worker reload; current code startup-only | Later tuning setting; currently missing from Compose environment. |
| `EXTRACTION_MATCH_MIN_SIMILARITY` | `src/config.ts` | Runtime-editable after worker reload; current code startup-only | Later tuning setting; currently missing from Compose environment. |
| `EXTRACTION_MIN_CONTENT_CHARS` | `src/config.ts` | Runtime-editable after worker reload; current code startup-only | Later tuning setting; currently missing from Compose environment. |
| `EXTRACTION_DEBUG_LOG` | `src/config.ts` | Runtime-editable after worker/logger reload; current code startup-only | Later diagnostic setting. Consider time-bound warning because it can increase sensitive logs. |
| `EXTRACTION_SEMANTIC_NEIGHBORS_ENABLED` | `src/config.ts` | Runtime-editable after worker reload; current code startup-only | Later setting with edge-creation impact. Currently documented in README but missing from Compose environment. |
| `EXTRACTION_SEMANTIC_NEIGHBORS_MAX` | `src/config.ts` | Runtime-editable after worker reload; current code startup-only | Later tuning setting; missing from Compose environment. |
| `EXTRACTION_SEMANTIC_NEIGHBORS_MIN_SIMILARITY` | `src/config.ts` | Runtime-editable after worker reload; current code startup-only | Later tuning setting; missing from Compose environment. |
| `OLLAMA_BASE_URL` | `src/config.ts` | Runtime/provider reinitialize required | Later provider-config setting. It affects extraction and is the fallback for embedding base URL. |
| `LLM_REQUEST_TIMEOUT_MS` | Direct `process.env` read in `llm-provider.ts` | Restart/reinitialize required until formalized in `src/config.ts` | Formalize before admin UI owns provider settings; then treat as LLM tuning. |
| `PGM_API_URL` / `PGM_API_KEY` | CLI/client env | Excluded from server runtime config | Do not manage in server admin UI. These configure external CLI clients. |

## Chosen Configuration Architecture

Use a DB-backed installation-wide runtime configuration service.

Recommended persistence model:

- `runtime_settings`: non-secret key/value records with schema key, typed JSON
  value, validation status, applied version, pending/applied state, actor,
  timestamps, and restart/reload classification.
- `runtime_secrets`: encrypted write-only values with secret key name,
  ciphertext, nonce, key version, provider/use metadata, last validation
  status, and timestamps.
- `admin_jobs`: apply/reload/migration/maintenance job records for operations
  that are not safe as blocking HTTP requests.

Configuration scope is global installation settings for the first version. Do
not introduce per-profile/environment settings until a later need is proven.

Env fallback policy:

- Existing env values remain a backward-compatible bootstrap/default source.
- DB settings override env for UI-managed provider/config values after the
  settings service exists.
- Bootstrap-only values stay env/Docker/deployment controlled.
- Later Docker/docs tasks must make the supported path explicit so operators do
  not need normal provider secrets in `.env` after setup.

## Secret Storage Questions

WAVE-001 decision:

- Store provider secrets in the database encrypted at the application layer.
- Keep one minimal installation encryption key outside the database, supplied
  through env or Docker secret. A later Docker task may generate/persist it for
  the Compose happy path, but database backups must not contain the key.
- Prefer Node application-layer AEAD encryption for the first implementation
  so DB backups contain ciphertext even if restored elsewhere. `pgcrypto`
  remains available, but do not rely on DB-only encryption if the key would
  live in the same database.
- Secret values are write-only after save. API/UI responses may show presence,
  provider, last validated time, and short non-sensitive metadata, but never
  plaintext.
- Audit rows and logs must contain redacted secret markers only.
- Secret rotation is out of first scope except replacing a stored secret value.

Backup/restore invariant:

- Restoring the database without the installation encryption key must not reveal
  provider secrets.
- Restoring the database with the wrong/missing key should make admin config
  show "secrets locked/misconfigured" and block provider apply until the key or
  secrets are repaired.

Open implementation detail:

- Name and format of the installation encryption key are for the settings
  implementation task, but it must be high entropy and deployment documented.

## Chosen Apply And Reload Strategy

Use explicit save/validate/apply states rather than silently applying every
form submit.

First implementation strategy:

- Saving a setting writes a pending value and audit event.
- Validation runs before apply for provider URLs, credentials, model names,
  dimensions, and structured-output compatibility where feasible.
- Applying extraction settings creates or runs a controlled reload: pause after
  the current worker iteration, rebuild the LLM factory and worker config from
  the DB-backed settings, then resume. If this cannot be made safe in the
  first implementation, mark the setting restart-required in the UI.
- Applying embedding provider/model settings validates provider connectivity
  and active model identity. If chunks exist or identity changes, require the
  embedding migration job path instead of a simple apply.
- Applying `EMBEDDING_DIMENSIONS` is always a migration job with mandatory
  dry-run, backup warning, step-up, confirmation, progress, and audit.
- Applying route/server/Docker values (`DATABASE_URL`, ports, bind hosts,
  `OAUTH_ENABLED`, and `PUBLIC_BASE_URL` until route reload exists) requires a
  controlled restart or deployment change.
- `LOG_LEVEL`, `ENRICHMENT_POLL_INTERVAL_MS`, and LLM tuning settings can
  become hot-reloadable, but current code treats them as startup-loaded.

Provider validation should not leak secrets in errors. Store safe failure
summaries and redact request headers, tokens, and provider responses.
Admin-configured provider URLs are attacker-controlled inputs; TASK-010 must
define and test an explicit URL/egress safety policy for `EXTRACTION_BASE_URL`,
`EMBEDDING_BASE_URL`, `OLLAMA_BASE_URL`, and equivalent future base URLs so
provider connection tests cannot become a generic SSRF primitive. The policy
must cover allowed schemes, hostnames/IPs, redirects if allowed, and any
deliberate local-provider exception such as Docker host Ollama access.

## Migration Notes

Expected new tables or columns:

- Admin users.
- Admin sessions.
- MFA factors.
- Login attempts or lockout state.
- Runtime settings.
- Secret metadata or encrypted secret values.
- Admin jobs/progress for maintenance.
- Admin actor attribution in audit.

Migration-sensitive constraints:

- Embedding dimensions alter the `chunks.embedding vector(N)` column and HNSW
  index.
- Embedding provider/model identity changes invalidate existing vectors even if
  dimensions match.
- Existing `ensureEmbeddingIdentityAgreement()` allows bootstrap-safe
  convergence only when there are no chunks; with chunks present it fails
  startup and asks for `pgm-admin embeddings migrate`.
- Admin config tasks must keep test reset helpers updated for every new table.

Each migration task should update test reset helpers if new tables affect
integration tests.

## WAVE-002 Admin Auth Migration

PR #79 added `src/db/migrations/010_admin_auth.sql` and merged it in
`0f96769`.

Created tables:

- `admin_users`: unique email, Argon2id password hash, `pending_mfa`/`active`/
  `disabled` status, MFA-required flag, password-change timestamp, and update
  trigger.
- `admin_sessions`: admin-user foreign key, hash-only session token, optional
  `mfa_verified_at`, expiry, revocation, and last-used tracking.
- `admin_mfa_factors`: TOTP factor rows with pending/verified/disabled status,
  encrypted-secret placeholder, recovery hashes, and verification/disabled
  timestamps.
- `admin_bootstrap_tokens`: hash-only bootstrap token, expiry, consumed and
  invalidated timestamps, attempt counters, and last-attempt timestamp.
- `admin_auth_attempts`: login/bootstrap/MFA/step-up attempt history with
  optional admin-user attribution and JSON metadata.

Reset helper updates:

- `tests/helpers/postgres.ts` truncates the new admin tables before existing
  auth/API-key tables so integration tests start from a clean auth state.

Future migration reminders:

- TASK-005 should not add route-only state to these tables unless the route
  semantics require it and tests prove reset ordering.
- TASK-006 owns TOTP secret handling and may need to formalize
  `secret_ciphertext` encryption once the installation encryption-key work is
  available.
- TASK-009/TASK-014 may add settings/secrets/jobs tables; reconcile migration
  ordering against the admin auth tables before dispatching those waves.

## Docker Notes

The final claim is no normal CLI or manual env-file editing for supported
provider configuration. It is acceptable if one minimal bootstrap token path
and one installation encryption key remain, but those must be explicit, safe,
and Docker-documented.

Any runtime config value added or reclassified must update:

- `docker-compose.yml`
- `.env.example` if present
- README or deployment-facing docs
- Relevant website docs only if the public docs are in scope for that task

Current drift for later Docker/config tasks to resolve:

- `LLM_REQUEST_TIMEOUT_MS` should be formalized in `src/config.ts` before the
  admin UI owns LLM tuning.
- `EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE_BY_TYPE`,
  `EXTRACTION_MATCH_MIN_SIMILARITY`, `EXTRACTION_MIN_CONTENT_CHARS`, and
  semantic-neighbor settings exist in code/docs but are incomplete or absent in
  Compose environment wiring.
- `EXTRACTION_DISABLE_THINKING` is in code and `.env.example`; confirm Compose
  and README tables stay aligned when config ownership changes.

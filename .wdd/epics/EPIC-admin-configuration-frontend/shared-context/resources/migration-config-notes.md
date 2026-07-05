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

## Setting Classes

Feasibility work should classify each setting as:

- Bootstrap-only: cannot reasonably be changed from the UI after startup.
- Runtime editable: can be safely applied without restart.
- Restart/reinitialize required: can be edited in UI but must trigger a
  controlled apply flow.
- Dangerous migration: affects stored data, dimensions, chunks, or graph state
  and needs dry-run, backup warning, confirmation, and progress tracking.

## Secret Storage Questions

The implementation must decide:

- Where the encryption key comes from.
- Whether any minimal secret/env remains required for secure operation.
- How secrets are redacted in UI/API/audit/logs.
- How secrets behave in backups and restores.
- Whether secret rotation is in scope for the first version.

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

Each migration task should update test reset helpers if new tables affect
integration tests.

## Docker Notes

The final claim is no normal CLI or manual env-file editing for supported
configuration. It is acceptable if one minimal bootstrap secret or encryption
key remains, but that must be explicit and safe.

Any runtime config value added or reclassified must update:

- `docker-compose.yml`
- `.env.example` if present
- README or deployment-facing docs
- Relevant website docs only if the public docs are in scope for that task

# Implementation Plan: Local Embedding Provider Support

**Branch**: `002-local-embeddings` | **Date**: 2026-04-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-local-embeddings/spec.md`

## Summary

Add an Ollama-compatible embedding provider alongside the existing OpenAI path, keep the existing `src/services/embedding-service.ts` as the caller-facing surface, and make `OPENAI_API_KEY` conditionally required. Introduce independent embedding host configuration (`EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`) with `OLLAMA_BASE_URL` as a fallback for the Ollama provider so that embedding and LLM-extraction hosts can be configured separately. Provide a single admin command, `pgm-admin embeddings migrate`, that performs an operator-invoked dimension migration (discards chunks, alters the `vector(N)` column, marks enrichable entities pending, writes an audit row). Add a narrow startup gate that refuses to boot on dimension mismatch only; reachability failures continue to degrade-and-warn, matching current behavior.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 22+ (LTS)
**Primary Dependencies**: Hono, `@modelcontextprotocol/sdk`, `pg` + `pgvector`, `zod`, `neverthrow`, `commander`, `pino`. No new deps — Ollama calls use native `fetch`.
**Storage**: PostgreSQL 16+ with `pgvector`; raw SQL via typed helpers; numbered forward-only migrations under `src/db/migrations/` (unchanged by this feature).
**Testing**: Vitest unit + integration (testcontainers for real Postgres).
**Target Platform**: Linux server via Docker Compose.
**Project Type**: Single TypeScript backend (HTTP + MCP + admin CLI).
**Performance Goals**: Preserve existing targets; embedding remains async.
**Constraints**: No new OpenAI outbound calls when both providers are non-OpenAI; no REST/MCP contract changes; admin operations container-local; audit on destructive admin path; startup fails fast only on dimension mismatch.
**Scale/Scope**: Personal/homelab (< 100k chunks). Migration completes a ~10k-chunk reembed in minutes.

## Constitution Check

- **I. Specification Before Implementation** — PASS. `spec.md`, this plan, and `tasks.md` in sync; no implementation until task approval.
- **II. Service-Layer Canonical Logic** — PASS. Provider logic lives in a small module behind `src/services/embedding-service.ts`. Admin CLI is a thin adapter over a service function.
- **III. Explicit Schema and Migration Discipline** — **WAIVER** (see Complexity Tracking). The runtime `ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(N)` is issued by the admin migrate command, not a numbered SQL migration, because the target dimension is operator-declared per deployment. No numbered SQL migration is added for this feature.
- **IV. Scoped Security and Auditability** — PASS. Admin surface stays on `pgm-admin` (container-local). Migrate writes an `audit_log` row on every invocation, including `--dry-run` (matches the existing CLI pattern of auditing read-only privileged operations like `key list` and `audit`). `--yes` required outside dry-run.
- **V. Verification with Contract Coverage** — PASS (minimal). Unit tests for the Ollama provider and for the conditional-config logic; one integration test for Ollama enrichment end-to-end; one integration test for the migration command (dry-run + real). Existing REST/MCP contract suite continues to cover the no-contract-change claim.

## Project Structure

### Documentation (this feature)

```text
specs/002-local-embeddings/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

No `contracts/` directory: the embedding-provider interface is internal (documented inline in `research.md`), and `pgm-admin embeddings migrate` has a single subcommand whose surface is small enough to describe in `quickstart.md`.

### Source Code (repository root)

```text
src/
├── config.ts                              # + EMBEDDING_* vars; conditional OPENAI_API_KEY
├── index.ts                                # Construct provider from config; log active provider; dimension gate
├── services/
│   ├── embedding-service.ts               # Refactored to accept a provider; keeps deterministic test mode
│   └── embeddings/
│       ├── providers.ts                   # EmbeddingProvider interface + OpenAI + Ollama implementations + factory
│       └── admin.ts                        # runMigrate({...}) service function
└── cli/
    └── admin/
        └── pgm-admin.ts                    # `embeddings migrate` subcommand (thin adapter)

tests/
├── unit/
│   ├── config.test.ts                      # Conditional OPENAI_API_KEY + host fallback
│   └── services/embeddings/
│       └── providers.test.ts               # OpenAI + Ollama against stubbed fetch
└── integration/
    ├── enrichment-ollama.test.ts            # End-to-end enrichment via stub Ollama
    └── admin-embeddings-migrate.test.ts     # Dry-run + real migrate + startup dimension gate
```

One new module directory (`src/services/embeddings/`) with two files. No separate startup-validation module, no separate error-class file, no contracts directory.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Runtime `ALTER TABLE` via admin command instead of a numbered SQL migration | The target dimension is operator-declared at runtime (`EMBEDDING_DIMENSIONS`) and varies per deployment. A fixed numbered migration cannot encode a variable target; shipping one per possible dimension would force-migrate every deployment on upgrade. | A forward-only migration to a specific dimension would break deployments that stay on 1536. Keeping `vector(1536)` as the initial schema state and providing an audited, operator-invoked admin command preserves the numbered-migration discipline for initial schema state while giving operators a supported path. Audit row (including on dry-run), and `--yes` requirement mitigate operator risk. Explicitly marked as a Principle III **waiver**, not a pass. **Operational note**: `ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(N)` plus `DROP INDEX` + `CREATE INDEX` takes an exclusive schema lock on `chunks`; this command is a maintenance-window operation, and search is unavailable for migrated entities until the enrichment worker backfills. |

## Phase 0: Research

See [`research.md`](./research.md).

## Phase 1: Design

See [`data-model.md`](./data-model.md) and [`quickstart.md`](./quickstart.md).

## Post-Design Check

- Spec, plan, research, data-model, quickstart, tasks all synchronized at the end of Phase 1.
- One waiver (Principle III) documented; all other principles pass.
- Internal surfaces (provider interface, migrate service) remain service-layer-canonical.

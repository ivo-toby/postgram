# Research: Phase 1 MVP — Central Knowledge Store

**Date**: 2026-03-18
**Status**: Complete
**Source**: All decisions pre-resolved in `SPEC.md` and `specs/postgram-brief.md`

## Summary

This feature had no NEEDS CLARIFICATION markers. The existing implementation
spec (`SPEC.md`) and design doc (`specs/postgram-brief.md`) resolve all
technical decisions in advance. This document records the key decisions and
their rationale for traceability.

---

## Decision 1: HTTP Framework — Hono

**Decision**: Use Hono as the HTTP framework.

**Rationale**: Lightweight, fast, TypeScript-native, middleware-first design.
Built-in context system maps cleanly to attaching auth context per request.
Tree-shakeable and works in multiple runtimes. The `@hono/node-server` adapter
provides Node.js compatibility.

**Alternatives considered**:
- **Fastify**: More mature ecosystem, but heavier. Plugin system adds complexity
  unnecessary for this project's small surface area.
- **Express**: Legacy patterns (callback-based middleware). No built-in TypeScript
  support. Slower.

---

## Decision 2: Error Handling — neverthrow Result Types

**Decision**: Use `neverthrow` for typed Result types in the service layer.

**Rationale**: The constitution mandates result types for expected errors.
`neverthrow` provides `Result<T, E>` with `ok()` and `err()` constructors,
`.map()`, `.andThen()` for chaining, and compile-time exhaustive error handling.
Service functions return `ResultAsync<T, AppError>` rather than throwing.

**Alternatives considered**:
- **Custom ServiceResult union**: Already defined in SPEC.md as
  `{ ok: true; data: T } | { ok: false; error: AppError }`. Works but lacks
  monadic chaining. The `neverthrow` library provides the same semantics with
  better ergonomics.
- **Throwing exceptions**: Constitution prohibits this for expected errors.
  Reserved for truly exceptional failures (e.g., OOM, corrupted state).

---

## Decision 3: Embedding Model — OpenAI text-embedding-3-small

**Decision**: Use OpenAI `text-embedding-3-small` (1536 dimensions) for Phase 1.

**Rationale**: Simplest integration path. Low cost (~$0.02/1M tokens). Good
quality for personal-scale semantic search. Pre-normalized vectors (no L2 norm
step needed). The `embedding_models` table allows switching models later without
schema changes.

**Alternatives considered**:
- **Local Ollama (nomic-embed-text)**: Free, more private, 384-768 dimensions.
  Requires running Ollama on the VM or home server. Deferred to later phase
  when volume justifies the infrastructure.
- **Cohere embed-v3**: Higher quality but more expensive, less common in the
  Node.js ecosystem.

---

## Decision 4: Chunking Strategy — RecursiveCharacterTextSplitter Port

**Decision**: Port the chunking logic from obsidian-autopilot-backend's
`RecursiveCharacterTextSplitter` to TypeScript.

**Rationale**: Proven approach already in use in the user's ecosystem. Character-
based splitting (300 chars, 100 overlap) with hierarchical separator priority
(paragraphs → headers → lines → sentences) preserves semantic coherence.
Identical config to the existing system ensures consistency during migration.

**Alternatives considered**:
- **LangChain splitters**: Heavy dependency for a single function. Overkill.
- **Token-based splitting (tiktoken)**: More accurate for LLM context budgeting
  but adds a dependency and complexity. Character-based is sufficient at personal
  scale. Token counts estimated separately via `gpt-tokenizer`.

---

## Decision 5: Key Hashing — argon2id

**Decision**: Use argon2id with parameters: time=3, memory=65536, parallelism=4.

**Rationale**: Industry standard for password/key hashing. Memory-hard (resists
GPU attacks). The `argon2` npm package provides a well-maintained implementation
with constant-time verification. Parameters balanced for a personal server
(single-digit keys, not high-throughput auth).

**Alternatives considered**:
- **bcrypt**: Widely supported but not memory-hard. Less resistant to modern
  GPU/ASIC attacks.
- **scrypt**: Memory-hard but less well-standardized. argon2id is the PHC
  winner.

---

## Decision 6: Write Pipeline — Async Enrichment

**Decision**: Persist the entity immediately (synchronous), then run chunking +
embedding asynchronously via a background enrichment worker. The entity is
returned to the caller with `enrichment_status: "pending"` before any embedding
work begins.

**Rationale**: The constitution requires "entity writes MUST return before
enrichment completes" (Constraints & Boundaries > Performance). This also
aligns with the edge case that entities must be stored even when the embedding
service is unavailable. The enrichment worker polls for pending entities, which
keeps the implementation simple (no external queue) while satisfying the async
requirement.

**Alternatives considered**:
- **Synchronous pipeline**: Simpler, but violates the constitution. Would block
  writes on embedding latency and fail entirely when the embedding service is
  down.
- **External job queue (BullMQ, etc.)**: More robust, but unnecessary at
  personal scale. A polling worker is sufficient and avoids a Redis dependency.

---

## Decision 7: Migration Runner — Simple Numbered SQL Files

**Decision**: Custom migration runner that reads numbered `.sql` files from
`src/db/migrations/` and tracks applied versions in a `schema_migrations` table.

**Rationale**: The constitution requires explicit SQL migrations. A simple runner
(< 50 lines) that reads files in order and skips already-applied ones is
sufficient. No dependency needed for personal-scale schema management.

**Alternatives considered**:
- **node-pg-migrate**: Full-featured but adds a dependency and config overhead.
- **Kysely migrations**: Requires adopting Kysely as a query builder (may use
  later, but not a prerequisite for the migration runner).
- **dbmate**: External binary, not a Node.js dependency. Good option but adds
  a deployment requirement.

---

## Decision 8: Docker Base Image — node:22-alpine + tini

**Decision**: Multi-stage build with `node:22-alpine` for both build and runtime
stages. `tini` for PID 1 signal handling. Non-root `node` user.

**Rationale**: Alpine minimizes image size. Tini handles zombie reaping and
signal forwarding (Node.js doesn't handle SIGTERM properly as PID 1). Non-root
user follows security best practices.

**Alternatives considered**:
- **node:22-slim (Debian)**: Larger image but more compatible with native
  dependencies. `argon2` npm package has native bindings but builds fine on
  Alpine.
- **Distroless**: Smallest possible image but harder to debug (no shell for
  `docker exec`). The admin CLI requires a shell.

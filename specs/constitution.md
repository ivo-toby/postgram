# Postgram constitution

## Principles

1. Spec first. A material change starts from an updated spec. When the code
   diverges from the spec, update the spec in the same change.
2. One service layer. Domain logic lives once in transport-agnostic service
   modules. REST handlers, MCP tools and CLI commands stay thin adapters and
   reuse its validation, authorization, persistence and error handling.
3. Explicit schema. Persistence uses PostgreSQL 16+ with pgvector, raw SQL and
   typed query helpers; no ORM. Schema changes ship as forward-only numbered
   migrations (`NNN_snake_case.sql`) together with the spec and query helpers.
4. Scoped security. Every non-health entry point authenticates and enforces
   scope, type and visibility in the service layer. Mutating or privileged
   operations write an audit record. Admin operations stay container-local.
   API keys are stored hashed (argon2). Secrets never reach logs or plaintext
   storage.
5. Expected errors are values. Use `neverthrow` Result types for expected
   errors; throw only for unrecoverable failures. Log with `pino` as
   structured JSON.
6. Red/green TDD. Write the failing test first. Transport, auth, schema,
   search and migration changes need contract or integration tests; narrower
   logic needs focused unit or service tests (Vitest).
7. Fresh verification. Before a change is done, run the smallest meaningful
   set of `npm run typecheck`, `npm test`, `npm run lint` and `npm run build`,
   scaling to all four for broad changes.
8. Config travels with Docker. A new or renamed runtime config value updates
   `docker-compose.yml`, `.env.example`, Dockerfile defaults, deployment docs
   and README tables in the same change.
9. Out of scope unless a change says so: production data, deployed
   infrastructure state, external account configuration and third-party
   service behavior.

## Conflicts

A worker that finds a conflict between a task and these principles stops and
reports it. The operator decides; the worker does not pick a side.

## Amendment

Semantic versioning: MAJOR removes or redefines a principle, MINOR adds one,
PATCH clarifies without changing obligations. Every amendment gets operator
approval of the exact Markdown bytes and a new approval record.

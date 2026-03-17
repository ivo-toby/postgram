Read @specs/postgram-brief.md
This is the design for Postgram — a personal knowledge store I'm building.

I want to implement Phase 1. Before writing any code, create a detailed
implementation spec as SPEC.md in this repo. Cover:

1. Exact Postgres schema (CREATE TABLE statements, indexes, constraints)
2. Project structure (files, folders, dependencies)
3. Service layer API — every function signature, input/output types
4. MCP tool definitions — names, descriptions, parameter schemas
5. REST endpoint contracts — request/response shapes, status codes, error format
6. Auth middleware — how key validation works per request
7. Embedding pipeline — chunking logic, async flow, error handling
8. CLI commands — every subcommand, flags, output format
9. Docker setup — Dockerfile, compose, env vars, health checks
10. Migration script design — how Talon memories get imported

For each section, include edge cases and error scenarios.
I already have a working chunking + embedding pipeline in
/home/ivo/workspace/obsidian-autopilot-backend — reference that for
proven patterns (chunking config, embedding providers, SHA-256
change detection, batch processing).

Don't write any implementation code yet. Just the spec.

Tech stack: TypeScript (Node.js). Use the MCP TypeScript SDK
(@modelcontextprotocol/sdk), pg + pgvector for database, and
a lightweight HTTP framework (Fastify or Hono) for REST.
No ORM — raw SQL with typed helpers is fine for 7 tables.
Port chunking patterns from /home/ivo/workspace/obsidian-autopilot-backend
(Python) to TypeScript equivalents.

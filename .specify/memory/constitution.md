<!--
Sync Impact Report
Version change: none -> 1.0.0
Modified principles:
- Template Principle 1 -> I. Specification Before Implementation
- Template Principle 2 -> II. Service-Layer Canonical Logic
- Template Principle 3 -> III. Explicit Schema and Migration Discipline
- Template Principle 4 -> IV. Scoped Security and Auditability
- Template Principle 5 -> V. Verification with Contract Coverage
Added sections:
- Engineering Standards
- Delivery Workflow & Quality Gates
Removed sections:
- None
Templates requiring updates:
- ✅ .specify/templates/plan-template.md
- ✅ .specify/templates/spec-template.md
- ✅ .specify/templates/tasks-template.md
- ✅ .specify/templates/agent-file-template.md
- ⚠ pending .specify/templates/commands/ (directory absent; no command templates available to validate)
Follow-up TODOs:
- None
-->
# Postgram Constitution

## Core Principles

### I. Specification Before Implementation
Every material change MUST begin with an updated specification artifact before
implementation starts. The spec MUST capture user-visible behavior, edge cases,
data model impact, transport contract impact, and operational implications for
the change. If implementation decisions diverge from the approved spec, the spec
MUST be updated in the same change before the implementation is considered
complete. Rationale: this repository already uses `SPEC.md` and feature specs as
its source of intent, so code without synchronized specifications is
unreviewable drift.

### II. Service-Layer Canonical Logic
Domain behavior MUST be implemented once in transport-agnostic service modules.
REST handlers, MCP tools, and CLI commands MUST remain thin adapters that reuse
the same validation, authorization, persistence, and error-handling rules rather
than reimplementing business logic. Rationale: Postgram serves multiple agent
and operator interfaces, and duplicated logic causes behavioral drift across
surfaces.

### III. Explicit Schema and Migration Discipline
Persistent behavior MUST be backed by explicit PostgreSQL schema definitions and
numbered SQL migrations. Any schema-affecting change MUST update the relevant
specification, migration files, typed query helpers, and concurrency/versioning
rules together. Raw SQL with typed helpers is the default persistence model; ORM
features that hide schema changes or query behavior are prohibited unless this
constitution is amended. Rationale: Postgram is a durable knowledge store, so
storage behavior must stay inspectable, reproducible, and reversible.

### IV. Scoped Security and Auditability
Every non-health transport entry point MUST authenticate callers and enforce
scope, type, and visibility restrictions in the service layer. Mutating or
privileged operations MUST emit auditable records, and admin capabilities MUST
remain container-local rather than exposed over public REST or MCP surfaces
unless the constitution is explicitly amended. Rationale: the system stores
personal, work, and shared knowledge for multiple agents, so boundary failures
and missing audit trails are unacceptable.

### V. Verification with Contract Coverage
Every change MUST include fresh verification proportional to risk. Changes that
touch transports, authentication, schema, search behavior, migrations, or
cross-surface contracts MUST include automated contract and/or integration
coverage; narrower logic changes MUST include focused unit or service tests.
No work may be marked complete without fresh verification evidence and updated
operator-facing documentation when setup or runtime behavior changes. Rationale:
this project spans database, API, MCP, and CLI interfaces, so regressions are
easy to introduce and hard to detect without explicit verification.

## Engineering Standards

- The canonical implementation stack for Phase 1 is Node.js with TypeScript,
  PostgreSQL with `pgvector`, raw SQL with typed helpers, MCP via
  `@modelcontextprotocol/sdk`, and a lightweight HTTP transport such as Hono or
  Fastify. Any deviation MUST be justified in the feature plan.
- Schema changes MUST ship as numbered SQL migrations in source control and MUST
  describe forward-only rollout, backfill needs, and version/locking impact.
- Structured application logs, explicit error contracts, and audit logging are
  part of the runtime surface and MUST be treated as maintained interfaces.
- Sensitive exports and backups MUST use encrypted handling, and key material
  MUST be stored hashed rather than in plaintext.

## Delivery Workflow & Quality Gates

- Feature work MUST flow through spec, plan, and task artifacts that remain
  consistent with this constitution.
- The plan's Constitution Check MUST confirm specification coverage, service
  layer ownership, migration impact, security and audit impact, and the exact
  verification commands required for the change.
- Task lists MUST be organized by user story and MUST include constitution-driven
  work for service logic, transport wiring, schema/migration updates,
  authorization and audit behavior, and documentation or quickstart updates when
  those surfaces change.
- Any constitutional exception MUST be documented in the plan's complexity or
  waiver section with a concrete justification and the simpler rejected
  alternative.

## Governance

- This constitution overrides conflicting local process notes, template defaults,
  and ad hoc implementation shortcuts.
- Amendments MUST update this file and all affected templates or guidance
  artifacts in the same change, and the top-of-file Sync Impact Report MUST
  summarize the propagation.
- Versioning policy for this constitution follows semantic versioning:
  MAJOR for removed or materially redefined principles, MINOR for new principles
  or materially expanded governance, and PATCH for clarifications that do not
  change obligations.
- Compliance review is mandatory for every plan, task list, code review, and
  merge decision. Reviewers MUST confirm alignment with all Core Principles or
  record the exception explicitly.
- Runtime guidance generated from
  `.specify/templates/agent-file-template.md` MUST remain consistent with this
  constitution.

**Version**: 1.0.0 | **Ratified**: 2026-03-18 | **Last Amended**: 2026-03-18

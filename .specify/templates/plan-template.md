# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [TypeScript on Node.js or NEEDS CLARIFICATION]
**Primary Dependencies**: [e.g., Hono, @modelcontextprotocol/sdk, pg, pgvector, OpenAI SDK or NEEDS CLARIFICATION]
**Storage**: [PostgreSQL with pgvector, numbered SQL migrations, or N/A]
**Testing**: [unit, service, integration, contract, and manual verification commands]
**Target Platform**: [Linux container / Hetzner VM / CLI clients or NEEDS CLARIFICATION]
**Project Type**: [backend service with REST, MCP, and CLI surfaces or NEEDS CLARIFICATION]
**Performance Goals**: [domain-specific, e.g., search latency, ingest latency, migration throughput]
**Constraints**: [auth, visibility, audit, operational, or deployment constraints]
**Scale/Scope**: [expected entity volume, clients, interfaces, rollout scope]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Specification Before Implementation**: Confirm the linked spec captures user
  stories, edge cases, data impact, contract impact, and operational impact for
  this change.
- **Service-Layer Canonical Logic**: List the service modules that own the new or
  changed behavior and confirm REST, MCP, and CLI work is adapter-only.
- **Explicit Schema and Migration Discipline**: Identify every affected table,
  index, SQL migration, typed query helper, and version/locking rule. If none
  are affected, state that explicitly.
- **Scoped Security and Auditability**: Describe auth scope changes,
  type/visibility enforcement, audit-log impact, and confirm no admin capability
  is being exposed on public transports.
- **Verification with Contract Coverage**: List the exact unit, service,
  integration, contract, build, and manual verification commands required before
  completion, including docs or quickstart updates.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── config.ts
├── db/
│   ├── migrations/
│   └── ...
├── services/
├── auth/
├── transport/
├── cli/
├── types/
└── util/

tests/
├── contract/
├── integration/
└── unit/
```

**Structure Decision**: [Document the exact directories and files this feature
touches. Call out service-layer ownership, transport adapters, persistence, and
test locations.]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

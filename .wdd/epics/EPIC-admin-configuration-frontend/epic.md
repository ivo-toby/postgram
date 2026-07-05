---
id: EPIC-admin-configuration-frontend
kind: epic
type: feature
slug: admin-configuration-frontend
title: Safe Admin Configuration Frontend
status: planned
created_at: 2026-07-05
updated_at: 2026-07-05
target_branch: main
epic_branch: codex/epic/admin-configuration-frontend
profile: full
review_mode: risk_based
monitoring_mode: adaptive
schema_version: 1
ticket_count: 7
task_count: 18
adapter_links:
  github_issue: null
  jira_epic: null
---

# Safe Admin Configuration Frontend

## Summary

Research and prove whether Postgram can safely replace routine `pgm-admin`
usage and environment-file editing with a hardened web administration plane.
The desired end state is a single Docker Compose setup where an operator can
bootstrap, secure, configure, maintain, audit, and operate Postgram from the
frontend without using the admin CLI for normal setup or maintenance.

## Goal

Prove the technical feasibility of a safe and easy-to-use configuration
frontend for commercial managed or self-hosted Postgram deployments, then
deliver a secure first implementation path if the hypothesis holds.

Core hypothesis:

> Postgram can expose the operational power of `pgm-admin` through a hardened
> web admin plane without making the web UI an unsafe single point of failure.

## Background

The commercial rollout discussion settled on managed private instances as the
most credible near-term shape for Postgram. That shape needs operational
simplicity: a technical user should be able to run Postgram and manage API
keys, model settings, graph health, memory grooming, audit logs, and queue
health from the product itself.

Today, these operations are split across:

- Runtime environment variables in `src/config.ts` and `docker-compose.yml`.
- The regular web UI, which authenticates by storing an API key in
  localStorage.
- `pgm-admin`, which directly connects to Postgres and performs privileged
  operations.
- REST/MCP endpoints, which mostly serve end-user and agent workflows through
  API-key or OAuth bearer authentication.

This epic exists because simply putting `pgm-admin` behind buttons would create
an unacceptable web-accessible blast radius. The work must start with
feasibility, threat modeling, and admin-boundary design before broad UI
implementation.

## Product Context

Primary users:

- Self-hosted Postgram operators who want setup and maintenance without CLI
  commands or manual `.env` edits.
- Managed-service operators provisioning or supporting private customer
  instances.
- Technical AI power users who can understand providers, models, API keys, and
  maintenance jobs but do not want to operate the system through shell commands.

Expected workflows:

1. Start the Docker Compose stack.
2. Visit the Postgram UI.
3. Complete a safe first-run bootstrap flow.
4. Configure admin identity, strong password, MFA, and optionally OIDC/OAuth
   login.
5. Configure embedding and extraction providers, models, dimensions, base URLs,
   and API keys from the UI.
6. Create and revoke Postgram API keys.
7. Inspect audit logs, stats, health, and queue state.
8. Run graph, memory, and embedding maintenance with dry-run previews,
   explicit confirmations, progress state, and audit trails.

Success means the happy path does not require `pgm-admin`, direct SQL, editing
runtime env files, or copy-pasting dangerous shell snippets after the container
is running.

## Technical Context

Current relevant areas:

- `src/cli/admin/pgm-admin.ts`: source inventory for privileged operations:
  `key`, `audit`, `model`, `reembed`, `reextract`, `prune-edges`,
  `validate-edges`, `improve-graph`, `link-neighbors`, `stats`,
  `embeddings migrate`, `memory groom`, `memory groom-durable`,
  `memory apply-durable-grooming`, `purge`, and `sql`.
- `src/auth/key-service.ts`: API-key creation, Argon2id key hashing,
  validation, revocation, scopes, type access, and visibility access.
- `src/auth/bearer.ts`, `src/auth/middleware.ts`: shared bearer validation for
  API keys and OAuth access tokens.
- `src/auth/oauth-service.ts`, `src/transport/oauth.ts`: existing remote MCP
  OAuth/DCR implementation. This is not an admin-login system, but it provides
  useful OAuth persistence and route patterns.
- `src/transport/rest.ts`: current authenticated REST API for user and agent
  workflows.
- `src/config.ts`, `src/index.ts`: startup-time configuration and provider
  construction. These are a major feasibility constraint for runtime
  configuration from the UI.
- `docker-compose.yml`: current single-compose stack with Postgres, backend,
  and UI services.
- `ui/src/App.tsx`, `ui/src/components/LoginScreen.tsx`,
  `ui/src/components/TopBar.tsx`, `ui/src/lib/api.ts`: current UI auth and API
  client shape. The UI stores API keys in localStorage and has Search, Graph,
  Projector, and Tasks pages.
- `tests/contract/oauth-routes.test.ts`, `tests/integration/key-service.test.ts`,
  `tests/integration/cli-admin.test.ts`, `ui/src/lib/api.test.ts`, and UI
  component tests: test patterns for auth, admin CLI behavior, API contracts,
  and frontend client flows.

Important existing constraints:

- Startup currently constructs embedding and extraction providers from process
  env. A UI-backed configuration system likely needs a DB-backed settings
  service plus a reload/restart strategy.
- API keys are for agents and users. Admin authentication must be separate from
  ordinary API-key bearer auth.
- Existing OAuth is for remote MCP connectors approved by an API key. Admin
  OAuth/OIDC login, if added, must be a separate security model.
- `pgm-admin sql` and broad purge operations are too dangerous to expose as
  ordinary web actions.

## Deliverables

- Feasibility research:
  - Inventory the current `pgm-admin` command surface and classify each command
    as safe web candidate, dangerous web candidate, or out of scope.
  - Decide which commands can be refactored into shared service APIs instead of
    shelling out to the CLI.
  - Decide which settings can become runtime-editable and which require a
    controlled restart or remain bootstrap-only.
  - Produce a threat model for the admin plane and bootstrap flow.
- Admin security architecture:
  - Separate admin authentication from API-key bearer auth.
  - Add first-run bootstrap design that avoids public instance takeover.
  - Support strong password storage and policy, admin sessions, logout, session
    expiry, rate limiting, lockout, CSRF protection, and audit logging.
  - Support MFA, with TOTP as the likely first implementation and WebAuthn as a
    possible later hardening path.
  - Support OAuth/OIDC admin login if feasible, explicitly separated from
    existing MCP connector OAuth.
  - Require step-up authentication or re-authentication for destructive and
    secret-changing actions.
- Admin API:
  - Add a dedicated admin API namespace and middleware, separate from `/api/*`
    bearer auth.
  - Expose typed, Zod-validated endpoints for the approved admin surfaces.
  - Preserve service-layer authorization, dry-run behavior, confirmation
    requirements, audit entries, and partial failure reporting.
  - Avoid exposing raw SQL and avoid generic command execution.
- Configuration system:
  - Add a DB-backed runtime settings model for provider/model/config choices.
  - Add secure secret storage for provider API keys and similar sensitive
    values, with a documented key management strategy.
  - Add validation and connection-test flows for embedding and extraction
    providers.
  - Add a strategy for applying settings: hot reload where safe, controlled
    restart/reinitialize where required, and explicit warnings where downtime or
    reprocessing is expected.
- Admin frontend:
  - Add a dedicated admin experience reachable after admin authentication.
  - Cover API-key management, model/provider configuration, graph maintenance,
    memory grooming, embedding maintenance, audit logs, stats, queue health, and
    system health.
  - Use dry-run previews, explicit confirmation controls, progress/status
    feedback, and safe defaults for expensive or destructive jobs.
  - Avoid making hidden or dangerous capabilities discoverable without
    context, warnings, and confirmation.
- Docker and deployment:
  - Provide a single Docker Compose setup for first-run bootstrap and normal
    operation.
  - Remove normal-operation dependence on `pgm-admin` and manual env-file edits
    for supported configuration.
  - Update `.env.example`, Docker Compose, README, and deployment docs when any
    runtime config value is added, renamed, or reclassified.
- Verification:
  - Add backend service, auth, admin API, and migration tests.
  - Add frontend API-client and component/flow tests.
  - Add integration or smoke coverage for the first-run Docker path.
  - Record security review findings and close all P1/P2 issues before final
    epic validation.

## Non-Goals

- Do not build a multi-tenant shared SaaS control plane in this epic.
- Do not add billing, Stripe, customer signup, or provisioning automation.
- Do not expose raw SQL execution in the web UI.
- Do not expose shell command execution from the web UI.
- Do not remove `pgm-admin`; it remains an emergency/operator fallback.
- Do not change the MCP connector OAuth flow unless needed to keep it isolated
  from admin login.
- Do not promise enterprise SSO, SCIM, policy engines, or organization-level
  RBAC in the first implementation.
- Do not use the existing localStorage API-key login as the admin security
  boundary.

## Assumptions

- The epic targets `main` and uses branch `codex/epic/admin-configuration-frontend`.
- The WDD profile is `full` because the work crosses auth, privileged
  mutations, persistence, secrets, deployment, and broad UI.
- The current REST/MCP API-key model remains available for agents and normal
  users.
- Admin users are installation-local for the first version.
- TOTP MFA is acceptable as the first MFA mechanism unless feasibility research
  proves WebAuthn is inexpensive enough to include.
- OAuth/OIDC admin login is desirable but must not block the core local-admin
  password plus MFA flow.
- Some configuration changes may require controlled restart or provider
  reinitialization; the UI can own and explain that flow.
- A secure bootstrap flow may require one minimal generated secret, bootstrap
  token, loopback-only setup mode, or equivalent guard. The feasibility phase
  must decide this explicitly.

## Constraints

- Admin APIs must not accept ordinary Postgram API keys as proof of admin
  authority.
- Admin sessions must use HttpOnly cookies or an equivalently hardened browser
  session mechanism, not long-lived bearer tokens in localStorage.
- Mutating admin endpoints must be CSRF-protected.
- Authentication and sensitive endpoints must be rate-limited and audited.
- Destructive, expensive, or broad maintenance operations must support dry-run
  preview where practical.
- Secret values must not be returned after storage except during one-time
  creation flows.
- Every admin mutation must record a useful audit entry that identifies the
  admin actor and operation.
- The UI must distinguish safe read-only diagnostics from dangerous actions.
- The Docker path must remain safe by default for localhost/self-host use and
  explicit about public exposure.
- Runtime configuration changes must not silently invalidate embedding
  dimensions or corrupt existing chunks.

## Risks

- The admin UI becomes a single high-value compromise point. This is the main
  security risk and must drive architecture, review, and validation.
- First-run bootstrap can be vulnerable to remote instance takeover if the
  setup screen is public before an admin exists.
- Existing configuration is process-env based; moving provider settings and
  secrets into the database may require significant provider lifecycle changes.
- Embedding dimension changes are not just a config edit. They affect storage,
  chunks, startup validation, and reembedding workflows.
- Shelling out to `pgm-admin` from the server would preserve CLI behavior but
  create command-injection, timeout, output parsing, and privilege-boundary
  hazards. Prefer service-layer refactors.
- Long-running maintenance jobs need progress, cancellation, idempotency, and
  audit semantics or the frontend will feel unreliable.
- OAuth/OIDC terminology can be confused with the existing MCP connector OAuth
  implementation. The epic must keep those boundaries explicit.
- Storing provider API keys in Postgres introduces secret-management and backup
  implications.
- A polished admin surface can make dangerous actions feel easier than they
  should; UX must keep friction where risk is real.

## Dependencies

- Existing `pgm-admin` command behavior and tests.
- Existing auth, API-key, OAuth, audit, queue, memory grooming, embedding, and
  graph services.
- Existing UI architecture and tests.
- Existing Docker Compose and environment documentation.
- A chosen bootstrap/security design before implementation moves beyond a
  prototype.
- A chosen runtime configuration model before model/provider UI work begins.

## Affected Areas

- Backend auth: `src/auth/*`.
- Backend admin services and middleware: likely new `src/admin/*` or
  `src/services/admin-*`.
- REST/admin transport: likely `src/transport/admin.ts` plus route
  registration in `src/index.ts`.
- Database migrations: admin users, sessions, MFA factors, runtime settings,
  secret metadata, job/progress state, and audit attribution if required.
- Configuration and provider lifecycle: `src/config.ts`, `src/index.ts`,
  embedding provider setup, extraction provider setup, and enrichment worker
  reload behavior.
- Admin CLI/service extraction: `src/cli/admin/pgm-admin.ts` and shared service
  modules.
- UI: `ui/src/App.tsx`, `ui/src/components/*`, `ui/src/lib/api.ts`, routing,
  auth/session flows, and admin pages.
- Docker/deployment docs: `docker-compose.yml`, `.env.example`, README, and
  deployment-facing documentation.
- Tests: integration, contract, unit, UI, and Docker/smoke validation.

## Validation Strategy

Use a feasibility gate before broad implementation:

1. Complete admin-surface inventory and threat model.
2. Prove a minimal admin auth/session/MFA flow with contract tests.
3. Prove one low-risk admin read API and one high-risk dry-run/apply API can be
   implemented through service-layer code without CLI shell-out.
4. Prove a DB-backed setting can be changed from the UI and safely applied or
   queued for controlled restart.
5. Prove first-run Docker bootstrap cannot be claimed remotely by an
   unauthenticated attacker under the supported deployment posture.

Focused verification should include:

- Auth/session/MFA service tests.
- Admin API contract tests for auth, CSRF, rate-limit/lockout, validation,
  audit, dry-run, and destructive confirmation behavior.
- Migration tests for new admin/config tables.
- Tests proving ordinary API keys and OAuth access tokens cannot call admin
  endpoints.
- UI tests for login, MFA enrollment/challenge, admin navigation, config forms,
  dry-run previews, confirmation states, and error handling.
- Focused `pgm-admin` regression tests when CLI code is refactored into shared
  services.
- Docker smoke test for first-run bootstrap and no-CLI happy path.
- Broad `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`,
  `npm --prefix ui run typecheck`, `npm --prefix ui run test -- --run`, and
  `npm --prefix ui run build` before final validation.
- Security review before merging any admin auth or destructive admin endpoint.

## Definition of Done

- [ ] Feasibility findings are documented and the core hypothesis is either
      proven or explicitly rejected with evidence.
- [ ] Admin-surface inventory classifies all current `pgm-admin` commands.
- [ ] Threat model covers bootstrap, auth, MFA, sessions, CSRF, rate limiting,
      secrets, destructive operations, audit, and Docker exposure.
- [ ] Admin auth is separate from API-key bearer auth.
- [ ] Strong password storage and policy, MFA, session lifecycle, CSRF, lockout,
      and audit requirements are implemented for the approved first scope.
- [ ] Ordinary API keys and MCP OAuth tokens cannot access admin endpoints.
- [ ] Runtime configuration frontend covers the approved first scope without
      manual env-file edits.
- [ ] API-key management, audit/stats, and at least one maintenance flow work
      from the admin UI with tests.
- [ ] Single Docker Compose first-run path is documented and verified.
- [ ] No raw SQL or shell-command execution is exposed through the web UI.
- [ ] Runtime configuration additions or changes are reflected in Docker and
      deployment-facing documentation.
- [ ] Task reviews have no unresolved P1/P2 findings.
- [ ] Epic validation passes.
- [ ] Final PR is ready for human review.

## Open Questions

- What exact first-run bootstrap posture should be used: loopback-only setup,
  generated bootstrap token, local-only one-time setup URL, Docker secret, or
  another approach?
- Should the first admin-login version support OIDC immediately, or should it
  ship password plus TOTP first with OIDC planned next?
- Is TOTP sufficient for the commercial beta, or should WebAuthn/passkeys be a
  first-version requirement?
- Which settings must be hot-reloadable, and which can be applied through a
  controlled restart or worker reinitialization?
- How should the app store encryption keys for provider secrets while still
  avoiding manual config-file edits?
- Should the admin frontend live inside the existing React app, a separate
  admin route/build, or a separate service behind the same reverse proxy?
- What minimum safe admin surface proves the hypothesis before implementing the
  full `pgm-admin` replacement?

## Planning Notes

Planned as seven tickets and eighteen tasks.

Tickets:

- TICKET-001-feasibility-security-design: feasibility inventory, threat model,
  and runtime configuration strategy.
- TICKET-002-admin-auth-foundation: admin identity, sessions, CSRF, MFA, lockout,
  step-up, and audit foundation.
- TICKET-003-admin-api-foundation: dedicated admin namespace, diagnostics,
  API-key management, audit, and stats endpoints.
- TICKET-004-runtime-configuration: DB-backed settings, secret storage,
  provider validation, and apply/reload behavior.
- TICKET-005-admin-frontend: protected admin shell, auth flow, operations views,
  and configuration UI.
- TICKET-006-maintenance-jobs: long-running maintenance job model, approved
  dry-run/apply admin APIs, and maintenance UI.
- TICKET-007-docker-e2e-validation: single Docker first-run validation,
  deployment docs, security review, and final epic validation.

Wave strategy:

- WAVE-001 bundles feasibility, threat model, and runtime-config research. It
  is the first gate and must be accepted before implementation waves proceed.
- WAVE-002 implements admin auth persistence.
- WAVE-003 implements admin session routes and middleware.
- WAVE-004 pairs MFA/step-up with settings and secret storage, because both
  depend on the session boundary and introduce migrations/security state.
- WAVE-005 pairs read-only admin API shell work with provider apply/reload
  behavior.
- WAVE-006 pairs API-key/audit/stats endpoints with the job foundation.
- WAVE-007 pairs admin auth UI with approved maintenance admin APIs.
- WAVE-008 pairs operations dashboard UI with runtime configuration UI.
- WAVE-009 implements maintenance UI.
- WAVE-010 validates single-compose first-run operation with no normal CLI path.
- WAVE-011 runs security-focused final epic validation.

The plan intentionally keeps raw SQL, generic shell execution, and ordinary
API-key bearer auth out of the admin boundary. The first wave should produce a
clear go/no-go on bootstrap posture, secret storage, runtime reload semantics,
and the subset of `pgm-admin` behavior eligible for a safe web surface.

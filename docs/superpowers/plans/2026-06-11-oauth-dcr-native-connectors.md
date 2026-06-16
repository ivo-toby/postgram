# OAuth DCR Native Connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OAuth authorization-code, PKCE, and Dynamic Client Registration support so Claude can connect to Postgram directly as a remote MCP connector.

**Architecture:** Implement native Hono OAuth routes backed by Postgres. OAuth grants are approved by an existing Postgram API key and resolve back into the existing `AuthContext`, preserving static Bearer auth and current permission checks.

**Tech Stack:** TypeScript, Hono, pg, Vitest, Testcontainers, `@modelcontextprotocol/sdk` Streamable HTTP client/server.

---

### Task 1: OAuth Persistence And Config

**Files:**
- Create: `src/db/migrations/009_oauth.sql`
- Modify: `src/config.ts`
- Test: `tests/integration/migration.test.ts`

- [ ] Add `OAUTH_ENABLED` and `PUBLIC_BASE_URL` parsing. `PUBLIC_BASE_URL` is required only when OAuth is enabled.
- [ ] Add OAuth tables for clients, authorization codes, and token grants.
- [ ] Verify migrations create the tables and indexes.

### Task 2: OAuth Services

**Files:**
- Create: `src/auth/oauth-service.ts`
- Create: `src/auth/bearer.ts`
- Modify: `src/auth/middleware.ts`
- Modify: `src/transport/mcp.ts`
- Test: `tests/integration/oauth-service.test.ts`

- [ ] Add DCR client registration and lookup.
- [ ] Add authorization-code creation, PKCE verification, token exchange, refresh rotation, token revocation, and access-token validation.
- [ ] Add shared bearer validation that accepts existing API keys first and OAuth access tokens second.
- [ ] Keep OAuth tokens live-bound to active source API keys.

### Task 3: OAuth HTTP Routes

**Files:**
- Create: `src/transport/oauth.ts`
- Modify: `src/index.ts`
- Test: `tests/contract/oauth-routes.test.ts`

- [ ] Register OAuth routes only when enabled.
- [ ] Serve OAuth authorization-server metadata and protected-resource metadata.
- [ ] Serve DCR registration, authorize GET/POST, token, and revoke endpoints.
- [ ] Return OAuth-shaped errors from OAuth endpoints, including `401 invalid_client` for missing/deleted clients at the token endpoint.

### Task 4: MCP Integration

**Files:**
- Modify: `src/transport/mcp.ts`
- Test: `tests/contract/mcp-oauth.test.ts`

- [ ] Authenticate `/mcp` with the shared bearer validator.
- [ ] Preserve existing API key and query `apiKey` behavior.
- [ ] Add `WWW-Authenticate` metadata hints for unauthenticated OAuth-enabled MCP requests.
- [ ] Prove an OAuth access token can list tools and call a scoped tool.

### Task 5: Documentation And Verification

**Files:**
- Modify: `README.md`

- [ ] Document `OAUTH_ENABLED`, `PUBLIC_BASE_URL`, and the Claude connector setup path.
- [ ] Run focused OAuth/MCP/auth tests.
- [ ] Run typecheck and full test suite if feasible.
- [ ] Run `git diff --check`.

# OAuth DCR Native Connectors Design

## Goal

Make Postgram usable as a native remote MCP connector in Claude Desktop, Claude Web, and mobile without `mcp-remote`, while keeping existing static Bearer API keys working unchanged.

## Decisions

- OAuth is opt-in. Routes are registered only when `OAUTH_ENABLED=true`.
- `PUBLIC_BASE_URL` is required when OAuth is enabled and is the source of truth for issuer, resource, and endpoint URLs.
- Dynamic Client Registration is supported so Claude can register itself without manual client setup.
- OAuth authorization uses an existing Postgram API key as the approval credential.
- OAuth access and refresh tokens are live-bound to the source API key. If the API key is revoked, OAuth tokens derived from it stop working.
- OAuth tokens resolve to the existing `AuthContext`; Postgram does not add a second permission model.
- Existing static Bearer API keys and `/mcp?apiKey=...` compatibility remain unchanged.

## OAuth Surface

When enabled, Postgram serves:

- `/.well-known/oauth-authorization-server`
- `/.well-known/oauth-protected-resource/mcp`
- `/oauth/register`
- `/oauth/authorize`
- `/oauth/token`
- `/oauth/revoke`

The protected resource is `${PUBLIC_BASE_URL}/mcp`. The authorization server issuer is `PUBLIC_BASE_URL`.

## Flow

Claude discovers protected resource metadata, discovers authorization server metadata, dynamically registers a public client, opens `/oauth/authorize`, and later calls `/oauth/token`.

`/oauth/authorize` validates the registered client, redirect URI, PKCE S256 challenge, and optional resource parameter. It renders a minimal HTML page with an API-key field. Posting a valid Postgram API key creates a short-lived authorization code bound to the client, redirect URI, PKCE challenge, resource, and source `api_key_id`.

`/oauth/token` exchanges a valid code and verifier for bearer tokens. Refresh tokens rotate. Deleted clients return `401` with `invalid_client`, so Claude can re-register. Revoked source API keys return `401`.

`/mcp` authenticates bearer tokens through a shared bearer validator. It first tries the existing static API-key validator, then tries OAuth access-token validation. Both paths return the same `AuthContext`.

## Persistence

Add tables for OAuth clients, authorization codes, and tokens. Secrets and tokens are stored as SHA-256 hashes of high-entropy random values. Authorization codes expire quickly and are single-use. Access tokens are short-lived; refresh tokens are longer-lived and rotate on use.

## Testing

Contract coverage must prove:

- OAuth routes are absent unless explicitly enabled.
- Metadata URLs are built from `PUBLIC_BASE_URL`.
- DCR registers a client.
- Authorization code + PKCE exchange issues tokens.
- OAuth access tokens can call MCP tools.
- Existing API keys still call MCP tools.
- Revoking the source API key invalidates OAuth access.
- Deleting a DCR client makes token refresh return `401 invalid_client`.

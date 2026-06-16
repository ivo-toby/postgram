import { createHash, randomBytes } from 'node:crypto';

import type { Hono } from 'hono';
import { expect } from 'vitest';

import { createKey } from '../../src/auth/key-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import type { TestDatabase } from './postgres.js';

export const OAUTH_PUBLIC_BASE_URL = 'https://postgram.example.test';
export const OAUTH_RESOURCE = `${OAUTH_PUBLIC_BASE_URL}/mcp`;
export const OAUTH_REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';

type OAuthApp = Hono<{ Variables: { auth: AuthContext } }>;

export function createPkcePair(): {
  verifier: string;
  challenge: string;
} {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256')
    .update(verifier)
    .digest('base64url');

  return { verifier, challenge };
}

export async function registerOAuthClient(
  app: OAuthApp
): Promise<{ clientId: string }> {
  const response = await app.request('/oauth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_name: 'Claude Connector',
      redirect_uris: [OAUTH_REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    })
  });

  expect(response.status).toBe(201);
  const body = (await response.json()) as { client_id: string };
  expect(body.client_id).toEqual(expect.any(String));

  return { clientId: body.client_id };
}

export async function authorizeAndExchangeOAuthToken(
  app: OAuthApp,
  database: TestDatabase,
  input: {
    clientId: string;
    keyName?: string;
  }
): Promise<{
  accessToken: string;
  refreshToken: string;
  apiKeyId: string;
  clientId: string;
}> {
  const created = (
    await createKey(database.pool, {
      name: input.keyName ?? `oauth-${crypto.randomUUID()}`,
      clientId: 'claude-connectors',
      scopes: ['read', 'write', 'delete'],
      allowedVisibility: ['shared', 'work', 'personal']
    })
  )._unsafeUnwrap();

  const pkce = createPkcePair();
  const authorizeBody = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: OAUTH_REDIRECT_URI,
    state: 'connector-state',
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    resource: OAUTH_RESOURCE,
    api_key: created.plaintextKey
  });

  const authorizeResponse = await app.request('/oauth/authorize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: authorizeBody.toString(),
    redirect: 'manual'
  });

  expect(authorizeResponse.status).toBe(302);
  const location = authorizeResponse.headers.get('Location');
  expect(location).toEqual(expect.any(String));

  const callbackUrl = new URL(location ?? '');
  expect(callbackUrl.origin + callbackUrl.pathname).toBe(OAUTH_REDIRECT_URI);
  expect(callbackUrl.searchParams.get('state')).toBe('connector-state');
  const code = callbackUrl.searchParams.get('code');
  expect(code).toEqual(expect.any(String));

  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: input.clientId,
    code: code ?? '',
    redirect_uri: OAUTH_REDIRECT_URI,
    code_verifier: pkce.verifier,
    resource: OAUTH_RESOURCE
  });

  const tokenResponse = await app.request('/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: tokenBody.toString()
  });

  expect(tokenResponse.status).toBe(200);
  const tokenPayload = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
  };
  expect(tokenPayload).toMatchObject({
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'read write delete'
  });
  expect(tokenPayload.access_token).toEqual(expect.any(String));
  expect(tokenPayload.refresh_token).toEqual(expect.any(String));

  return {
    accessToken: tokenPayload.access_token,
    refreshToken: tokenPayload.refresh_token,
    apiKeyId: created.record.id,
    clientId: input.clientId
  };
}

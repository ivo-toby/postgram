import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import type { AuthContext, Scope } from './types.js';
import { validateKey } from './key-service.js';

export const OAUTH_SCOPES: Scope[] = ['read', 'write', 'delete', 'sync'];
export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 3600;
const OAUTH_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const OAUTH_AUTHORIZATION_CODE_TTL_SECONDS = 10 * 60;
const TOKEN_ENDPOINT_AUTH_METHOD = 'none';

export type OAuthClientRecord = {
  clientId: string;
  clientName: string | null;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: 'none';
  scope: string | null;
  clientUri: string | null;
  logoUri: string | null;
  contacts: string[] | null;
  createdAt: string;
};

export type OAuthClientRegistrationInput = {
  client_name?: string | undefined;
  redirect_uris?: string[] | undefined;
  grant_types?: string[] | undefined;
  response_types?: string[] | undefined;
  token_endpoint_auth_method?: string | undefined;
  scope?: string | undefined;
  client_uri?: string | undefined;
  logo_uri?: string | undefined;
  contacts?: string[] | undefined;
};

export type OAuthTokenPayload = {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
};

export class OAuthHttpError extends Error {
  status: 400 | 401 | 403;
  oauthError: string;

  constructor(
    status: 400 | 401 | 403,
    oauthError: string,
    description: string
  ) {
    super(description);
    this.name = 'OAuthHttpError';
    this.status = status;
    this.oauthError = oauthError;
  }
}

type OAuthClientRow = {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: 'none';
  scope: string | null;
  client_uri: string | null;
  logo_uri: string | null;
  contacts: string[] | null;
  created_at: Date;
};

type AuthorizationCodeRow = {
  code_hash: string;
  client_id: string;
  api_key_id: string;
  redirect_uri: string;
  scopes: Scope[];
  code_challenge: string;
  resource: string | null;
  expires_at: Date;
  consumed_at: Date | null;
};

type ApiKeyAuthRow = {
  id: string;
  name: string;
  client_id: string;
  scopes: Scope[];
  allowed_types: AuthContext['allowedTypes'];
  allowed_visibility: AuthContext['allowedVisibility'];
};

type OAuthTokenRow = {
  client_id: string;
  api_key_id: string;
  scopes: Scope[];
  resource: string | null;
  refresh_expires_at: Date;
};

function mapOAuthClient(row: OAuthClientRow): OAuthClientRecord {
  return {
    clientId: row.client_id,
    clientName: row.client_name,
    redirectUris: row.redirect_uris,
    grantTypes: row.grant_types,
    responseTypes: row.response_types,
    tokenEndpointAuthMethod: row.token_endpoint_auth_method,
    scope: row.scope,
    clientUri: row.client_uri,
    logoUri: row.logo_uri,
    contacts: row.contacts,
    createdAt: row.created_at.toISOString()
  };
}

export function normalizePublicBaseUrl(publicBaseUrl: string): string {
  const parsed = new URL(publicBaseUrl);
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');

  return parsed.toString().replace(/\/$/, '');
}

export function getOAuthResource(publicBaseUrl: string): string {
  return `${normalizePublicBaseUrl(publicBaseUrl)}/mcp`;
}

export function getOAuthProtectedResourceMetadataUrl(
  publicBaseUrl: string
): string {
  return `${normalizePublicBaseUrl(publicBaseUrl)}/.well-known/oauth-protected-resource/mcp`;
}

function hashOpaqueValue(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function generateOpaqueValue(prefix: string): string {
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}

function expiresIn(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

function toEpochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function isHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.hostname === 'localhost'
      || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function assertRedirectUris(value: string[] | undefined): string[] {
  if (!value || value.length === 0) {
    throw new OAuthHttpError(
      400,
      'invalid_client_metadata',
      'redirect_uris must contain at least one URI'
    );
  }

  for (const uri of value) {
    if (!isHttpsUrl(uri)) {
      throw new OAuthHttpError(
        400,
        'invalid_client_metadata',
        'redirect_uris must contain valid HTTPS URLs'
      );
    }
  }

  return value;
}

function assertRegistrationDefaults(input: OAuthClientRegistrationInput): {
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: 'none';
} {
  const grantTypes = input.grant_types ?? [
    'authorization_code',
    'refresh_token'
  ];
  const responseTypes = input.response_types ?? ['code'];
  const tokenEndpointAuthMethod =
    input.token_endpoint_auth_method ?? TOKEN_ENDPOINT_AUTH_METHOD;

  if (!grantTypes.includes('authorization_code')) {
    throw new OAuthHttpError(
      400,
      'invalid_client_metadata',
      'grant_types must include authorization_code'
    );
  }

  if (!responseTypes.includes('code')) {
    throw new OAuthHttpError(
      400,
      'invalid_client_metadata',
      'response_types must include code'
    );
  }

  if (tokenEndpointAuthMethod !== TOKEN_ENDPOINT_AUTH_METHOD) {
    throw new OAuthHttpError(
      400,
      'invalid_client_metadata',
      'Only public clients with token_endpoint_auth_method=none are supported'
    );
  }

  return {
    grantTypes,
    responseTypes,
    tokenEndpointAuthMethod
  };
}

function assertResource(
  resource: string | undefined,
  publicBaseUrl: string
): string | null {
  if (!resource) {
    return null;
  }

  const expected = getOAuthResource(publicBaseUrl);
  if (resource !== expected) {
    throw new OAuthHttpError(
      400,
      'invalid_target',
      'OAuth resource does not match this MCP server'
    );
  }

  return resource;
}

function assertPkce(
  codeVerifier: string,
  codeChallenge: string
): void {
  const actual = createHash('sha256').update(codeVerifier).digest('base64url');
  const expected = Buffer.from(codeChallenge);
  const received = Buffer.from(actual);

  if (
    expected.length !== received.length
    || !timingSafeEqual(expected, received)
  ) {
    throw new OAuthHttpError(
      400,
      'invalid_grant',
      'PKCE verifier does not match the authorization code'
    );
  }
}

function mapApiKeyAuth(row: ApiKeyAuthRow): AuthContext {
  return {
    apiKeyId: row.id,
    keyName: row.name,
    clientId: row.client_id,
    scopes: row.scopes,
    allowedTypes: row.allowed_types,
    allowedVisibility: row.allowed_visibility
  };
}

async function getActiveApiKeyAuth(
  client: Pool | PoolClient,
  apiKeyId: string
): Promise<AuthContext | null> {
  const result = await client.query<ApiKeyAuthRow>(
    `
      SELECT
        id,
        name,
        client_id,
        scopes,
        allowed_types,
        allowed_visibility
      FROM api_keys
      WHERE id = $1
        AND is_active = true
    `,
    [apiKeyId]
  );

  const row = result.rows[0];
  return row ? mapApiKeyAuth(row) : null;
}

export async function registerOAuthClient(
  pool: Pool,
  input: OAuthClientRegistrationInput
): Promise<OAuthClientRecord> {
  const redirectUris = assertRedirectUris(input.redirect_uris);
  const {
    grantTypes,
    responseTypes,
    tokenEndpointAuthMethod
  } = assertRegistrationDefaults(input);
  const clientId = generateOpaqueValue('pgo_client_');

  const result = await pool.query<OAuthClientRow>(
    `
      INSERT INTO oauth_clients (
        client_id,
        client_name,
        redirect_uris,
        grant_types,
        response_types,
        token_endpoint_auth_method,
        scope,
        client_uri,
        logo_uri,
        contacts
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `,
    [
      clientId,
      input.client_name ?? null,
      redirectUris,
      grantTypes,
      responseTypes,
      tokenEndpointAuthMethod,
      input.scope ?? null,
      input.client_uri ?? null,
      input.logo_uri ?? null,
      input.contacts ?? null
    ]
  );

  const row = result.rows[0];
  if (!row) {
    throw new OAuthHttpError(
      400,
      'server_error',
      'Failed to register OAuth client'
    );
  }

  return mapOAuthClient(row);
}

export async function getOAuthClient(
  pool: Pool | PoolClient,
  clientId: string
): Promise<OAuthClientRecord | null> {
  const result = await pool.query<OAuthClientRow>(
    'SELECT * FROM oauth_clients WHERE client_id = $1',
    [clientId]
  );

  const row = result.rows[0];
  return row ? mapOAuthClient(row) : null;
}

async function requireOAuthClient(
  pool: Pool | PoolClient,
  clientId: string
): Promise<OAuthClientRecord> {
  const client = await getOAuthClient(pool, clientId);
  if (!client) {
    throw new OAuthHttpError(
      401,
      'invalid_client',
      'OAuth client is not registered'
    );
  }

  return client;
}

export async function createAuthorizationCode(
  pool: Pool,
  input: {
    publicBaseUrl: string;
    responseType: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    resource?: string | undefined;
    apiKey: string;
  }
): Promise<string> {
  if (input.responseType !== 'code') {
    throw new OAuthHttpError(400, 'unsupported_response_type', 'Use response_type=code');
  }
  if (!input.codeChallenge || input.codeChallengeMethod !== 'S256') {
    throw new OAuthHttpError(
      400,
      'invalid_request',
      'PKCE S256 code_challenge is required'
    );
  }

  const client = await requireOAuthClient(pool, input.clientId);
  if (!client.redirectUris.includes(input.redirectUri)) {
    throw new OAuthHttpError(
      400,
      'invalid_request',
      'redirect_uri is not registered for this client'
    );
  }

  const resource = assertResource(input.resource, input.publicBaseUrl);
  const validated = await validateKey(pool, input.apiKey);
  if (validated.isErr()) {
    throw new OAuthHttpError(401, 'access_denied', 'Invalid Postgram API key');
  }

  const auth = validated.value;
  if (!auth.apiKeyId) {
    throw new OAuthHttpError(
      401,
      'access_denied',
      'Postgram API key id is required'
    );
  }

  const code = generateOpaqueValue('pgo_code_');
  await pool.query(
    `
      INSERT INTO oauth_authorization_codes (
        code_hash,
        client_id,
        api_key_id,
        redirect_uri,
        scopes,
        code_challenge,
        code_challenge_method,
        resource,
        expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'S256', $7, $8)
    `,
    [
      hashOpaqueValue(code),
      input.clientId,
      auth.apiKeyId,
      input.redirectUri,
      auth.scopes,
      input.codeChallenge,
      resource,
      expiresIn(OAUTH_AUTHORIZATION_CODE_TTL_SECONDS)
    ]
  );

  return code;
}

async function issueTokenGrant(
  client: Pool | PoolClient,
  input: {
    clientId: string;
    apiKeyId: string;
    scopes: Scope[];
    resource: string | null;
  }
): Promise<OAuthTokenPayload> {
  const accessToken = generateOpaqueValue('pgo_access_');
  const refreshToken = generateOpaqueValue('pgo_refresh_');
  const accessExpiresAt = expiresIn(OAUTH_ACCESS_TOKEN_TTL_SECONDS);
  const refreshExpiresAt = expiresIn(OAUTH_REFRESH_TOKEN_TTL_SECONDS);

  await client.query(
    `
      INSERT INTO oauth_tokens (
        access_token_hash,
        refresh_token_hash,
        client_id,
        api_key_id,
        scopes,
        resource,
        access_expires_at,
        refresh_expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      hashOpaqueValue(accessToken),
      hashOpaqueValue(refreshToken),
      input.clientId,
      input.apiKeyId,
      input.scopes,
      input.resource,
      accessExpiresAt,
      refreshExpiresAt
    ]
  );

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    scope: input.scopes.join(' ')
  };
}

export async function exchangeAuthorizationCode(
  pool: Pool,
  input: {
    publicBaseUrl: string;
    clientId: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
    resource?: string | undefined;
  }
): Promise<OAuthTokenPayload> {
  const resource = assertResource(input.resource, input.publicBaseUrl);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await requireOAuthClient(client, input.clientId);

    const result = await client.query<AuthorizationCodeRow>(
      `
        SELECT *
        FROM oauth_authorization_codes
        WHERE code_hash = $1
        FOR UPDATE
      `,
      [hashOpaqueValue(input.code)]
    );
    const code = result.rows[0];

    if (
      !code
      || code.client_id !== input.clientId
      || code.redirect_uri !== input.redirectUri
      || code.consumed_at
      || code.expires_at.getTime() <= Date.now()
      || code.resource !== resource
    ) {
      throw new OAuthHttpError(
        400,
        'invalid_grant',
        'Authorization code is invalid'
      );
    }

    assertPkce(input.codeVerifier, code.code_challenge);

    const auth = await getActiveApiKeyAuth(client, code.api_key_id);
    if (!auth) {
      throw new OAuthHttpError(
        401,
        'invalid_grant',
        'Source API key is no longer active'
      );
    }

    await client.query(
      `
        UPDATE oauth_authorization_codes
        SET consumed_at = now()
        WHERE code_hash = $1
      `,
      [code.code_hash]
    );

    const tokens = await issueTokenGrant(client, {
      clientId: input.clientId,
      apiKeyId: code.api_key_id,
      scopes: code.scopes,
      resource: code.resource
    });

    await client.query('COMMIT');
    return tokens;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function refreshOAuthToken(
  pool: Pool,
  input: {
    publicBaseUrl: string;
    clientId: string;
    refreshToken: string;
    resource?: string | undefined;
  }
): Promise<OAuthTokenPayload> {
  const resource = assertResource(input.resource, input.publicBaseUrl);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await requireOAuthClient(client, input.clientId);

    const result = await client.query<OAuthTokenRow>(
      `
        SELECT
          client_id,
          api_key_id,
          scopes,
          resource,
          refresh_expires_at
        FROM oauth_tokens
        WHERE refresh_token_hash = $1
          AND revoked_at IS NULL
        FOR UPDATE
      `,
      [hashOpaqueValue(input.refreshToken)]
    );
    const token = result.rows[0];

    if (
      !token
      || token.client_id !== input.clientId
      || token.refresh_expires_at.getTime() <= Date.now()
      || token.resource !== resource
    ) {
      throw new OAuthHttpError(400, 'invalid_grant', 'Refresh token is invalid');
    }

    const auth = await getActiveApiKeyAuth(client, token.api_key_id);
    if (!auth) {
      throw new OAuthHttpError(
        401,
        'invalid_grant',
        'Source API key is no longer active'
      );
    }

    await client.query(
      `
        UPDATE oauth_tokens
        SET revoked_at = now()
        WHERE refresh_token_hash = $1
      `,
      [hashOpaqueValue(input.refreshToken)]
    );

    const tokens = await issueTokenGrant(client, {
      clientId: input.clientId,
      apiKeyId: token.api_key_id,
      scopes: token.scopes,
      resource: token.resource
    });

    await client.query('COMMIT');
    return tokens;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function validateOAuthAccessToken(
  pool: Pool,
  accessToken: string
): Promise<AuthContext | null> {
  const result = await pool.query<ApiKeyAuthRow & { access_expires_at: Date }>(
    `
      SELECT
        k.id,
        k.name,
        k.client_id,
        k.scopes,
        k.allowed_types,
        k.allowed_visibility,
        t.access_expires_at
      FROM oauth_tokens t
      JOIN oauth_clients c ON c.client_id = t.client_id
      JOIN api_keys k ON k.id = t.api_key_id
      WHERE t.access_token_hash = $1
        AND t.revoked_at IS NULL
        AND t.access_expires_at > now()
        AND k.is_active = true
      LIMIT 1
    `,
    [hashOpaqueValue(accessToken)]
  );

  const row = result.rows[0];
  return row ? mapApiKeyAuth(row) : null;
}

export async function revokeOAuthToken(
  pool: Pool,
  input: {
    clientId: string;
    token: string;
  }
): Promise<void> {
  await requireOAuthClient(pool, input.clientId);
  const tokenHash = hashOpaqueValue(input.token);
  await pool.query(
    `
      UPDATE oauth_tokens
      SET revoked_at = now()
      WHERE client_id = $1
        AND (access_token_hash = $2 OR refresh_token_hash = $2)
    `,
    [input.clientId, tokenHash]
  );
}

export function toOAuthClientRegistrationResponse(client: OAuthClientRecord) {
  return {
    client_id: client.clientId,
    client_id_issued_at: toEpochSeconds(new Date(client.createdAt)),
    redirect_uris: client.redirectUris,
    grant_types: client.grantTypes,
    response_types: client.responseTypes,
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    ...(client.clientName ? { client_name: client.clientName } : {}),
    ...(client.scope ? { scope: client.scope } : {}),
    ...(client.clientUri ? { client_uri: client.clientUri } : {}),
    ...(client.logoUri ? { logo_uri: client.logoUri } : {}),
    ...(client.contacts ? { contacts: client.contacts } : {})
  };
}

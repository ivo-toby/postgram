import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import { revokeKey } from '../../src/auth/key-service.js';
import { createApp } from '../../src/index.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';
import {
  authorizeAndExchangeOAuthToken,
  OAUTH_PUBLIC_BASE_URL,
  OAUTH_REDIRECT_URI,
  OAUTH_RESOURCE,
  registerOAuthClient
} from '../helpers/oauth.js';

describe('OAuth connector routes', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await resetTestDatabase(database.pool);
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('does not expose OAuth metadata unless OAuth is enabled', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const app = createApp({ pool: database.pool });

    const authorizationServer = await app.request(
      '/.well-known/oauth-authorization-server'
    );
    const protectedResource = await app.request(
      '/.well-known/oauth-protected-resource/mcp'
    );

    expect(authorizationServer.status).toBe(404);
    expect(protectedResource.status).toBe(404);
  });

  it('serves OAuth metadata from PUBLIC_BASE_URL', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const app = createApp({
      pool: database.pool,
      oauth: {
        enabled: true,
        publicBaseUrl: OAUTH_PUBLIC_BASE_URL
      }
    });

    const authorizationServer = await app.request(
      '/.well-known/oauth-authorization-server'
    );
    const authorizationServerBody: unknown = await authorizationServer.json();
    expect(authorizationServer.status).toBe(200);
    expect(authorizationServerBody).toMatchObject({
      issuer: OAUTH_PUBLIC_BASE_URL,
      authorization_endpoint: `${OAUTH_PUBLIC_BASE_URL}/oauth/authorize`,
      token_endpoint: `${OAUTH_PUBLIC_BASE_URL}/oauth/token`,
      registration_endpoint: `${OAUTH_PUBLIC_BASE_URL}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['read', 'write', 'delete', 'sync']
    });

    const protectedResource = await app.request(
      '/.well-known/oauth-protected-resource/mcp'
    );
    const protectedResourceBody: unknown = await protectedResource.json();
    expect(protectedResource.status).toBe(200);
    expect(protectedResourceBody).toMatchObject({
      resource: OAUTH_RESOURCE,
      authorization_servers: [OAUTH_PUBLIC_BASE_URL],
      scopes_supported: ['read', 'write', 'delete', 'sync'],
      resource_name: 'Postgram MCP'
    });
  });

  it('registers a public OAuth client through DCR', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const app = createApp({
      pool: database.pool,
      oauth: {
        enabled: true,
        publicBaseUrl: OAUTH_PUBLIC_BASE_URL
      }
    });

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

    const body = (await response.json()) as {
      client_id: string;
      client_id_issued_at: number;
      redirect_uris: string[];
      grant_types: string[];
      response_types: string[];
      token_endpoint_auth_method: string;
    };

    expect(response.status).toBe(201);
    expect(body.client_id).toEqual(expect.any(String));
    expect(body.client_id_issued_at).toEqual(expect.any(Number));
    expect(body).toMatchObject({
      redirect_uris: [OAUTH_REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    });
  });

  it('exchanges an API-key-approved PKCE code for OAuth tokens', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const app = createApp({
      pool: database.pool,
      oauth: {
        enabled: true,
        publicBaseUrl: OAUTH_PUBLIC_BASE_URL
      }
    });
    const { clientId } = await registerOAuthClient(app);

    await authorizeAndExchangeOAuthToken(app, database, { clientId });
  }, 120_000);

  it('invalidates OAuth grants when the source API key is revoked', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const app = createApp({
      pool: database.pool,
      oauth: {
        enabled: true,
        publicBaseUrl: OAUTH_PUBLIC_BASE_URL
      }
    });
    const { clientId } = await registerOAuthClient(app);
    const tokens = await authorizeAndExchangeOAuthToken(app, database, {
      clientId
    });

    await revokeKey(database.pool, tokens.apiKeyId);

    const refreshResponse = await app.request('/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: tokens.refreshToken,
        resource: OAUTH_RESOURCE
      }).toString()
    });
    const body: unknown = await refreshResponse.json();

    expect(refreshResponse.status).toBe(401);
    expect(body).toEqual({
      error: 'invalid_grant',
      error_description: 'Source API key is no longer active'
    });
  }, 120_000);

  it('returns invalid_client when a DCR client has been deleted', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const app = createApp({
      pool: database.pool,
      oauth: {
        enabled: true,
        publicBaseUrl: OAUTH_PUBLIC_BASE_URL
      }
    });
    const { clientId } = await registerOAuthClient(app);
    const tokens = await authorizeAndExchangeOAuthToken(app, database, {
      clientId
    });

    await database.pool.query('DELETE FROM oauth_clients WHERE client_id = $1', [
      clientId
    ]);

    const refreshResponse = await app.request('/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: tokens.refreshToken,
        resource: OAUTH_RESOURCE
      }).toString()
    });
    const body: unknown = await refreshResponse.json();

    expect(refreshResponse.status).toBe(401);
    expect(body).toEqual({
      error: 'invalid_client',
      error_description: 'OAuth client is not registered'
    });
  }, 120_000);
});

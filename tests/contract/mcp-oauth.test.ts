import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { revokeKey } from '../../src/auth/key-service.js';
import { createApp } from '../../src/index.js';
import { createEmbeddingService } from '../../src/services/embedding-service.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';
import {
  authorizeAndExchangeOAuthToken,
  OAUTH_PUBLIC_BASE_URL,
  registerOAuthClient
} from '../helpers/oauth.js';

describe('MCP OAuth authentication', () => {
  let database: TestDatabase | undefined;
  let server: ReturnType<typeof serve> | undefined;
  let baseUrl = '';

  beforeAll(async () => {
    database = await createTestDatabase();
    if (!database) {
      throw new Error('test database not initialized');
    }

    const app = createApp({
      pool: database.pool,
      embeddingService: createEmbeddingService(),
      oauth: {
        enabled: true,
        publicBaseUrl: OAUTH_PUBLIC_BASE_URL
      }
    });

    server = serve(
      { fetch: app.fetch, hostname: '127.0.0.1', port: 0 },
      (info) => {
        baseUrl = `http://${info.address}:${info.port}`;
      }
    );
  }, 120_000);

  beforeEach(async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await resetTestDatabase(database.pool);
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server?.close(() => resolve());
      });
    }

    if (database) {
      await database.close();
    }
  });

  async function connectWithToken(accessToken: string): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(
      new URL('/mcp', baseUrl),
      {
        requestInit: {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      }
    );
    const client = new Client(
      { name: 'postgram-oauth-test-client', version: '0.1.0' },
      { capabilities: {} }
    );
    await client.connect(transport as unknown as Transport);

    return client;
  }

  it('accepts OAuth access tokens for Streamable HTTP MCP', async () => {
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

    const client = await connectWithToken(tokens.accessToken);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain('store');
    } finally {
      await client.close();
    }
  }, 120_000);

  it('rejects OAuth access tokens after the source API key is revoked', async () => {
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

    await expect(connectWithToken(tokens.accessToken)).rejects.toThrow();
  }, 120_000);
});

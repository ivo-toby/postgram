import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Pool } from 'pg';

import type { AuthContext } from '../../src/auth/types.js';
import { createSessionServer } from '../../src/transport/mcp.js';

const auth: AuthContext = {
  apiKeyId: null,
  keyName: 'in-memory-test',
  clientId: null,
  scopes: ['read', 'write', 'delete'],
  allowedTypes: null,
  allowedVisibility: ['personal', 'work', 'shared']
};

/**
 * Connects a client to a session server without a database. Use it for
 * tests that read what the server advertises (instructions, tool list), not
 * for tests that call tools.
 */
export async function connectInMemoryMcpClient(): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const server = createSessionServer({} as Pool, auth);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'in-memory-test', version: '0.0.0' });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    }
  };
}

/** Tool names, input property names and enum values the server advertises. */
export async function advertisedVocabulary(client: Client): Promise<{
  toolNames: Set<string>;
  words: Set<string>;
}> {
  const { tools } = await client.listTools();
  const toolNames = new Set(tools.map((tool) => tool.name));
  const words = new Set(toolNames);

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== 'object' || node === null) return;

    const schema = node as Record<string, unknown>;
    if (typeof schema.properties === 'object' && schema.properties !== null) {
      Object.keys(schema.properties).forEach((key) => words.add(key));
    }
    if (Array.isArray(schema.enum)) {
      schema.enum.forEach((value) => {
        if (typeof value === 'string') words.add(value);
      });
    }
    Object.values(schema).forEach(visit);
  };

  tools.forEach((tool) => visit(tool.inputSchema));

  return { toolNames, words };
}

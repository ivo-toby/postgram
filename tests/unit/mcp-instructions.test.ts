import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { MCP_SERVER_INSTRUCTIONS } from '../../src/transport/mcp-instructions.js';
import {
  advertisedVocabulary,
  connectInMemoryMcpClient
} from '../helpers/mcp-in-memory.js';

// Claude Code cuts server instructions after 4,096 characters.
const CLIENT_INSTRUCTION_LIMIT = 4096;

describe('MCP server instructions', () => {
  let client: Client;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ client, close } = await connectInMemoryMcpClient());
  });

  afterAll(async () => {
    await close();
  });

  it('sends the instructions to the client on initialize', () => {
    expect(MCP_SERVER_INSTRUCTIONS.length).toBeGreaterThan(0);
    expect(client.getInstructions()).toBe(MCP_SERVER_INSTRUCTIONS);
  });

  it('stays under the limit at which clients cut instructions', () => {
    expect(MCP_SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(
      CLIENT_INSTRUCTION_LIMIT
    );
  });

  it('names only tools, parameters and values the server advertises', async () => {
    const { words } = await advertisedVocabulary(client);
    const named = [...MCP_SERVER_INSTRUCTIONS.matchAll(/`([^`]+)`/g)].map(
      (match) => match[1]
    );

    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((word) => !words.has(word ?? ''))).toEqual([]);
  });

  it('covers when to search, store, keep session context and track tasks', () => {
    for (const tool of [
      'search',
      'recall',
      'store',
      'store_session_context',
      'task_create',
      'where'
    ]) {
      expect(MCP_SERVER_INSTRUCTIONS).toContain(`\`${tool}\``);
    }
  });
});

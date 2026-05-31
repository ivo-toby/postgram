import { describe, expect, it } from 'vitest';

import {
  buildSessionContextMetadata,
  getMemoryRole,
  isSessionContextMemory
} from '../../src/services/memory-role-service.js';

describe('memory-role-service', () => {
  it('treats missing memory_role as durable_memory', () => {
    expect(getMemoryRole({})).toBe('durable_memory');
  });

  it('detects session_context memory', () => {
    expect(isSessionContextMemory({
      type: 'memory',
      metadata: { memory_role: 'session_context' }
    })).toBe(true);
  });

  it('defaults session scope from client_id', () => {
    expect(buildSessionContextMetadata({
      existing: {},
      auth: {
        apiKeyId: 'key-1',
        keyName: 'codex-key',
        clientId: 'codex-desktop'
      },
      input: { topic: 'postgram-memory', agentId: 'codex' }
    })).toEqual({
      memory_role: 'session_context',
      session_scope: { kind: 'client', client_id: 'codex-desktop' },
      topic: 'postgram-memory',
      agent_id: 'codex'
    });
  });
});

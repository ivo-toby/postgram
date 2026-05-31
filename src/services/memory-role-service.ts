import type { AuthContext } from '../auth/types.js';
import type { Visibility } from '../types/entities.js';

export type MemoryRole = 'durable_memory' | 'session_context';

export type SessionContextInput = {
  content: string;
  visibility?: Visibility | undefined;
  owner?: string | undefined;
  sessionId?: string | undefined;
  agentId?: string | undefined;
  topic?: string | undefined;
  tags?: string[] | undefined;
  promotable?: boolean | undefined;
  groomAfter?: string | undefined;
  expiresAt?: string | undefined;
};

export function getMemoryRole(
  metadata: Record<string, unknown> | null | undefined
): MemoryRole {
  return metadata?.memory_role === 'session_context'
    ? 'session_context'
    : 'durable_memory';
}

export function isSessionContextMemory(entity: {
  type: string;
  metadata: Record<string, unknown> | null | undefined;
}): boolean {
  return entity.type === 'memory' && getMemoryRole(entity.metadata) === 'session_context';
}

export function buildSessionContextMetadata({
  existing,
  auth,
  input
}: {
  existing?: Record<string, unknown> | undefined;
  auth: Pick<AuthContext, 'clientId' | 'apiKeyId' | 'keyName'>;
  input: {
    sessionId?: string | undefined;
    agentId?: string | undefined;
    topic?: string | undefined;
    promotable?: boolean | undefined;
    groomAfter?: string | undefined;
    expiresAt?: string | undefined;
  };
}): Record<string, unknown> {
  const sessionScope = auth.clientId
    ? { kind: 'client', client_id: auth.clientId }
    : { kind: 'api_key', api_key_id: auth.apiKeyId, api_key_name: auth.keyName };

  return {
    ...(existing ?? {}),
    memory_role: 'session_context',
    session_scope: sessionScope,
    ...(input.sessionId ? { session_id: input.sessionId } : {}),
    ...(input.agentId ? { agent_id: input.agentId } : {}),
    ...(input.topic ? { topic: input.topic } : {}),
    ...(input.promotable !== undefined ? { promotable: input.promotable } : {}),
    ...(input.groomAfter ? { groom_after: input.groomAfter } : {}),
    ...(input.expiresAt ? { expires_at: input.expiresAt } : {})
  };
}

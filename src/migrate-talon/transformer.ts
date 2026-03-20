import type { TalonMemoryRow } from './reader.js';

export type TalonTransformedEntity = {
  entity: {
    type: 'memory';
    content: string;
    visibility: 'shared';
    tags: string[];
    metadata: Record<string, unknown>;
  };
  createdAt: string;
  updatedAt: string;
  talonId: string;
  talonThreadId: string;
};

const TYPE_TO_NAMESPACE: Record<string, string> = {
  fact: 'facts',
  summary: 'summaries',
  note: 'notes'
};

function parseMetadata(rawMetadata: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawMetadata) as unknown;

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to the empty object below.
  }

  return {};
}

export function transformTalonMemoryItem(
  item: TalonMemoryRow
): TalonTransformedEntity | null {
  if (item.content.trim().length === 0) {
    return null;
  }

  const metadata: Record<string, unknown> = {
    ...parseMetadata(item.metadata),
    talon_id: item.id,
    talon_thread_id: item.threadId,
    talon_type: item.type
  };

  const namespace = TYPE_TO_NAMESPACE[item.type];
  if (namespace) {
    metadata.namespace = namespace;
  }

  return {
    entity: {
      type: 'memory',
      content: item.content,
      visibility: 'shared',
      tags: [],
      metadata
    },
    createdAt: new Date(item.createdAt).toISOString(),
    updatedAt: new Date(item.updatedAt).toISOString(),
    talonId: item.id,
    talonThreadId: item.threadId
  };
}

import { DatabaseSync } from 'node:sqlite';

export type TalonMemoryRow = {
  id: string;
  threadId: string;
  type: string;
  content: string;
  embeddingRef: string | null;
  metadata: string;
  createdAt: number;
  updatedAt: number;
};

export type TalonThread = {
  threadId: string;
  items: TalonMemoryRow[];
};

export type ReadTalonThreadsResult = {
  threads: TalonThread[];
  skippedEmbeddingRefs: number;
};

type RawMemoryRow = {
  id: string;
  thread_id: string;
  type: string;
  content: string;
  embedding_ref: string | null;
  metadata: string;
  created_at: number;
  updated_at: number;
};

function groupRowsByThread(rows: RawMemoryRow[]): TalonThread[] {
  const grouped = new Map<string, TalonMemoryRow[]>();

  for (const row of rows) {
    const items = grouped.get(row.thread_id) ?? [];
    items.push({
      id: row.id,
      threadId: row.thread_id,
      type: row.type,
      content: row.content,
      embeddingRef: row.embedding_ref,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
    grouped.set(row.thread_id, items);
  }

  return Array.from(grouped.entries(), ([threadId, items]) => ({
    threadId,
    items
  }));
}

export function readTalonThreads(
  sqlitePath: string,
  options: {
    threadId?: string | undefined;
  } = {}
): ReadTalonThreadsResult {
  const database = new DatabaseSync(sqlitePath, { readOnly: true });

  try {
    const skippedEmbeddingRefs = options.threadId
      ? database
          .prepare(
            `
              SELECT COUNT(*) AS count
              FROM memory_items
              WHERE type = 'embedding_ref'
                AND thread_id = ?
            `
          )
          .get(options.threadId)
      : database
          .prepare(
            `
              SELECT COUNT(*) AS count
              FROM memory_items
              WHERE type = 'embedding_ref'
            `
          )
          .get();

    const rows = options.threadId
      ? database
          .prepare(
            `
              SELECT
                id,
                thread_id,
                type,
                content,
                embedding_ref,
                metadata,
                created_at,
                updated_at
              FROM memory_items
              WHERE type != 'embedding_ref'
                AND thread_id = ?
              ORDER BY thread_id, created_at, id
            `
          )
          .all(options.threadId)
      : database
          .prepare(
            `
              SELECT
                id,
                thread_id,
                type,
                content,
                embedding_ref,
                metadata,
                created_at,
                updated_at
              FROM memory_items
              WHERE type != 'embedding_ref'
              ORDER BY thread_id, created_at, id
            `
          )
          .all();

    return {
      threads: groupRowsByThread(rows as RawMemoryRow[]),
      skippedEmbeddingRefs: Number(
        (skippedEmbeddingRefs as { count?: number | string } | undefined)?.count ??
          0
      )
    };
  } finally {
    database.close();
  }
}

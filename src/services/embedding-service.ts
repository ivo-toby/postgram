import type { Pool } from 'pg';

import { AppError, ErrorCode } from '../util/errors.js';

const DEFAULT_DIMENSIONS = 1536;

type ActiveModel = {
  id: string;
  name: string;
};

type EmbeddingServiceOptions = {
  embedBatch?: (texts: string[]) => Promise<number[][]>;
  embedQuery?: (text: string) => Promise<number[]>;
};

export type EmbeddingService = ReturnType<typeof createEmbeddingService>;

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function hashToken(token: string): number {
  let hash = 0;
  for (const character of token) {
    hash = (hash * 31 + character.charCodeAt(0)) % DEFAULT_DIMENSIONS;
  }
  return Math.abs(hash);
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0));

  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => value / magnitude);
}

function embedDeterministically(text: string): number[] {
  const vector = new Array<number>(DEFAULT_DIMENSIONS).fill(0);

  for (const token of tokenize(text)) {
    const index = hashToken(token);
    vector[index] = (vector[index] ?? 0) + 1;
  }

  return normalizeVector(vector);
}

export function vectorToSql(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

export function createEmbeddingService(options: EmbeddingServiceOptions = {}) {
  const embedBatchImpl =
    options.embedBatch ??
    ((texts: string[]) =>
      Promise.resolve(texts.map((text) => embedDeterministically(text))));
  const embedQueryImpl =
    options.embedQuery ??
    (async (text: string) => {
      const [vector] = await embedBatchImpl([text]);
      if (!vector) {
        throw new AppError(
          ErrorCode.EMBEDDING_FAILED,
          'Failed to embed query text'
        );
      }
      return vector;
    });

  return {
    dimensions: DEFAULT_DIMENSIONS,
    async embedBatch(texts: string[]): Promise<number[][]> {
      return embedBatchImpl(texts);
    },
    async embedQuery(text: string): Promise<number[]> {
      return embedQueryImpl(text);
    },
    async getActiveModel(pool: Pool): Promise<ActiveModel> {
      const result = await pool.query<ActiveModel>(
        `
          SELECT id, name
          FROM embedding_models
          WHERE is_active = true
          LIMIT 1
        `
      );

      const model = result.rows[0];
      if (!model) {
        throw new AppError(
          ErrorCode.INTERNAL,
          'No active embedding model configured'
        );
      }

      return model;
    }
  };
}

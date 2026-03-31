import OpenAI from 'openai';
import type { Pool } from 'pg';

import { AppError, ErrorCode } from '../util/errors.js';

const DEFAULT_DIMENSIONS = 1536;

type EmbeddingMode = 'deterministic' | 'openai';

type OpenAIEmbeddingClient = {
  embeddings: {
    create: (params: {
      model: string;
      input: string[];
      encoding_format: 'float';
    }) => Promise<{
      data: Array<{
        index: number;
        embedding: number[];
      }>;
    }>;
  };
};

type ActiveModelRow = {
  id: string;
  name: string;
  provider: string;
  dimensions: number;
  chunk_size: number;
  chunk_overlap: number;
  metadata: Record<string, unknown>;
  created_at: Date;
};

export type ActiveEmbeddingModel = {
  id: string;
  name: string;
  provider: string;
  dimensions: number;
  chunkSize: number;
  chunkOverlap: number;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type EmbeddingServiceOptions = {
  mode?: EmbeddingMode | undefined;
  apiKey?: string | undefined;
  client?: OpenAIEmbeddingClient | undefined;
  embedBatch?:
    | ((texts: string[], model?: ActiveEmbeddingModel) => Promise<number[][]>)
    | undefined;
  embedQuery?:
    | ((text: string, model?: ActiveEmbeddingModel) => Promise<number[]>)
    | undefined;
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
  const magnitude = Math.sqrt(
    vector.reduce((sum, value) => sum + value ** 2, 0)
  );

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

function resolveDefaultMode(): EmbeddingMode {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return 'deterministic';
  }

  return 'openai';
}

function toEmbeddingError(error: unknown, fallbackMessage: string): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(ErrorCode.EMBEDDING_FAILED, error.message, {
      cause: fallbackMessage
    });
  }

  return new AppError(ErrorCode.EMBEDDING_FAILED, fallbackMessage);
}

function mapActiveModel(row: ActiveModelRow): ActiveEmbeddingModel {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    dimensions: row.dimensions,
    chunkSize: row.chunk_size,
    chunkOverlap: row.chunk_overlap,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString()
  };
}

function getClient(
  options: EmbeddingServiceOptions
): OpenAIEmbeddingClient {
  if (options.client) {
    return options.client;
  }

  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AppError(
      ErrorCode.EMBEDDING_FAILED,
      'OPENAI_API_KEY is required for embeddings'
    );
  }

  return new OpenAI({ apiKey });
}

function assertOpenAIModel(
  model: ActiveEmbeddingModel | undefined
): ActiveEmbeddingModel {
  if (!model) {
    throw new AppError(
      ErrorCode.EMBEDDING_FAILED,
      'Active embedding model is required'
    );
  }

  if (model.provider !== 'openai') {
    throw new AppError(
      ErrorCode.EMBEDDING_FAILED,
      `Unsupported embedding provider '${model.provider}'`,
      {
        provider: model.provider
      }
    );
  }

  return model;
}

export function vectorToSql(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

export function createEmbeddingService(
  options: EmbeddingServiceOptions = {}
) {
  const mode = options.mode ?? resolveDefaultMode();

  const embedBatchImpl =
    options.embedBatch ??
    (async (texts: string[], model?: ActiveEmbeddingModel) => {
      if (mode === 'deterministic') {
        return texts.map((text) => embedDeterministically(text));
      }

      const activeModel = assertOpenAIModel(model);
      const client = getClient(options);

      try {
        const response = await client.embeddings.create({
          model: activeModel.name,
          input: texts,
          encoding_format: 'float'
        });

        const embeddings = response.data
          .slice()
          .sort((left, right) => left.index - right.index)
          .map((item) => item.embedding);

        if (embeddings.length !== texts.length) {
          throw new AppError(
            ErrorCode.EMBEDDING_FAILED,
            'Embedding API returned an unexpected number of vectors',
            {
              expected: texts.length,
              actual: embeddings.length
            }
          );
        }

        for (const embedding of embeddings) {
          if (embedding.length !== activeModel.dimensions) {
            throw new AppError(
              ErrorCode.EMBEDDING_FAILED,
              'Embedding dimension mismatch',
              {
                expected: activeModel.dimensions,
                actual: embedding.length,
                model: activeModel.name
              }
            );
          }
        }

        return embeddings;
      } catch (error) {
        throw toEmbeddingError(error, 'Failed to embed batch');
      }
    });

  const embedQueryImpl =
    options.embedQuery ??
    (async (text: string, model?: ActiveEmbeddingModel) => {
      const [vector] = await embedBatchImpl([text], model);
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
    async embedBatch(
      texts: string[],
      model?: ActiveEmbeddingModel
    ): Promise<number[][]> {
      return embedBatchImpl(texts, model);
    },
    async embedQuery(
      text: string,
      model?: ActiveEmbeddingModel
    ): Promise<number[]> {
      return embedQueryImpl(text, model);
    },
    async getActiveModel(pool: Pool): Promise<ActiveEmbeddingModel> {
      const result = await pool.query<ActiveModelRow>(
        `
          SELECT
            id,
            name,
            provider,
            dimensions,
            chunk_size,
            chunk_overlap,
            metadata,
            created_at
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

      return mapActiveModel(model);
    }
  };
}

import OpenAI from 'openai';

import { AppError, ErrorCode } from '../../util/errors.js';

export type EmbeddingProviderName = 'openai' | 'ollama';

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  readonly model: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export type EmbeddingProviderConfig =
  | {
      provider: 'openai';
      model: string;
      dimensions: number;
      apiKey: string;
    }
  | {
      provider: 'ollama';
      model: string;
      dimensions: number;
      baseUrl: string;
      apiKey?: string | undefined;
    };

const OPENAI_DEFAULT_MODEL = 'text-embedding-3-small';
const OPENAI_DEFAULT_DIMENSIONS = 1536;
const OLLAMA_DEFAULT_MODEL = 'bge-m3';
const OLLAMA_DEFAULT_DIMENSIONS = 1024;

export function resolveEmbeddingDefaults(
  provider: EmbeddingProviderName,
  model?: string,
  dimensions?: number
): { model: string; dimensions: number } {
  if (provider === 'openai') {
    return {
      model: model ?? OPENAI_DEFAULT_MODEL,
      dimensions: dimensions ?? OPENAI_DEFAULT_DIMENSIONS
    };
  }
  return {
    model: model ?? OLLAMA_DEFAULT_MODEL,
    dimensions: dimensions ?? OLLAMA_DEFAULT_DIMENSIONS
  };
}

type OpenAIEmbeddingClient = {
  embeddings: {
    create: (params: {
      model: string;
      input: string[];
      encoding_format: 'float';
      dimensions?: number;
    }) => Promise<{
      data: Array<{ index: number; embedding: number[] }>;
    }>;
  };
};

function embeddingError(message: string, details: Record<string, unknown> = {}): AppError {
  return new AppError(ErrorCode.EMBEDDING_FAILED, message, details);
}

function assertVectorShape(
  vector: number[],
  expectedLength: number,
  provider: EmbeddingProviderName,
  model: string
): void {
  if (!Array.isArray(vector) || vector.length !== expectedLength) {
    throw embeddingError('Embedding dimension mismatch', {
      provider,
      model,
      expected: expectedLength,
      actual: Array.isArray(vector) ? vector.length : null
    });
  }
}

export function createOpenAIEmbeddingProvider(
  config: Extract<EmbeddingProviderConfig, { provider: 'openai' }>,
  clientOverride?: OpenAIEmbeddingClient
): EmbeddingProvider {
  const client = clientOverride ?? new OpenAI({ apiKey: config.apiKey });

  async function embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    try {
      // Pass `dimensions` to OpenAI when the operator has chosen a non-default
      // size. text-embedding-3-small/large accept this parameter and truncate
      // via Matryoshka; older models (ada-002) will reject it at the API.
      const nonDefaultDimensions = config.dimensions !== OPENAI_DEFAULT_DIMENSIONS;
      const response = await client.embeddings.create({
        model: config.model,
        input: texts,
        encoding_format: 'float',
        ...(nonDefaultDimensions ? { dimensions: config.dimensions } : {})
      });

      const ordered = response.data
        .slice()
        .sort((left, right) => left.index - right.index)
        .map((item) => item.embedding);

      if (ordered.length !== texts.length) {
        throw embeddingError('Embedding API returned an unexpected number of vectors', {
          provider: 'openai',
          model: config.model,
          expected: texts.length,
          actual: ordered.length
        });
      }

      for (const vector of ordered) {
        assertVectorShape(vector, config.dimensions, 'openai', config.model);
      }

      return ordered;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : 'OpenAI embedding call failed';
      throw embeddingError(message, {
        provider: 'openai',
        model: config.model
      });
    }
  }

  async function embed(text: string): Promise<number[]> {
    const [vector] = await embedBatch([text]);
    if (!vector) {
      throw embeddingError('OpenAI embedding call returned no vector', {
        provider: 'openai',
        model: config.model
      });
    }
    return vector;
  }

  return {
    name: 'openai',
    model: config.model,
    dimensions: config.dimensions,
    embed,
    embedBatch
  };
}

export function createOllamaEmbeddingProvider(
  config: Extract<EmbeddingProviderConfig, { provider: 'ollama' }>
): EmbeddingProvider {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');

  async function callOllama(prompt: string): Promise<number[]> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/embeddings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: config.model, prompt })
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Ollama embedding call failed';
      throw embeddingError(`Ollama provider unreachable: ${message}`, {
        provider: 'ollama',
        model: config.model,
        baseUrl
      });
    }

    if (!response.ok) {
      const bodySnippet = await safeReadSnippet(response);
      throw embeddingError(
        `Ollama embedding call failed with status ${response.status}`,
        {
          provider: 'ollama',
          model: config.model,
          baseUrl,
          status: response.status,
          body: bodySnippet
        }
      );
    }

    const body = (await response.json()) as { embedding?: number[] };
    if (!body.embedding) {
      throw embeddingError('Ollama response missing embedding field', {
        provider: 'ollama',
        model: config.model,
        baseUrl
      });
    }

    assertVectorShape(body.embedding, config.dimensions, 'ollama', config.model);
    return body.embedding;
  }

  async function embedBatch(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (const text of texts) {
      vectors.push(await callOllama(text));
    }
    return vectors;
  }

  async function embed(text: string): Promise<number[]> {
    return callOllama(text);
  }

  return {
    name: 'ollama',
    model: config.model,
    dimensions: config.dimensions,
    embed,
    embedBatch
  };
}

async function safeReadSnippet(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 256);
  } catch {
    return '';
  }
}

export function createEmbeddingProvider(
  config: EmbeddingProviderConfig
): EmbeddingProvider {
  if (config.provider === 'openai') {
    return createOpenAIEmbeddingProvider(config);
  }
  return createOllamaEmbeddingProvider(config);
}

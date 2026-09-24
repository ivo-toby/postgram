import OpenAI, {
  APIConnectionTimeoutError,
  APIUserAbortError
} from 'openai';

import { AppError, ErrorCode } from '../../util/errors.js';

export type EmbeddingProviderName = 'openai' | 'ollama' | 'openai-compatible';

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  readonly model: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

type ProviderFetch = (input: string, init: RequestInit) => Promise<Response>;

export type EmbeddingProviderConfig =
  | {
      provider: 'openai';
      model: string;
      dimensions: number;
      apiKey: string;
      timeoutMs?: number | undefined;
      maxRetries?: number | undefined;
    }
  | {
      provider: 'openai-compatible';
      model: string;
      dimensions: number;
      baseUrl: string;
      apiKey?: string | undefined;
    }
  | {
      provider: 'ollama';
      model: string;
      dimensions: number;
      baseUrl: string;
      apiKey?: string | undefined;
      timeoutMs?: number | undefined;
      fetchImpl?: ProviderFetch | undefined;
    };

const OPENAI_DEFAULT_MODEL = 'text-embedding-3-small';
const OPENAI_DEFAULT_DIMENSIONS = 1536;
const OLLAMA_DEFAULT_MODEL = 'bge-m3';
const OLLAMA_DEFAULT_DIMENSIONS = 1024;
// Mistral Embed uses the same 1024-dimensional space as bge-m3.
const OPENAI_COMPATIBLE_DEFAULT_MODEL = 'mistral-embed';
const OPENAI_COMPATIBLE_DEFAULT_DIMENSIONS = 1024;

// The OpenAI SDK defaults to a 10 minute timeout and 2 retries, which means a
// single stalled embedding call can pin a request (and a database connection
// upstream of it) for far longer than any caller is willing to wait. Embedding
// a short query is a sub-second operation; bound it accordingly.
export const DEFAULT_EMBEDDING_TIMEOUT_MS = 15_000;
export const DEFAULT_EMBEDDING_MAX_RETRIES = 2;

// The SDK's `timeout` is applied per HTTP attempt and a timed-out attempt is
// itself retried, so `timeout` alone bounds an attempt rather than the
// operation: measured locally, timeout=200/maxRetries=2 took 1974ms to fail.
// Every provider call therefore also carries an outer AbortSignal, which is
// what actually makes EMBEDDING_TIMEOUT_MS mean what its name says.
//
// Retries are still worth keeping: a fast transient failure (429, 5xx) fails
// well inside the budget and leaves room to try again. Only slow failures are
// cut off, which is precisely the case retrying should not extend.
function embeddingDeadline(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

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
  if (provider === 'openai-compatible') {
    return {
      model: model ?? OPENAI_COMPATIBLE_DEFAULT_MODEL,
      dimensions: dimensions ?? OPENAI_COMPATIBLE_DEFAULT_DIMENSIONS
    };
  }
  return {
    model: model ?? OLLAMA_DEFAULT_MODEL,
    dimensions: dimensions ?? OLLAMA_DEFAULT_DIMENSIONS
  };
}

type OpenAIEmbeddingClient = {
  embeddings: {
    create: (
      params: {
        model: string;
        input: string[];
        encoding_format: 'float';
        dimensions?: number;
      },
      options?: { signal?: AbortSignal | undefined }
    ) => Promise<{
      data: Array<{ index: number; embedding: number[] }>;
    }>;
  };
};

function embeddingError(message: string, details: Record<string, unknown> = {}): AppError {
  return new AppError(ErrorCode.EMBEDDING_FAILED, message, details);
}

/**
 * The deadline surfaces differently depending on where it fires. The OpenAI SDK
 * wraps an aborted signal as APIUserAbortError and an exhausted per-attempt
 * timeout as APIConnectionTimeoutError; neither sets a useful `name`, so they
 * are matched by class. A bare fetch instead rejects with a DOMException named
 * AbortError or TimeoutError.
 */
function isAbortError(error: unknown): boolean {
  if (
    error instanceof APIUserAbortError ||
    error instanceof APIConnectionTimeoutError
  ) {
    return true;
  }
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
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
  const client =
    clientOverride ??
    new OpenAI({
      apiKey: config.apiKey,
      timeout: config.timeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? DEFAULT_EMBEDDING_MAX_RETRIES
    });

  async function embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const timeoutMs = config.timeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS;

    try {
      // Pass `dimensions` to OpenAI when the operator has chosen a non-default
      // size. text-embedding-3-small/large accept this parameter and truncate
      // via Matryoshka; older models (ada-002) will reject it at the API.
      const nonDefaultDimensions = config.dimensions !== OPENAI_DEFAULT_DIMENSIONS;
      const response = await client.embeddings.create(
        {
          model: config.model,
          input: texts,
          encoding_format: 'float',
          ...(nonDefaultDimensions ? { dimensions: config.dimensions } : {})
        },
        { signal: embeddingDeadline(timeoutMs) }
      );

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
      if (isAbortError(error)) {
        throw embeddingError(
          `OpenAI embedding call timed out after ${timeoutMs}ms`,
          { provider: 'openai', model: config.model, timeoutMs }
        );
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
    // The timer spans the body read as well as the headers: fetch resolves as
    // soon as headers arrive, so clearing it earlier would leave a stalled
    // response body unbounded.
    const timeoutMs = config.timeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await callOllamaWithSignal(prompt, controller, timeoutMs);
    } finally {
      clearTimeout(timer);
    }
  }

  async function callOllamaWithSignal(
    prompt: string,
    controller: AbortController,
    timeoutMs: number
  ): Promise<number[]> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    let response: Response;
    try {
      response = await (config.fetchImpl ?? fetch)(`${baseUrl}/api/embeddings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: config.model, prompt }),
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw embeddingError(
          `Ollama embedding call timed out after ${timeoutMs}ms`,
          { provider: 'ollama', model: config.model, baseUrl, timeoutMs }
        );
      }
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

    let body: { embedding?: number[] };
    try {
      body = (await response.json()) as { embedding?: number[] };
    } catch (error) {
      if (controller.signal.aborted) {
        throw embeddingError(
          `Ollama embedding call timed out after ${timeoutMs}ms`,
          { provider: 'ollama', model: config.model, baseUrl, timeoutMs }
        );
      }
      const message =
        error instanceof Error ? error.message : 'Invalid JSON from Ollama';
      throw embeddingError(`Ollama returned an unreadable response: ${message}`, {
        provider: 'ollama',
        model: config.model,
        baseUrl
      });
    }
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

// Mistral (and many other openai-compatible providers) cap the number of
// inputs and total tokens per embeddings request. Using 64 as a safe default
// avoids 400 errors on large documents that produce hundreds of chunks.
const OPENAI_COMPATIBLE_MAX_BATCH_SIZE = 64;

export function createOpenAICompatibleEmbeddingProvider(
  config: Extract<EmbeddingProviderConfig, { provider: 'openai-compatible' }>
): EmbeddingProvider {
  // Use the OpenAI SDK with a custom base URL — Mistral, together.ai, etc.
  const client = new OpenAI({
    apiKey: config.apiKey ?? 'dummy', // some servers don't require a key
    baseURL: config.baseUrl.replace(/\/+$/, '')
  }) as OpenAIEmbeddingClient;

  async function embedBatchPage(texts: string[]): Promise<number[][]> {
    try {
      const response = await client.embeddings.create({
        model: config.model,
        input: texts.map((t) => t.toWellFormed()),
        encoding_format: 'float'
      });
      const ordered = response.data
        .slice()
        .sort((left, right) => left.index - right.index)
        .map((item) => item.embedding);

      if (ordered.length !== texts.length) {
        throw embeddingError('Embedding API returned an unexpected number of vectors', {
          provider: 'openai-compatible',
          model: config.model,
          expected: texts.length,
          actual: ordered.length
        });
      }
      for (const vector of ordered) {
        assertVectorShape(vector, config.dimensions, 'openai-compatible', config.model);
      }
      return ordered;
    } catch (error) {
      if (error instanceof AppError) throw error;
      const message =
        error instanceof Error ? error.message : 'OpenAI-compatible embedding call failed';
      throw embeddingError(message, {
        provider: 'openai-compatible',
        model: config.model,
        baseUrl: config.baseUrl
      });
    }
  }

  async function embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    // Split into pages to respect per-request input limits.
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += OPENAI_COMPATIBLE_MAX_BATCH_SIZE) {
      const page = texts.slice(i, i + OPENAI_COMPATIBLE_MAX_BATCH_SIZE);
      const pageVectors = await embedBatchPage(page);
      results.push(...pageVectors);
    }
    return results;
  }

  async function embed(text: string): Promise<number[]> {
    const [vector] = await embedBatch([text]);
    if (!vector) {
      throw embeddingError('OpenAI-compatible embedding call returned no vector', {
        provider: 'openai-compatible',
        model: config.model
      });
    }
    return vector;
  }

  return {
    name: 'openai-compatible',
    model: config.model,
    dimensions: config.dimensions,
    embed,
    embedBatch
  };
}

export function createEmbeddingProvider(
  config: EmbeddingProviderConfig
): EmbeddingProvider {
  if (config.provider === 'openai') {
    return createOpenAIEmbeddingProvider(config);
  }
  if (config.provider === 'openai-compatible') {
    return createOpenAICompatibleEmbeddingProvider(config);
  }
  return createOllamaEmbeddingProvider(config);
}

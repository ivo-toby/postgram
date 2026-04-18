import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config.js';

function baseEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgres://localhost/postgram',
    ...overrides
  };
}

describe('config', () => {
  it('parses an Ollama-only config without OPENAI_API_KEY', () => {
    const cfg = loadConfig(
      baseEnv({
        EMBEDDING_PROVIDER: 'ollama',
        EMBEDDING_MODEL: 'bge-m3',
        EMBEDDING_DIMENSIONS: '1024',
        EMBEDDING_BASE_URL: 'http://embeddings.local:11434'
      })
    );

    expect(cfg.EMBEDDING_PROVIDER).toBe('ollama');
    expect(cfg.EMBEDDING_MODEL).toBe('bge-m3');
    expect(cfg.EMBEDDING_DIMENSIONS).toBe(1024);
    expect(cfg.EMBEDDING_BASE_URL).toBe('http://embeddings.local:11434');
    expect(cfg.OPENAI_API_KEY).toBeUndefined();
  });

  it('rejects OpenAI embedding provider without OPENAI_API_KEY', () => {
    expect(() =>
      loadConfig(baseEnv({ EMBEDDING_PROVIDER: 'openai' }))
    ).toThrowError(/OPENAI_API_KEY is required/);
  });

  it('rejects OpenAI extraction enabled without OPENAI_API_KEY', () => {
    expect(() =>
      loadConfig(
        baseEnv({
          EMBEDDING_PROVIDER: 'ollama',
          EMBEDDING_DIMENSIONS: '1024',
          EMBEDDING_BASE_URL: 'http://e.local',
          EXTRACTION_ENABLED: 'true',
          EXTRACTION_PROVIDER: 'openai'
        })
      )
    ).toThrowError(/OPENAI_API_KEY is required/);
  });

  it('allows Ollama extraction with no OPENAI_API_KEY', () => {
    const cfg = loadConfig(
      baseEnv({
        EMBEDDING_PROVIDER: 'ollama',
        EMBEDDING_DIMENSIONS: '1024',
        EMBEDDING_BASE_URL: 'http://e.local',
        EXTRACTION_ENABLED: 'true',
        EXTRACTION_PROVIDER: 'ollama'
      })
    );

    expect(cfg.EXTRACTION_ENABLED).toBe(true);
    expect(cfg.EXTRACTION_PROVIDER).toBe('ollama');
  });

  it('accepts OpenAI defaults when OPENAI_API_KEY is present', () => {
    const cfg = loadConfig(baseEnv({ OPENAI_API_KEY: 'sk-test' }));
    expect(cfg.EMBEDDING_PROVIDER).toBe('openai');
    expect(cfg.EMBEDDING_MODEL).toBeUndefined();
    expect(cfg.EMBEDDING_DIMENSIONS).toBeUndefined();
  });

  it('leaves EMBEDDING_BASE_URL undefined when unset so callers can fall back to OLLAMA_BASE_URL', () => {
    const cfg = loadConfig(
      baseEnv({
        EMBEDDING_PROVIDER: 'ollama',
        EMBEDDING_DIMENSIONS: '1024',
        OLLAMA_BASE_URL: 'http://shared.local:11434'
      })
    );

    expect(cfg.EMBEDDING_BASE_URL).toBeUndefined();
    expect(cfg.OLLAMA_BASE_URL).toBe('http://shared.local:11434');
  });

  it('treats blank EMBEDDING_BASE_URL as unset and falls back to OLLAMA_BASE_URL', () => {
    const cfg = loadConfig(
      baseEnv({
        EMBEDDING_PROVIDER: 'ollama',
        EMBEDDING_DIMENSIONS: '1024',
        EMBEDDING_BASE_URL: '',
        OLLAMA_BASE_URL: 'http://shared.local:11434'
      })
    );

    expect(cfg.EMBEDDING_BASE_URL).toBeUndefined();
    expect(cfg.OLLAMA_BASE_URL).toBe('http://shared.local:11434');
  });

  it('coerces EMBEDDING_DIMENSIONS to a positive integer', () => {
    expect(() =>
      loadConfig(
        baseEnv({
          EMBEDDING_PROVIDER: 'ollama',
          EMBEDDING_DIMENSIONS: '0'
        })
      )
    ).toThrow();
  });
});

describe('buildEmbeddingProviderConfig', () => {
  it('requires EMBEDDING_DIMENSIONS when EMBEDDING_MODEL is overridden', async () => {
    const { buildEmbeddingProviderConfig } = await import('../../src/index.js');
    const cfg = loadConfig(
      baseEnv({
        EMBEDDING_PROVIDER: 'openai',
        OPENAI_API_KEY: 'sk-test',
        EMBEDDING_MODEL: 'text-embedding-3-large'
      })
    );
    expect(() => buildEmbeddingProviderConfig(cfg)).toThrow(
      /EMBEDDING_MODEL is set but EMBEDDING_DIMENSIONS is not/
    );
  });

  it('accepts model override together with explicit dimensions', async () => {
    const { buildEmbeddingProviderConfig } = await import('../../src/index.js');
    const cfg = loadConfig(
      baseEnv({
        EMBEDDING_PROVIDER: 'openai',
        OPENAI_API_KEY: 'sk-test',
        EMBEDDING_MODEL: 'text-embedding-3-large',
        EMBEDDING_DIMENSIONS: '3072'
      })
    );
    const built = buildEmbeddingProviderConfig(cfg);
    expect(built).toMatchObject({
      provider: 'openai',
      model: 'text-embedding-3-large',
      dimensions: 3072
    });
  });
});

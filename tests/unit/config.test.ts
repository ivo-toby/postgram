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

  it('allows OpenAI-compatible extraction with a custom base URL and no OPENAI_API_KEY', () => {
    const cfg = loadConfig(
      baseEnv({
        EMBEDDING_PROVIDER: 'ollama',
        EMBEDDING_DIMENSIONS: '1024',
        EMBEDDING_BASE_URL: 'http://e.local',
        EXTRACTION_ENABLED: 'true',
        EXTRACTION_PROVIDER: 'openai-compatible',
        EXTRACTION_MODEL: 'gemma-4-e4b-it-OptiQ-4bit',
        EXTRACTION_BASE_URL: 'http://host.docker.internal:8000/v1',
        EXTRACTION_API_KEY: 'local-key'
      })
    );

    expect(cfg.EXTRACTION_PROVIDER).toBe('openai-compatible');
    expect(cfg.EXTRACTION_BASE_URL).toBe('http://host.docker.internal:8000/v1');
    expect(cfg.EXTRACTION_API_KEY).toBe('local-key');
    expect(cfg.OPENAI_API_KEY).toBeUndefined();
  });

  it('rejects enabled OpenAI-compatible extraction without EXTRACTION_BASE_URL', () => {
    expect(() =>
      loadConfig(
        baseEnv({
          EMBEDDING_PROVIDER: 'ollama',
          EMBEDDING_DIMENSIONS: '1024',
          EMBEDDING_BASE_URL: 'http://e.local',
          EXTRACTION_ENABLED: 'true',
          EXTRACTION_PROVIDER: 'openai-compatible'
        })
      )
    ).toThrowError(/EXTRACTION_BASE_URL is required/);
  });

  it('accepts OpenAI defaults when OPENAI_API_KEY is present', () => {
    const cfg = loadConfig(baseEnv({ OPENAI_API_KEY: 'sk-test' }));
    expect(cfg.EMBEDDING_PROVIDER).toBe('openai');
    expect(cfg.EMBEDDING_MODEL).toBeUndefined();
    expect(cfg.EMBEDDING_DIMENSIONS).toBeUndefined();
  });

  it('defaults memory extraction to embeddings only', () => {
    const cfg = loadConfig(baseEnv({ OPENAI_API_KEY: 'sk-test' }));

    expect(cfg.EXTRACTION_MEMORY_MODE).toBe('embed_only');
  });

  it('parses the optional admin settings encryption key', () => {
    const cfg = loadConfig(
      baseEnv({
        OPENAI_API_KEY: 'sk-test',
        ADMIN_SETTINGS_ENCRYPTION_KEY: 'base64url-installation-key'
      })
    );

    expect(cfg.ADMIN_SETTINGS_ENCRYPTION_KEY).toBe(
      'base64url-installation-key'
    );

    const blank = loadConfig(
      baseEnv({
        OPENAI_API_KEY: 'sk-test',
        ADMIN_SETTINGS_ENCRYPTION_KEY: ''
      })
    );
    expect(blank.ADMIN_SETTINGS_ENCRYPTION_KEY).toBeUndefined();
  });

  it('accepts explicit memory extraction modes', () => {
    const cfg = loadConfig(
      baseEnv({
        OPENAI_API_KEY: 'sk-test',
        EXTRACTION_MEMORY_MODE: 'extract_durable'
      })
    );

    expect(cfg.EXTRACTION_MEMORY_MODE).toBe('extract_durable');
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

  it('parses EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE_BY_TYPE into a per-type map', () => {
    const cfg = loadConfig(
      baseEnv({
        OPENAI_API_KEY: 'sk-test',
        EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE_BY_TYPE:
          'person:0.4, project:0.55 ,task:0.8'
      })
    );
    expect(cfg.EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE_BY_TYPE).toEqual({
      person: 0.4,
      project: 0.55,
      task: 0.8
    });
  });

  it('defaults EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE_BY_TYPE to person+project overrides', () => {
    const cfg = loadConfig(baseEnv({ OPENAI_API_KEY: 'sk-test' }));
    expect(cfg.EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE_BY_TYPE).toEqual({
      person: 0.5,
      project: 0.6
    });
  });

  it('rejects EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE_BY_TYPE with unknown type', () => {
    expect(() =>
      loadConfig(
        baseEnv({
          OPENAI_API_KEY: 'sk-test',
          EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE_BY_TYPE: 'alien:0.5'
        })
      )
    ).toThrow(/Unknown type/);
  });

  it('rejects EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE_BY_TYPE with out-of-range value', () => {
    expect(() =>
      loadConfig(
        baseEnv({
          OPENAI_API_KEY: 'sk-test',
          EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE_BY_TYPE: 'person:1.5'
        })
      )
    ).toThrow(/must be 0/);
  });

  it('defaults EXTRACTION_MIN_CONTENT_CHARS to 80', () => {
    const cfg = loadConfig(baseEnv({ OPENAI_API_KEY: 'sk-test' }));
    expect(cfg.EXTRACTION_MIN_CONTENT_CHARS).toBe(80);
  });

  it('honors EXTRACTION_MIN_CONTENT_CHARS=0 to disable the skip', () => {
    const cfg = loadConfig(
      baseEnv({ OPENAI_API_KEY: 'sk-test', EXTRACTION_MIN_CONTENT_CHARS: '0' })
    );
    expect(cfg.EXTRACTION_MIN_CONTENT_CHARS).toBe(0);
  });

  it('defaults EXTRACTION_DEBUG_LOG to false', () => {
    const cfg = loadConfig(baseEnv({ OPENAI_API_KEY: 'sk-test' }));
    expect(cfg.EXTRACTION_DEBUG_LOG).toBe(false);
  });

  it('parses EXTRACTION_DEBUG_LOG=true', () => {
    const cfg = loadConfig(
      baseEnv({ OPENAI_API_KEY: 'sk-test', EXTRACTION_DEBUG_LOG: 'true' })
    );
    expect(cfg.EXTRACTION_DEBUG_LOG).toBe(true);
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

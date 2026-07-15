import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../../src/config.js';
import { resolveRuntimeProviderConfig } from '../../src/services/admin-provider-config-service.js';

describe('provider configuration resolution', () => {
  it('ignores unapplied database settings when resolving runtime configuration', async () => {
    const query = vi.fn((statement: string) => {
      if (statement.includes('FROM admin_runtime_secrets')) {
        return Promise.resolve({ rows: [] });
      }
      if (statement.includes('FROM admin_runtime_settings')) {
        expect(statement).toContain('CASE');
        return Promise.resolve({ rows: [] });
      }
      return Promise.reject(new Error(`Unexpected query: ${statement}`));
    });
    const pool = { query } as unknown as Pool;
    const envConfig = loadConfig({
      DATABASE_URL: 'postgres://localhost/postgram',
      OPENAI_API_KEY: 'sk-target-resolution-test',
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'bge-m3',
      EMBEDDING_DIMENSIONS: '1024'
    });

    const runtime = await resolveRuntimeProviderConfig(pool, { envConfig });

    expect(runtime.isOk()).toBe(true);
    expect(runtime._unsafeUnwrap()).toMatchObject({
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'bge-m3',
      EMBEDDING_DIMENSIONS: 1024
    });
  });
});

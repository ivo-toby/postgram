import { describe, expect, it } from 'vitest';

import { ErrorCode } from '../../src/util/errors.js';
import { createApp } from '../../src/index.js';

describe('GET /health', () => {
  it('returns the documented healthy payload', async () => {
    const app = createApp({
      getHealthStatus: () => ({
        postgres: 'connected',
        embeddingModel: 'text-embedding-3-small'
      })
    });

    const response = await app.request('/health');
    const body: unknown = await response.json();

    expect(response.status).toBe(200);

    if (!body || typeof body !== 'object') {
      throw new Error('expected JSON object');
    }

    expect(body).toEqual({
      status: 'ok',
      version: '0.1.0',
      postgres: 'connected',
      embedding_model: 'text-embedding-3-small'
    });
  });

  it('returns the documented degraded payload when postgres is unavailable', async () => {
    const app = createApp({
      getHealthStatus: () => ({
        postgres: 'disconnected',
        embeddingModel: null
      })
    });

    const response = await app.request('/health');
    const body: unknown = await response.json();

    expect(response.status).toBe(503);

    if (!body || typeof body !== 'object') {
      throw new Error('expected JSON object');
    }

    expect(body).toEqual({
      status: 'degraded',
      postgres: 'disconnected'
    });
  });

  it('returns REST error shape when the health probe throws', async () => {
    const app = createApp({
      getHealthStatus: () => {
        throw new Error('probe failed');
      }
    });

    const response = await app.request('/health');
    const body: unknown = await response.json();

    expect(response.status).toBe(500);

    if (!body || typeof body !== 'object') {
      throw new Error('expected JSON object');
    }

    expect(body).toEqual({
      error: {
        code: ErrorCode.INTERNAL,
        message: 'probe failed',
        details: {}
      }
    });
  });
});

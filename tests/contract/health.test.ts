import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/index.js';

describe('GET /health', () => {
  it('returns the documented healthy payload', async () => {
    const app = createApp();

    const response = await app.request('/health');
    const body: unknown = await response.json();

    expect(response.status).toBe(200);

    if (!body || typeof body !== 'object') {
      throw new Error('expected JSON object');
    }

    expect(body).toMatchObject({
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

    expect(body).toMatchObject({
      status: 'degraded',
      postgres: 'disconnected'
    });
    expect(body).not.toHaveProperty('embedding_model');
  });
});

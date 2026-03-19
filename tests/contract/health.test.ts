import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/index.js';

describe('GET /health', () => {
  it('returns the documented health shape', async () => {
    const app = createApp();

    const response = await app.request('/health');
    const body: unknown = await response.json();

    expect([200, 503]).toContain(response.status);

    if (!body || typeof body !== 'object') {
      throw new Error('expected JSON object');
    }

    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('postgres');
  });
});

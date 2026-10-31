import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config.js';

function baseEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgres://localhost/postgram',
    ...overrides
  };
}

describe('config WORKSPACE_DORMANT_AFTER_DAYS', () => {
  it('defaults to 30 when unset', () => {
    expect(loadConfig(baseEnv()).WORKSPACE_DORMANT_AFTER_DAYS).toBe(30);
  });

  it('treats a blank value as unset', () => {
    expect(
      loadConfig(baseEnv({ WORKSPACE_DORMANT_AFTER_DAYS: '' }))
        .WORKSPACE_DORMANT_AFTER_DAYS
    ).toBe(30);
  });

  it('accepts an override of 7', () => {
    expect(
      loadConfig(baseEnv({ WORKSPACE_DORMANT_AFTER_DAYS: '7' }))
        .WORKSPACE_DORMANT_AFTER_DAYS
    ).toBe(7);
  });

  it('rejects 0, negative numbers and non-integers', () => {
    expect(() =>
      loadConfig(baseEnv({ WORKSPACE_DORMANT_AFTER_DAYS: '0' }))
    ).toThrow();
    expect(() =>
      loadConfig(baseEnv({ WORKSPACE_DORMANT_AFTER_DAYS: '-1' }))
    ).toThrow();
    expect(() =>
      loadConfig(baseEnv({ WORKSPACE_DORMANT_AFTER_DAYS: 'abc' }))
    ).toThrow();
  });

  it('is documented in docker-compose.yml with default 30', () => {
    const compose = readFileSync(
      new URL('../../docker-compose.yml', import.meta.url),
      'utf8'
    );
    expect(compose).toContain(
      'WORKSPACE_DORMANT_AFTER_DAYS: ${WORKSPACE_DORMANT_AFTER_DAYS:-30}'
    );
  });

  it('is documented in the README configuration table with default 30', () => {
    const readme = readFileSync(
      new URL('../../README.md', import.meta.url),
      'utf8'
    );
    expect(readme).toContain('`WORKSPACE_DORMANT_AFTER_DAYS`');
    const row = readme
      .split('\n')
      .find((line) => line.includes('`WORKSPACE_DORMANT_AFTER_DAYS`'));
    expect(row).toBeDefined();
    expect(row ?? '').toContain('`30`');
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createKey } from '../../src/auth/key-service.js';
import { createApp } from '../../src/index.js';
import {
  LoaderRegistry,
  type RegisteredLoader,
} from '../../src/services/loaders/registry.js';
import type { DocumentLoader, LoaderResult } from '../../src/types/loader.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase,
} from '../helpers/postgres.js';

function entry(name: string): RegisteredLoader {
  const loader: DocumentLoader = {
    name,
    version: `1.0.0-${name}`,
    accepts: { mimeTypes: ['x/y'] },
    async load(): Promise<LoaderResult> {
      return { documentType: name, blocks: [] };
    },
  };
  return {
    loader,
    config: {
      kind: 'in-process',
      name,
      package: `@x/${name}`,
      accepts: loader.accepts,
      priority: 0,
      options: {},
      enabled: true,
    },
    enabled: true,
    status: 'ok',
  };
}

describe('admin /api/admin/loaders', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  afterAll(async () => {
    if (database) await database.close();
  });

  beforeEach(async () => {
    if (database) await resetTestDatabase(database.pool);
  });

  it('lists registered loaders for admin keys', async () => {
    if (!database) throw new Error('db missing');
    const created = (
      await createKey(database.pool, {
        name: `admin-${crypto.randomUUID()}`,
        scopes: ['read', 'write', 'delete'],
      })
    )._unsafeUnwrap();
    const registry = new LoaderRegistry([entry('pdf'), entry('html')]);
    const app = createApp({ pool: database.pool, loaderRegistry: registry });
    const res = await app.request('/api/admin/loaders', {
      headers: { Authorization: `Bearer ${created.plaintextKey}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { loaders: Array<{ name: string }> };
    expect(body.loaders.map((l) => l.name).sort()).toEqual(['html', 'pdf']);
  });

  it('rejects without delete scope', async () => {
    if (!database) throw new Error('db missing');
    const created = (
      await createKey(database.pool, {
        name: `nondel-${crypto.randomUUID()}`,
        scopes: ['read', 'write'],
      })
    )._unsafeUnwrap();
    const registry = new LoaderRegistry([entry('pdf')]);
    const app = createApp({ pool: database.pool, loaderRegistry: registry });
    const res = await app.request('/api/admin/loaders', {
      headers: { Authorization: `Bearer ${created.plaintextKey}` },
    });
    expect(res.status).toBe(403);
  });

  it('disables and re-enables a loader at runtime', async () => {
    if (!database) throw new Error('db missing');
    const created = (
      await createKey(database.pool, {
        name: `flip-${crypto.randomUUID()}`,
        scopes: ['read', 'write', 'delete'],
      })
    )._unsafeUnwrap();
    const registry = new LoaderRegistry([entry('pdf')]);
    const app = createApp({ pool: database.pool, loaderRegistry: registry });

    const off = await app.request('/api/admin/loaders/pdf/disable', {
      method: 'POST',
      headers: { Authorization: `Bearer ${created.plaintextKey}` },
    });
    expect(off.status).toBe(200);
    expect(
      registry.resolve({
        kind: 'bytes',
        bytes: new Uint8Array(),
        mimeType: 'x/y',
      }).ok,
    ).toBe(false);

    const on = await app.request('/api/admin/loaders/pdf/enable', {
      method: 'POST',
      headers: { Authorization: `Bearer ${created.plaintextKey}` },
    });
    expect(on.status).toBe(200);
    expect(
      registry.resolve({
        kind: 'bytes',
        bytes: new Uint8Array(),
        mimeType: 'x/y',
      }).ok,
    ).toBe(true);
  });

  it('returns 404 for unknown loader names', async () => {
    if (!database) throw new Error('db missing');
    const created = (
      await createKey(database.pool, {
        name: `nf-${crypto.randomUUID()}`,
        scopes: ['read', 'write', 'delete'],
      })
    )._unsafeUnwrap();
    const app = createApp({
      pool: database.pool,
      loaderRegistry: new LoaderRegistry([entry('pdf')]),
    });
    const res = await app.request('/api/admin/loaders/nope/disable', {
      method: 'POST',
      headers: { Authorization: `Bearer ${created.plaintextKey}` },
    });
    expect(res.status).toBe(404);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { syncManifest, getSyncStatus } from '../../src/services/sync-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

function makeAuthContext(): AuthContext {
  return {
    apiKeyId: '00000000-0000-0000-0000-000000000201',
    keyName: 'sync-key',
    scopes: ['read', 'write', 'delete'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared']
  };
}

describe('sync-service', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await resetTestDatabase(database.pool);
    await seedApiKey(database.pool, {
      id: '00000000-0000-0000-0000-000000000201',
      name: 'sync-key'
    });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('creates entities and document_sources for new files', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const result = await syncManifest(database.pool, makeAuthContext(), {
      repo: 'test-repo',
      files: [
        { path: 'doc-a.md', sha: 'sha-a', content: '# Doc A\n\nContent A.' },
        { path: 'doc-b.md', sha: 'sha-b', content: 'Plain content B.' }
      ]
    });

    expect(result.isOk()).toBe(true);
    const counts = result._unsafeUnwrap();
    expect(counts).toEqual({ created: 2, updated: 0, unchanged: 0, deleted: 0 });

    const entities = await database.pool.query(
      "SELECT type, content, metadata FROM entities WHERE type = 'document' ORDER BY created_at"
    );
    expect(entities.rows).toHaveLength(2);
    expect(entities.rows[0]?.content).toBe('# Doc A\n\nContent A.');
    expect(entities.rows[0]?.metadata).toMatchObject({ repo: 'test-repo', path: 'doc-a.md', title: 'Doc A' });
    expect(entities.rows[1]?.metadata).toMatchObject({ title: 'doc-b' });

    const sources = await database.pool.query(
      "SELECT repo, path, sha, sync_status FROM document_sources ORDER BY path"
    );
    expect(sources.rows).toHaveLength(2);
    expect(sources.rows[0]).toMatchObject({ repo: 'test-repo', path: 'doc-a.md', sha: 'sha-a', sync_status: 'current' });
  }, 120_000);

  it('updates changed files, skips unchanged, and archives deleted', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await syncManifest(database.pool, makeAuthContext(), {
      repo: 'test-repo',
      files: [
        { path: 'keep.md', sha: 'sha-keep', content: '# Keep\n\nStays the same.' },
        { path: 'change.md', sha: 'sha-old', content: '# Change\n\nOld content.' },
        { path: 'remove.md', sha: 'sha-rm', content: '# Remove\n\nWill be deleted.' }
      ]
    });

    const result = await syncManifest(database.pool, makeAuthContext(), {
      repo: 'test-repo',
      files: [
        { path: 'keep.md', sha: 'sha-keep', content: '# Keep\n\nStays the same.' },
        { path: 'change.md', sha: 'sha-new', content: '# Change\n\nNew content!' }
      ]
    });

    expect(result.isOk()).toBe(true);
    const counts = result._unsafeUnwrap();
    expect(counts).toEqual({ created: 0, updated: 1, unchanged: 1, deleted: 1 });

    const changed = await database.pool.query<{ content: string; enrichment_status: string }>(
      "SELECT e.content, e.enrichment_status FROM entities e JOIN document_sources ds ON ds.entity_id = e.id WHERE ds.path = 'change.md'"
    );
    expect(changed.rows[0]?.content).toBe('# Change\n\nNew content!');
    expect(changed.rows[0]?.enrichment_status).toBe('pending');

    const removed = await database.pool.query<{ status: string }>(
      "SELECT e.status FROM entities e JOIN document_sources ds ON ds.entity_id = e.id WHERE ds.path = 'remove.md'"
    );
    expect(removed.rows[0]?.status).toBe('archived');

    const staleSources = await database.pool.query<{ sync_status: string }>(
      "SELECT sync_status FROM document_sources WHERE path = 'remove.md'"
    );
    expect(staleSources.rows[0]?.sync_status).toBe('stale');
  }, 120_000);

  it('returns sync status for a repo', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await syncManifest(database.pool, makeAuthContext(), {
      repo: 'status-repo',
      files: [
        { path: 'file.md', sha: 'sha-1', content: '# File\n\nContent.' }
      ]
    });

    const result = await getSyncStatus(database.pool, makeAuthContext(), 'status-repo');

    expect(result.isOk()).toBe(true);
    const entries = result._unsafeUnwrap();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      path: 'file.md',
      sha: 'sha-1',
      syncStatus: 'current'
    });
    expect(entries[0]?.entityId).toBeDefined();
    expect(entries[0]?.lastSynced).toBeDefined();
  }, 120_000);
});

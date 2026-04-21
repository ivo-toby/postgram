import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  syncManifest,
  getSyncStatus,
  diffSyncManifest,
  uploadSyncFiles,
  finalizeSyncManifest
} from '../../src/services/sync-service.js';
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

    const entities = await database.pool.query<{ type: string; content: string; metadata: Record<string, unknown> }>(
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

  it('restores previously deleted files when they reappear', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    // Initial sync with one file
    await syncManifest(database.pool, makeAuthContext(), {
      repo: 'test-repo',
      files: [
        { path: 'comeback.md', sha: 'sha-1', content: '# Comeback\n\nOriginal.' }
      ]
    });

    // Remove the file
    await syncManifest(database.pool, makeAuthContext(), {
      repo: 'test-repo',
      files: []
    });

    // Verify archived
    const archived = await database.pool.query<{ status: string }>(
      "SELECT e.status FROM entities e JOIN document_sources ds ON ds.entity_id = e.id WHERE ds.path = 'comeback.md'"
    );
    expect(archived.rows[0]?.status).toBe('archived');

    // Bring it back with same SHA
    const result = await syncManifest(database.pool, makeAuthContext(), {
      repo: 'test-repo',
      files: [
        { path: 'comeback.md', sha: 'sha-1', content: '# Comeback\n\nOriginal.' }
      ]
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().unchanged).toBe(1);

    // Entity should be un-archived
    const restored = await database.pool.query<{ status: string | null; sync_status: string }>(
      "SELECT e.status, ds.sync_status FROM entities e JOIN document_sources ds ON ds.entity_id = e.id WHERE ds.path = 'comeback.md'"
    );
    expect(restored.rows[0]?.status).toBeNull();
    expect(restored.rows[0]?.sync_status).toBe('current');
  }, 120_000);

  describe('two-phase protocol (diff / upload / finalize)', () => {
    it('diff returns new+changed+deleted and unchanged count', async () => {
      if (!database) {
        throw new Error('test database not initialized');
      }

      // Seed an existing repo.
      await syncManifest(database.pool, makeAuthContext(), {
        repo: 'tp-repo',
        files: [
          { path: 'keep.md', sha: 'sha-keep', content: '# Keep' },
          { path: 'mutate.md', sha: 'sha-old', content: '# Old' },
          { path: 'drop.md', sha: 'sha-drop', content: '# Drop' }
        ]
      });

      const diff = await diffSyncManifest(database.pool, makeAuthContext(), {
        repo: 'tp-repo',
        files: [
          { path: 'keep.md', sha: 'sha-keep' },
          { path: 'mutate.md', sha: 'sha-new' },
          { path: 'fresh.md', sha: 'sha-fresh' }
        ]
      });

      expect(diff.isOk()).toBe(true);
      const result = diff._unsafeUnwrap();
      expect(result.unchanged).toBe(1);
      expect(result.toDelete).toEqual(['drop.md']);
      expect(result.toUpload).toEqual(
        expect.arrayContaining([
          { path: 'mutate.md', sha: 'sha-new', reason: 'changed' },
          { path: 'fresh.md', sha: 'sha-fresh', reason: 'new' }
        ])
      );
      expect(result.toUpload).toHaveLength(2);
    }, 120_000);

    it('upload creates new files and updates changed ones', async () => {
      if (!database) {
        throw new Error('test database not initialized');
      }

      await syncManifest(database.pool, makeAuthContext(), {
        repo: 'tp-repo',
        files: [{ path: 'change.md', sha: 'sha-old', content: '# Old' }]
      });

      const upload = await uploadSyncFiles(database.pool, makeAuthContext(), {
        repo: 'tp-repo',
        files: [
          { path: 'new.md', sha: 'sha-new', content: '# New' },
          { path: 'change.md', sha: 'sha-v2', content: '# Updated' }
        ]
      });

      expect(upload.isOk()).toBe(true);
      expect(upload._unsafeUnwrap()).toEqual({ created: 1, updated: 1 });

      const rows = await database.pool.query<{ path: string; sha: string }>(
        "SELECT path, sha FROM document_sources WHERE repo = 'tp-repo' ORDER BY path"
      );
      expect(rows.rows).toEqual([
        { path: 'change.md', sha: 'sha-v2' },
        { path: 'new.md', sha: 'sha-new' }
      ]);
    }, 120_000);

    it('finalize archives orphans, restores stale matches, and updates timestamps', async () => {
      if (!database) {
        throw new Error('test database not initialized');
      }

      // Initial state: one current, one stale (simulated by archiving via a prior sync).
      await syncManifest(database.pool, makeAuthContext(), {
        repo: 'tp-repo',
        files: [
          { path: 'current.md', sha: 'sha-c', content: '# Current' },
          { path: 'comeback.md', sha: 'sha-cb', content: '# Comeback' },
          { path: 'orphan.md', sha: 'sha-o', content: '# Orphan' }
        ]
      });

      // Mark comeback.md stale by syncing without it.
      await syncManifest(database.pool, makeAuthContext(), {
        repo: 'tp-repo',
        files: [
          { path: 'current.md', sha: 'sha-c', content: '# Current' },
          { path: 'orphan.md', sha: 'sha-o', content: '# Orphan' }
        ]
      });

      const finalize = await finalizeSyncManifest(database.pool, makeAuthContext(), {
        repo: 'tp-repo',
        files: [
          { path: 'current.md', sha: 'sha-c' },
          { path: 'comeback.md', sha: 'sha-cb' }
        ]
      });

      expect(finalize.isOk()).toBe(true);
      expect(finalize._unsafeUnwrap()).toEqual({ deleted: 1 });

      const rows = await database.pool.query<{ path: string; sync_status: string; status: string | null }>(
        `SELECT ds.path, ds.sync_status, e.status
         FROM document_sources ds
         JOIN entities e ON e.id = ds.entity_id
         WHERE ds.repo = 'tp-repo'
         ORDER BY ds.path`
      );
      const byPath = Object.fromEntries(rows.rows.map((r) => [r.path, r]));
      expect(byPath['comeback.md']).toMatchObject({ sync_status: 'current', status: null });
      expect(byPath['current.md']).toMatchObject({ sync_status: 'current', status: null });
      expect(byPath['orphan.md']).toMatchObject({ sync_status: 'stale', status: 'archived' });
    }, 120_000);

    it('full diff → upload → finalize flow matches single-shot sync results', async () => {
      if (!database) {
        throw new Error('test database not initialized');
      }

      await syncManifest(database.pool, makeAuthContext(), {
        repo: 'flow-repo',
        files: [
          { path: 'a.md', sha: 'sha-a', content: '# A' },
          { path: 'b.md', sha: 'sha-b-old', content: '# B old' },
          { path: 'remove.md', sha: 'sha-r', content: '# Remove' }
        ]
      });

      const newManifest = [
        { path: 'a.md', sha: 'sha-a' },
        { path: 'b.md', sha: 'sha-b-new' },
        { path: 'c.md', sha: 'sha-c' }
      ];

      const diff = (await diffSyncManifest(database.pool, makeAuthContext(), {
        repo: 'flow-repo',
        files: newManifest
      }))._unsafeUnwrap();

      expect(diff.unchanged).toBe(1);
      expect(diff.toDelete).toEqual(['remove.md']);

      const uploadResult = (await uploadSyncFiles(database.pool, makeAuthContext(), {
        repo: 'flow-repo',
        files: diff.toUpload.map((f) => ({
          path: f.path,
          sha: f.sha,
          content: f.reason === 'new' ? '# C' : '# B new'
        }))
      }))._unsafeUnwrap();

      const finalResult = (await finalizeSyncManifest(database.pool, makeAuthContext(), {
        repo: 'flow-repo',
        files: newManifest
      }))._unsafeUnwrap();

      expect({
        created: uploadResult.created,
        updated: uploadResult.updated,
        unchanged: diff.unchanged,
        deleted: finalResult.deleted
      }).toEqual({ created: 1, updated: 1, unchanged: 1, deleted: 1 });

      const rows = await database.pool.query<{ path: string; sha: string; sync_status: string }>(
        "SELECT path, sha, sync_status FROM document_sources WHERE repo = 'flow-repo' ORDER BY path"
      );
      expect(rows.rows).toEqual([
        { path: 'a.md', sha: 'sha-a', sync_status: 'current' },
        { path: 'b.md', sha: 'sha-b-new', sync_status: 'current' },
        { path: 'c.md', sha: 'sha-c', sync_status: 'current' },
        { path: 'remove.md', sha: 'sha-r', sync_status: 'stale' }
      ]);
    }, 120_000);
  });

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

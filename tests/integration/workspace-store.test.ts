import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Pool, PoolClient } from 'pg';

import type { AuthContext } from '../../src/auth/types.js';
import type { WorkspaceRow } from '../../src/types/workspaces.js';
import {
  loadFeatureSummary,
  resolveFeatureLink,
  upsertMachine,
  upsertWorkspace
} from '../../src/services/workspace-store.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

const KEY_ID = '00000000-0000-0000-0000-000000000501';
const UNKNOWN_FEATURE_ID = '00000000-0000-0000-0000-000000000fff';
const PAST = new Date('2020-01-01T00:00:00.000Z');
const PAST_OBSERVED = new Date('2020-06-01T00:00:00.000Z');
const FUTURE = new Date('2030-01-01T00:00:00.000Z');
const FUTURE_OBSERVED = new Date('2031-01-01T00:00:00.000Z');
const EPOCH_BOUNDARY = new Date('2025-01-01T00:00:00.000Z').getTime();

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    apiKeyId: KEY_ID,
    keyName: 'workspace-store-key',
    clientId: 'workspace-store-key',
    scopes: ['read', 'write'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared'],
    ...overrides
  };
}

async function withTransaction<T>(
  pool: Pool,
  run: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const value = await run(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedMachine(pool: Pool, alias = 'work-laptop'): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO machines (alias, hostname, last_seen_at)
      VALUES ($1, 'host.local', now())
      RETURNING id
    `,
    [alias]
  );

  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error('machine seed failed');
  }

  return id;
}

async function seedWorkspace(
  pool: Pool,
  machineId: string,
  input: {
    path: string;
    repoRemote?: string | null;
    missingSince?: Date | null;
    lastActivityAt?: Date;
  }
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO workspaces (
        machine_id,
        path,
        repo_remote,
        missing_since,
        last_activity_at
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `,
    [
      machineId,
      input.path,
      input.repoRemote ?? null,
      input.missingSince ?? null,
      input.lastActivityAt ?? PAST
    ]
  );

  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error('workspace seed failed');
  }

  return id;
}

async function seedEntity(
  pool: Pool,
  input: {
    type: string;
    content: string;
    visibility?: 'personal' | 'work' | 'shared';
    metadata?: Record<string, unknown>;
  }
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO entities (type, content, visibility, metadata)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `,
    [input.type, input.content, input.visibility ?? 'personal', input.metadata ?? {}]
  );

  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error('entity seed failed');
  }

  return id;
}

async function readWorkspace(pool: Pool, id: string): Promise<WorkspaceRow> {
  const result = await pool.query<WorkspaceRow>(
    'SELECT * FROM workspaces WHERE id = $1 LIMIT 1',
    [id]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('workspace row missing');
  }

  return row;
}

async function workspaceIdByPath(pool: Pool, path: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM workspaces WHERE path = $1',
    [path]
  );

  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error('workspace row missing');
  }

  return id;
}

async function readMachineBootId(pool: Pool, alias: string): Promise<string | null> {
  const result = await pool.query<{ boot_id: string | null }>(
    'SELECT boot_id FROM machines WHERE alias = $1',
    [alias]
  );

  return result.rows[0]?.boot_id ?? null;
}

async function countRows(pool: Pool, table: string): Promise<number> {
  const result = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table}`
  );

  return result.rows[0]?.n ?? 0;
}

type EntitySnapshotRow = {
  id: string;
  type: string;
  content: string | null;
  visibility: string;
  metadata: Record<string, unknown>;
  version: number;
  status: string | null;
  enrichment_status: string | null;
};

async function snapshotEntities(pool: Pool): Promise<EntitySnapshotRow[]> {
  const result = await pool.query<EntitySnapshotRow>(
    `
      SELECT id, type, content, visibility, metadata, version, status, enrichment_status
      FROM entities
      ORDER BY id
    `
  );

  return result.rows;
}

describe('workspace-store', () => {
  let database: TestDatabase | undefined;

  function pool(): Pool {
    if (!database) {
      throw new Error('test database not initialized');
    }

    return database.pool;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    await resetTestDatabase(pool());
    await seedApiKey(pool(), { id: KEY_ID, name: 'workspace-store-key' });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  describe('upsertMachine', () => {
    it('creates the machine once per alias and refreshes hostname and last_seen_at', async () => {
      const first = await withTransaction(pool(), (client) =>
        upsertMachine(client, {
          alias: 'work-laptop',
          hostname: 'host-a',
          bootId: 'boot-a',
          source: 'hook'
        })
      );

      expect(first.created).toBe(true);
      expect(first.machine.alias).toBe('work-laptop');
      expect(first.machine.hostname).toBe('host-a');
      expect(first.machine.boot_id).toBe('boot-a');

      const second = await withTransaction(pool(), (client) =>
        upsertMachine(client, {
          alias: 'work-laptop',
          hostname: 'host-b',
          bootId: 'boot-b',
          source: 'hook'
        })
      );

      expect(second.created).toBe(false);
      expect(second.machine.id).toBe(first.machine.id);
      expect(second.machine.hostname).toBe('host-b');
      expect(
        second.machine.last_seen_at.getTime() >=
          first.machine.last_seen_at.getTime()
      ).toBe(true);

      expect(await countRows(pool(), 'machines')).toBe(1);
    });

    it('sets boot_id only for a hook report with a non-null boot id', async () => {
      await withTransaction(pool(), (client) =>
        upsertMachine(client, {
          alias: 'scan-box',
          hostname: 'scan-host',
          bootId: 'boot-scan',
          source: 'scan'
        })
      );
      expect(await readMachineBootId(pool(), 'scan-box')).toBeNull();

      await withTransaction(pool(), (client) =>
        upsertMachine(client, {
          alias: 'scan-box',
          hostname: 'scan-host',
          bootId: 'boot-hook',
          source: 'hook'
        })
      );
      expect(await readMachineBootId(pool(), 'scan-box')).toBe('boot-hook');

      await withTransaction(pool(), (client) =>
        upsertMachine(client, {
          alias: 'scan-box',
          hostname: 'scan-host',
          bootId: 'boot-scan-2',
          source: 'scan'
        })
      );
      expect(await readMachineBootId(pool(), 'scan-box')).toBe('boot-hook');

      await withTransaction(pool(), (client) =>
        upsertMachine(client, {
          alias: 'scan-box',
          hostname: 'scan-host',
          bootId: null,
          source: 'hook'
        })
      );
      expect(await readMachineBootId(pool(), 'scan-box')).toBe('boot-hook');
    });

    it('keeps boot_id null when a hook report has no boot id on insert', async () => {
      const result = await withTransaction(pool(), (client) =>
        upsertMachine(client, {
          alias: 'fresh-box',
          hostname: 'fresh-host',
          bootId: null,
          source: 'hook'
        })
      );

      expect(result.created).toBe(true);
      expect(result.machine.boot_id).toBeNull();
      expect(await readMachineBootId(pool(), 'fresh-box')).toBeNull();
    });
  });

  describe('upsertWorkspace', () => {
    it('upserts once per machine and path and strips a trailing slash', async () => {
      const machineId = await seedMachine(pool());

      const first = await withTransaction(pool(), (client) =>
        upsertWorkspace(client, {
          machineId,
          source: 'hook',
          path: '/home/dev/work/alpha/'
        })
      );
      expect(first.created).toBe(true);
      expect(first.workspace.path).toBe('/home/dev/work/alpha');

      const second = await withTransaction(pool(), (client) =>
        upsertWorkspace(client, {
          machineId,
          source: 'hook',
          path: '/home/dev/work/alpha'
        })
      );
      expect(second.created).toBe(false);
      expect(second.workspace.id).toBe(first.workspace.id);
      expect(
        await workspaceIdByPath(pool(), '/home/dev/work/alpha')
      ).toBe(first.workspace.id);

      expect(await countRows(pool(), 'workspaces')).toBe(1);
    });

    it('keeps omitted repo values and clears them when they are null', async () => {
      const machineId = await seedMachine(pool());

      const created = await withTransaction(pool(), (client) =>
        upsertWorkspace(client, {
          machineId,
          source: 'hook',
          path: '/home/dev/work/keep',
          repoRemote: 'github.com/ivo-toby/postgram',
          repoRoot: '/home/dev/src/postgram',
          branch: 'main'
        })
      );

      const omitted = await withTransaction(pool(), (client) =>
        upsertWorkspace(client, {
          machineId,
          source: 'hook',
          path: '/home/dev/work/keep'
        })
      );
      expect(omitted.workspace.repo_remote).toBe('github.com/ivo-toby/postgram');
      expect(omitted.workspace.repo_root).toBe('/home/dev/src/postgram');
      expect(omitted.workspace.branch).toBe('main');

      const nulled = await withTransaction(pool(), (client) =>
        upsertWorkspace(client, {
          machineId,
          source: 'hook',
          path: '/home/dev/work/keep',
          repoRemote: null,
          repoRoot: null,
          branch: null
        })
      );
      expect(nulled.workspace.repo_remote).toBeNull();
      expect(nulled.workspace.repo_root).toBeNull();
      expect(nulled.workspace.branch).toBeNull();

      const stored = await readWorkspace(pool(), created.workspace.id);
      expect(stored.repo_remote).toBeNull();
      expect(await countRows(pool(), 'workspaces')).toBe(1);
    });

    it('treats an omitted branch as keep and a null branch as clear', async () => {
      const machineId = await seedMachine(pool());
      const branchPath = '/home/dev/work/branch';

      const created = await withTransaction(pool(), (client) =>
        upsertWorkspace(client, {
          machineId,
          source: 'hook',
          path: branchPath,
          branch: 'feat/x'
        })
      );
      expect(created.workspace.branch).toBe('feat/x');

      const omitted = await withTransaction(pool(), (client) =>
        upsertWorkspace(client, {
          machineId,
          source: 'hook',
          path: branchPath
        })
      );
      expect(omitted.workspace.branch).toBe('feat/x');
      expect((await readWorkspace(pool(), created.workspace.id)).branch).toBe(
        'feat/x'
      );

      const cleared = await withTransaction(pool(), (client) =>
        upsertWorkspace(client, {
          machineId,
          source: 'hook',
          path: branchPath,
          branch: null
        })
      );
      expect(cleared.workspace.branch).toBeNull();
      expect((await readWorkspace(pool(), created.workspace.id)).branch).toBeNull();
    });

    it('keeps the git snapshot when omitted, clears it on null and replaces it on an object', async () => {
      const machineId = await seedMachine(pool());

      const created = await withTransaction(pool(), (client) =>
        upsertWorkspace(client, {
          machineId,
          source: 'hook',
          path: '/home/dev/work/git',
          git: { dirty_count: 2, unpushed_count: 3, has_upstream: true }
        })
      );
      expect(created.workspace.git_state_at).not.toBeNull();
      const firstStateAt = created.workspace.git_state_at?.getTime() ?? 0;

      const gitOmitted = await withTransaction(pool(), (client) =>
        upsertWorkspace(client, {
          machineId,
          source: 'hook',
          path: '/home/dev/work/git',
          branch: 'feat/git'
        })
      );
      expect(gitOmitted.workspace.git_dirty_count).toBe(2);
      expect(gitOmitted.workspace.git_unpushed_count).toBe(3);
      expect(gitOmitted.workspace.git_has_upstream).toBe(true);
      expect(gitOmitted.workspace.git_state_at?.getTime()).toBe(firstStateAt);

      const gitCleared = await withTransaction(pool(), (client) =>
        upsertWorkspace(client, {
          machineId,
          source: 'hook',
          path: '/home/dev/work/git',
          git: null
        })
      );
      expect(gitCleared.workspace.git_dirty_count).toBeNull();
      expect(gitCleared.workspace.git_unpushed_count).toBeNull();
      expect(gitCleared.workspace.git_has_upstream).toBeNull();
      expect(gitCleared.workspace.git_state_at).not.toBeNull();
      expect(gitCleared.workspace.git_state_at?.getTime()).not.toBe(firstStateAt);
      expect(gitCleared.workspace.branch).toBe('feat/git');

      const gitReplaced = await withTransaction(pool(), (client) =>
        upsertWorkspace(client, {
          machineId,
          source: 'hook',
          path: '/home/dev/work/git',
          git: { dirty_count: 0, unpushed_count: 5, has_upstream: false }
        })
      );
      expect(gitReplaced.workspace.git_dirty_count).toBe(0);
      expect(gitReplaced.workspace.git_unpushed_count).toBe(5);
      expect(gitReplaced.workspace.git_has_upstream).toBe(false);
      expect(gitReplaced.workspace.git_state_at).not.toBeNull();
    });

    it('clears missing_since and keeps stored repo values on a plain report', async () => {
      const machineId = await seedMachine(pool());
      const workspaceId = await seedWorkspace(pool(), machineId, {
        path: '/home/dev/work/gone',
        repoRemote: 'github.com/ivo-toby/stale',
        missingSince: new Date(),
        lastActivityAt: PAST
      });

      const result = await withTransaction(pool(), (client) =>
        upsertWorkspace(client, {
          machineId,
          source: 'hook',
          path: '/home/dev/work/gone'
        })
      );

      expect(result.created).toBe(false);
      expect(result.workspace.missing_since).toBeNull();
      expect(result.workspace.repo_remote).toBe('github.com/ivo-toby/stale');
      expect(
        result.workspace.last_activity_at.getTime() > PAST.getTime()
      ).toBe(true);

      const stored = await readWorkspace(pool(), workspaceId);
      expect(stored.missing_since).toBeNull();
    });

    it('uses now() for hook reports regardless of observedAt', async () => {
      const machineId = await seedMachine(pool());
      const workspaceId = await seedWorkspace(pool(), machineId, {
        path: '/home/dev/work/hook-time',
        lastActivityAt: PAST
      });

      const result = await withTransaction(pool(), (client) =>
        upsertWorkspace(client, {
          machineId,
          source: 'hook',
          path: '/home/dev/work/hook-time',
          observedAt: PAST_OBSERVED
        })
      );

      expect(
        result.workspace.last_activity_at.getTime() > EPOCH_BOUNDARY
      ).toBe(true);

      const stored = await readWorkspace(pool(), workspaceId);
      expect(stored.last_activity_at.getTime() > EPOCH_BOUNDARY).toBe(true);
    });

    it('keeps the newest activity time and ignores an older scan observation', async () => {
      const machineId = await seedMachine(pool());
      const workspaceId = await seedWorkspace(pool(), machineId, {
        path: '/home/dev/work/scan-time',
        lastActivityAt: FUTURE
      });

      const older = await withTransaction(pool(), (client) =>
        upsertWorkspace(client, {
          machineId,
          source: 'scan',
          path: '/home/dev/work/scan-time',
          observedAt: PAST_OBSERVED
        })
      );
      expect(older.created).toBe(false);
      expect(older.workspace.last_activity_at.getTime()).toBe(FUTURE.getTime());

      const newer = await withTransaction(pool(), (client) =>
        upsertWorkspace(client, {
          machineId,
          source: 'scan',
          path: '/home/dev/work/scan-time',
          observedAt: FUTURE_OBSERVED
        })
      );
      expect(newer.workspace.last_activity_at.getTime()).toBe(
        FUTURE_OBSERVED.getTime()
      );

      const stored = await readWorkspace(pool(), workspaceId);
      expect(stored.last_activity_at.getTime()).toBe(FUTURE_OBSERVED.getTime());
    });

    it('uses server time for a scan insert with no observed time', async () => {
      const machineId = await seedMachine(pool());

      const result = await withTransaction(pool(), (client) =>
        upsertWorkspace(client, {
          machineId,
          source: 'scan',
          path: '/home/dev/work/scan-insert'
        })
      );

      expect(result.created).toBe(true);
      expect(
        result.workspace.last_activity_at.getTime() > EPOCH_BOUNDARY
      ).toBe(true);
      expect(result.workspace.git_state_at).toBeNull();
    });
  });

  describe('resolveFeatureLink', () => {
    it('links a visible task and keeps the link for every warning outcome', async () => {
      const machineId = await seedMachine(pool());
      const workspaceId = await seedWorkspace(pool(), machineId, {
        path: '/home/dev/work/link'
      });
      const taskId = await seedEntity(pool(), {
        type: 'task',
        content: 'Feature one\nmore detail'
      });
      const memoryId = await seedEntity(pool(), {
        type: 'memory',
        content: 'an unrelated memory'
      });
      const workTaskId = await seedEntity(pool(), {
        type: 'task',
        content: 'A work task',
        visibility: 'work'
      });

      const linked = await withTransaction(pool(), (client) =>
        resolveFeatureLink(client, auth(), { workspaceId, featureId: taskId })
      );
      expect(linked.linkChanged).toBe(true);
      expect(linked.warning).toBeNull();
      expect(linked.workspace.feature_id).toBe(taskId);
      expect((await readWorkspace(pool(), workspaceId)).feature_id).toBe(taskId);

      const memoryResult = await withTransaction(pool(), (client) =>
        resolveFeatureLink(client, auth(), { workspaceId, featureId: memoryId })
      );
      expect(memoryResult.warning).toBe('feature_not_task');
      expect(memoryResult.linkChanged).toBe(false);
      expect((await readWorkspace(pool(), workspaceId)).feature_id).toBe(taskId);

      const unknownResult = await withTransaction(pool(), (client) =>
        resolveFeatureLink(client, auth(), {
          workspaceId,
          featureId: UNKNOWN_FEATURE_ID
        })
      );
      expect(unknownResult.warning).toBe('feature_not_found');
      expect(unknownResult.linkChanged).toBe(false);
      expect((await readWorkspace(pool(), workspaceId)).feature_id).toBe(taskId);

      const invisibleResult = await withTransaction(pool(), (client) =>
        resolveFeatureLink(client, auth({ allowedVisibility: ['personal'] }), {
          workspaceId,
          featureId: workTaskId
        })
      );
      expect(invisibleResult.warning).toBe('feature_not_found');
      expect(invisibleResult.linkChanged).toBe(false);
      expect((await readWorkspace(pool(), workspaceId)).feature_id).toBe(taskId);

      const disallowedTypeResult = await withTransaction(pool(), (client) =>
        resolveFeatureLink(client, auth({ allowedTypes: ['memory'] }), {
          workspaceId,
          featureId: taskId
        })
      );
      expect(disallowedTypeResult.warning).toBe('feature_not_found');
      expect(disallowedTypeResult.linkChanged).toBe(false);
      expect((await readWorkspace(pool(), workspaceId)).feature_id).toBe(taskId);
    });

    it('keeps an existing link when feature_id is absent or unchanged', async () => {
      const machineId = await seedMachine(pool());
      const workspaceId = await seedWorkspace(pool(), machineId, {
        path: '/home/dev/work/keep-link'
      });
      const taskId = await seedEntity(pool(), {
        type: 'task',
        content: 'Feature keep'
      });

      await withTransaction(pool(), (client) =>
        resolveFeatureLink(client, auth(), { workspaceId, featureId: taskId })
      );

      const absent = await withTransaction(pool(), (client) =>
        resolveFeatureLink(client, auth(), { workspaceId })
      );
      expect(absent.linkChanged).toBe(false);
      expect(absent.warning).toBeNull();
      expect(absent.workspace.feature_id).toBe(taskId);

      const same = await withTransaction(pool(), (client) =>
        resolveFeatureLink(client, auth(), { workspaceId, featureId: taskId })
      );
      expect(same.linkChanged).toBe(false);
      expect(same.warning).toBeNull();

      expect((await readWorkspace(pool(), workspaceId)).feature_id).toBe(taskId);
      expect(await countRows(pool(), 'workspaces')).toBe(1);
    });

    it('starts from no link and never creates or deletes entities', async () => {
      const machineId = await seedMachine(pool());
      const workspaceId = await seedWorkspace(pool(), machineId, {
        path: '/home/dev/work/no-link'
      });
      const memoryId = await seedEntity(pool(), {
        type: 'memory',
        content: 'only a memory'
      });

      expect((await readWorkspace(pool(), workspaceId)).feature_id).toBeNull();

      const before = await snapshotEntities(pool());

      const absent = await withTransaction(pool(), (client) =>
        resolveFeatureLink(client, auth(), { workspaceId })
      );
      expect(absent.workspace.feature_id).toBeNull();

      const unknown = await withTransaction(pool(), (client) =>
        resolveFeatureLink(client, auth(), {
          workspaceId,
          featureId: UNKNOWN_FEATURE_ID
        })
      );
      expect(unknown.warning).toBe('feature_not_found');

      const notTask = await withTransaction(pool(), (client) =>
        resolveFeatureLink(client, auth(), { workspaceId, featureId: memoryId })
      );
      expect(notTask.warning).toBe('feature_not_task');

      expect((await readWorkspace(pool(), workspaceId)).feature_id).toBeNull();

      const after = await snapshotEntities(pool());
      expect(after).toEqual(before);
      expect(await countRows(pool(), 'entities')).toBe(before.length);
    });
  });

  describe('loadFeatureSummary', () => {
    it('returns the first trimmed line cut at 80 characters and the stage', async () => {
      const taskId = await seedEntity(pool(), {
        type: 'task',
        content: '  Build the workspace report API  \nsecond line\nthird line',
        metadata: { stage: 'doing' }
      });

      const summary = await withTransaction(pool(), (client) =>
        loadFeatureSummary(client, auth(), taskId)
      );

      expect(summary).toEqual({
        id: taskId,
        title: 'Build the workspace report API',
        stage: 'doing'
      });
    });

    it('cuts a long first line at 80 characters', async () => {
      const taskId = await seedEntity(pool(), {
        type: 'task',
        content: `${'x'.repeat(100)}\nsecond`
      });

      const summary = await withTransaction(pool(), (client) =>
        loadFeatureSummary(client, auth(), taskId)
      );

      expect(summary?.title).toBe('x'.repeat(80));
      expect(summary?.stage).toBeNull();
    });

    it('returns null for a null id, a non-task and an invisible task', async () => {
      const memoryId = await seedEntity(pool(), {
        type: 'memory',
        content: 'memory summary source'
      });
      const workTaskId = await seedEntity(pool(), {
        type: 'task',
        content: 'work task',
        visibility: 'work'
      });

      expect(
        await withTransaction(pool(), (client) =>
          loadFeatureSummary(client, auth(), null)
        )
      ).toBeNull();

      expect(
        await withTransaction(pool(), (client) =>
          loadFeatureSummary(client, auth(), memoryId)
        )
      ).toBeNull();

      expect(
        await withTransaction(pool(), (client) =>
          loadFeatureSummary(client, auth({ allowedVisibility: ['personal'] }), workTaskId)
        )
      ).toBeNull();

      expect(
        await withTransaction(pool(), (client) =>
          loadFeatureSummary(client, auth(), UNKNOWN_FEATURE_ID)
        )
      ).toBeNull();
    });
  });
});

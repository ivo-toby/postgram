import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { appendAuditEntry } from '../../src/util/audit.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

const MACHINE_ID = '00000000-0000-0000-0000-000000000a01';
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000a02';

async function insertMachine(
  pool: TestDatabase['pool'],
  alias = 'work-laptop'
): Promise<void> {
  await pool.query(
    `
      INSERT INTO machines (id, alias, hostname, last_seen_at)
      VALUES ($1, $2, 'host.local', now())
    `,
    [MACHINE_ID, alias]
  );
}

async function insertWorkspace(
  pool: TestDatabase['pool'],
  path = '/Users/dev/project'
): Promise<void> {
  await pool.query(
    `
      INSERT INTO workspaces (id, machine_id, path, last_activity_at)
      VALUES ($1, $2, $3, now())
    `,
    [WORKSPACE_ID, MACHINE_ID, path]
  );
}

describe('workspace tracking migration', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await resetTestDatabase(database.pool);
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('creates machines, workspaces, agent_sessions and repositories', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const result = await database.pool.query<{ table_name: string }>(
      `
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1)
      `,
      [['machines', 'workspaces', 'agent_sessions', 'repositories']]
    );

    expect(
      result.rows.map((row) => row.table_name).sort()
    ).toEqual([
      'agent_sessions',
      'machines',
      'repositories',
      'workspaces'
    ]);
  });

  it('rejects a duplicate workspace path on the same machine', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await insertMachine(database.pool);
    await insertWorkspace(database.pool);

    await expect(
      database.pool.query(
        `
          INSERT INTO workspaces (machine_id, path, last_activity_at)
          VALUES ($1, $2, now())
        `,
        [MACHINE_ID, '/Users/dev/project']
      )
    ).rejects.toMatchObject({ code: '23505' });

    const samePathOtherMachine = await database.pool.query<{ id: string }>(
      `
        INSERT INTO machines (alias, hostname, last_seen_at)
        VALUES ('home-desktop', 'desk.local', now())
        RETURNING id
      `
    );
    const otherMachineId = samePathOtherMachine.rows[0]?.id;
    if (!otherMachineId) {
      throw new Error('second machine insert failed');
    }

    const reused = await database.pool.query<{ id: string }>(
      `
        INSERT INTO workspaces (machine_id, path, last_activity_at)
        VALUES ($1, $2, now())
        RETURNING id
      `,
      [otherMachineId, '/Users/dev/project']
    );
    expect(reused.rows).toHaveLength(1);
  });

  it('enforces the partial unique session key per workspace and kind', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await insertMachine(database.pool);
    await insertWorkspace(database.pool);

    const sessionInsert = (
      agentKind: string,
      agentSessionId: string | null
    ) =>
      database!.pool.query(
        `
          INSERT INTO agent_sessions (
            workspace_id,
            agent_kind,
            agent_session_id,
            status,
            started_at,
            last_activity_at
          )
          VALUES ($1, $2, $3, 'running', now(), now())
        `,
        [WORKSPACE_ID, agentKind, agentSessionId]
      );

    await sessionInsert('claude-code', 'session-1');

    await expect(sessionInsert('claude-code', 'session-1')).rejects.toMatchObject(
      { code: '23505' }
    );

    await expect(sessionInsert('pi', 'session-1')).resolves.toBeDefined();
    await expect(sessionInsert('claude-code', null)).resolves.toBeDefined();
    await expect(sessionInsert('pi', null)).resolves.toBeDefined();
  });

  it('rejects invalid alias, status and agent_kind values', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await expect(
      database.pool.query(
        `
          INSERT INTO machines (alias, hostname, last_seen_at)
          VALUES ('BAD ALIAS', 'host.local', now())
        `
      )
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      database.pool.query(
        `
          INSERT INTO machines (alias, hostname, last_seen_at)
          VALUES ('ok.alias-1', 'host.local', now())
        `
      )
    ).resolves.toBeDefined();

    await insertMachine(database.pool);
    await insertWorkspace(database.pool);

    await expect(
      database.pool.query(
        `
          INSERT INTO agent_sessions (
            workspace_id,
            agent_kind,
            status,
            started_at,
            last_activity_at
          )
          VALUES ($1, 'claude-code', 'paused', now(), now())
        `,
        [WORKSPACE_ID]
      )
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      database.pool.query(
        `
          INSERT INTO agent_sessions (
            workspace_id,
            agent_kind,
            status,
            started_at,
            last_activity_at
          )
          VALUES ($1, 'cursor', 'running', now(), now())
        `,
        [WORKSPACE_ID]
      )
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('cascades workspace deletion to sessions and clears feature links', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await insertMachine(database.pool);
    await insertWorkspace(database.pool);

    const feature = await database.pool.query<{ id: string }>(
      `
        INSERT INTO entities (type, content)
        VALUES ('task', 'feature task')
        RETURNING id
      `
    );
    const featureId = feature.rows[0]?.id;
    if (!featureId) {
      throw new Error('feature entity insert failed');
    }

    await database.pool.query(
      'UPDATE workspaces SET feature_id = $1 WHERE id = $2',
      [featureId, WORKSPACE_ID]
    );
    await database.pool.query(
      `
        INSERT INTO agent_sessions (
          workspace_id,
          agent_kind,
          status,
          started_at,
          last_activity_at
        )
        VALUES ($1, 'pi', 'running', now(), now())
      `,
      [WORKSPACE_ID]
    );

    await database.pool.query('DELETE FROM entities WHERE id = $1', [
      featureId
    ]);

    const afterFeatureDelete = await database.pool.query<{
      feature_id: string | null;
    }>(
      'SELECT feature_id FROM workspaces WHERE id = $1',
      [WORKSPACE_ID]
    );
    expect(afterFeatureDelete.rows[0]?.feature_id).toBeNull();

    await database.pool.query('DELETE FROM workspaces WHERE id = $1', [
      WORKSPACE_ID
    ]);

    const sessions = await database.pool.query<{ id: string }>(
      'SELECT id FROM agent_sessions WHERE workspace_id = $1',
      [WORKSPACE_ID]
    );
    expect(sessions.rows).toHaveLength(0);
  });

  it('lets appendAuditEntry join a client transaction that rolls back', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const client = await database.pool.connect();

    try {
      await client.query('BEGIN');
      await appendAuditEntry(client, {
        operation: 'workspace_create',
        details: { rolledBack: true }
      });
      const inside = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM audit_log WHERE operation = 'workspace_create'"
      );
      expect(inside.rows[0]?.count).toBe(1);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const after = await database.pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM audit_log WHERE operation = 'workspace_create'"
    );
    expect(after.rows[0]?.count).toBe(0);

    const commitClient = await database.pool.connect();

    try {
      await commitClient.query('BEGIN');
      await appendAuditEntry(commitClient, {
        operation: 'workspace_link',
        details: { committed: true }
      });
      await commitClient.query('COMMIT');
    } finally {
      commitClient.release();
    }

    const committed = await database.pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM audit_log WHERE operation = 'workspace_link'"
    );
    expect(committed.rows[0]?.count).toBe(1);
  });
});

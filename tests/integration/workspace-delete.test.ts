import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthContext } from '../../src/auth/types.js';
import { createFeature } from '../../src/services/feature-service.js';
import { deleteWorkspace } from '../../src/services/workspace-delete.js';
import { reportWorkspace } from '../../src/services/workspace-service.js';
import { ErrorCode } from '../../src/util/errors.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

const KEY_ID = '00000000-0000-0000-0000-000000000503';
const OPTIONS = { dormantAfterDays: 30 };

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    apiKeyId: KEY_ID,
    keyName: 'delete-key',
    clientId: 'delete-key',
    scopes: ['read', 'write', 'delete'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared'],
    ...overrides
  };
}

function hookReport(path: string, featureId?: string): Record<string, unknown> {
  return {
    source: 'hook',
    machine: { alias: 'strongbad', hostname: 'strongbad-host', boot_id: 'boot-a' },
    workspace: {
      path,
      repo_remote: 'git@github.com:example/postgram.git',
      repo_root: '/src/postgram',
      branch: 'feat/x',
      git: { dirty_count: 0, unpushed_count: 0, has_upstream: true }
    },
    ...(featureId !== undefined ? { feature_id: featureId } : {}),
    session: {
      agent_kind: 'claude-code',
      agent_session_id: `s-${path}`,
      event: 'start',
      cwd: null,
      transcript_path: null
    }
  };
}

describe('deleteWorkspace', () => {
  let database: TestDatabase | undefined;

  function db(): TestDatabase {
    if (!database) {
      throw new Error('test database not initialized');
    }
    return database;
  }

  async function report(path: string, featureId?: string): Promise<string> {
    const result = await reportWorkspace(
      db().pool,
      auth(),
      hookReport(path, featureId),
      OPTIONS
    );
    const workspace = result._unsafeUnwrap().workspace;
    if (!workspace) {
      throw new Error('report returned no workspace');
    }
    return workspace.id;
  }

  async function count(table: string): Promise<number> {
    const result = await db().pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM ${table}`
    );
    return result.rows[0]?.n ?? 0;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    await resetTestDatabase(db().pool);
    await db().pool.query(
      'TRUNCATE TABLE agent_sessions, workspaces, machines, repositories CASCADE'
    );
    await seedApiKey(db().pool, { id: KEY_ID, name: 'delete-key' });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('removes the workspace and its sessions but keeps the feature entity', async () => {
    const featureId = (
      await createFeature(db().pool, auth(), { content: 'Keep me' })
    )._unsafeUnwrap().id;
    const id = await report('/wt/a', featureId);
    const other = await report('/wt/b', featureId);
    const entitiesBefore = await count('entities');

    const deleted = (
      await deleteWorkspace(db().pool, auth(), { id }, OPTIONS)
    )._unsafeUnwrap();

    expect(deleted).toMatchObject({ id, path: '/wt/a', feature_id: featureId });
    expect(await count('workspaces')).toBe(1);
    expect(await count('agent_sessions')).toBe(1);
    const left = await db().pool.query<{ id: string }>('SELECT id FROM workspaces');
    expect(left.rows[0]?.id).toBe(other);
    expect(await count('entities')).toBe(entitiesBefore);

    const audit = await db().pool.query<{ details: Record<string, unknown> }>(
      "SELECT details FROM audit_log WHERE operation = 'workspace_delete'"
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.details).toMatchObject({ path: '/wt/a' });
  }, 120_000);

  it('returns NOT_FOUND for an unknown or malformed id', async () => {
    const unknown = await deleteWorkspace(
      db().pool,
      auth(),
      { id: '11111111-1111-4111-8111-111111111111' },
      OPTIONS
    );
    expect(unknown._unsafeUnwrapErr().code).toBe(ErrorCode.NOT_FOUND);
    const malformed = await deleteWorkspace(
      db().pool,
      auth(),
      { id: 'nope' },
      OPTIONS
    );
    expect(malformed._unsafeUnwrapErr().code).toBe(ErrorCode.NOT_FOUND);
  }, 120_000);

  it('requires the delete scope', async () => {
    const id = await report('/wt/a');
    const result = await deleteWorkspace(
      db().pool,
      auth({ scopes: ['read', 'write'] }),
      { id },
      OPTIONS
    );
    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.FORBIDDEN);
    expect(await count('workspaces')).toBe(1);
  }, 120_000);
});

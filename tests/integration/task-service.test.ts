import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  completeTask,
  createTask,
  listTasks,
  updateTask
} from '../../src/services/task-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

function makeAuthContext(): AuthContext {
  return {
    apiKeyId: 'task-key',
    keyName: 'task-key',
    scopes: ['read', 'write', 'delete'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared']
  };
}

describe('task-service', () => {
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

  it('creates tasks with inbox status by default', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const created = await createTask(database.pool, makeAuthContext(), {
      content: 'write MCP transport',
      context: '@dev',
      dueDate: '2026-03-25'
    });

    expect(created.isOk()).toBe(true);
    expect(created._unsafeUnwrap()).toMatchObject({
      type: 'task',
      status: 'inbox',
      metadata: {
        context: '@dev',
        due_date: '2026-03-25'
      }
    });
  }, 120_000);

  it('lists tasks filtered by status and context', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await createTask(database.pool, makeAuthContext(), {
      content: 'write MCP transport',
      context: '@dev',
      status: 'next'
    });
    await createTask(database.pool, makeAuthContext(), {
      content: 'buy groceries',
      context: '@home',
      status: 'inbox'
    });

    const listed = await listTasks(database.pool, makeAuthContext(), {
      status: 'next',
      context: '@dev'
    });

    expect(listed.isOk()).toBe(true);
    expect(listed._unsafeUnwrap()).toMatchObject({
      total: 1,
      items: [
        {
          type: 'task',
          status: 'next',
          metadata: {
            context: '@dev'
          }
        }
      ]
    });
  }, 120_000);

  it('updates and completes tasks with a completion timestamp', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const created = (await createTask(database.pool, makeAuthContext(), {
      content: 'write tests',
      context: '@dev'
    }))._unsafeUnwrap();

    const updated = await updateTask(database.pool, makeAuthContext(), {
      id: created.id,
      version: created.version,
      status: 'next',
      context: '@deep-work'
    });

    expect(updated.isOk()).toBe(true);
    expect(updated._unsafeUnwrap()).toMatchObject({
      status: 'next',
      metadata: {
        context: '@deep-work'
      }
    });

    const completed = await completeTask(database.pool, makeAuthContext(), {
      id: created.id,
      version: updated._unsafeUnwrap().version
    });

    expect(completed.isOk()).toBe(true);
    const completedTask = completed._unsafeUnwrap();
    expect(completedTask.status).toBe('done');
    expect(typeof completedTask.metadata.completed_at).toBe('string');
  }, 120_000);
});

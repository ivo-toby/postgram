import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

import type { AuthContext } from '../../src/auth/types.js';
import { listTasks } from '../../src/services/task-service.js';

const auth: AuthContext = {
  apiKeyId: '00000000-0000-0000-0000-000000000106',
  keyName: 'tasks-key',
  clientId: 'tasks-key',
  scopes: ['read'],
  allowedTypes: null,
  allowedVisibility: ['personal', 'work', 'shared']
};

function capture() {
  const query = vi.fn<(sql: string, params: unknown[]) => Promise<{ rows: [] }>>(() =>
    Promise.resolve({ rows: [] })
  );
  return { pool: { query } as unknown as Pool, query };
}

describe('listTasks kind filter', () => {
  it('filters on metadata.kind and defaults to all kinds', async () => {
    const { pool, query } = capture();
    await listTasks(pool, auth, {});
    await listTasks(pool, auth, { kind: 'task' });
    await listTasks(pool, auth, { kind: 'feature' });

    const [sql] = query.mock.calls[0] ?? [''];
    expect(sql).toContain("metadata->>'kind' IS NOT DISTINCT FROM 'feature'");
    expect(query.mock.calls.map((call) => call[1].at(-1))).toEqual(['all', 'task', 'feature']);
  });
});

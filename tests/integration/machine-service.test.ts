import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthContext } from '../../src/auth/types.js';
import type { ServiceResult } from '../../src/types/common.js';
import {
  listMachines,
  setMachineConnectTarget
} from '../../src/services/machine-service.js';
import { reportWorkspace } from '../../src/services/workspace-service.js';
import { ErrorCode } from '../../src/util/errors.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

const KEY_ID = '00000000-0000-0000-0000-000000000501';
const OPTIONS = { dormantAfterDays: 30 };

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    apiKeyId: KEY_ID,
    keyName: 'machine-key',
    clientId: 'machine-key',
    scopes: ['read', 'write'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared'],
    ...overrides
  };
}

function hookReport(input: { alias: string; path: string }): Record<
  string,
  unknown
> {
  return {
    source: 'hook',
    machine: { alias: input.alias, hostname: `${input.alias}-host`, boot_id: 'boot-a' },
    workspace: {
      path: input.path,
      repo_remote: 'git@github.com:Ivo-Toby/postgram.git',
      repo_root: '/home/ivo/src/postgram',
      branch: 'feat/x',
      git: { dirty_count: 0, unpushed_count: 0, has_upstream: true }
    },
    session: {
      agent_kind: 'claude-code',
      agent_session_id: `s-${input.path}`,
      event: 'start',
      cwd: null,
      transcript_path: null
    }
  };
}

function errorCode<T>(result: Awaited<ServiceResult<T>>): ErrorCode | null {
  return result.isErr() ? result.error.code : null;
}

describe('machine service', () => {
  let database: TestDatabase | undefined;

  function db(): TestDatabase {
    if (!database) {
      throw new Error('test database not initialized');
    }
    return database;
  }

  async function report(input: { alias: string; path: string }): Promise<void> {
    const result = await reportWorkspace(
      db().pool,
      auth(),
      hookReport(input),
      OPTIONS
    );
    if (result.isErr()) {
      throw result.error;
    }
  }

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    await resetTestDatabase(db().pool);
    await db().pool.query(
      'TRUNCATE TABLE agent_sessions, workspaces, machines, repositories CASCADE'
    );
    await seedApiKey(db().pool, { id: KEY_ID, name: 'machine-key' });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('lists machines sorted by alias with ISO last_seen_at', async () => {
    // Reported in reverse alias order; the listing must be sorted.
    await report({ alias: 'zeta', path: '/home/ivo/wt/z' });
    await report({ alias: 'alpha', path: '/home/ivo/wt/a' });

    const machines = (await listMachines(db().pool, auth()))._unsafeUnwrap();
    expect(machines.map((m) => [m.alias, m.hostname, m.connect_target])).toEqual(
      [
        ['alpha', 'alpha-host', null],
        ['zeta', 'zeta-host', null]
      ]
    );
    for (const machine of machines) {
      expect(typeof machine.last_seen_at).toBe('string');
      expect(Number.isNaN(Date.parse(machine.last_seen_at))).toBe(false);
    }
  }, 120_000);

  it('sets and clears a connect target', async () => {
    await report({ alias: 'codebox', path: '/home/ivo/wt/b' });

    const set = (
      await setMachineConnectTarget(db().pool, auth(), {
        alias: 'codebox',
        connectTarget: 'ivo@codebox.local'
      })
    )._unsafeUnwrap();
    expect(set.alias).toBe('codebox');
    expect(set.hostname).toBe('codebox-host');
    expect(set.connect_target).toBe('ivo@codebox.local');

    // Stored, not just returned.
    const listed = (await listMachines(db().pool, auth()))._unsafeUnwrap();
    expect(listed[0]?.connect_target).toBe('ivo@codebox.local');

    const cleared = (
      await setMachineConnectTarget(db().pool, auth(), {
        alias: 'codebox',
        connectTarget: null
      })
    )._unsafeUnwrap();
    expect(cleared.connect_target).toBeNull();

    const after = (await listMachines(db().pool, auth()))._unsafeUnwrap();
    expect(after[0]?.connect_target).toBeNull();
  }, 120_000);

  it('rejects invalid targets and unknown aliases without writing', async () => {
    await report({ alias: 'codebox', path: '/home/ivo/wt/b' });

    const spaced = await setMachineConnectTarget(db().pool, auth(), {
      alias: 'codebox',
      connectTarget: 'bad target!'
    });
    expect(errorCode(spaced)).toBe(ErrorCode.VALIDATION);

    const empty = await setMachineConnectTarget(db().pool, auth(), {
      alias: 'codebox',
      connectTarget: ''
    });
    expect(errorCode(empty)).toBe(ErrorCode.VALIDATION);

    const tooLong = await setMachineConnectTarget(db().pool, auth(), {
      alias: 'codebox',
      connectTarget: 'x'.repeat(256)
    });
    expect(errorCode(tooLong)).toBe(ErrorCode.VALIDATION);

    const unknown = await setMachineConnectTarget(db().pool, auth(), {
      alias: 'nope',
      connectTarget: 'nope'
    });
    expect(errorCode(unknown)).toBe(ErrorCode.NOT_FOUND);

    // Nothing created or changed.
    const after = (await listMachines(db().pool, auth()))._unsafeUnwrap();
    expect(after.map((m) => m.alias)).toEqual(['codebox']);
    expect(after[0]?.connect_target).toBeNull();
  }, 120_000);

  it('accepts a 255-character target', async () => {
    await report({ alias: 'codebox', path: '/home/ivo/wt/b' });

    const target = 'a'.repeat(255);
    const set = (
      await setMachineConnectTarget(db().pool, auth(), {
        alias: 'codebox',
        connectTarget: target
      })
    )._unsafeUnwrap();
    expect(set.connect_target).toBe(target);
  }, 120_000);

  it('enforces read scope for list and write scope for set', async () => {
    await report({ alias: 'codebox', path: '/home/ivo/wt/b' });

    const listNoRead = await listMachines(
      db().pool,
      auth({ scopes: ['write'] })
    );
    expect(errorCode(listNoRead)).toBe(ErrorCode.FORBIDDEN);

    const setNoWrite = await setMachineConnectTarget(
      db().pool,
      auth({ scopes: ['read'] }),
      { alias: 'codebox', connectTarget: 'x' }
    );
    expect(errorCode(setNoWrite)).toBe(ErrorCode.FORBIDDEN);
  }, 120_000);
});

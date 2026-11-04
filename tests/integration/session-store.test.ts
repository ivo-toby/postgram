import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';

import {
  applyHookSession,
  applyScanSessions,
  findTargetSession,
  interruptRebootedSessions
} from '../../src/services/session-store.js';
import type {
  AgentKind,
  AgentSessionRow,
  SessionStatus
} from '../../src/types/workspaces.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

const SESSION_COLUMNS = `
  id,
  workspace_id,
  agent_kind,
  agent_session_id,
  status,
  boot_id,
  cwd,
  transcript_path,
  started_at,
  last_activity_at,
  ended_at,
  end_reason
`;

describe('session-store', () => {
  let database: TestDatabase | undefined;

  function pool() {
    if (!database) {
      throw new Error('test database not initialized');
    }

    return database.pool;
  }

  async function withClient<T>(fn: (client: PoolClient) => Promise<T>) {
    const client = await pool().connect();

    try {
      await client.query('BEGIN');
      const value = await fn(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function seedMachine(
    client: PoolClient,
    alias: string
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `
        INSERT INTO machines (alias, hostname, last_seen_at)
        VALUES ($1, $1, now())
        RETURNING id
      `,
      [alias]
    );
    const id = result.rows[0]?.id;

    if (!id) {
      throw new Error(`failed to seed machine ${alias}`);
    }

    return id;
  }

  async function seedWorkspace(
    client: PoolClient,
    machineId: string,
    path: string
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `
        INSERT INTO workspaces (machine_id, path, last_activity_at)
        VALUES ($1, $2, now())
        RETURNING id
      `,
      [machineId, path]
    );
    const id = result.rows[0]?.id;

    if (!id) {
      throw new Error(`failed to seed workspace ${path}`);
    }

    return id;
  }

  async function seedSession(
    client: PoolClient,
    input: {
      workspaceId: string;
      agentKind: AgentKind;
      agentSessionId: string | null;
      status: SessionStatus;
      bootId?: string | null;
    }
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `
        INSERT INTO agent_sessions (
          workspace_id,
          agent_kind,
          agent_session_id,
          status,
          boot_id,
          started_at,
          last_activity_at,
          ended_at,
          end_reason
        )
        VALUES (
          $1, $2, $3, $4, $5, now(), now(),
          CASE WHEN $4 IN ('ended', 'interrupted') THEN now() ELSE NULL END,
          NULL
        )
        RETURNING id
      `,
      [
        input.workspaceId,
        input.agentKind,
        input.agentSessionId,
        input.status,
        input.bootId ?? null
      ]
    );
    const id = result.rows[0]?.id;

    if (!id) {
      throw new Error('failed to seed agent session');
    }

    return id;
  }

  async function fetchSession(
    client: PoolClient,
    id: string
  ): Promise<AgentSessionRow | undefined> {
    const result = await client.query<AgentSessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM agent_sessions WHERE id = $1`,
      [id]
    );

    return result.rows[0];
  }

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    await resetTestDatabase(pool());
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  describe('findTargetSession', () => {
    it('returns null when the workspace does not exist', async () => {
      await withClient(async (client) => {
        const machineId = await seedMachine(client, 'ws-missing-machine');

        const target = await findTargetSession(client, {
          machineId,
          path: '/repo/nowhere',
          agentKind: 'pi',
          agentSessionId: 'sess-1',
          event: 'activity'
        });

        expect(target).toBeNull();
      });
    });

    it('finds the session by workspace, kind and id; kind is part of the key', async () => {
      await withClient(async (client) => {
        const machineId = await seedMachine(client, 'key-machine');
        const workspaceId = await seedWorkspace(
          client,
          machineId,
          '/repo/keyed'
        );
        const sessionId = await seedSession(client, {
          workspaceId,
          agentKind: 'pi',
          agentSessionId: 'dup-1',
          status: 'running',
          bootId: 'boot-A'
        });

        const found = await findTargetSession(client, {
          machineId,
          path: '/repo/keyed',
          agentKind: 'pi',
          agentSessionId: 'dup-1',
          event: 'stop'
        });
        expect(found).toBe(sessionId);

        const wrongKind = await findTargetSession(client, {
          machineId,
          path: '/repo/keyed',
          agentKind: 'claude-code',
          agentSessionId: 'dup-1',
          event: 'stop'
        });
        expect(wrongKind).toBeNull();
      });
    });

    it('id-less: start returns null, other events pick the newest id-less row of that kind', async () => {
      await withClient(async (client) => {
        const machineId = await seedMachine(client, 'idless-find-machine');
        const workspaceId = await seedWorkspace(
          client,
          machineId,
          '/repo/idless'
        );

        const beforeAny = await findTargetSession(client, {
          machineId,
          path: '/repo/idless',
          agentKind: 'pi',
          agentSessionId: null,
          event: 'activity'
        });
        expect(beforeAny).toBeNull();

        const startTarget = await findTargetSession(client, {
          machineId,
          path: '/repo/idless',
          agentKind: 'pi',
          agentSessionId: null,
          event: 'start'
        });
        expect(startTarget).toBeNull();

        const older = await seedSession(client, {
          workspaceId,
          agentKind: 'pi',
          agentSessionId: null,
          status: 'running'
        });
        const newest = await seedSession(client, {
          workspaceId,
          agentKind: 'pi',
          agentSessionId: null,
          status: 'running'
        });
        // Seeded in the same transaction share now(); make recency explicit.
        await client.query(
          `
            UPDATE agent_sessions
               SET last_activity_at = now() - interval '2 hours'
             WHERE id = $1
          `,
          [older]
        );

        // These must be ignored: a session with an id, and another kind.
        await seedSession(client, {
          workspaceId,
          agentKind: 'pi',
          agentSessionId: 'has-id',
          status: 'running'
        });
        await seedSession(client, {
          workspaceId,
          agentKind: 'talon',
          agentSessionId: null,
          status: 'running'
        });

        const target = await findTargetSession(client, {
          machineId,
          path: '/repo/idless',
          agentKind: 'pi',
          agentSessionId: null,
          event: 'stop'
        });
        expect(target).toBe(newest);
      });
    });
  });

  describe('interruptRebootedSessions', () => {
    it('interrupts other running sessions from a different boot and excludes the reported session', async () => {
      await withClient(async (client) => {
        const machineId = await seedMachine(client, 'reboot-machine');
        const workspaceId = await seedWorkspace(
          client,
          machineId,
          '/repo/reboot'
        );
        const s1 = await seedSession(client, {
          workspaceId,
          agentKind: 'pi',
          agentSessionId: 's1',
          status: 'running',
          bootId: 'boot-A'
        });
        const s2 = await seedSession(client, {
          workspaceId,
          agentKind: 'pi',
          agentSessionId: 's2',
          status: 'running',
          bootId: 'boot-A'
        });

        const interrupted = await interruptRebootedSessions(client, {
          machineId,
          bootId: 'boot-B',
          excludeSessionId: s1
        });

        expect(interrupted).toEqual([s2]);

        const rowS1 = await fetchSession(client, s1);
        expect(rowS1?.status).toBe('running');
        expect(rowS1?.boot_id).toBe('boot-A');
        expect(rowS1?.end_reason).toBeNull();
        expect(rowS1?.ended_at).toBeNull();

        const rowS2 = await fetchSession(client, s2);
        expect(rowS2?.status).toBe('interrupted');
        expect(rowS2?.end_reason).toBe('reboot');
        expect(rowS2?.ended_at).not.toBeNull();
      });
    });

    it('never interrupts null-boot, ended, same-boot or other-machine sessions', async () => {
      await withClient(async (client) => {
        const machineId = await seedMachine(client, 'selective-machine');
        const workspaceId = await seedWorkspace(
          client,
          machineId,
          '/repo/selective'
        );
        const otherMachineId = await seedMachine(client, 'other-machine');
        const otherWorkspaceId = await seedWorkspace(
          client,
          otherMachineId,
          '/repo/other'
        );

        const nullBoot = await seedSession(client, {
          workspaceId,
          agentKind: 'pi',
          agentSessionId: 'null-boot',
          status: 'running',
          bootId: null
        });
        const ended = await seedSession(client, {
          workspaceId,
          agentKind: 'pi',
          agentSessionId: 'ended',
          status: 'ended',
          bootId: 'boot-A'
        });
        const sameBoot = await seedSession(client, {
          workspaceId,
          agentKind: 'pi',
          agentSessionId: 'same-boot',
          status: 'idle',
          bootId: 'boot-B'
        });
        const otherMachine = await seedSession(client, {
          workspaceId: otherWorkspaceId,
          agentKind: 'pi',
          agentSessionId: 'other-machine',
          status: 'running',
          bootId: 'boot-A'
        });

        const interrupted = await interruptRebootedSessions(client, {
          machineId,
          bootId: 'boot-B',
          excludeSessionId: null
        });

        expect(interrupted).toEqual([]);

        for (const id of [nullBoot, ended, sameBoot, otherMachine]) {
          const row = await fetchSession(client, id);
          expect(row?.end_reason).toBeNull();
        }

        expect((await fetchSession(client, nullBoot))?.status).toBe('running');
        expect((await fetchSession(client, ended))?.status).toBe('ended');
        expect((await fetchSession(client, sameBoot))?.status).toBe('idle');
        expect((await fetchSession(client, otherMachine))?.status).toBe(
          'running'
        );
      });
    });
  });

  describe('applyHookSession', () => {
    const path = '/repo/hooked';

    function hookInput(base: { workspaceId: string }) {
      return {
        workspaceId: base.workspaceId,
        targetSessionId: null as string | null,
        agentKind: 'claude-code' as AgentKind,
        agentSessionId: 'sess-1',
        event: 'start' as const,
        bootId: 'boot-A',
        reason: null,
        cwd: '/repo/hooked/work',
        transcriptPath: '/home/user/transcript.jsonl'
      };
    }

    it('walks one id through start, stop, end and activity on a single row', async () => {
      const setup = await withClient(async (client) => {
        const machineId = await seedMachine(client, 'hook-machine');
        const workspaceId = await seedWorkspace(client, machineId, path);

        const before = await findTargetSession(client, {
          machineId,
          path,
          agentKind: 'claude-code',
          agentSessionId: 'sess-1',
          event: 'start'
        });
        expect(before).toBeNull();

        return { machineId, workspaceId };
      });

      const started = await withClient(async (client) => {
        const target = await findTargetSession(client, {
          machineId: setup.machineId,
          path,
          agentKind: 'claude-code',
          agentSessionId: 'sess-1',
          event: 'start'
        });
        expect(target).toBeNull();

        return applyHookSession(client, hookInput(setup));
      });

      expect(started.created).toBe(true);
      expect(started.ended).toBe(false);
      expect(started.session.status).toBe('running');
      expect(started.session.boot_id).toBe('boot-A');
      expect(started.session.cwd).toBe('/repo/hooked/work');
      expect(started.session.transcript_path).toBe(
        '/home/user/transcript.jsonl'
      );
      expect(started.session.started_at).toBeInstanceOf(Date);
      expect(started.session.ended_at).toBeNull();
      expect(started.session.end_reason).toBeNull();

      const stopped = await withClient(async (client) => {
        const target = await findTargetSession(client, {
          machineId: setup.machineId,
          path,
          agentKind: 'claude-code',
          agentSessionId: 'sess-1',
          event: 'stop'
        });
        expect(target).toBe(started.session.id);

        return applyHookSession(client, {
          ...hookInput(setup),
          targetSessionId: target,
          event: 'stop'
        });
      });

      expect(stopped.created).toBe(false);
      expect(stopped.session.id).toBe(started.session.id);
      expect(stopped.session.status).toBe('idle');
      expect(stopped.ended).toBe(false);

      const endedRes = await withClient(async (client) => {
        const target = await findTargetSession(client, {
          machineId: setup.machineId,
          path,
          agentKind: 'claude-code',
          agentSessionId: 'sess-1',
          event: 'end'
        });
        expect(target).toBe(started.session.id);

        return applyHookSession(client, {
          ...hookInput(setup),
          targetSessionId: target,
          event: 'end',
          reason: 'logout'
        });
      });

      expect(endedRes.created).toBe(false);
      expect(endedRes.ended).toBe(true);
      expect(endedRes.session.status).toBe('ended');
      expect(endedRes.session.ended_at).not.toBeNull();
      expect(endedRes.session.end_reason).toBe('logout');

      const reEnded = await withClient(async (client) =>
        applyHookSession(client, {
          ...hookInput(setup),
          targetSessionId: started.session.id,
          event: 'end',
          reason: 'logout'
        })
      );
      expect(reEnded.ended).toBe(false);
      expect(reEnded.session.status).toBe('ended');

      const revived = await withClient(async (client) =>
        applyHookSession(client, {
          ...hookInput(setup),
          targetSessionId: started.session.id,
          event: 'activity',
          bootId: 'boot-B'
        })
      );
      expect(revived.session.status).toBe('running');
      expect(revived.session.boot_id).toBe('boot-B');
      expect(revived.session.ended_at).toBeNull();
      expect(revived.session.end_reason).toBeNull();
      expect(revived.ended).toBe(false);

      const count = await withClient(async (client) => {
        const result = await client.query<{ count: string }>(
          `
            SELECT count(*)::text AS count
              FROM agent_sessions
             WHERE workspace_id = $1
          `,
          [setup.workspaceId]
        );

        return result.rows[0]?.count;
      });
      expect(count).toBe('1');
    });

    it('id-less start inserts twice; id-less stop updates the newest row only', async () => {
      const setup = await withClient(async (client) => {
        const machineId = await seedMachine(client, 'idless-hook-machine');
        const workspaceId = await seedWorkspace(
          client,
          machineId,
          '/repo/idless-hook'
        );

        return { machineId, workspaceId };
      });

      function idlessHook(
        base: { workspaceId: string },
        targetSessionId: string | null,
        event: 'start' | 'stop'
      ) {
        return {
          workspaceId: base.workspaceId,
          targetSessionId,
          agentKind: 'pi' as AgentKind,
          agentSessionId: null,
          event,
          bootId: 'boot-A',
          reason: null,
          cwd: null,
          transcriptPath: null
        };
      }

      const firstStart = await withClient((client) =>
        applyHookSession(client, idlessHook(setup, null, 'start'))
      );
      expect(firstStart.created).toBe(true);

      const secondFind = await withClient((client) =>
        findTargetSession(client, {
          machineId: setup.machineId,
          path: '/repo/idless-hook',
          agentKind: 'pi',
          agentSessionId: null,
          event: 'start'
        })
      );
      expect(secondFind).toBeNull();

      const secondStart = await withClient((client) =>
        applyHookSession(client, idlessHook(setup, secondFind, 'start'))
      );
      expect(secondStart.created).toBe(true);
      expect(secondStart.session.id).not.toBe(firstStart.session.id);

      // Make recency explicit: `secondStart` is the newest id-less row.
      await withClient(async (client) => {
        await client.query(
          `
            UPDATE agent_sessions
               SET last_activity_at = now() - interval '3 hours'
             WHERE id = $1
          `,
          [firstStart.session.id]
        );
        await client.query(
          `
            UPDATE agent_sessions
               SET last_activity_at = now() - interval '1 hour'
             WHERE id = $1
          `,
          [secondStart.session.id]
        );
        // Ignored by the id-less lookup: with an id, and another kind.
        await seedSession(client, {
          workspaceId: setup.workspaceId,
          agentKind: 'pi',
          agentSessionId: 'with-id',
          status: 'running'
        });
        await seedSession(client, {
          workspaceId: setup.workspaceId,
          agentKind: 'other',
          agentSessionId: null,
          status: 'running'
        });
      });

      const stopped = await withClient(async (client) => {
        const target = await findTargetSession(client, {
          machineId: setup.machineId,
          path: '/repo/idless-hook',
          agentKind: 'pi',
          agentSessionId: null,
          event: 'stop'
        });
        expect(target).toBe(secondStart.session.id);

        return applyHookSession(
          client,
          idlessHook(setup, target, 'stop')
        );
      });

      expect(stopped.created).toBe(false);
      expect(stopped.session.id).toBe(secondStart.session.id);
      expect(stopped.session.status).toBe('idle');

      const olderRow = await withClient((client) =>
        fetchSession(client, firstStart.session.id)
      );
      expect(olderRow?.status).toBe('running');

      const idlessCount = await withClient(async (client) => {
        const result = await client.query<{ count: string }>(
          `
            SELECT count(*)::text AS count
              FROM agent_sessions
             WHERE workspace_id = $1
               AND agent_kind = 'pi'
               AND agent_session_id IS NULL
          `,
          [setup.workspaceId]
        );

        return result.rows[0]?.count;
      });
      expect(idlessCount).toBe('2');
    });
  });

  describe('applyScanSessions', () => {
    const observed = new Date('2026-01-01T00:00:00.000Z');
    const older = new Date('2025-12-31T00:00:00.000Z');
    const newer = new Date('2026-01-02T00:00:00.000Z');

    it('inserts idle sessions and only moves last_activity_at forward', async () => {
      const setup = await withClient(async (client) => {
        const machineId = await seedMachine(client, 'scan-machine');
        const workspaceId = await seedWorkspace(client, machineId, '/scan/repo');

        const [first] = await applyScanSessions(client, {
          workspaceId,
          sessions: [
            {
              agentKind: 'pi',
              agentSessionId: 'scan-1',
              observedAt: observed,
              cwd: null,
              transcriptPath: null
            }
          ]
        });

        expect(first?.created).toBe(true);
        expect(first?.session.status).toBe('idle');
        expect(first?.session.boot_id).toBeNull();
        expect(first?.session.started_at.getTime()).toBe(observed.getTime());
        expect(first?.session.last_activity_at.getTime()).toBe(
          observed.getTime()
        );

        return { workspaceId, sessionId: first?.session.id };
      });

      if (!setup.sessionId) {
        throw new Error('scan insert did not return a session');
      }

      await withClient(async (client) => {
        const [backdated] = await applyScanSessions(client, {
          workspaceId: setup.workspaceId,
          sessions: [
            {
              agentKind: 'pi',
              agentSessionId: 'scan-1',
              observedAt: older,
              cwd: '/fill/cwd',
              transcriptPath: '/fill/transcript.jsonl'
            }
          ]
        });

        expect(backdated?.created).toBe(false);
        expect(backdated?.session.id).toBe(setup.sessionId);
        expect(backdated?.session.status).toBe('idle');
        expect(backdated?.session.boot_id).toBeNull();
        expect(backdated?.session.last_activity_at.getTime()).toBe(
          observed.getTime()
        );
        expect(backdated?.session.cwd).toBe('/fill/cwd');
        expect(backdated?.session.transcript_path).toBe(
          '/fill/transcript.jsonl'
        );
      });

      await withClient(async (client) => {
        const [advanced] = await applyScanSessions(client, {
          workspaceId: setup.workspaceId,
          sessions: [
            {
              agentKind: 'pi',
              agentSessionId: 'scan-1',
              observedAt: newer,
              cwd: '/other/cwd',
              transcriptPath: null
            }
          ]
        });

        expect(advanced?.created).toBe(false);
        expect(advanced?.session.id).toBe(setup.sessionId);
        expect(advanced?.session.status).toBe('idle');
        expect(advanced?.session.last_activity_at.getTime()).toBe(
          newer.getTime()
        );
        // Already-filled cwd and transcript_path are not overwritten.
        expect(advanced?.session.cwd).toBe('/fill/cwd');
        expect(advanced?.session.transcript_path).toBe(
          '/fill/transcript.jsonl'
        );

        const count = await client.query<{ count: string }>(
          `
            SELECT count(*)::text AS count
              FROM agent_sessions
             WHERE workspace_id = $1
          `,
          [setup.workspaceId]
        );
        expect(count.rows[0]?.count).toBe('1');
      });
    });
  });
});

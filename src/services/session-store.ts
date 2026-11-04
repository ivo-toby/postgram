// Agent session persistence for the workspace report transaction (spec 004,
// data-model.md steps 2 and 5). Every function takes a PoolClient first; the
// caller owns the transaction. Timestamps use the server clock (now()).
import type { PoolClient } from 'pg';

import type {
  AgentKind,
  AgentSessionRow,
  SessionEvent,
  SessionStatus
} from '../types/workspaces.js';

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

function statusForEvent(event: SessionEvent): SessionStatus {
  switch (event) {
    case 'start':
    case 'activity':
      return 'running';
    case 'stop':
      return 'idle';
    case 'end':
      return 'ended';
  }
}

function requireRow(
  row: AgentSessionRow | undefined,
  context: string
): AgentSessionRow {
  if (!row) {
    throw new Error(`session-store: ${context}`);
  }

  return row;
}

/**
 * Identify session S (spec "Report transaction", paragraph on S) and lock it
 * FOR UPDATE. With an agent session id: the row with that (workspace at
 * machineId+path, agentKind, agentSessionId). Without one: null for `start`,
 * otherwise the newest id-less row of that kind in that workspace. Null when
 * the workspace does not exist.
 */
export async function findTargetSession(
  client: PoolClient,
  input: {
    machineId: string;
    path: string;
    agentKind: AgentKind;
    agentSessionId: string | null;
    event: SessionEvent;
  }
): Promise<string | null> {
  const workspace = await client.query<{ id: string }>(
    `
      SELECT id
        FROM workspaces
       WHERE machine_id = $1
         AND path = $2
    `,
    [input.machineId, input.path]
  );
  const workspaceId = workspace.rows[0]?.id;

  if (!workspaceId) {
    return null;
  }

  if (input.agentSessionId !== null) {
    const byId = await client.query<{ id: string }>(
      `
        SELECT id
          FROM agent_sessions
         WHERE workspace_id = $1
           AND agent_kind = $2
           AND agent_session_id = $3
         FOR UPDATE
      `,
      [workspaceId, input.agentKind, input.agentSessionId]
    );

    return byId.rows[0]?.id ?? null;
  }

  // `start` without an id always inserts a new row (step 5).
  if (input.event === 'start') {
    return null;
  }

  const newest = await client.query<{ id: string }>(
    `
      SELECT id
        FROM agent_sessions
       WHERE workspace_id = $1
         AND agent_kind = $2
         AND agent_session_id IS NULL
       ORDER BY last_activity_at DESC, id DESC
       LIMIT 1
       FOR UPDATE
    `,
    [workspaceId, input.agentKind]
  );

  return newest.rows[0]?.id ?? null;
}

/**
 * Step 2, the reboot rule: every session on the machine with status `running`
 * or `idle`, a non-null boot_id that differs from the reported one, and that
 * is not the reported session, becomes `interrupted` with
 * end_reason = 'reboot' and ended_at = now(). Returns the changed ids.
 */
export async function interruptRebootedSessions(
  client: PoolClient,
  input: { machineId: string; bootId: string; excludeSessionId: string | null }
): Promise<string[]> {
  const candidates = await client.query<{ id: string }>(
    `
      SELECT s.id
        FROM agent_sessions s
        JOIN workspaces w ON w.id = s.workspace_id
       WHERE w.machine_id = $1
         AND s.status IN ('running', 'idle')
         AND s.boot_id IS NOT NULL
         AND s.boot_id <> $2
         AND ($3::uuid IS NULL OR s.id <> $3::uuid)
       ORDER BY s.id
       FOR UPDATE OF s
    `,
    [input.machineId, input.bootId, input.excludeSessionId]
  );

  if (candidates.rows.length === 0) {
    return [];
  }

  const ids = candidates.rows.map((row) => row.id);

  await client.query(
    `
      UPDATE agent_sessions
         SET status = 'interrupted',
             end_reason = 'reboot',
             ended_at = now()
       WHERE id = ANY($1::uuid[])
    `,
    [ids]
  );

  return ids;
}

/**
 * Step 5, hook source: upsert session S. The event sets the status; `end`
 * records ended_at and end_reason, any non-end event clears both.
 * last_activity_at is now(), boot_id is the reported value, and cwd /
 * transcript_path are set only when non-null. `ended` is true when the status
 * moved into `ended` from another status (including a fresh row).
 */
export async function applyHookSession(
  client: PoolClient,
  input: {
    workspaceId: string;
    targetSessionId: string | null;
    agentKind: AgentKind;
    agentSessionId: string | null;
    event: SessionEvent;
    bootId: string | null;
    reason: string | null;
    cwd: string | null;
    transcriptPath: string | null;
  }
): Promise<{ session: AgentSessionRow; created: boolean; ended: boolean }> {
  const status = statusForEvent(input.event);
  const isEnd = input.event === 'end';

  if (input.targetSessionId !== null) {
    const previous = await client.query<{ status: SessionStatus }>(
      `
        SELECT status
          FROM agent_sessions
         WHERE id = $1
         FOR UPDATE
      `,
      [input.targetSessionId]
    );
    const previousStatus = previous.rows[0]?.status;

    const updated = await client.query<AgentSessionRow>(
      `
        UPDATE agent_sessions
           SET status = $2,
               last_activity_at = now(),
               boot_id = $3,
               cwd = COALESCE($4, cwd),
               transcript_path = COALESCE($5, transcript_path),
               ended_at = CASE WHEN $6::boolean THEN now() ELSE NULL END,
               end_reason = CASE WHEN $6::boolean THEN $7 ELSE NULL END
         WHERE id = $1
         RETURNING ${SESSION_COLUMNS}
      `,
      [
        input.targetSessionId,
        status,
        input.bootId,
        input.cwd,
        input.transcriptPath,
        isEnd,
        input.reason
      ]
    );

    return {
      session: requireRow(updated.rows[0], 'updated session row missing'),
      created: false,
      ended: isEnd && previousStatus !== 'ended'
    };
  }

  const inserted = await client.query<AgentSessionRow>(
    `
      INSERT INTO agent_sessions (
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
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, now(), now(),
        CASE WHEN $8::boolean THEN now() ELSE NULL END,
        CASE WHEN $8::boolean THEN $9 ELSE NULL END
      )
      RETURNING ${SESSION_COLUMNS}
    `,
    [
      input.workspaceId,
      input.agentKind,
      input.agentSessionId,
      status,
      input.bootId,
      input.cwd,
      input.transcriptPath,
      isEnd,
      isEnd ? input.reason : null
    ]
  );

  return {
    session: requireRow(inserted.rows[0], 'inserted session row missing'),
    created: true,
    ended: isEnd
  };
}

/**
 * Step 5, scan source: upsert each entry by (workspace, agent kind, agent
 * session id). Inserts get status `idle`, a null boot_id and
 * started_at = last_activity_at = observedAt. Existing rows only move
 * last_activity_at forward (GREATEST) and gain cwd / transcript_path when
 * they were null; status never changes.
 */
export async function applyScanSessions(
  client: PoolClient,
  input: {
    workspaceId: string;
    sessions: {
      agentKind: AgentKind;
      agentSessionId: string | null;
      observedAt: Date;
      cwd: string | null;
      transcriptPath: string | null;
    }[];
  }
): Promise<{ session: AgentSessionRow; created: boolean }[]> {
  const results: { session: AgentSessionRow; created: boolean }[] = [];

  for (const entry of input.sessions) {
    const existing = await client.query<AgentSessionRow>(
      `
        SELECT ${SESSION_COLUMNS}
          FROM agent_sessions
         WHERE workspace_id = $1
           AND agent_kind = $2
           AND agent_session_id IS NOT DISTINCT FROM $3::text
         FOR UPDATE
      `,
      [input.workspaceId, entry.agentKind, entry.agentSessionId]
    );
    const existingRow = existing.rows[0];

    if (existingRow) {
      const refreshed = await client.query<AgentSessionRow>(
        `
          UPDATE agent_sessions
             SET last_activity_at = GREATEST(last_activity_at, $2::timestamptz),
                 cwd = COALESCE(cwd, $3),
                 transcript_path = COALESCE(transcript_path, $4)
           WHERE id = $1
           RETURNING ${SESSION_COLUMNS}
        `,
        [existingRow.id, entry.observedAt, entry.cwd, entry.transcriptPath]
      );

      results.push({
        session: requireRow(
          refreshed.rows[0],
          'refreshed scan session row missing'
        ),
        created: false
      });
      continue;
    }

    const inserted = await client.query<AgentSessionRow>(
      `
        INSERT INTO agent_sessions (
          workspace_id,
          agent_kind,
          agent_session_id,
          status,
          boot_id,
          cwd,
          transcript_path,
          started_at,
          last_activity_at
        )
        VALUES (
          $1, $2, $3, 'idle', NULL, $4, $5, $6::timestamptz, $6::timestamptz
        )
        RETURNING ${SESSION_COLUMNS}
      `,
      [
        input.workspaceId,
        entry.agentKind,
        entry.agentSessionId,
        entry.cwd,
        entry.transcriptPath,
        entry.observedAt
      ]
    );

    results.push({
      session: requireRow(
        inserted.rows[0],
        'inserted scan session row missing'
      ),
      created: true
    });
  }

  return results;
}

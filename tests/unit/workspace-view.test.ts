import { describe, expect, it } from 'vitest';

import {
  computeRisks,
  isDormant,
  selectResumeSession,
  selectVisibleSessions,
  toWorkspaceView,
} from '../../src/services/workspace-view.js';
import type {
  AgentSessionRow,
  MachineRow,
  SessionStatus,
  WorkspaceRow,
} from '../../src/types/workspaces.js';

const NOW = new Date('2026-04-20T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

function sessionRow(overrides: Partial<AgentSessionRow> = {}): AgentSessionRow {
  return {
    id: 'session-1',
    workspace_id: 'workspace-1',
    agent_kind: 'claude-code',
    agent_session_id: 'agent-session-1',
    status: 'running',
    boot_id: null,
    cwd: '/home/ivo/wt/1a2b3c4d-kw-rank',
    transcript_path: '/home/ivo/.claude/projects/x/8f3c.jsonl',
    started_at: daysAgo(3),
    last_activity_at: daysAgo(1),
    ended_at: null,
    end_reason: null,
    ...overrides,
  };
}

function workspaceRow(overrides: Partial<WorkspaceRow> = {}): WorkspaceRow {
  return {
    id: 'workspace-1',
    machine_id: 'machine-1',
    path: '/home/ivo/wt/1a2b3c4d-kw-rank',
    repo_remote: 'github.com/ivo-toby/postgram',
    repo_root: '/home/ivo/wt/1a2b3c4d-kw-rank',
    branch: 'feat/1a2b3c4d-kw-rank',
    git_dirty_count: 0,
    git_unpushed_count: 0,
    git_has_upstream: true,
    git_state_at: daysAgo(1),
    feature_id: null,
    missing_since: null,
    last_activity_at: daysAgo(1),
    created_at: daysAgo(10),
    updated_at: daysAgo(1),
    ...overrides,
  };
}

function machineRow(overrides: Partial<MachineRow> = {}): MachineRow {
  return {
    id: 'machine-1',
    alias: 'codebox',
    hostname: 'codebox.example.com',
    connect_target: 'codebox',
    boot_id: null,
    last_seen_at: daysAgo(0),
    created_at: daysAgo(10),
    updated_at: daysAgo(1),
    ...overrides,
  };
}

describe('computeRisks', () => {
  it('raises dirty and unpushed in contract order', () => {
    const workspace = workspaceRow({
      git_dirty_count: 2,
      git_unpushed_count: 3,
      git_has_upstream: true,
    });

    expect(computeRisks(workspace, [])).toEqual(['dirty', 'unpushed']);
  });

  it('does not raise no_upstream when branch is null', () => {
    const workspace = workspaceRow({
      git_dirty_count: 0,
      git_unpushed_count: 0,
      git_has_upstream: false,
      branch: null,
    });

    expect(computeRisks(workspace, [])).toEqual([]);
  });

  it('raises no_upstream when has_upstream is false and branch is set', () => {
    const workspace = workspaceRow({
      git_dirty_count: 0,
      git_unpushed_count: 0,
      git_has_upstream: false,
      branch: 'feat/1a2b3c4d-kw-rank',
    });

    expect(computeRisks(workspace, [])).toEqual(['no_upstream']);
  });

  it('raises interrupted when the most recently active session is interrupted', () => {
    const olderRunning = sessionRow({
      id: 'session-running',
      status: 'running',
      last_activity_at: daysAgo(2),
    });
    const newestInterrupted = sessionRow({
      id: 'session-interrupted',
      status: 'interrupted',
      last_activity_at: daysAgo(1),
    });

    expect(
      computeRisks(workspaceRow(), [olderRunning, newestInterrupted]),
    ).toEqual(['interrupted']);
  });

  it('does not raise interrupted when a newer session is not interrupted', () => {
    const interrupted = sessionRow({
      id: 'session-interrupted',
      status: 'interrupted',
      last_activity_at: daysAgo(5),
    });
    const newestRunning = sessionRow({
      id: 'session-running',
      status: 'running',
      last_activity_at: daysAgo(1),
    });

    expect(
      computeRisks(workspaceRow(), [interrupted, newestRunning]),
    ).toEqual([]);
  });

  it('raises nothing when every git field is null', () => {
    const workspace = workspaceRow({
      git_dirty_count: null,
      git_unpushed_count: null,
      git_has_upstream: null,
      branch: 'feat/1a2b3c4d-kw-rank',
    });

    expect(computeRisks(workspace, [])).toEqual([]);
  });

  it('lists all risks in contract order', () => {
    const workspace = workspaceRow({
      git_dirty_count: 1,
      git_unpushed_count: 1,
      git_has_upstream: false,
      branch: 'feat/1a2b3c4d-kw-rank',
      missing_since: daysAgo(1),
    });
    const interrupted = sessionRow({ status: 'interrupted' });

    expect(computeRisks(workspace, [interrupted])).toEqual([
      'dirty',
      'unpushed',
      'no_upstream',
      'interrupted',
      'missing',
    ]);
  });
});

describe('isDormant', () => {
  it('is true for an idle session older than the threshold', () => {
    const session = sessionRow({ status: 'idle', last_activity_at: daysAgo(31) });

    expect(isDormant(session, NOW, 30)).toBe(true);
  });

  it('is true for a running session older than the threshold', () => {
    const session = sessionRow({
      status: 'running',
      last_activity_at: daysAgo(31),
    });

    expect(isDormant(session, NOW, 30)).toBe(true);
  });

  it('is false for a session younger than the threshold', () => {
    const session = sessionRow({ status: 'idle', last_activity_at: daysAgo(29) });

    expect(isDormant(session, NOW, 30)).toBe(false);
  });

  it('is false at the exact threshold boundary', () => {
    const session = sessionRow({
      status: 'idle',
      last_activity_at: new Date(NOW.getTime() - 30 * DAY_MS),
    });

    expect(isDormant(session, NOW, 30)).toBe(false);
  });

  it.each<SessionStatus>(['ended', 'interrupted'])(
    'is false for a %s session however old',
    (status) => {
      const session = sessionRow({ status, last_activity_at: daysAgo(365) });

      expect(isDormant(session, NOW, 30)).toBe(false);
    },
  );

  it('adds no risk', () => {
    const dormantSession = sessionRow({
      status: 'idle',
      last_activity_at: daysAgo(31),
    });

    expect(computeRisks(workspaceRow(), [dormantSession])).toEqual([]);
  });
});

describe('selectResumeSession', () => {
  it('picks the ended session when it is the most recent with an id', () => {
    const running = sessionRow({
      id: 'session-running',
      status: 'running',
      last_activity_at: daysAgo(2),
    });
    const ended = sessionRow({
      id: 'session-ended',
      status: 'ended',
      agent_session_id: '8f3c',
      last_activity_at: daysAgo(1),
    });

    expect(selectResumeSession([running, ended])?.id).toBe('session-ended');
  });

  it('ignores sessions without an agent_session_id', () => {
    const withId = sessionRow({
      id: 'session-with-id',
      last_activity_at: daysAgo(5),
    });
    const newerWithoutId = sessionRow({
      id: 'session-without-id',
      agent_session_id: null,
      last_activity_at: daysAgo(1),
    });

    expect(selectResumeSession([newerWithoutId, withId])?.id).toBe(
      'session-with-id',
    );
  });

  it('returns null when no session has an id', () => {
    const sessions = [
      sessionRow({ id: 'a', agent_session_id: null }),
      sessionRow({ id: 'b', agent_session_id: null }),
    ];

    expect(selectResumeSession(sessions)).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(selectResumeSession([])).toBeNull();
  });
});

describe('selectVisibleSessions', () => {
  const running = sessionRow({
    id: 'running',
    status: 'running',
    last_activity_at: daysAgo(2),
  });
  const idle = sessionRow({
    id: 'idle',
    status: 'idle',
    last_activity_at: daysAgo(4),
  });
  const endedNewest = sessionRow({
    id: 'ended-newest',
    status: 'ended',
    last_activity_at: daysAgo(1),
  });
  const endedOldest = sessionRow({
    id: 'ended-oldest',
    status: 'ended',
    last_activity_at: daysAgo(10),
  });

  it('keeps non-ended sessions plus the single most recent ended session', () => {
    const visible = selectVisibleSessions(
      [running, idle, endedNewest, endedOldest],
      false,
    );

    expect(visible.map((session) => session.id)).toEqual([
      'ended-newest',
      'running',
      'idle',
    ]);
  });

  it('includes all sessions with includeEnded, sorted by activity descending', () => {
    const visible = selectVisibleSessions(
      [running, idle, endedNewest, endedOldest],
      true,
    );

    expect(visible.map((session) => session.id)).toEqual([
      'ended-newest',
      'running',
      'idle',
      'ended-oldest',
    ]);
  });

  it('does not duplicate the newest session when it is not ended and drops older ended sessions', () => {
    const visible = selectVisibleSessions([running, endedOldest], false);

    expect(visible.map((session) => session.id)).toEqual(['running']);
  });

  it('includes the newest interrupted session by default', () => {
    const interrupted = sessionRow({
      id: 'interrupted',
      status: 'interrupted',
      last_activity_at: daysAgo(0),
    });

    const visible = selectVisibleSessions([running, interrupted], false);

    expect(visible.map((session) => session.id)).toEqual([
      'interrupted',
      'running',
    ]);
  });

  it('returns an empty list unchanged', () => {
    expect(selectVisibleSessions([], false)).toEqual([]);
    expect(selectVisibleSessions([], true)).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const sessions = [idle, running, endedNewest];
    const original = [...sessions];

    selectVisibleSessions(sessions, false);

    expect(sessions).toEqual(original);
  });
});

describe('toWorkspaceView', () => {
  it('maps the workspace object with resolved machine and ISO timestamps', () => {
    const workspace = workspaceRow({
      git_dirty_count: 2,
      git_unpushed_count: 3,
      git_has_upstream: true,
      feature_id: 'feature-1',
    });
    const running = sessionRow({
      id: 'running',
      status: 'running',
      last_activity_at: daysAgo(1),
      started_at: daysAgo(3),
    });

    const view = toWorkspaceView({
      workspace,
      machine: machineRow(),
      sessions: [running],
      now: NOW,
      dormantAfterDays: 30,
    });

    expect(view).toEqual({
      id: 'workspace-1',
      machine: 'codebox',
      connect_target: 'codebox',
      path: '/home/ivo/wt/1a2b3c4d-kw-rank',
      repo_remote: 'github.com/ivo-toby/postgram',
      branch: 'feat/1a2b3c4d-kw-rank',
      feature_id: 'feature-1',
      last_activity_at: daysAgo(1).toISOString(),
      git: { dirty_count: 2, unpushed_count: 3, has_upstream: true },
      git_state_at: daysAgo(1).toISOString(),
      missing_since: null,
      risks: ['dirty', 'unpushed'],
      resume_session: {
        id: 'running',
        agent_kind: 'claude-code',
        agent_session_id: 'agent-session-1',
        status: 'running',
        cwd: '/home/ivo/wt/1a2b3c4d-kw-rank',
        transcript_path: '/home/ivo/.claude/projects/x/8f3c.jsonl',
        last_activity_at: daysAgo(1).toISOString(),
      },
      sessions: [
        {
          id: 'running',
          agent_kind: 'claude-code',
          agent_session_id: 'agent-session-1',
          status: 'running',
          dormant: false,
          cwd: '/home/ivo/wt/1a2b3c4d-kw-rank',
          transcript_path: '/home/ivo/.claude/projects/x/8f3c.jsonl',
          started_at: daysAgo(3).toISOString(),
          last_activity_at: daysAgo(1).toISOString(),
          ended_at: null,
          end_reason: null,
        },
      ],
    });
  });

  it('falls back to the machine alias when connect_target is null', () => {
    const view = toWorkspaceView({
      workspace: workspaceRow(),
      machine: machineRow({ connect_target: null }),
      sessions: [],
      now: NOW,
      dormantAfterDays: 30,
    });

    expect(view.machine).toBe('codebox');
    expect(view.connect_target).toBe('codebox');
  });

  it('reports git as null when every git column is null', () => {
    const view = toWorkspaceView({
      workspace: workspaceRow({
        git_dirty_count: null,
        git_unpushed_count: null,
        git_has_upstream: null,
        git_state_at: null,
      }),
      machine: machineRow(),
      sessions: [],
      now: NOW,
      dormantAfterDays: 30,
    });

    expect(view.git).toBeNull();
    expect(view.git_state_at).toBeNull();
    expect(view.risks).toEqual([]);
    expect(view.resume_session).toBeNull();
    expect(view.sessions).toEqual([]);
  });

  it('keeps a partial git snapshot with null counts', () => {
    const view = toWorkspaceView({
      workspace: workspaceRow({
        git_dirty_count: null,
        git_unpushed_count: 3,
        git_has_upstream: null,
      }),
      machine: machineRow(),
      sessions: [],
      now: NOW,
      dormantAfterDays: 30,
    });

    expect(view.git).toEqual({
      dirty_count: null,
      unpushed_count: 3,
      has_upstream: null,
    });
    expect(view.risks).toEqual(['unpushed']);
  });

  it('resumes the ended session that is newest with an id', () => {
    const running = sessionRow({
      id: 'running',
      status: 'running',
      last_activity_at: daysAgo(2),
    });
    const ended = sessionRow({
      id: 'ended',
      status: 'ended',
      agent_session_id: '8f3c',
      ended_at: daysAgo(1),
      end_reason: 'user_stop',
      last_activity_at: daysAgo(1),
    });

    const view = toWorkspaceView({
      workspace: workspaceRow(),
      machine: machineRow(),
      sessions: [running, ended],
      now: NOW,
      dormantAfterDays: 30,
    });

    expect(view.resume_session?.id).toBe('ended');
    expect(view.resume_session?.status).toBe('ended');
    expect(view.sessions.map((session) => session.id)).toEqual([
      'ended',
      'running',
    ]);
    expect(view.sessions[0]?.ended_at).toBe(daysAgo(1).toISOString());
    expect(view.sessions[0]?.end_reason).toBe('user_stop');
  });

  it('flags a 31 day idle session as dormant without adding a risk', () => {
    const dormantSession = sessionRow({
      id: 'dormant',
      status: 'idle',
      last_activity_at: daysAgo(31),
    });

    const view = toWorkspaceView({
      workspace: workspaceRow(),
      machine: machineRow(),
      sessions: [dormantSession],
      now: NOW,
      dormantAfterDays: 30,
    });

    expect(view.sessions[0]?.dormant).toBe(true);
    expect(view.risks).toEqual([]);
  });

  it('honours includeEnded', () => {
    const running = sessionRow({
      id: 'running',
      status: 'running',
      last_activity_at: daysAgo(2),
    });
    const endedNewest = sessionRow({
      id: 'ended-newest',
      status: 'ended',
      last_activity_at: daysAgo(1),
    });
    const endedOldest = sessionRow({
      id: 'ended-oldest',
      status: 'ended',
      last_activity_at: daysAgo(10),
    });
    const sessions = [running, endedNewest, endedOldest];

    const defaultView = toWorkspaceView({
      workspace: workspaceRow(),
      machine: machineRow(),
      sessions,
      now: NOW,
      dormantAfterDays: 30,
    });
    const withEnded = toWorkspaceView({
      workspace: workspaceRow(),
      machine: machineRow(),
      sessions,
      now: NOW,
      dormantAfterDays: 30,
      includeEnded: true,
    });

    expect(defaultView.sessions.map((session) => session.id)).toEqual([
      'ended-newest',
      'running',
    ]);
    expect(withEnded.sessions.map((session) => session.id)).toEqual([
      'ended-newest',
      'running',
      'ended-oldest',
    ]);
  });
});

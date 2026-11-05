import { describe, expect, it } from 'vitest';
import {
  formatAge,
  groupCount,
  isGroupEmpty,
  pullRequestNumber,
  renderResume,
  resumeDirectory,
  shq,
  shqIfNeeded,
  stageLabel,
} from './where.ts';
import type { WhereGroup, WorkspaceView } from './where.ts';

const NOW = new Date('2026-06-08T12:00:00.000Z');
const agoMs = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function workspace(overrides: Partial<WorkspaceView> = {}): WorkspaceView {
  return {
    id: 'ws-1',
    machine: 'codebox',
    connect_target: 'codebox',
    path: '/w/a',
    repo_remote: null,
    branch: 'feat/x',
    feature_id: null,
    last_activity_at: agoMs(12 * MINUTE),
    git: null,
    git_state_at: null,
    missing_since: null,
    risks: [],
    resume_session: null,
    sessions: [],
    ...overrides,
  };
}

describe('shq', () => {
  it('wraps a plain value in single quotes', () => {
    expect(shq('/w/a b')).toBe(String.raw`'/w/a b'`);
  });

  it('escapes single quotes with the POSIX close, escape, reopen sequence', () => {
    expect(shq("x'y")).toBe(String.raw`'x'\''y'`);
  });
});

describe('shqIfNeeded', () => {
  it('leaves plain paths, hosts and ids unquoted', () => {
    expect(shqIfNeeded('/home/ivo/wt/postgram-ui')).toBe('/home/ivo/wt/postgram-ui');
    expect(shqIfNeeded('nuc.lan')).toBe('nuc.lan');
    expect(shqIfNeeded('ivo@codebox')).toBe('ivo@codebox');
    expect(shqIfNeeded('8f3c1a2b-0000-4000-8000-000000000000')).toBe('8f3c1a2b-0000-4000-8000-000000000000');
  });

  it('quotes spaces, quotes, shell characters, a leading ~ or = and the empty string', () => {
    expect(shqIfNeeded('a b')).toBe("'a b'");
    expect(shqIfNeeded("x'y")).toBe(String.raw`'x'\''y'`);
    expect(shqIfNeeded('a;rm -rf')).toBe("'a;rm -rf'");
    expect(shqIfNeeded('$HOME')).toBe("'$HOME'");
    expect(shqIfNeeded('~/wt')).toBe("'~/wt'");
    expect(shqIfNeeded('=x')).toBe("'=x'");
    expect(shqIfNeeded('')).toBe("''");
  });
});

describe('stageLabel', () => {
  it('turns every stage key into a readable label', () => {
    expect(stageLabel('building')).toBe('Building');
    expect(stageLabel('review')).toBe('Review');
    expect(stageLabel('functional_test')).toBe('Functional test');
    expect(stageLabel('ready_to_merge')).toBe('Ready to merge');
    expect(stageLabel('awaiting_release')).toBe('Awaiting release');
    expect(stageLabel('released')).toBe('Released');
  });
});

describe('renderResume (ssh form only)', () => {
  it('renders a claude-code session with its id', () => {
    const ws = workspace({
      resume_session: {
        id: 'session-1',
        agent_kind: 'claude-code',
        agent_session_id: '8f3c',
        status: 'running',
        cwd: '/w/a',
        transcript_path: null,
        last_activity_at: agoMs(MINUTE),
      },
    });
    expect(renderResume(ws)).toBe(
      String.raw`ssh -t codebox 'cd /w/a && claude --resume 8f3c'`
    );
  });

  it('renders a pi session with a quoted id and the cwd below the path', () => {
    const ws = workspace({
      machine: 'nuc',
      connect_target: 'nuc.lan',
      path: '/home/ivo/wt/a b',
      resume_session: {
        id: 'session-2',
        agent_kind: 'pi',
        agent_session_id: "x'y",
        status: 'idle',
        cwd: '/home/ivo/wt/a b/cli',
        transcript_path: null,
        last_activity_at: agoMs(3 * DAY),
      },
    });
    expect(renderResume(ws)).toBe(
      String.raw`ssh -t nuc.lan 'cd '\''/home/ivo/wt/a b/cli'\'' && pi --session '\''x'\''\'\'''\''y'\'''`
    );
  });

  it('renders only the cd for a talon session, which has no template', () => {
    const ws = workspace({
      machine: 'jarvis',
      connect_target: 'jarvis',
      path: '/w/d',
      resume_session: {
        id: 'session-3',
        agent_kind: 'talon',
        agent_session_id: 'tl-1',
        status: 'ended',
        cwd: null,
        transcript_path: null,
        last_activity_at: agoMs(3 * DAY),
      },
    });
    expect(renderResume(ws)).toBe(String.raw`ssh -t jarvis 'cd /w/d'`);
  });

  it('renders the bare claude command when there is no session at all', () => {
    const ws = workspace({ path: '/w/c' });
    expect(renderResume(ws)).toBe(String.raw`ssh -t codebox 'cd /w/c && claude'`);
  });

  it('falls back to the first session agent kind when resume_session is null', () => {
    const ws = workspace({
      path: '/w/c',
      sessions: [
        {
          id: 'session-4',
          agent_kind: 'pi',
          agent_session_id: null,
          status: 'running',
          dormant: false,
          cwd: null,
          transcript_path: null,
          started_at: agoMs(HOUR),
          last_activity_at: agoMs(MINUTE),
          ended_at: null,
          end_reason: null,
        },
      ],
    });
    expect(renderResume(ws)).toBe(String.raw`ssh -t codebox 'cd /w/c && pi'`);
  });

  it('uses the workspace path when the resume cwd lies outside it', () => {
    const ws = workspace({
      path: '/w/a',
      resume_session: {
        id: 'session-1',
        agent_kind: 'claude-code',
        agent_session_id: '8f3c',
        status: 'running',
        cwd: '/other',
        transcript_path: null,
        last_activity_at: agoMs(MINUTE),
      },
    });
    expect(resumeDirectory(ws)).toBe('/w/a');
    expect(renderResume(ws)).toBe(
      String.raw`ssh -t codebox 'cd /w/a && claude --resume 8f3c'`
    );
  });

  it('does not treat a sibling directory sharing the prefix as inside the path', () => {
    const ws = workspace({
      path: '/w/a',
      resume_session: {
        id: 'session-1',
        agent_kind: 'claude-code',
        agent_session_id: '8f3c',
        status: 'running',
        cwd: '/w/ab',
        transcript_path: null,
        last_activity_at: agoMs(MINUTE),
      },
    });
    expect(resumeDirectory(ws)).toBe('/w/a');
  });
});

describe('formatAge', () => {
  it('shows whole minutes under an hour', () => {
    expect(formatAge(agoMs(12 * MINUTE), NOW)).toBe('12m');
    expect(formatAge(agoMs(59 * MINUTE), NOW)).toBe('59m');
  });

  it('switches to hours at exactly 60 minutes', () => {
    expect(formatAge(agoMs(60 * MINUTE), NOW)).toBe('1h');
  });

  it('shows hours up to 47 hours', () => {
    expect(formatAge(agoMs(47 * HOUR), NOW)).toBe('47h');
  });

  it('switches to days at exactly 48 hours', () => {
    expect(formatAge(agoMs(48 * HOUR), NOW)).toBe('2d');
  });

  it('shows days for older times', () => {
    expect(formatAge(agoMs(10 * DAY), NOW)).toBe('10d');
  });

  it('clamps a time in the future to zero', () => {
    expect(formatAge(new Date(NOW.getTime() + HOUR).toISOString(), NOW)).toBe('0m');
  });
});

describe('pullRequestNumber', () => {
  it('returns the trailing number of a canonical pull request url', () => {
    expect(pullRequestNumber('https://github.com/ivo-toby/postgram/pull/42')).toBe('42');
  });

  it('returns null for a repository url', () => {
    expect(pullRequestNumber('https://github.com/ivo-toby/postgram')).toBeNull();
  });

  it('returns null when the url ends in more than the number', () => {
    expect(pullRequestNumber('https://github.com/ivo-toby/postgram/pull/42/files')).toBeNull();
  });
});

describe('groupCount and isGroupEmpty', () => {
  const feature = {
    id: 'feature-1',
    title: 'Feature',
    stage: 'building' as const,
    stage_source: null,
    stage_set_at: null,
    task_status: null,
    pull_requests: [],
    workspaces: [],
  };

  it('counts the features of a feature group', () => {
    const group: WhereGroup = { key: 'review', label: 'Review', features: [feature, feature] };
    expect(groupCount(group)).toBe(2);
    expect(isGroupEmpty(group)).toBe(false);
  });

  it('counts the workspaces of an unassigned group', () => {
    const group: WhereGroup = { key: 'unassigned', label: 'Unassigned', workspaces: [workspace()] };
    expect(groupCount(group)).toBe(1);
    expect(isGroupEmpty(group)).toBe(false);
  });

  it('reports a group with no features and no workspaces as empty', () => {
    expect(isGroupEmpty({ key: 'done', label: 'Done', features: [] })).toBe(true);
    expect(isGroupEmpty({ key: 'unassigned', label: 'Unassigned', workspaces: [] })).toBe(true);
  });
});

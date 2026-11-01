// cli/tests/unit/tracking-resume.test.ts
import { describe, expect, it } from 'vitest';

import { DEFAULT_RESUME, shq } from '../../src/tracking/config.js';
import {
  formatAge,
  isTranscriptGone,
  renderResume,
  resumeDirectory
} from '../../src/tracking/resume.js';
import type { ResumeSessionView, SessionView, WorkspaceView } from '../../src/tracking/types.js';

function session(overrides?: Partial<ResumeSessionView>): ResumeSessionView {
  return {
    id: 'sess-1',
    agent_kind: 'claude-code',
    agent_session_id: '8f3c',
    status: 'running',
    cwd: null,
    transcript_path: null,
    last_activity_at: '2026-10-31T12:00:00Z',
    ...overrides
  };
}

function workspace(overrides?: Partial<WorkspaceView>): WorkspaceView {
  return {
    id: 'ws-1',
    machine: 'local',
    connect_target: 'codebox',
    path: '/w/a',
    repo_remote: null,
    branch: null,
    feature_id: null,
    last_activity_at: '2026-10-31T12:00:00Z',
    git: null,
    git_state_at: null,
    missing_since: null,
    risks: [],
    resume_session: null,
    sessions: [],
    ...overrides
  };
}

function sessions(overrides?: Partial<SessionView>): SessionView[] {
  return [
    {
      id: 'sess-1',
      agent_kind: 'claude-code',
      agent_session_id: '8f3c',
      status: 'running',
      dormant: false,
      cwd: null,
      transcript_path: null,
      started_at: '2026-10-31T12:00:00Z',
      last_activity_at: '2026-10-31T12:00:00Z',
      ended_at: null,
      end_reason: null,
      ...overrides
    }
  ];
}

describe('resumeDirectory', () => {
  it('uses resume_session.cwd when it equals the workspace path', () => {
    const w = workspace({ resume_session: session({ cwd: '/w/a' }) });
    expect(resumeDirectory(w)).toBe('/w/a');
  });

  it('uses resume_session.cwd when it lies under the workspace path', () => {
    const w = workspace({ resume_session: session({ cwd: '/w/a/sub' }) });
    expect(resumeDirectory(w)).toBe('/w/a/sub');
  });

  it('falls back to the path when cwd is outside the workspace path', () => {
    const w = workspace({ resume_session: session({ cwd: '/other/place' }) });
    expect(resumeDirectory(w)).toBe('/w/a');
  });

  it('falls back to the path when cwd is a sibling with the same prefix', () => {
    const w = workspace({ resume_session: session({ cwd: '/w/ab' }) });
    expect(resumeDirectory(w)).toBe('/w/a');
  });

  it('falls back to the path when there is no resume session', () => {
    const w = workspace();
    expect(resumeDirectory(w)).toBe('/w/a');
  });
});

describe('renderResume', () => {
  const input = { localAlias: 'local', templates: DEFAULT_RESUME, transcriptGone: false };

  it('renders the local claude-code with_id row from the contract table', () => {
    const w = workspace({ resume_session: session({ agent_session_id: '8f3c' }) });
    expect(renderResume(w, input)).toBe("cd '/w/a' && claude --resume '8f3c'");
  });

  it('renders the remote codebox row from the contract table', () => {
    const w = workspace({
      machine: 'codebox',
      path: '/home/ivo/wt/a b',
      resume_session: session({ agent_session_id: "x'y" })
    });
    // The contract's verified "remote shell receives" row, wrapped per rule 4.
    const shellRow = `cd '/home/ivo/wt/a b' && claude --resume 'x'\\''y'`;
    expect(renderResume(w, input)).toBe(`ssh -t codebox ${shq(shellRow)}`);
  });

  it('renders only cd for a local talon session', () => {
    const w = workspace({
      resume_session: session({ agent_kind: 'talon', agent_session_id: 't1' })
    });
    expect(renderResume(w, input)).toBe("cd '/w/a'");
  });

  it('defaults to the claude-code template when there are no sessions at all', () => {
    const w = workspace();
    expect(renderResume(w, input)).toBe("cd '/w/a' && claude");
  });

  it('uses sessions[0].agent_kind for without_id when there is no resume session', () => {
    const w = workspace({ sessions: sessions({ agent_kind: 'pi' }) });
    expect(renderResume(w, input)).toBe("cd '/w/a' && pi");
  });

  it('cds into the resume session cwd when it lies under the path', () => {
    const w = workspace({ resume_session: session({ cwd: '/w/a/sub' }) });
    expect(renderResume(w, input)).toBe("cd '/w/a/sub' && claude --resume '8f3c'");
  });

  it('cds into the path when the resume session cwd is outside the path', () => {
    const w = workspace({ resume_session: session({ cwd: '/elsewhere' }) });
    expect(renderResume(w, input)).toBe("cd '/w/a' && claude --resume '8f3c'");
  });

  it('falls back to without_id when the transcript is gone', () => {
    const w = workspace({
      resume_session: session({ transcript_path: '/gone.jsonl' })
    });
    expect(renderResume(w, { ...input, transcriptGone: true })).toBe("cd '/w/a' && claude");
  });

  it('replaces {session_id} with the shell-quoted id for the pi template', () => {
    const w = workspace({
      resume_session: session({ agent_kind: 'pi', agent_session_id: "x'y" })
    });
    expect(renderResume(w, input)).toBe("cd '/w/a' && pi --session 'x'\\''y'");
  });

  it('renders only the cd for a remote workspace whose template is null', () => {
    const w = workspace({
      machine: 'codebox',
      resume_session: session({ agent_kind: 'other', agent_session_id: 'o1' })
    });
    expect(renderResume(w, input)).toBe(`ssh -t codebox ${shq("cd '/w/a'")}`);
  });
});

describe('isTranscriptGone', () => {
  const existsFalse = () => false;
  const existsTrue = () => true;

  it('is true for a local claude-code session with a missing transcript', () => {
    const w = workspace({
      resume_session: session({ transcript_path: '/tmp/gone.jsonl' })
    });
    expect(isTranscriptGone(w, 'local', existsFalse)).toBe(true);
  });

  it('is false for the same workspace on another machine', () => {
    const w = workspace({
      machine: 'codebox',
      resume_session: session({ transcript_path: '/tmp/gone.jsonl' })
    });
    expect(isTranscriptGone(w, 'local', existsFalse)).toBe(false);
  });

  it('is false for a non-claude-kind session', () => {
    const w = workspace({
      resume_session: session({
        agent_kind: 'pi',
        transcript_path: '/tmp/gone.jsonl'
      })
    });
    expect(isTranscriptGone(w, 'local', existsFalse)).toBe(false);
  });

  it('is false when the transcript path is null', () => {
    const w = workspace({ resume_session: session({ transcript_path: null }) });
    expect(isTranscriptGone(w, 'local', existsFalse)).toBe(false);
  });

  it('is false when the transcript file exists', () => {
    const w = workspace({
      resume_session: session({ transcript_path: '/tmp/here.jsonl' })
    });
    expect(isTranscriptGone(w, 'local', existsTrue)).toBe(false);
  });

  it('is false when there is no resume session', () => {
    const w = workspace();
    expect(isTranscriptGone(w, 'local', existsFalse)).toBe(false);
  });
});

describe('formatAge', () => {
  const now = new Date('2026-11-01T12:00:00Z');

  it('renders 59 minutes as 59m', () => {
    expect(formatAge('2026-11-01T11:01:00Z', now)).toBe('59m');
  });

  it('renders 3 hours as 3h', () => {
    expect(formatAge('2026-11-01T09:00:00Z', now)).toBe('3h');
  });

  it('renders 47 hours as 47h', () => {
    expect(formatAge('2026-10-30T13:00:00Z', now)).toBe('47h');
  });

  it('renders 48 hours as 2d', () => {
    expect(formatAge('2026-10-30T12:00:00Z', now)).toBe('2d');
  });

  it('renders 12 days as 12d', () => {
    expect(formatAge('2026-10-20T12:00:00Z', now)).toBe('12d');
  });

  it('renders a future time as 0m', () => {
    expect(formatAge('2026-11-01T12:30:00Z', now)).toBe('0m');
  });

  it('floors partial minutes and hours', () => {
    expect(formatAge('2026-11-01T11:59:30Z', now)).toBe('0m');
    expect(formatAge('2026-11-01T09:00:30Z', now)).toBe('2h');
  });
});

import { describe, expect, it } from 'vitest';

import { parseReportInput } from '../../src/services/workspace-report-schema.js';
import type {
  ReportHookInput,
  ReportScanInput,
  ReportWorkspace,
} from '../../src/services/workspace-report-schema.js';
import { ErrorCode } from '../../src/util/errors.js';

const MACHINE = { alias: 'codebox', hostname: 'codebox-vm', boot_id: null };

function workspace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    path: '/home/ivo/wt/1a2b3c4d-kw-rank',
    repo_remote: 'github.com/ivo-toby/postgram',
    repo_root: '/home/ivo/src/postgram',
    branch: 'feat/1a2b3c4d-kw-rank',
    git: { dirty_count: 2, unpushed_count: 3, has_upstream: true },
    ...overrides,
  };
}

function hookSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agent_kind: 'claude-code',
    agent_session_id: '8f3c',
    event: 'start',
    reason: 'startup',
    cwd: '/home/ivo/wt/1a2b3c4d-kw-rank/cli',
    transcript_path: '/home/ivo/.claude/projects/x/8f3c.jsonl',
    ...overrides,
  };
}

function validHook(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: 'hook',
    machine: MACHINE,
    workspace: workspace(),
    session: hookSession(),
    ...overrides,
  };
}

function unwrapWorkspace(result: ReturnType<typeof parseReportInput>): ReportWorkspace {
  const parsed = result._unsafeUnwrap().workspace;
  if (parsed === undefined) {
    throw new Error('expected a workspace in the parsed input');
  }
  return parsed;
}

// `ReportInput` is a union on `source`: `session` exists only on the hook
// member and `sessions` only on the scan member, so reads are narrowed first.
function hookInput(result: ReturnType<typeof parseReportInput>): ReportHookInput {
  const input = result._unsafeUnwrap();
  if (input.source !== 'hook') {
    throw new Error('expected a hook report input');
  }
  return input;
}

function scanInput(result: ReturnType<typeof parseReportInput>): ReportScanInput {
  const input = result._unsafeUnwrap();
  if (input.source !== 'scan') {
    throw new Error('expected a scan report input');
  }
  return input;
}

function expectValidationFailure(raw: unknown): void {
  const result = parseReportInput(raw);
  expect(result.isOk()).toBe(false);
  const error = result._unsafeUnwrapErr();
  expect(error.code).toBe(ErrorCode.VALIDATION);
  expect(error.details['issues']).toBeInstanceOf(Array);
}

describe('parseReportInput', () => {
  it('accepts a valid hook report and applies defaults', () => {
    const raw = validHook();
    const result = parseReportInput(raw);
    expect(result.isOk()).toBe(true);
    const input = hookInput(result);
    expect(input.source).toBe('hook');
    expect(input.machine).toEqual(MACHINE);
    expect(input.workspace?.path).toBe('/home/ivo/wt/1a2b3c4d-kw-rank');
    expect(input.session?.event).toBe('start');
  });

  it('defaults source to hook when omitted', () => {
    const raw = validHook();
    delete raw['source'];
    const result = parseReportInput(raw);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().source).toBe('hook');
  });

  it('normalizes a string repo_remote with normalizeRemote', () => {
    const result = parseReportInput(
      validHook({
        workspace: workspace({ repo_remote: 'git@github.com:ivo-toby/postgram.git' }),
      }),
    );
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().workspace?.repo_remote).toBe('github.com/ivo-toby/postgram');
  });

  it('strips trailing slashes from workspace.path but keeps "/" itself', () => {
    const withSlash = parseReportInput(
      validHook({ workspace: workspace({ path: '/home/ivo/postgram/' }) }),
    );
    expect(withSlash.isOk()).toBe(true);
    expect(withSlash._unsafeUnwrap().workspace?.path).toBe('/home/ivo/postgram');

    const root = parseReportInput(validHook({ workspace: workspace({ path: '/' }) }));
    expect(root.isOk()).toBe(true);
    expect(root._unsafeUnwrap().workspace?.path).toBe('/');
  });

  it('treats feature_id null as absent and accepts a UUID', () => {
    const uuid = '6c1e1b6c-1f2a-4a3b-8c9d-0e1f2a3b4c5d';
    const withNull = parseReportInput(validHook({ feature_id: null }));
    expect(withNull.isOk()).toBe(true);
    expect('feature_id' in withNull._unsafeUnwrap()).toBe(false);

    const withUuid = parseReportInput(validHook({ feature_id: uuid }));
    expect(withUuid.isOk()).toBe(true);
    expect(withUuid._unsafeUnwrap().feature_id).toBe(uuid);
  });

  describe('validation table rows', () => {
    it('rejects an unknown source', () => {
      expectValidationFailure(validHook({ source: 'cron' }));
    });

    it('rejects a machine alias with uppercase or invalid characters', () => {
      expectValidationFailure(validHook({ machine: { ...MACHINE, alias: 'Codebox' } }));
      expectValidationFailure(validHook({ machine: { ...MACHINE, alias: 'code box' } }));
      expectValidationFailure(validHook({ machine: { ...MACHINE, alias: 'x'.repeat(65) } }));
    });

    it('rejects a hostname outside 1-255 characters', () => {
      expectValidationFailure(validHook({ machine: { ...MACHINE, hostname: '' } }));
      expectValidationFailure(validHook({ machine: { ...MACHINE, hostname: 'h'.repeat(256) } }));
    });

    it('rejects a boot_id over 128 characters and accepts null', () => {
      expectValidationFailure(validHook({ machine: { ...MACHINE, boot_id: 'b'.repeat(129) } }));
      const okResult = parseReportInput(
        validHook({ machine: { ...MACHINE, boot_id: 'b'.repeat(128) } }),
      );
      expect(okResult.isOk()).toBe(true);
    });

    it('rejects a relative or oversized workspace.path', () => {
      expectValidationFailure(validHook({ workspace: workspace({ path: 'relative/path' }) }));
      expectValidationFailure(
        validHook({ workspace: workspace({ path: `/${'d'.repeat(4096)}` }) }),
      );
    });

    it('accepts null repo_remote, repo_root and branch but rejects non-strings', () => {
      const result = parseReportInput(
        validHook({ workspace: workspace({ repo_remote: null, repo_root: null, branch: null }) }),
      );
      expect(result.isOk()).toBe(true);
      const input = result._unsafeUnwrap();
      expect(input.workspace?.repo_remote).toBeNull();
      expect(input.workspace?.repo_root).toBeNull();
      expect(input.workspace?.branch).toBeNull();

      expectValidationFailure(validHook({ workspace: workspace({ branch: 42 }) }));
    });

    it('rejects a malformed git snapshot', () => {
      expectValidationFailure(
        validHook({ workspace: workspace({ git: { dirty_count: -1, unpushed_count: 0, has_upstream: true } }) }),
      );
      expectValidationFailure(
        validHook({ workspace: workspace({ git: { dirty_count: 0, unpushed_count: 0 } }) }),
      );
    });

    it('rejects a short feature id and any non-UUID feature id', () => {
      expectValidationFailure(validHook({ feature_id: '1a2b3c4d' }));
      expectValidationFailure(validHook({ feature_id: 'not-a-uuid' }));
    });

    it('rejects an unknown agent_kind', () => {
      expectValidationFailure(validHook({ session: hookSession({ agent_kind: 'cursor' }) }));
    });

    it('rejects an agent_session_id over 200 characters and accepts null', () => {
      expectValidationFailure(
        validHook({ session: hookSession({ agent_session_id: 's'.repeat(201) }) }),
      );
      const result = parseReportInput(
        validHook({ session: hookSession({ agent_session_id: null }) }),
      );
      expect(result.isOk()).toBe(true);
      expect(hookInput(result).session?.agent_session_id).toBeNull();
    });

    it('rejects a relative or oversized session cwd and transcript_path, accepts null', () => {
      expectValidationFailure(validHook({ session: hookSession({ cwd: 'relative/cli' }) }));
      expectValidationFailure(
        validHook({ session: hookSession({ transcript_path: `/${'t'.repeat(4096)}` }) }),
      );
      const result = parseReportInput(
        validHook({ session: hookSession({ cwd: null, transcript_path: null }) }),
      );
      expect(result.isOk()).toBe(true);
    });

    it('rejects unknown keys at every level', () => {
      expectValidationFailure(validHook({ extra: true }));
      expectValidationFailure(validHook({ machine: { ...MACHINE, extra: 1 } }));
      expectValidationFailure(validHook({ workspace: workspace({ extra: 1 }) }));
      expectValidationFailure(validHook({ session: hookSession({ extra: 1 }) }));
      expectValidationFailure(
        validHook({ workspace: workspace({ git: { dirty_count: 0, unpushed_count: 0, has_upstream: true, extra: 1 } }) }),
      );
    });
  });

  describe('omitted versus null', () => {
    it('keeps an omitted git key absent and an explicit git null present', () => {
      const omitted = parseReportInput(validHook({ workspace: { path: '/repo' } }));
      expect(omitted.isOk()).toBe(true);
      const omittedWorkspace = unwrapWorkspace(omitted);
      expect('git' in omittedWorkspace).toBe(false);

      const explicitNull = parseReportInput(validHook({ workspace: workspace({ git: null }) }));
      expect(explicitNull.isOk()).toBe(true);
      const nullWorkspace = unwrapWorkspace(explicitNull);
      expect('git' in nullWorkspace).toBe(true);
      expect(nullWorkspace.git).toBeNull();
    });

    it('keeps omitted repo_remote, repo_root and branch absent while null stays null', () => {
      const result = parseReportInput(validHook({ workspace: { path: '/repo' } }));
      expect(result.isOk()).toBe(true);
      const parsedWorkspace = unwrapWorkspace(result);
      expect('repo_remote' in parsedWorkspace).toBe(false);
      expect('repo_root' in parsedWorkspace).toBe(false);
      expect('branch' in parsedWorkspace).toBe(false);
    });
  });

  describe('session forms', () => {
    it('rejects sessions on a hook report', () => {
      expectValidationFailure(
        validHook({ sessions: [hookSession({ observed_at: new Date().toISOString() })] }),
      );
    });

    it('rejects a hook session without event', () => {
      const session = hookSession();
      delete session['event'];
      expectValidationFailure(validHook({ session }));
    });

    it('accepts a hook report with no session at all', () => {
      const raw = validHook();
      delete raw['session'];
      const result = parseReportInput(raw);
      expect(result.isOk()).toBe(true);
      expect('session' in result._unsafeUnwrap()).toBe(false);
    });

    it('requires sessions for a scan report and accepts an empty array', () => {
      const scanBase = { source: 'scan', machine: MACHINE, workspace: workspace() };
      expectValidationFailure(scanBase);

      const empty = parseReportInput({ ...scanBase, sessions: [] });
      expect(empty.isOk()).toBe(true);
      expect(scanInput(empty).sessions).toEqual([]);
    });

    it('rejects session on a scan report', () => {
      expectValidationFailure({
        source: 'scan',
        machine: MACHINE,
        workspace: workspace(),
        sessions: [],
        session: hookSession(),
      });
    });

    it('rejects a scan entry without observed_at and accepts a valid ISO one', () => {
      const entry = hookSession();
      delete entry['observed_at'];
      expectValidationFailure({
        source: 'scan',
        machine: MACHINE,
        workspace: workspace(),
        sessions: [entry],
      });

      const result = parseReportInput({
        source: 'scan',
        machine: MACHINE,
        workspace: workspace(),
        sessions: [hookSession({ observed_at: '2026-10-31T10:00:00.000Z' })],
      });
      expect(result.isOk()).toBe(true);
      expect(scanInput(result).sessions[0]?.observed_at).toBe('2026-10-31T10:00:00.000Z');
    });

    it('rejects a non-ISO observed_at on a scan entry', () => {
      expectValidationFailure({
        source: 'scan',
        machine: MACHINE,
        workspace: workspace(),
        sessions: [hookSession({ observed_at: 'yesterday' })],
      });
    });

    it('ignores event on scan entries without rejecting them', () => {
      const result = parseReportInput({
        source: 'scan',
        machine: MACHINE,
        workspace: workspace(),
        sessions: [hookSession({ observed_at: '2026-10-31T10:00:00.000Z', event: 'start' })],
      });
      expect(result.isOk()).toBe(true);
    });
  });

  describe('reports without a workspace', () => {
    it('accepts a machine-only report', () => {
      const result = parseReportInput({ source: 'hook', machine: MACHINE });
      expect(result.isOk()).toBe(true);
      const input = result._unsafeUnwrap();
      expect(input.workspace).toBeUndefined();
      expect(input.machine).toEqual(MACHINE);
    });

    it('rejects session without workspace', () => {
      expectValidationFailure({ source: 'hook', machine: MACHINE, session: hookSession() });
    });

    it('rejects sessions without workspace', () => {
      expectValidationFailure({
        source: 'scan',
        machine: MACHINE,
        sessions: [hookSession({ observed_at: '2026-10-31T10:00:00.000Z' })],
      });
    });

    it('rejects feature_id without workspace but allows feature_id null', () => {
      expectValidationFailure({
        source: 'hook',
        machine: MACHINE,
        feature_id: '6c1e1b6c-1f2a-4a3b-8c9d-0e1f2a3b4c5d',
      });
      const result = parseReportInput({ source: 'hook', machine: MACHINE, feature_id: null });
      expect(result.isOk()).toBe(true);
    });
  });
});

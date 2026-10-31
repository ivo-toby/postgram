import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { AppError, ErrorCode } from '../util/errors.js';
import { normalizeRemote } from '../util/git-remote.js';

/**
 * Validation schema for `POST /api/workspaces/report`
 * (specs/004-workspace-session-tracking/contracts/rest.md).
 *
 * Unknown keys are rejected. Omitted keys stay absent in the output so callers
 * can distinguish "keep the stored value" from an explicit `null`.
 */

const machineSchema = z
  .object({
    alias: z.string().regex(/^[a-z0-9._-]{1,64}$/),
    hostname: z.string().min(1).max(255),
    boot_id: z.string().max(128).nullable(),
  })
  .strict();

const gitSnapshotSchema = z
  .object({
    dirty_count: z.number().int().nonnegative(),
    unpushed_count: z.number().int().nonnegative(),
    has_upstream: z.boolean(),
  })
  .strict();

/**
 * `repo_remote`, `repo_root`, `branch` and `git` are "string (or object) or
 * null" where an omitted key keeps the stored value, so they are optional and
 * nullable. With `exactOptionalPropertyTypes`, Zod only lets the key through
 * as absent when the key is not present in the input.
 */
const workspaceSchema = z
  .object({
    path: z.string().startsWith('/').max(4096),
    repo_remote: z.string().optional().nullable(),
    repo_root: z.string().optional().nullable(),
    branch: z.string().optional().nullable(),
    git: gitSnapshotSchema.optional().nullable(),
  })
  .strict();

const sessionSchema = z
  .object({
    agent_kind: z.enum(['claude-code', 'pi', 'talon', 'other']),
    agent_session_id: z.string().max(200).nullable(),
    /** Required for `source: "hook"`; ignored for `source: "scan"`. */
    event: z.enum(['start', 'activity', 'stop', 'end']).optional(),
    reason: z.string().optional(),
    cwd: z.string().startsWith('/').max(4096).nullable(),
    transcript_path: z.string().startsWith('/').max(4096).nullable(),
    /** Required on every entry for `source: "scan"`. */
    observed_at: z.string().datetime().optional(),
  })
  .strict();

const reportInputSchema = z
  .object({
    source: z.enum(['hook', 'scan']).default('hook'),
    machine: machineSchema,
    workspace: workspaceSchema.optional(),
    feature_id: z.string().uuid().nullish(),
    session: sessionSchema.optional(),
    sessions: z.array(sessionSchema).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.workspace) {
      // Without a workspace only the machine steps run; the rest must be
      // absent (`feature_id: null` counts as absent).
      if (value.session !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'session requires workspace',
          path: ['session'],
        });
      }
      if (value.sessions !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'sessions requires workspace',
          path: ['sessions'],
        });
      }
      if (value.feature_id !== undefined && value.feature_id !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'feature_id requires workspace',
          path: ['feature_id'],
        });
      }
      return;
    }

    if (value.source === 'hook') {
      if (value.sessions !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'sessions is only accepted for source scan',
          path: ['sessions'],
        });
      }
      if (value.session !== undefined && value.session.event === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'event is required for source hook',
          path: ['session', 'event'],
        });
      }
      return;
    }

    // source === 'scan': only `sessions`, every entry needs observed_at.
    if (value.session !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'session is only accepted for source hook',
        path: ['session'],
      });
    }
    if (value.sessions === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'sessions is required for source scan',
        path: ['sessions'],
      });
    }
    if (value.sessions !== undefined) {
      value.sessions.forEach((session, index) => {
        if (session.observed_at === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'observed_at is required for source scan sessions',
            path: ['sessions', index, 'observed_at'],
          });
        }
      });
    }
  });

export interface ReportMachine {
  alias: string;
  hostname: string;
  boot_id: string | null;
}

export interface ReportGitSnapshot {
  dirty_count: number;
  unpushed_count: number;
  has_upstream: boolean;
}

export interface ReportWorkspace {
  /** Always absolute; the server has stripped trailing `/` (except `/`). */
  path: string;
  /** Omitted keeps the stored value; `null` sets null. Strings are normalized. */
  repo_remote?: string | null;
  repo_root?: string | null;
  branch?: string | null;
  /** Omitted keeps the previous snapshot; `null` clears it; object stores it. */
  git?: ReportGitSnapshot | null;
}

export interface ReportSession {
  agent_kind: 'claude-code' | 'pi' | 'talon' | 'other';
  agent_session_id: string | null;
  /** Required for `source: "hook"`; ignored for `source: "scan"`. */
  event?: 'start' | 'activity' | 'stop' | 'end';
  reason?: string;
  cwd: string | null;
  transcript_path: string | null;
  /** Required on every entry for `source: "scan"`. */
  observed_at?: string;
}

export interface ReportHookInput {
  source: 'hook';
  machine: ReportMachine;
  workspace?: ReportWorkspace;
  /** `null` in the request is treated as absent (a report never unlinks). */
  feature_id?: string;
  /** At most one session for a hook report. */
  session?: ReportSession;
}

export interface ReportScanInput {
  source: 'scan';
  machine: ReportMachine;
  workspace?: ReportWorkspace;
  /** `null` in the request is treated as absent (a report never unlinks). */
  feature_id?: string;
  /** Required for a scan report with a workspace; may be empty. */
  sessions: ReportSession[];
}

export type ReportInput = ReportHookInput | ReportScanInput;

/** Strip trailing `/` except when the path is `/` itself. */
function stripTrailingSlash(path: string): string {
  return path === '/' ? path : path.replace(/\/+$/, '');
}

/**
 * Build a `ReportWorkspace` from the parsed value. Zod types an `.optional()`
 * key as `key?: T | undefined`, which does not assign to `ReportWorkspace`
 * under `exactOptionalPropertyTypes`, so each optional key is copied only
 * when it is defined. This keeps the "omitted stays absent" rule.
 */
function buildWorkspace(workspace: z.infer<typeof workspaceSchema>): ReportWorkspace {
  const repoRemote = workspace.repo_remote;
  return {
    path: stripTrailingSlash(workspace.path),
    ...(repoRemote !== undefined
      ? { repo_remote: repoRemote === null ? null : normalizeRemote(repoRemote) }
      : {}),
    ...(workspace.repo_root !== undefined ? { repo_root: workspace.repo_root } : {}),
    ...(workspace.branch !== undefined ? { branch: workspace.branch } : {}),
    ...(workspace.git !== undefined ? { git: workspace.git } : {}),
  };
}

/** Same rationale as `buildWorkspace`: copy session keys only when defined. */
function buildSession(session: z.infer<typeof sessionSchema>): ReportSession {
  return {
    agent_kind: session.agent_kind,
    agent_session_id: session.agent_session_id,
    cwd: session.cwd,
    transcript_path: session.transcript_path,
    ...(session.event !== undefined ? { event: session.event } : {}),
    ...(session.reason !== undefined ? { reason: session.reason } : {}),
    ...(session.observed_at !== undefined ? { observed_at: session.observed_at } : {}),
  };
}

/**
 * Validate a raw workspace-report payload against the rest.md validation table
 * and session-form rules. Expected failures come back as a single AppError
 * with code VALIDATION and the zod issues in `details.issues`.
 */
export function parseReportInput(raw: unknown): Result<ReportInput, AppError> {
  const parsed = reportInputSchema.safeParse(raw);
  if (!parsed.success) {
    return err(
      new AppError(ErrorCode.VALIDATION, 'invalid workspace report input', {
        issues: parsed.error.issues,
      }),
    );
  }

  const value = parsed.data;
  const featureId = value.feature_id ?? undefined;
  const workspace = value.workspace !== undefined ? buildWorkspace(value.workspace) : undefined;

  if (value.source === 'scan') {
    return ok({
      source: 'scan',
      machine: value.machine,
      ...(workspace !== undefined ? { workspace } : {}),
      ...(featureId !== undefined ? { feature_id: featureId } : {}),
      sessions: (value.sessions ?? []).map(buildSession),
    });
  }

  return ok({
    source: 'hook',
    machine: value.machine,
    ...(workspace !== undefined ? { workspace } : {}),
    ...(featureId !== undefined ? { feature_id: featureId } : {}),
    ...(value.session !== undefined ? { session: buildSession(value.session) } : {}),
  });
}

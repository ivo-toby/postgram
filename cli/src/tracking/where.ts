// cli/src/tracking/where.ts: pgm where — features and workspaces grouped by stage.
import { existsSync } from 'node:fs';

import type { Command } from 'commander';

import { shortId } from '../shared.js';
import { runTrackingCommand } from './api.js';
import type { TrackingClient } from './api.js';
import { usageExit } from './config.js';
import type { ResumeTemplates } from './config.js';
import { formatAge, isTranscriptGone, renderResume } from './resume.js';
import type { WhereFeature, WhereGroup, WhereResponse, WorkspaceView } from './types.js';

export function collectWorkspaces(response: WhereResponse): WorkspaceView[] {
  const workspaces: WorkspaceView[] = [];
  for (const group of response.groups) {
    if ('features' in group) {
      for (const feature of group.features) {
        workspaces.push(...feature.workspaces);
      }
    } else {
      workspaces.push(...group.workspaces);
    }
  }
  return workspaces;
}

export async function syncMissing(
  workspaces: readonly WorkspaceView[],
  deps: {
    localAlias: string;
    exists: (path: string) => boolean;
    patch: (id: string, missing: boolean) => Promise<unknown>;
  }
): Promise<{ changed: boolean; failedIds: Set<string> }> {
  let changed = false;
  const failedIds = new Set<string>();
  for (const workspace of workspaces) {
    if (workspace.machine !== deps.localAlias) {
      continue;
    }
    const present = deps.exists(workspace.path);
    if (!present && workspace.missing_since === null) {
      try {
        await deps.patch(workspace.id, true);
        changed = true;
      } catch {
        failedIds.add(workspace.id);
      }
    } else if (present && workspace.missing_since !== null) {
      try {
        await deps.patch(workspace.id, false);
        changed = true;
      } catch {
        // the workspace is present; nothing to mark locally
      }
    }
  }
  return { changed, failedIds };
}

export type RenderInput = {
  localAlias: string;
  templates: ResumeTemplates;
  now: Date;
  exists: (path: string) => boolean;
  failedIds: ReadonlySet<string>;
};

type AugmentedWorkspace = WorkspaceView & { resume: string; transcript_gone: boolean };

function displayRisks(workspace: WorkspaceView, input: RenderInput): string[] {
  const risks = [...workspace.risks];
  if (
    input.failedIds.has(workspace.id) &&
    !input.exists(workspace.path) &&
    !risks.includes('missing')
  ) {
    risks.push('missing');
  }
  return risks;
}

function riskText(risk: string, workspace: WorkspaceView): string {
  if (risk === 'dirty') {
    const count = workspace.git?.dirty_count ?? null;
    return count !== null ? `dirty:${count}` : risk;
  }
  if (risk === 'unpushed') {
    const count = workspace.git?.unpushed_count ?? null;
    return count !== null ? `unpushed:${count}` : risk;
  }
  return risk;
}

function transcriptGone(workspace: WorkspaceView, input: RenderInput): boolean {
  return isTranscriptGone(workspace, input.localAlias, input.exists);
}

function augmentedWorkspace(
  workspace: WorkspaceView,
  input: RenderInput
): AugmentedWorkspace {
  const gone = transcriptGone(workspace, input);
  return {
    ...workspace,
    risks: displayRisks(workspace, input),
    git: workspace.git !== null ? { ...workspace.git } : null,
    resume_session: workspace.resume_session !== null ? { ...workspace.resume_session } : null,
    sessions: workspace.sessions.map((session) => ({ ...session })),
    resume: renderResume(workspace, {
      localAlias: input.localAlias,
      templates: input.templates,
      transcriptGone: gone
    }),
    transcript_gone: gone
  };
}

export function augmentWhere(response: WhereResponse, input: RenderInput): unknown {
  const groups: WhereGroup[] = response.groups.map((group) => {
    if ('features' in group) {
      const features: WhereFeature[] = group.features.map((feature) => ({
        ...feature,
        pull_requests: feature.pull_requests.map((pullRequest) => ({
          ...pullRequest
        })),
        workspaces: feature.workspaces.map((workspace) =>
          augmentedWorkspace(workspace, input)
        )
      }));
      return { ...group, features };
    }
    return {
      ...group,
      workspaces: group.workspaces.map((workspace) =>
        augmentedWorkspace(workspace, input)
      )
    };
  });
  return { ...response, groups };
}

const CUT_WIDTH = 60;

function cut(line: string): string {
  return line.length > CUT_WIDTH ? `${line.slice(0, CUT_WIDTH - 1)}…` : line;
}

function workspaceLines(workspace: WorkspaceView, input: RenderInput): string[] {
  const risks = displayRisks(workspace, input).map((risk) => riskText(risk, workspace));
  let line1 = `  ${workspace.machine}  ${workspace.branch ?? '-'}`;
  if (risks.length > 0) {
    line1 = `${line1}  ${risks.join(' ')}`;
  }

  const gitAge =
    workspace.git_state_at !== null
      ? formatAge(workspace.git_state_at, input.now)
      : '?';
  let sessions: string;
  if (workspace.sessions.length === 0) {
    sessions = 'no sessions';
  } else {
    const gone = transcriptGone(workspace, input);
    const resumeId = workspace.resume_session?.id ?? null;
    sessions = workspace.sessions
      .map((session) => {
        let text = `${session.agent_kind}/${session.status} ${formatAge(
          session.last_activity_at,
          input.now
        )}`;
        if (session.dormant) {
          text = `${text} dormant`;
        }
        if (gone && resumeId !== null && session.id === resumeId) {
          text = `${text} transcript gone`;
        }
        return text;
      })
      .join(', ');
  }
  const line2 = `  ${workspace.path}  git ${gitAge}  ${sessions}`;

  const resume = renderResume(workspace, {
    localAlias: input.localAlias,
    templates: input.templates,
    transcriptGone: transcriptGone(workspace, input)
  });

  return [cut(line1), cut(line2), `  resume: ${resume}`];
}

export function renderWhere(response: WhereResponse, input: RenderInput): string[] {
  const lines: string[] = [];
  for (const group of response.groups) {
    if ('features' in group) {
      if (group.features.length === 0) {
        continue;
      }
      lines.push(`== ${group.label} (${group.features.length}) ==`);
      for (const feature of group.features) {
        const pullRequests = feature.pull_requests
          .map((pullRequest) => ` PR:${pullRequest.state}`)
          .join('');
        lines.push(`${shortId(feature.id)} ${feature.title}  [${feature.stage}]${pullRequests}`);
        for (const workspace of feature.workspaces) {
          lines.push(...workspaceLines(workspace, input));
        }
      }
    } else {
      if (group.workspaces.length === 0) {
        continue;
      }
      lines.push(`== ${group.label} (${group.workspaces.length}) ==`);
      for (const workspace of group.workspaces) {
        lines.push(...workspaceLines(workspace, input));
      }
    }
  }
  return lines;
}

export type WhereOptions = {
  actions: boolean;
  machine?: string;
  repo?: string;
  all: boolean;
  includeEnded: boolean;
};

export async function runWhere(
  options: WhereOptions,
  deps: { client: TrackingClient; json: boolean } & Omit<RenderInput, 'failedIds'>
): Promise<unknown> {
  const query: Parameters<TrackingClient['where']>[0] = {
    view: options.actions ? 'actions' : 'stage',
    ...(options.machine !== undefined ? { machine: options.machine } : {}),
    ...(options.repo !== undefined ? { repo: options.repo } : {}),
    includeReleased: options.all,
    includeDone: options.all,
    includeEnded: options.includeEnded
  };
  let response = await deps.client.where(query);
  const { changed, failedIds } = await syncMissing(collectWorkspaces(response), {
    localAlias: deps.localAlias,
    exists: deps.exists,
    patch: (id, missing) => deps.client.patchWorkspace(id, { missing })
  });
  if (changed) {
    response = await deps.client.where(query);
  }
  const input: RenderInput = {
    localAlias: deps.localAlias,
    templates: deps.templates,
    now: deps.now,
    exists: deps.exists,
    failedIds
  };
  return deps.json ? augmentWhere(response, input) : renderWhere(response, input);
}

type WhereCommandOpts = {
  actions?: boolean;
  machine?: string;
  repo?: string;
  all?: boolean;
  includeEnded?: boolean;
};

export function registerWhereCommand(program: Command): void {
  const command = usageExit(
    program
      .command('where')
      .description('Show features and workspaces grouped by stage')
      .option('--actions', 'group by the next action instead of stage')
      .option('--machine <alias>', 'only workspaces on this machine')
      .option('--repo <remote>', 'only workspaces of this repo')
      .option('--all', 'include released and done features')
      .option('--include-ended', 'include ended sessions')
  ).action(async () => {
    const opts = command.opts<WhereCommandOpts>();
    await runTrackingCommand(command, (context) =>
      runWhere(
        {
          actions: opts.actions === true,
          ...(opts.machine !== undefined ? { machine: opts.machine } : {}),
          ...(opts.repo !== undefined ? { repo: opts.repo } : {}),
          all: opts.all === true,
          includeEnded: opts.includeEnded === true
        },
        {
          client: context.client,
          json: context.json,
          localAlias: context.config.alias,
          templates: context.config.resume,
          now: new Date(),
          exists: existsSync
        }
      )
    );
  });
}

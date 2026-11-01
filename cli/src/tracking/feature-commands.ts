// cli/src/tracking/feature-commands.ts: pgm feature, pgm machine, pgm repo.
import { existsSync } from 'node:fs';
import os from 'node:os';

import type { Command } from 'commander';

import { AppError, ErrorCode } from '../errors.js';
import { parseCommaList, shortId } from '../shared.js';
import { runTrackingCommand } from './api.js';
import type { TrackingClient, TrackingContext } from './api.js';
import { UsageError, usageExit, writeMachineConfig } from './config.js';
import type { TrackingConfig } from './config.js';
import { readBootId, removeMarker, resolveLocalWorkspace, writeMarker } from './local.js';
import type { LocalWorkspace } from './local.js';
import { FEATURE_STAGES } from './types.js';
import type { FeatureStage } from './types.js';

export type FeatureDeps = {
  client: TrackingClient;
  config: TrackingConfig;
  json: boolean;
  cwd: string;
  hostname: string;
  homeDir: string;
  bootId: () => Promise<string | null>;
  resolveWorkspace: (cwd: string) => Promise<LocalWorkspace>;
  writeMarker: (worktree: string, featureId: string) => Promise<void>;
  removeMarker: (worktree: string) => Promise<void>;
  exists: (path: string) => boolean;
  warn: (line: string) => void;
};

export async function runFeatureAdd(
  title: string,
  options: { tags?: string; visibility?: string },
  deps: FeatureDeps
): Promise<unknown> {
  const tags = parseCommaList(options.tags);
  const response = await deps.client.createFeature({
    content: title,
    ...(tags !== undefined ? { tags } : {}),
    ...(options.visibility !== undefined ? { visibility: options.visibility } : {})
  });
  return deps.json ? response : [response.entity.id];
}

export async function runFeatureStage(
  id: string,
  stage: string,
  deps: FeatureDeps
): Promise<unknown> {
  if (!(FEATURE_STAGES as readonly string[]).includes(stage)) {
    throw new UsageError(
      `invalid stage '${stage}'. Use one of: ${FEATURE_STAGES.join(', ')}`
    );
  }
  const response = await deps.client.setStage(id, stage as FeatureStage);
  return deps.json
    ? response
    : [`${shortId(response.entity.id)} ${response.previous_stage ?? '-'} → ${stage}`];
}

const PR_STATES = ['open', 'merged', 'closed'] as const;

export async function runFeaturePr(
  id: string,
  url: string,
  options: { state?: string },
  deps: FeatureDeps
): Promise<unknown> {
  const state = options.state ?? 'open';
  if (!(PR_STATES as readonly string[]).includes(state)) {
    throw new UsageError(
      `invalid --state '${state}'. Use one of: ${PR_STATES.join(', ')}`
    );
  }
  const response = await deps.client.addPullRequest(id, {
    url,
    state: state as 'open' | 'merged' | 'closed'
  });
  return deps.json
    ? response
    : [`${shortId(response.entity.id)} PR ${state}, stage ${response.to}`];
}

export async function runFeatureLink(
  id: string | null,
  options: { path?: string; workspace?: string },
  deps: FeatureDeps
): Promise<unknown> {
  if (options.workspace !== undefined) {
    const patched = await deps.client.patchWorkspace(options.workspace, {
      feature_id: id
    });
    const workspace = patched.workspace;
    if (workspace.machine === deps.config.alias && deps.exists(workspace.path)) {
      if (id !== null) {
        await deps.writeMarker(workspace.path, workspace.feature_id ?? id);
      } else {
        await deps.removeMarker(workspace.path);
      }
    } else {
      deps.warn(
        `warning: ${workspace.machine} may have a feature marker; its next registration will restore the marker's link`
      );
    }
    return deps.json
      ? patched
      : [
          id !== null
            ? `linked ${workspace.path} → ${shortId(id)}`
            : `unlinked ${workspace.path}`
        ];
  }

  const target = options.path ?? deps.cwd;
  const local = await deps.resolveWorkspace(target);
  if (local.kind === 'timeout') {
    throw new AppError(ErrorCode.INTERNAL, 'git timeout');
  }

  const looked = await deps.client.lookup(deps.config.alias, local.path);
  let workspaceId: string;
  if (looked.workspace !== null && looked.workspace.path === local.path) {
    workspaceId = looked.workspace.id;
  } else {
    const report = await deps.client.report({
      source: 'hook',
      machine: {
        alias: deps.config.alias,
        hostname: deps.hostname,
        boot_id: await deps.bootId()
      },
      workspace: local.workspace
    });
    if (report.workspace === null) {
      throw new AppError(
        ErrorCode.INTERNAL,
        'workspace registration returned no workspace'
      );
    }
    workspaceId = report.workspace.id;
  }

  const patched = await deps.client.patchWorkspace(workspaceId, {
    feature_id: id
  });
  if (id !== null) {
    await deps.writeMarker(local.path, patched.workspace.feature_id ?? id);
  } else {
    await deps.removeMarker(local.path);
  }
  return deps.json
    ? patched
    : [
        id !== null
          ? `linked ${local.path} → ${shortId(id)}`
          : `unlinked ${local.path}`
    ];
}

export async function runMachineSet(
  options: { alias?: string; connect?: string },
  deps: FeatureDeps & { writeConfig: typeof writeMachineConfig }
): Promise<unknown> {
  const written = await deps.writeConfig({
    ...(options.alias !== undefined ? { alias: options.alias } : {}),
    ...(options.connect !== undefined ? { connectTarget: options.connect } : {}),
    homeDir: deps.homeDir
  });
  if (written.previousAlias !== null && written.previousAlias !== written.alias) {
    deps.warn(
      `warning: history stays under the old alias '${written.previousAlias}'`
    );
  }
  await deps.client.report({
    source: 'hook',
    machine: {
      alias: written.alias,
      hostname: deps.hostname,
      boot_id: await deps.bootId()
    }
  });
  const result = await deps.client.putMachine(written.alias, written.connectTarget);
  return deps.json
    ? result
    : [`machine ${written.alias} → ${written.connectTarget}`];
}

export async function runMachineList(deps: FeatureDeps): Promise<unknown> {
  const result = await deps.client.listMachines();
  return deps.json
    ? result
    : result.machines.map(
        (machine) =>
          `${machine.alias}  ${machine.connect_target ?? machine.alias}  ${machine.last_seen_at}`
      );
}

export async function runRepoSet(
  remote: string,
  options: { releaseOnMerge?: string },
  deps: FeatureDeps
): Promise<unknown> {
  if (options.releaseOnMerge !== 'true' && options.releaseOnMerge !== 'false') {
    throw new UsageError(`--release-on-merge must be 'true' or 'false'`);
  }
  const releaseOnMerge = options.releaseOnMerge === 'true';
  const result = await deps.client.putRepository(remote, releaseOnMerge);
  return deps.json ? result : [`${remote} release_on_merge=${releaseOnMerge}`];
}

function featureDeps(context: TrackingContext): FeatureDeps {
  return {
    client: context.client,
    config: context.config,
    json: context.json,
    cwd: process.cwd(),
    hostname: os.hostname(),
    homeDir: context.homeDir,
    bootId: readBootId,
    resolveWorkspace: (cwd) => resolveLocalWorkspace(cwd),
    writeMarker: (worktree, featureId) => writeMarker(worktree, featureId, new Date()),
    removeMarker,
    exists: existsSync,
    warn: (line) => process.stderr.write(`${line}\n`)
  };
}

type AddOptions = { tags?: string; visibility?: string };
type PrOptions = { state?: string };
type LinkOptions = { path?: string; workspace?: string };
type MachineSetOptions = { alias?: string; connect?: string };
type RepoSetOptions = { releaseOnMerge?: string };

export function registerFeatureCommands(program: Command): void {
  const feature = usageExit(
    program
      .command('feature')
      .description('Manage features')
  );

  usageExit(
    feature
      .command('add')
      .description('Create a feature')
      .argument('<title>', 'feature title')
      .option('--tags <tags>', 'comma-separated tags')
      .option('--visibility <visibility>', 'personal, work or shared')
  ).action(async (title: string, options: AddOptions, command: Command) => {
    await runTrackingCommand(command, (context) =>
      runFeatureAdd(title, options, featureDeps(context))
    );
  });

  usageExit(
    feature
      .command('stage')
      .description('Set a feature stage')
      .argument('<id>', 'feature id (UUID or 8-hex)')
      .argument('<stage>', `one of: ${FEATURE_STAGES.join(', ')}`)
  ).action(async (id: string, stage: string, _options: unknown, command: Command) => {
    await runTrackingCommand(command, (context) =>
      runFeatureStage(id, stage, featureDeps(context))
    );
  });

  usageExit(
    feature
      .command('pr')
      .description('Attach a pull request to a feature')
      .argument('<id>', 'feature id (UUID or 8-hex)')
      .argument('<url>', 'pull request URL')
      .option('--state <state>', 'open, merged or closed', 'open')
  ).action(async (id: string, url: string, options: PrOptions, command: Command) => {
    await runTrackingCommand(command, (context) =>
      runFeaturePr(id, url, options, featureDeps(context))
    );
  });

  usageExit(
    feature
      .command('link')
      .description('Link a workspace to a feature')
      .argument('<id>', 'feature id (UUID or 8-hex)')
      .option('--path <dir>', 'workspace directory (default: cwd)')
      .option('--workspace <workspace-uuid>', 'link by workspace id instead')
  ).action(async (id: string, options: LinkOptions, command: Command) => {
    await runTrackingCommand(command, (context) =>
      runFeatureLink(id, options, featureDeps(context))
    );
  });

  usageExit(
    feature
      .command('unlink')
      .description('Unlink a workspace from its feature')
      .option('--path <dir>', 'workspace directory (default: cwd)')
      .option('--workspace <workspace-uuid>', 'unlink by workspace id instead')
  ).action(async (options: LinkOptions, command: Command) => {
    await runTrackingCommand(command, (context) =>
      runFeatureLink(null, options, featureDeps(context))
    );
  });

  const machine = usageExit(
    program
      .command('machine')
      .description('Machine settings')
  );

  usageExit(
    machine
      .command('set')
      .description('Write ~/.pgmrc and register the machine')
      .option('--alias <alias>', 'machine alias')
      .option('--connect <target>', 'connect target')
  ).action(async (options: MachineSetOptions, command: Command) => {
    await runTrackingCommand(command, (context) =>
      runMachineSet(options, { ...featureDeps(context), writeConfig: writeMachineConfig })
    );
  });

  usageExit(
    machine
      .command('list')
      .description('List machines')
  ).action(async (_options, command: Command) => {
    await runTrackingCommand(command, (context) => runMachineList(featureDeps(context)));
  });

  const repo = usageExit(
    program
      .command('repo')
      .description('Repository settings')
  );

  usageExit(
    repo
      .command('set')
      .description('Set repository settings')
      .argument('<remote>', 'repository remote')
      .option('--release-on-merge <bool>', 'true or false')
  ).action(async (remote: string, options: RepoSetOptions, command: Command) => {
    await runTrackingCommand(command, (context) =>
      runRepoSet(remote, options, featureDeps(context))
    );
  });
}

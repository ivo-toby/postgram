#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, readFileSync } from 'node:fs';
import { mkdir, readFile as fsReadFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { Command } from 'commander';
import { pipeline } from 'node:stream/promises';

import { createPgmClient } from './client.js';
import {
  handleCliFailure,
  isJsonMode,
  parseCommaList,
  parseJsonObject,
  printHuman,
  printJson,
  readStdinText,
  resolvePgmConfig,
  shortId
} from './shared.js';
import { AppError, ErrorCode } from './errors.js';
import { buildSyncManifest } from './sync-walk.js';
import {
  compactEdgeResponse,
  compactEntityListResponse,
  compactGraphResponse,
  compactSearchResponse,
  compactStoredEntityResponse,
  entityListResponseToToon,
  graphResponseToToon,
  searchResponseToToon
} from './search-output.js';

function readCliVersion(): string {
  const rawPackageJson = readFileSync(
    new URL('../package.json', import.meta.url),
    'utf8'
  );
  const packageJson = JSON.parse(rawPackageJson) as { version: string };
  return packageJson.version;
}

function printTopLevelVersionAndExit(argv: string[]): void {
  if (argv.length === 3 && (argv[2] === '--version' || argv[2] === '-V')) {
    process.stdout.write(`${readCliVersion()}\n`);
    process.exit(0);
  }
}

printTopLevelVersionAndExit(process.argv);

function formatStoredEntity(entity: {
  id: string;
  type: string;
  content: string | null;
  status: string | null;
  visibility: string;
  owner: string | null;
  tags: string[];
}) {
  return [
    `${entity.type} ${shortId(entity.id)}${entity.status ? ` [${entity.status}]` : ''}`,
    `visibility: ${entity.visibility}`,
    `owner: ${entity.owner ?? 'shared'}`,
    `tags: ${entity.tags.join(', ') || '-'}`,
    entity.content ? `content: ${entity.content}` : 'content: -'
  ];
}

function formatSearchResults(
  results: Array<{
    entity: { id: string; type: string; content: string | null };
    score: number;
    chunk_content: string;
    related?: Array<{
      entity: {
        id: string;
        type: string;
        content: string | null;
        metadata: Record<string, unknown>;
      };
      relation: string;
      direction: string;
    }>;
  }>
) {
  if (results.length === 0) {
    return ['No results'];
  }

  const lines: string[] = [];
  for (const result of results) {
    lines.push(
      `${result.entity.type} ${shortId(result.entity.id)} score=${result.score.toFixed(3)}`
    );
    lines.push(`  ${result.chunk_content}`);
    if (
      result.entity.content &&
      result.entity.content !== result.chunk_content
    ) {
      lines.push(`  entity: ${result.entity.content}`);
    }
    if (result.related && result.related.length > 0) {
      lines.push(`  related (${result.related.length}):`);
      for (const rel of result.related) {
        const arrow = rel.direction === 'outgoing' ? '->' : '<-';
        lines.push(
          `    ${arrow} [${rel.relation}] ${rel.entity.type} ${shortId(rel.entity.id)}`
        );
      }
    }
  }

  return lines;
}

function formatTaskList(
  items: Array<{
    id: string;
    content: string | null;
    status: string | null;
    metadata: Record<string, unknown>;
  }>
) {
  if (items.length === 0) {
    return ['No tasks'];
  }

  return items.flatMap((item) => {
    const metadata = item.metadata as { context?: string; due_date?: string };
    const suffix = [
      metadata.context ? `context=${metadata.context}` : undefined,
      metadata.due_date ? `due=${metadata.due_date}` : undefined
    ]
      .filter(Boolean)
      .join(' ');
    return [
      `${shortId(item.id)}${item.status ? ` [${item.status}]` : ''} ${item.content ?? ''}`.trim(),
      suffix ? `  ${suffix}` : '  -'
    ];
  });
}

function validateToonOptions(
  options: {
    toon?: boolean;
    fullResponse?: boolean;
  },
  json: boolean
): void {
  if (options.toon === true && (json || options.fullResponse === true)) {
    throw new AppError(
      ErrorCode.VALIDATION,
      '--toon cannot be combined with --json or --full-response'
    );
  }
}

function parseDurationMs(value: string): number {
  const match = /^(\d+)([mhd])$/i.exec(value.trim());
  if (!match) {
    throw new AppError(
      ErrorCode.VALIDATION,
      `Invalid duration '${value}'. Use format like '15m', '2h', or '7d'.`
    );
  }

  const [, amountText, unitText] = match as RegExpExecArray & [
    string,
    string,
    string
  ];
  const amount = Number(amountText);
  const unit = unitText.toLowerCase();
  const milliseconds =
    unit === 'm'
      ? amount * 60 * 1000
      : unit === 'h'
        ? amount * 60 * 60 * 1000
        : amount * 24 * 60 * 60 * 1000;

  if (milliseconds > 3650 * 24 * 60 * 60 * 1000) {
    throw new AppError(
      ErrorCode.VALIDATION,
      `Duration '${value}' exceeds the maximum allowed (3650 days / ~10 years).`
    );
  }

  return milliseconds;
}

function formatGroomCandidates(
  candidates: Array<{
    id: string;
    content: string | null;
    tags: string[];
    metadata: Record<string, unknown>;
    createdAt: string;
  }>
) {
  if (candidates.length === 0) {
    return ['No eligible session-context memories'];
  }

  const lines = [`Would archive ${candidates.length} session-context memories`];
  for (const candidate of candidates) {
    const metadata = candidate.metadata as {
      topic?: string;
      session_id?: string;
    };
    lines.push(
      [
        `  ${shortId(candidate.id)} ${candidate.createdAt.slice(0, 10)}`,
        candidate.tags.length ? `tags=${candidate.tags.join(',')}` : 'tags=-',
        metadata.topic ? `topic=${metadata.topic}` : undefined,
        metadata.session_id ? `session=${metadata.session_id}` : undefined,
        candidate.content ? `content=${candidate.content}` : 'content=-'
      ]
        .filter(Boolean)
        .join(' | ')
    );
  }

  return lines;
}

async function resolveStoreContent(
  content: string | undefined
): Promise<string> {
  if (content !== undefined) {
    return content;
  }

  const stdin = await readStdinText();
  if (!stdin) {
    throw new AppError(ErrorCode.VALIDATION, 'content is required');
  }

  return stdin;
}

async function runWithClient<T>(
  command: Command,
  handler: (
    client: ReturnType<typeof createPgmClient>,
    json: boolean
  ) => Promise<T>
): Promise<void> {
  const json = isJsonMode(command);

  try {
    const config = await resolvePgmConfig();
    const client = createPgmClient(config);
    const result = await handler(client, json);

    if (result !== undefined) {
      if (json) {
        printJson(result);
      } else if (Array.isArray(result)) {
        printHuman(result.map(String));
      } else {
        printHuman([String(result)]);
      }
    }
  } catch (error) {
    await handleCliFailure(error, json);
  }
}

async function runBackup(
  output: string | undefined,
  encrypt: boolean
): Promise<void> {
  if (!output) {
    throw new AppError(ErrorCode.VALIDATION, '--output is required for backup');
  }

  const databaseUrl = process.env.DATABASE_URL ?? process.env.PGM_DATABASE_URL;
  if (!databaseUrl) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'DATABASE_URL must be set for backup'
    );
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  let destination = output;
  const backupExtension = encrypt ? '.dump.gpg' : '.dump';

  try {
    const fileStat = await stat(output);
    if (fileStat.isDirectory()) {
      destination = path.join(
        output,
        `postgram-backup-${timestamp}${backupExtension}`
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT' &&
      output.endsWith('/')
    ) {
      destination = path.join(
        output,
        `postgram-backup-${timestamp}${backupExtension}`
      );
    }
  }

  await mkdir(path.dirname(destination), { recursive: true });

  const hasLocalPgDump =
    spawnSync('sh', ['-lc', 'command -v pg_dump >/dev/null']).status === 0;
  const dockerService = process.env.PGM_BACKUP_DOCKER_SERVICE ?? 'postgres';
  const dockerUser = process.env.PGM_BACKUP_DOCKER_USER ?? 'postgram';
  const dockerDatabase = process.env.PGM_BACKUP_DOCKER_DB ?? 'postgram';

  const pgDump = hasLocalPgDump
    ? spawn('pg_dump', [
        '--dbname',
        databaseUrl,
        '--format=custom',
        '--no-owner',
        '--no-privileges'
      ])
    : spawn('docker', [
        'compose',
        'exec',
        '-T',
        dockerService,
        'pg_dump',
        '-U',
        dockerUser,
        '-d',
        dockerDatabase,
        '--format=custom',
        '--no-owner',
        '--no-privileges'
      ]);

  if (encrypt) {
    const passphrase = process.env.PGM_BACKUP_PASSPHRASE;
    if (!passphrase) {
      throw new AppError(
        ErrorCode.VALIDATION,
        'PGM_BACKUP_PASSPHRASE must be set when using --encrypt'
      );
    }

    const gpg = spawn('gpg', [
      '--symmetric',
      '--cipher-algo',
      'AES256',
      '--batch',
      '--yes',
      '--pinentry-mode',
      'loopback',
      '--passphrase',
      passphrase,
      '--output',
      destination
    ]);

    const waitForExit = (child: typeof pgDump) =>
      new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(
              new AppError(
                ErrorCode.INTERNAL,
                `${child.spawnfile} exited with code ${code ?? 'unknown'}`
              )
            );
          }
        });
      });

    await Promise.all([
      pipeline(pgDump.stdout!, gpg.stdin!),
      waitForExit(pgDump),
      waitForExit(gpg)
    ]);
    return;
  }

  const file = createWriteStream(destination);
  const waitForExit = (child: typeof pgDump) =>
    new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new AppError(
              ErrorCode.INTERNAL,
              `${child.spawnfile} exited with code ${code ?? 'unknown'}`
            )
          );
        }
      });
    });

  await Promise.all([pipeline(pgDump.stdout!, file), waitForExit(pgDump)]);
}

const program = new Command();

program
  .name('pgm')
  .description('Postgram CLI for humans and agents')
  .option('--json', 'emit compact JSON for agents where supported');

program
  .command('store')
  .alias('add')
  .description('Store durable memory/entity; use memory session-context for resumability')
  .argument('[content]', 'entity content')
  .option('--type <type>', 'entity type', 'memory')
  .option(
    '--visibility <visibility>',
    'entity visibility (prefer personal for agent memory)',
    'shared'
  )
  .option('--owner <owner>', 'entity owner or namespace')
  .option('--status <status>', 'entity status')
  .option('--tags <tags>', 'comma-separated tags')
  .option('--source <source>', 'entity source')
  .option('--metadata <json>', 'JSON metadata object')
  .option('--skip-extraction', 'store without ever queueing graph extraction')
  .option('--full-response', 'emit the full API response when used with --json')
  .action(async (content, options, command) => {
    await runWithClient(command, async (client, json) => {
      const body = await client.storeEntity({
        type: options.type,
        content: await resolveStoreContent(content),
        visibility: options.visibility,
        owner: options.owner,
        status: options.status,
        tags: parseCommaList(options.tags),
        source: options.source,
        metadata: parseJsonObject(options.metadata),
        skip_extraction: options.skipExtraction === true ? true : undefined
      });

      return json
        ? options.fullResponse === true
          ? body
          : compactStoredEntityResponse(body)
        : formatStoredEntity({
            id: body.entity.id,
            type: body.entity.type,
            content: body.entity.content,
            status: body.entity.status,
            visibility: body.entity.visibility,
            owner: body.entity.owner,
            tags: body.entity.tags
          });
    });
  });

program
  .command('search')
  .description('Search stored entities (compact JSON with --json; TOON with --toon)')
  .argument('query', 'search query')
  .option('--type <type>', 'entity type')
  .option('--tags <tags>', 'comma-separated tags')
  .option('--visibility <visibility>', 'entity visibility filter')
  .option('--owner <owner>', 'entity owner filter')
  .option('--limit <limit>', 'result limit', '10')
  .option('--threshold <threshold>', 'similarity threshold', '0.35')
  .option('--recency-weight <recencyWeight>', 'recency weight', '0.1')
  .option('--expand-graph', 'include graph-connected entities in results')
  .option('--include-archived', 'include archived entities in results')
  .option(
    '--memory-role <role>',
    'memory role filter: session_context for continuity; durable_memory for stable facts'
  )
  .option(
    '--full-response',
    'emit the full API response instead of compact default output when used with --json'
  )
  .option(
    '--toon',
    'emit compact TOON output for lower agent token use; formatting is applied in the CLI, not the API'
  )
  .action(async (query, options, command) => {
    await runWithClient(command, async (client, json) => {
      if (options.toon === true && (json || options.fullResponse === true)) {
        throw new AppError(
          ErrorCode.VALIDATION,
          '--toon cannot be combined with --json or --full-response'
        );
      }

      if (
        options.memoryRole !== undefined &&
        !['durable_memory', 'session_context'].includes(options.memoryRole)
      ) {
        throw new AppError(
          ErrorCode.VALIDATION,
          '--memory-role must be durable_memory or session_context'
        );
      }

      const body = await client.searchEntities({
        query,
        type: options.type,
        tags: parseCommaList(options.tags),
        visibility: options.visibility,
        owner: options.owner,
        limit: Number(options.limit),
        threshold: Number(options.threshold),
        recency_weight: Number(options.recencyWeight),
        expand_graph: options.expandGraph === true ? true : undefined,
        include_archived: options.includeArchived === true ? true : undefined,
        memory_role: options.memoryRole
      });

      if (options.toon === true) {
        return searchResponseToToon(compactSearchResponse(body));
      }

      if (json) {
        return options.fullResponse === true
          ? body
          : compactSearchResponse(body);
      }

      return formatSearchResults(body.results);
    });
  });

const memoryCommand = program
  .command('memory')
  .description('Memory commands for agent session context');

memoryCommand
  .command('groom')
  .description('Preview or archive stale session-context memories for the authenticated client')
  .option('--dry-run', 'preview without mutating')
  .option(
    '--older-than <duration>',
    'only include memories older than this (e.g. 15m, 2h, 7d)',
    '7d'
  )
  .option('--limit <limit>', 'maximum candidates')
  .option('--topic <topic>', 'filter by topic')
  .option('--session-id <sessionId>', 'filter by session id')
  .option(
    '--tag <tag>',
    'filter by tag (repeatable)',
    (value: string, previous: string[] = []) => {
      previous.push(value);
      return previous;
    },
    []
  )
  .option('--yes', 'confirm archive mutation')
  .action(async (options, command) => {
    await runWithClient(command, async (client, json) => {
      let limit: number | undefined;
      if (options.limit !== undefined) {
        limit = Number.parseInt(options.limit, 10);
        if (!Number.isInteger(limit) || limit <= 0) {
          throw new AppError(ErrorCode.VALIDATION, '--limit must be a positive integer');
        }
      }

      if (options.dryRun !== true && options.yes !== true) {
        throw new AppError(ErrorCode.VALIDATION, '--yes is required outside dry-run');
      }

      const body = await client.groomSessionContext({
        dry_run: options.dryRun === true,
        confirmed: options.dryRun === true ? undefined : true,
        older_than_ms: parseDurationMs(options.olderThan),
        limit,
        topic: options.topic,
        session_id: options.sessionId,
        tags: options.tag
      });

      if (json) {
        return body;
      }

      if (body.dryRun) {
        return formatGroomCandidates(body.eligible ?? []);
      }

      return [
        `Archived ${body.archived} session-context memories`,
        `  promoted: ${body.promoted}`,
        `  skipped: ${body.skipped}`
      ];
    });
  });

memoryCommand
  .command('session-context')
  .alias('session')
  .description('Store client-scoped session context for agent resumability')
  .argument('[content]', 'session context content')
  .option(
    '--visibility <visibility>',
    'entity visibility (prefer personal for agent session context)',
    'shared'
  )
  .option('--owner <owner>', 'entity owner or namespace')
  .option('--session-id <sessionId>', 'external session or thread id')
  .option('--agent-id <agentId>', 'agent/persona metadata only; not an auth boundary')
  .option('--topic <topic>', 'topic label')
  .option('--tags <tags>', 'comma-separated tags')
  .option('--promotable', 'mark this session context as promotable')
  .option(
    '--groom-after <groomAfter>',
    'ISO timestamp after which grooming may archive/promote it'
  )
  .option(
    '--expires-at <expiresAt>',
    'ISO timestamp after which the context is stale'
  )
  .option('--full-response', 'emit the full API response when used with --json')
  .action(async (content, options, command) => {
    await runWithClient(command, async (client, json) => {
      const body = await client.storeSessionContext({
        content: await resolveStoreContent(content),
        visibility: options.visibility,
        owner: options.owner,
        session_id: options.sessionId,
        agent_id: options.agentId,
        topic: options.topic,
        tags: parseCommaList(options.tags),
        promotable: options.promotable === true ? true : undefined,
        groom_after: options.groomAfter,
        expires_at: options.expiresAt
      });

      return json
        ? options.fullResponse === true
          ? body
          : compactStoredEntityResponse(body)
        : formatStoredEntity({
            id: body.entity.id,
            type: body.entity.type,
            content: body.entity.content,
            status: body.entity.status,
            visibility: body.entity.visibility,
            owner: body.entity.owner,
            tags: body.entity.tags
          });
    });
  });

program
  .command('recall')
  .description('Recall an entity by ID')
  .argument('id', 'entity ID')
  .option('--owner <owner>', 'entity owner filter')
  .action(async (id, options, command) => {
    await runWithClient(command, async (client, json) => {
      const body = await client.recallEntity(id, {
        owner: options.owner
      });
      return json ? body : formatStoredEntity(body.entity);
    });
  });

program
  .command('list')
  .description('List entities')
  .option('--type <type>', 'filter by type')
  .option('--status <status>', 'filter by status')
  .option('--visibility <visibility>', 'filter by visibility')
  .option('--owner <owner>', 'filter by owner')
  .option('--tags <tags>', 'comma-separated tags')
  .option('--limit <limit>', 'result limit', '50')
  .option('--offset <offset>', 'result offset', '0')
  .option('--include-archived', 'include archived entities')
  .option(
    '--full-response',
    'emit the full API response instead of compact default output when used with --json'
  )
  .option(
    '--toon',
    'emit compact TOON output for lower agent token use; formatting is applied in the CLI, not the API'
  )
  .action(async (options, command) => {
    await runWithClient(command, async (client, json) => {
      validateToonOptions(options, json);

      const body = await client.listEntities({
        type: options.type,
        status: options.status,
        visibility: options.visibility,
        owner: options.owner,
        tags: parseCommaList(options.tags),
        limit: Number(options.limit),
        offset: Number(options.offset),
        include_archived: options.includeArchived === true ? true : undefined
      });

      if (options.toon === true) {
        return entityListResponseToToon(compactEntityListResponse(body));
      }

      if (json) {
        return options.fullResponse === true
          ? body
          : compactEntityListResponse(body);
      }

      if (body.items.length === 0) {
        return ['No entities'];
      }

      const lines = body.items.flatMap((item) => {
        const preview = item.content
          ? item.content.length > 60
            ? `${item.content.slice(0, 60)}...`
            : item.content
          : '-';
        return [
          `${item.type} ${shortId(item.id)}  ${preview}`,
          `  tags: ${item.tags.join(', ') || '-'} | owner=${item.owner ?? 'shared'} | ${item.visibility} | ${item.created_at.slice(0, 10)}`
        ];
      });

      lines.push('');
      lines.push(
        `${body.total} entities (showing ${body.offset + 1}-${body.offset + body.items.length})`
      );

      return lines;
    });
  });

program
  .command('update')
  .description('Update an entity')
  .argument('id', 'entity ID')
  .option('--content <content>', 'updated content')
  .option('--visibility <visibility>', 'updated visibility')
  .option('--status <status>', 'updated status')
  .option('--tags <tags>', 'comma-separated tags')
  .option('--source <source>', 'updated source')
  .option('--metadata <json>', 'JSON metadata object')
  .option('--version <version>', 'expected version')
  .option('--force', 'retry using the latest version on conflict')
  .option('--full-response', 'emit the full API response when used with --json')
  .action(async (id, options, command) => {
    await runWithClient(command, async (client, json) => {
      const payload = {
        content: options.content,
        visibility: options.visibility,
        status: options.status,
        tags: parseCommaList(options.tags),
        source: options.source,
        metadata: parseJsonObject(options.metadata)
      };

      const updateOnce = async (version: number) =>
        client.updateEntity(id, {
          version,
          ...payload
        });

      let body;
      if (options.version !== undefined) {
        body = await updateOnce(Number(options.version));
      } else if (options.force) {
        const current = await client.recallEntity(id);
        body = await updateOnce(current.entity.version);
      } else {
        throw new Error('--version is required unless --force is set');
      }

      return json
        ? options.fullResponse === true
          ? body
          : compactStoredEntityResponse(body)
        : formatStoredEntity(body.entity);
    });
  });

program
  .command('delete')
  .description('Soft delete an entity')
  .argument('id', 'entity ID')
  .action(async (id, _options, command) => {
    await runWithClient(command, async (client, json) => {
      const body = await client.deleteEntity(id);
      return json ? body : [`Deleted ${shortId(body.id)}`];
    });
  });

const taskCommand = program.command('task').description('Task commands');

taskCommand
  .command('add')
  .description('Create a task')
  .argument('[content]', 'task content')
  .option('--context <context>', 'GTD context')
  .option('--status <status>', 'task status', 'inbox')
  .option('--due <dueDate>', 'due date')
  .option('--tags <tags>', 'comma-separated tags')
  .option('--visibility <visibility>', 'task visibility', 'shared')
  .option('--metadata <json>', 'JSON metadata object')
  .option('--full-response', 'emit the full API response when used with --json')
  .action(async (content, options, command) => {
    await runWithClient(command, async (client, json) => {
      const taskContent = await resolveStoreContent(content);
      const body = await client.createTask({
        content: taskContent,
        context: options.context,
        status: options.status,
        due_date: options.due,
        tags: parseCommaList(options.tags),
        visibility: options.visibility,
        metadata: parseJsonObject(options.metadata)
      });

      return json
        ? options.fullResponse === true
          ? body
          : compactStoredEntityResponse(body)
        : formatStoredEntity({
            id: body.entity.id,
            type: body.entity.type,
            content: body.entity.content,
            status: body.entity.status,
            visibility: body.entity.visibility,
            owner: body.entity.owner,
            tags: body.entity.tags
          });
    });
  });

taskCommand
  .command('list')
  .description('List tasks')
  .option('--status <status>', 'filter by status')
  .option('--context <context>', 'filter by context')
  .option('--limit <limit>', 'result limit', '50')
  .option('--offset <offset>', 'result offset', '0')
  .option('--include-archived', 'include archived tasks')
  .option(
    '--full-response',
    'emit the full API response instead of compact default output when used with --json'
  )
  .option(
    '--toon',
    'emit compact TOON output for lower agent token use; formatting is applied in the CLI, not the API'
  )
  .action(async (options, command) => {
    await runWithClient(command, async (client, json) => {
      validateToonOptions(options, json);

      const body = await client.listTasks({
        status: options.status,
        context: options.context,
        limit: Number(options.limit),
        offset: Number(options.offset),
        include_archived: options.includeArchived === true ? true : undefined
      });

      if (options.toon === true) {
        return entityListResponseToToon(compactEntityListResponse(body));
      }

      return json
        ? options.fullResponse === true
          ? body
          : compactEntityListResponse(body)
        : formatTaskList(body.items);
    });
  });

taskCommand
  .command('update')
  .description('Update a task')
  .argument('id', 'task ID')
  .option('--content <content>', 'updated content')
  .option('--context <context>', 'updated context')
  .option('--status <status>', 'updated status')
  .option('--due <dueDate>', 'updated due date')
  .option('--tags <tags>', 'comma-separated tags')
  .option('--visibility <visibility>', 'updated task visibility')
  .option('--metadata <json>', 'JSON metadata object')
  .option('--version <version>', 'expected version', '')
  .option('--full-response', 'emit the full API response when used with --json')
  .action(async (id, options, command) => {
    await runWithClient(command, async (client, json) => {
      if (!options.version) {
        throw new AppError(ErrorCode.VALIDATION, '--version is required');
      }

      const body = await client.updateTask(id, {
        version: Number(options.version),
        content: options.content,
        context: options.context,
        status: options.status,
        due_date: options.due,
        tags: parseCommaList(options.tags),
        visibility: options.visibility,
        metadata: parseJsonObject(options.metadata)
      });

      return json
        ? options.fullResponse === true
          ? body
          : compactStoredEntityResponse(body)
        : formatStoredEntity({
            id: body.entity.id,
            type: body.entity.type,
            content: body.entity.content,
            status: body.entity.status,
            visibility: body.entity.visibility,
            owner: body.entity.owner,
            tags: body.entity.tags
          });
    });
  });

taskCommand
  .command('complete')
  .description('Mark a task complete')
  .argument('id', 'task ID')
  .option('--version <version>', 'expected version')
  .option('--full-response', 'emit the full API response when used with --json')
  .action(async (id, options, command) => {
    await runWithClient(command, async (client, json) => {
      if (options.version === undefined) {
        throw new AppError(ErrorCode.VALIDATION, '--version is required');
      }

      const body = await client.completeTask(id, Number(options.version));
      return json
        ? options.fullResponse === true
          ? body
          : compactStoredEntityResponse(body)
        : formatStoredEntity({
            id: body.entity.id,
            type: body.entity.type,
            content: body.entity.content,
            status: body.entity.status,
            visibility: body.entity.visibility,
            owner: body.entity.owner,
            tags: body.entity.tags
          });
    });
  });

program
  .command('queue')
  .description('Show enrichment and extraction queue status')
  .action(async (_options, command) => {
    await runWithClient(command, async (client, json) => {
      const body = await client.getQueueStatus();

      if (json) return body;

      const e = body.embedding;
      const age =
        e.oldest_pending_secs !== null
          ? ` oldest_pending=${e.oldest_pending_secs}s`
          : '';
      const lines = [
        `embedding:  pending=${e.pending}  completed=${e.completed}  failed=${e.failed}  retry_eligible=${e.retry_eligible}${age}`
      ];

      if (body.extraction) {
        const x = body.extraction;
        lines.push(
          `extraction: pending=${x.pending}  completed=${x.completed}  failed=${x.failed}`
        );
      } else {
        lines.push('extraction: disabled');
      }

      return lines;
    });
  });

program
  .command('backup')
  .description('Create a database backup')
  .option('--output <path>', 'backup output path')
  .option('--encrypt', 'encrypt the backup with GPG')
  .action(async (options, command) => {
    const json = isJsonMode(command);

    try {
      await runBackup(options.output, Boolean(options.encrypt));
      if (json) {
        printJson({ ok: true });
      } else {
        printHuman(['Backup completed']);
      }
    } catch (error) {
      await handleCliFailure(error, json);
    }
  });

program
  .command('sync')
  .description('Sync a local directory of markdown files')
  .argument('<dir>', 'directory path to sync')
  .option('--repo <name>', 'repo identifier (defaults to directory name)')
  .option('--dry-run', 'show what would change without syncing')
  .option('--quiet', 'suppress output')
  .action(async (dir, options, command) => {
    const json = isJsonMode(command);

    try {
      const resolvedDir = path.resolve(dir);
      const repoName = options.repo ?? path.basename(resolvedDir);

      const manifest = await buildSyncManifest(resolvedDir);

      const config = await resolvePgmConfig();
      const client = createPgmClient(config);

      const manifestForServer = manifest.map(({ path: p, sha }) => ({
        path: p,
        sha
      }));
      const diff = await client.diffSync({
        repo: repoName,
        files: manifestForServer
      });

      if (options.dryRun) {
        const newCount = diff.toUpload.filter((f) => f.reason === 'new').length;
        const changedCount = diff.toUpload.filter(
          (f) => f.reason === 'changed'
        ).length;
        const result = {
          created: newCount,
          updated: changedCount,
          unchanged: diff.unchanged,
          deleted: diff.toDelete.length
        };

        if (json) {
          printJson(result);
        } else if (!options.quiet) {
          printHuman([
            `Dry run ${repoName}: ${result.created} to create, ${result.updated} to update, ${result.unchanged} unchanged, ${result.deleted} to delete`
          ]);
        }
        return;
      }

      const pathToFile = new Map(manifest.map((f) => [f.path, f]));
      const BATCH_BYTES = 4 * 1024 * 1024;
      const BATCH_FILES = 50;

      let totalCreated = 0;
      let totalUpdated = 0;
      let batch: Array<{ path: string; sha: string; content: string }> = [];
      let batchBytes = 0;

      async function flushBatch(): Promise<void> {
        if (batch.length === 0) return;
        const result = await client.uploadSyncFiles({
          repo: repoName,
          files: batch
        });
        totalCreated += result.created;
        totalUpdated += result.updated;
        batch = [];
        batchBytes = 0;
      }

      for (const toUpload of diff.toUpload) {
        const entry = pathToFile.get(toUpload.path);
        if (!entry) {
          throw new AppError(
            ErrorCode.INTERNAL,
            `Server asked to upload ${toUpload.path} but it was not in the local manifest`
          );
        }
        const content = await fsReadFile(entry.fullPath, 'utf8');
        const size = Buffer.byteLength(content, 'utf8');
        if (
          batch.length > 0 &&
          (batch.length >= BATCH_FILES || batchBytes + size > BATCH_BYTES)
        ) {
          await flushBatch();
        }
        batch.push({ path: toUpload.path, sha: toUpload.sha, content });
        batchBytes += size;
      }
      await flushBatch();

      const finalize = await client.finalizeSync({
        repo: repoName,
        files: manifestForServer
      });

      const result = {
        created: totalCreated,
        updated: totalUpdated,
        unchanged: diff.unchanged,
        deleted: finalize.deleted
      };

      if (json) {
        printJson(result);
      } else if (!options.quiet) {
        printHuman([
          `Synced ${repoName}: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged, ${result.deleted} deleted`
        ]);
      }
    } catch (error) {
      await handleCliFailure(error, json);
    }
  });

program
  .command('link')
  .description('Create an edge between two entities')
  .argument('<source-id>', 'source entity ID')
  .argument('<target-id>', 'target entity ID')
  .requiredOption('--relation <relation>', 'relationship type')
  .option('--confidence <n>', 'confidence score 0-1', '1.0')
  .option('--full-response', 'emit the full API response when used with --json')
  .action(async (sourceId, targetId, options, command) => {
    await runWithClient(command, async (client, json) => {
      const body = await client.createEdge({
        source_id: sourceId,
        target_id: targetId,
        relation: options.relation,
        confidence: Number(options.confidence)
      });

      if (json) {
        return options.fullResponse === true ? body : compactEdgeResponse(body);
      }
      return [
        `Linked ${shortId(sourceId)} → ${shortId(targetId)} (${options.relation})`
      ];
    });
  });

program
  .command('unlink')
  .description('Delete an edge')
  .argument('<edge-id>', 'edge ID')
  .action(async (edgeId, _options, command) => {
    await runWithClient(command, async (client, json) => {
      const body = await client.deleteEdge(edgeId);
      return json ? body : [`Deleted edge ${shortId(edgeId)}`];
    });
  });

program
  .command('expand')
  .description('Show graph neighborhood of an entity')
  .argument('<entity-id>', 'entity ID')
  .option('--depth <n>', 'traversal depth (1-3)', '1')
  .option('--relation <types>', 'comma-separated relation types')
  .option('--owner <owner>', 'owner filter')
  .option(
    '--full-response',
    'emit the full API response instead of compact default output when used with --json'
  )
  .option(
    '--toon',
    'emit compact TOON output for lower agent token use; formatting is applied in the CLI, not the API'
  )
  .action(async (entityId, options, command) => {
    await runWithClient(command, async (client, json) => {
      validateToonOptions(options, json);

      const relationTypes = parseCommaList(options.relation);
      const body = await client.expandGraph(entityId, {
        depth: Number(options.depth),
        ...(relationTypes !== undefined ? { relationTypes } : {}),
        ...(options.owner !== undefined ? { owner: options.owner } : {})
      });

      if (options.toon === true) {
        return graphResponseToToon(compactGraphResponse(body));
      }

      if (json) {
        return options.fullResponse === true
          ? body
          : compactGraphResponse(body);
      }

      const lines: string[] = [];
      lines.push(`Graph for ${shortId(entityId)}:`);
      lines.push(
        `  ${body.entities.length} entities, ${body.edges.length} edges`
      );
      for (const edge of body.edges) {
        lines.push(
          `  ${shortId(edge.source_id)} → ${shortId(edge.target_id)} (${edge.relation})`
        );
      }
      return lines;
    });
  });

await program.parseAsync(process.argv);

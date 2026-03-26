import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
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
import { AppError, ErrorCode } from '../util/errors.js';

function formatStoredEntity(entity: {
  id: string;
  type: string;
  content: string | null;
  status: string | null;
  visibility: string;
  tags: string[];
}) {
  return [
    `${entity.type} ${shortId(entity.id)}${entity.status ? ` [${entity.status}]` : ''}`,
    `visibility: ${entity.visibility}`,
    `tags: ${entity.tags.join(', ') || '-'}`,
    entity.content ? `content: ${entity.content}` : 'content: -'
  ];
}

function formatSearchResults(results: Array<{
  entity: { id: string; type: string; content: string | null };
  score: number;
  chunk_content: string;
}>) {
  if (results.length === 0) {
    return ['No results'];
  }

  const lines: string[] = [];
  for (const result of results) {
    lines.push(
      `${result.entity.type} ${shortId(result.entity.id)} score=${result.score.toFixed(3)}`
    );
    lines.push(`  ${result.chunk_content}`);
    if (result.entity.content && result.entity.content !== result.chunk_content) {
      lines.push(`  entity: ${result.entity.content}`);
    }
  }

  return lines;
}

function formatTaskList(items: Array<{ id: string; content: string | null; status: string | null; metadata: Record<string, unknown> }>) {
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

async function resolveStoreContent(content: string | undefined): Promise<string> {
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
  handler: (client: ReturnType<typeof createPgmClient>, json: boolean) => Promise<T>
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

async function runBackup(output: string | undefined, encrypt: boolean): Promise<void> {
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
  .description('Postgram human CLI')
  .option('--json', 'emit JSON output');

program
  .command('store')
  .description('Store an entity')
  .argument('[content]', 'entity content')
  .option('--type <type>', 'entity type', 'memory')
  .option('--visibility <visibility>', 'entity visibility', 'shared')
  .option('--status <status>', 'entity status')
  .option('--tags <tags>', 'comma-separated tags')
  .option('--metadata <json>', 'JSON metadata object')
  .action(async (content, options, command) => {
    await runWithClient(command, async (client, json) => {
      const body = await client.storeEntity({
        type: options.type,
        content: await resolveStoreContent(content),
        visibility: options.visibility,
        status: options.status,
        tags: parseCommaList(options.tags),
        metadata: parseJsonObject(options.metadata)
      });

      return json
        ? body
        : formatStoredEntity({
            id: body.entity.id,
            type: body.entity.type,
            content: body.entity.content,
            status: body.entity.status,
            visibility: body.entity.visibility,
            tags: body.entity.tags
          });
    });
  });

program
  .command('search')
  .description('Search stored entities')
  .argument('query', 'search query')
  .option('--type <type>', 'entity type')
  .option('--tags <tags>', 'comma-separated tags')
  .option('--limit <limit>', 'result limit', '10')
  .option('--threshold <threshold>', 'similarity threshold', '0.35')
  .option('--recency-weight <recencyWeight>', 'recency weight', '0.1')
  .action(async (query, options, command) => {
    await runWithClient(command, async (client, json) => {
      const body = await client.searchEntities({
        query,
        type: options.type,
        tags: parseCommaList(options.tags),
        limit: Number(options.limit),
        threshold: Number(options.threshold),
        recency_weight: Number(options.recencyWeight)
      });

      return json ? body : formatSearchResults(body.results);
    });
  });

program
  .command('recall')
  .description('Recall an entity by ID')
  .argument('id', 'entity ID')
  .action(async (id, _options, command) => {
    await runWithClient(command, async (client, json) => {
      const body = await client.recallEntity(id);
      return json ? body : formatStoredEntity(body.entity);
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
  .option('--metadata <json>', 'JSON metadata object')
  .option('--version <version>', 'expected version')
  .option('--force', 'retry using the latest version on conflict')
  .action(async (id, options, command) => {
    await runWithClient(command, async (client, json) => {
      const payload = {
        content: options.content,
        visibility: options.visibility,
        status: options.status,
        tags: parseCommaList(options.tags),
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

      return json ? body : formatStoredEntity(body.entity);
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
  .action(async (content, options, command) => {
    await runWithClient(command, async (client, json) => {
      const taskContent = await resolveStoreContent(content);
      const body = await client.createTask({
        content: taskContent,
        context: options.context,
        status: options.status,
        due_date: options.due,
        tags: parseCommaList(options.tags)
      });

      return json
        ? body
        : formatStoredEntity({
            id: body.entity.id,
            type: body.entity.type,
            content: body.entity.content,
            status: body.entity.status,
            visibility: body.entity.visibility,
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
  .action(async (options, command) => {
    await runWithClient(command, async (client, json) => {
      const body = await client.listTasks({
        status: options.status,
        context: options.context,
        limit: Number(options.limit),
        offset: Number(options.offset)
      });

      return json ? body : formatTaskList(body.items);
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
  .option('--version <version>', 'expected version', '')
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
        tags: parseCommaList(options.tags)
      });

      return json
        ? body
        : formatStoredEntity({
            id: body.entity.id,
            type: body.entity.type,
            content: body.entity.content,
            status: body.entity.status,
            visibility: body.entity.visibility,
            tags: body.entity.tags
          });
    });
  });

taskCommand
  .command('complete')
  .description('Mark a task complete')
  .argument('id', 'task ID')
  .option('--version <version>', 'expected version')
  .action(async (id, options, command) => {
    await runWithClient(command, async (client, json) => {
      if (options.version === undefined) {
        throw new AppError(ErrorCode.VALIDATION, '--version is required');
      }

      const body = await client.completeTask(id, Number(options.version));
      return json
        ? body
        : formatStoredEntity({
            id: body.entity.id,
            type: body.entity.type,
            content: body.entity.content,
            status: body.entity.status,
            visibility: body.entity.visibility,
            tags: body.entity.tags
          });
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

await program.parseAsync(process.argv);

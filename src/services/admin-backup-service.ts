import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AppConfig } from '../config.js';
import { AppError, ErrorCode } from '../util/errors.js';

export type AdminBackupCommandRunnerInput = {
  command: string;
  args: string[];
  cwd?: string | undefined;
  env: NodeJS.ProcessEnv;
};

export type AdminBackupCommandRunnerResult = {
  stdout: string;
};

export type AdminBackupCommandRunner = (
  input: AdminBackupCommandRunnerInput
) => Promise<AdminBackupCommandRunnerResult | void>;

export type AdminBackupArchive = {
  filePath: string;
  filename: string;
  generatedAt: string;
  sizeBytes: number;
  cleanup: () => Promise<void>;
};

export type CreateAdminBackupInput = {
  databaseUrl: string;
  runtimeConfig?: AppConfig | undefined;
  now?: Date | undefined;
  commandRunner?: AdminBackupCommandRunner | undefined;
  pgDumpPath?: string | undefined;
  tarPath?: string | undefined;
};

export type AdminBackupDatabaseDescriptor = {
  name: string;
  host: string;
  port: string;
  user: string | null;
  redactedUrl: string;
};

export type AdminBackupSwitchOverInstructions = {
  dockerCompose: string[];
  emergencyRollback: string[];
};

export type AdminBackupRestoreVerification = {
  migrations: 'passed';
  health: 'connected';
};

export type AdminBackupRestoreVerifier = (input: {
  databaseUrl: string;
  stagingDatabaseName: string;
}) => Promise<AdminBackupRestoreVerification>;

export type ValidatedAdminBackupRestore = {
  token: string;
  expiresAt: string;
  rootDir: string;
  databaseDumpPath: string;
  stagingDatabaseName: string;
  manifest: {
    id: string | null;
    generatedAt: string | null;
    formatVersion: number;
  };
  sourceDatabase: AdminBackupDatabaseDescriptor;
  validation: {
    archive: 'passed';
    pgRestoreList: 'passed';
    entries: number;
  };
  switchOver: AdminBackupSwitchOverInstructions;
  cleanup: () => Promise<void>;
};

export type PrepareAdminBackupRestoreInput = {
  filename: string;
  data: Buffer;
  databaseUrl: string;
  now?: Date | undefined;
  commandRunner?: AdminBackupCommandRunner | undefined;
  tarPath?: string | undefined;
  pgRestorePath?: string | undefined;
  tokenTtlMs?: number | undefined;
};

export type StageAdminBackupRestoreInput = {
  restore: ValidatedAdminBackupRestore;
  databaseUrl: string;
  verifier: AdminBackupRestoreVerifier;
  commandRunner?: AdminBackupCommandRunner | undefined;
  createdbPath?: string | undefined;
  dropdbPath?: string | undefined;
  pgRestorePath?: string | undefined;
};

export type StagedAdminBackupRestore = {
  status: 'staged';
  stagingDatabaseName: string;
  sourceDatabase: AdminBackupDatabaseDescriptor;
  verification: AdminBackupRestoreVerification;
  switchOver: AdminBackupSwitchOverInstructions;
};

const SAFE_RUNTIME_CONFIG_KEYS = [
  'PORT',
  'OAUTH_ENABLED',
  'PUBLIC_BASE_URL',
  'LOG_LEVEL',
  'ENRICHMENT_POLL_INTERVAL_MS',
  'EXTRACTION_ENABLED',
  'EXTRACTION_MEMORY_MODE',
  'EXTRACTION_PROVIDER',
  'EXTRACTION_MODEL',
  'EXTRACTION_BASE_URL',
  'EXTRACTION_DISABLE_THINKING',
  'EXTRACTION_REASONING_EFFORT',
  'EXTRACTION_AUTO_CREATE_ENTITIES',
  'EXTRACTION_AUTO_CREATE_TYPES',
  'EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE',
  'EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE_BY_TYPE',
  'EXTRACTION_MATCH_MIN_SIMILARITY',
  'EXTRACTION_MIN_CONTENT_CHARS',
  'EXTRACTION_DEBUG_LOG',
  'EXTRACTION_SEMANTIC_NEIGHBORS_ENABLED',
  'EXTRACTION_SEMANTIC_NEIGHBORS_MAX',
  'EXTRACTION_SEMANTIC_NEIGHBORS_MIN_SIMILARITY',
  'OLLAMA_BASE_URL',
  'EMBEDDING_PROVIDER',
  'EMBEDDING_MODEL',
  'EMBEDDING_DIMENSIONS',
  'EMBEDDING_BASE_URL'
] as const satisfies readonly (keyof AppConfig)[];

function decodeUrlPart(value: string): string {
  return decodeURIComponent(value.replace(/\+/gu, '%20'));
}

function encodePathPart(value: string): string {
  return encodeURIComponent(value).replace(/%2F/giu, '/');
}

export function postgresEnvFromDatabaseUrl(
  databaseUrl: string
): NodeJS.ProcessEnv {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new AppError(
      ErrorCode.VALIDATION,
      'DATABASE_URL is not a valid PostgreSQL connection string'
    );
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new AppError(
      ErrorCode.VALIDATION,
      'DATABASE_URL must use postgres:// or postgresql://'
    );
  }

  const database = decodeUrlPart(parsed.pathname.replace(/^\//u, ''));
  if (!database) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'DATABASE_URL must include a database name for admin backup'
    );
  }

  const env: NodeJS.ProcessEnv = {
    PGDATABASE: database,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGCONNECT_TIMEOUT: '10'
  };

  if (parsed.username) {
    env.PGUSER = decodeUrlPart(parsed.username);
  }
  if (parsed.password) {
    env.PGPASSWORD = decodeUrlPart(parsed.password);
  }
  const sslMode = parsed.searchParams.get('sslmode');
  if (sslMode) {
    env.PGSSLMODE = sslMode;
  }

  return env;
}

function parsePostgresUrl(databaseUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new AppError(
      ErrorCode.VALIDATION,
      'DATABASE_URL is not a valid PostgreSQL connection string'
    );
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new AppError(
      ErrorCode.VALIDATION,
      'DATABASE_URL must use postgres:// or postgresql://'
    );
  }

  return parsed;
}

export function databaseDescriptorFromUrl(
  databaseUrl: string
): AdminBackupDatabaseDescriptor {
  const parsed = parsePostgresUrl(databaseUrl);
  const name = decodeUrlPart(parsed.pathname.replace(/^\//u, ''));
  if (!name) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'DATABASE_URL must include a database name for admin restore'
    );
  }

  const redacted = new URL(parsed.toString());
  if (redacted.password) {
    redacted.password = '***';
  }

  return {
    name,
    host: parsed.hostname,
    port: parsed.port || '5432',
    user: parsed.username ? decodeUrlPart(parsed.username) : null,
    redactedUrl: redacted.toString()
  };
}

export function databaseUrlWithDatabaseName(
  databaseUrl: string,
  databaseName: string
): string {
  const parsed = parsePostgresUrl(databaseUrl);
  parsed.pathname = `/${encodePathPart(databaseName)}`;
  return parsed.toString();
}

function redactedRuntimeConfig(
  runtimeConfig: AppConfig | undefined
): Record<string, unknown> {
  if (!runtimeConfig) {
    return {};
  }

  return Object.fromEntries(
    SAFE_RUNTIME_CONFIG_KEYS.flatMap((key) => {
      const value = runtimeConfig[key];
      return value === undefined ? [] : [[key, value]];
    })
  );
}

function backupFilename(generatedAt: string): string {
  return `postgram-backup-${generatedAt.replace(/[:.]/gu, '-')}.tar.gz`;
}

async function defaultCommandRunner(
  input: AdminBackupCommandRunnerInput
): Promise<AdminBackupCommandRunnerResult> {
  return await new Promise<AdminBackupCommandRunnerResult>((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const child = spawn(input.command, input.args, {
      env: input.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(input.cwd ? { cwd: input.cwd } : {})
    });

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on('error', (error: Error) => {
      reject(error);
    });
    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf8')
        });
        return;
      }

      const stderr = Buffer.concat(stderrChunks).toString('utf8').slice(0, 8000);
      reject(
        new AppError(
          ErrorCode.INTERNAL,
          `${input.command} failed during admin backup`,
          {
            exitCode: code,
            stderr
          }
        )
      );
    });
  });
}

export async function createAdminBackupArchive(
  input: CreateAdminBackupInput
): Promise<AdminBackupArchive> {
  const generatedAt = (input.now ?? new Date()).toISOString();
  const rootDir = await mkdtemp(join(tmpdir(), 'postgram-admin-backup-'));
  const payloadDir = join(rootDir, 'payload');
  const databaseDumpPath = join(payloadDir, 'database.dump');
  const manifestPath = join(payloadDir, 'manifest.json');
  const configurationPath = join(payloadDir, 'configuration.json');
  const filename = backupFilename(generatedAt);
  const archivePath = join(rootDir, filename);
  const commandRunner = input.commandRunner ?? defaultCommandRunner;

  try {
    await mkdir(payloadDir);
    const dumpEnv = {
      ...process.env,
      ...postgresEnvFromDatabaseUrl(input.databaseUrl)
    };

    await commandRunner({
      command: input.pgDumpPath ?? 'pg_dump',
      args: [
        '--format=custom',
        '--blobs',
        '--no-owner',
        '--no-acl',
        '--file',
        databaseDumpPath
      ],
      env: dumpEnv
    });

    const manifest = {
      formatVersion: 1,
      id: randomUUID(),
      generatedAt,
      product: 'postgram',
      contents: [
        {
          path: 'database.dump',
          type: 'postgres_custom_dump',
          validation: 'Run pg_restore --list before restore.'
        },
        {
          path: 'configuration.json',
          type: 'redacted_runtime_configuration',
          validation: 'Confirm target runtime values before restore.'
        }
      ],
      restoreGuidance: {
        directRestore: false,
        recommendedFlow: [
          'Validate manifest.json and pg_restore --list database.dump.',
          'Restore into a fresh staging database name.',
          'Run Postgram migrations and health checks against the staged database.',
          'After operator approval, switch the app to the staged database and archive the old database.'
        ]
      }
    };
    const configuration = {
      generatedAt,
      secretPolicy: 'secrets are redacted here; encrypted DB-backed secrets are included only inside database.dump',
      runtime: redactedRuntimeConfig(input.runtimeConfig)
    };

    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    await writeFile(configurationPath, JSON.stringify(configuration, null, 2));

    await commandRunner({
      command: input.tarPath ?? 'tar',
      args: [
        '-czf',
        archivePath,
        '-C',
        payloadDir,
        'manifest.json',
        'configuration.json',
        'database.dump'
      ],
      env: process.env
    });

    const archiveStat = await stat(archivePath);
    return {
      filePath: archivePath,
      filename,
      generatedAt,
      sizeBytes: archiveStat.size,
      cleanup: () => rm(rootDir, { recursive: true, force: true })
    };
  } catch (error) {
    await rm(rootDir, { recursive: true, force: true });
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(ErrorCode.INTERNAL, 'Unable to create admin backup', {
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(raw: string, name: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new AppError(ErrorCode.VALIDATION, `${name} is not valid JSON`);
  }

  if (!isRecord(parsed)) {
    throw new AppError(ErrorCode.VALIDATION, `${name} must be a JSON object`);
  }

  return parsed;
}

function hasArchivePath(
  contents: unknown,
  path: string,
  type: string
): boolean {
  return (
    Array.isArray(contents) &&
    contents.some(
      (entry) =>
        isRecord(entry) && entry.path === path && entry.type === type
    )
  );
}

async function readAndValidateManifest(
  manifestPath: string,
  configurationPath: string
): Promise<ValidatedAdminBackupRestore['manifest']> {
  const manifest = parseJsonObject(
    await readFile(manifestPath, 'utf8'),
    'manifest.json'
  );
  parseJsonObject(await readFile(configurationPath, 'utf8'), 'configuration.json');

  if (manifest.product !== 'postgram') {
    throw new AppError(
      ErrorCode.VALIDATION,
      'Backup manifest is not a Postgram backup'
    );
  }
  if (manifest.formatVersion !== 1) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'Unsupported Postgram backup format version'
    );
  }
  if (
    !hasArchivePath(
      manifest.contents,
      'database.dump',
      'postgres_custom_dump'
    ) ||
    !hasArchivePath(
      manifest.contents,
      'configuration.json',
      'redacted_runtime_configuration'
    )
  ) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'Backup archive is missing expected database/configuration entries'
    );
  }

  return {
    id: typeof manifest.id === 'string' ? manifest.id : null,
    generatedAt:
      typeof manifest.generatedAt === 'string' ? manifest.generatedAt : null,
    formatVersion: 1
  };
}

function countPgRestoreListEntries(stdout: string | undefined): number {
  if (!stdout) {
    return 0;
  }
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith(';')).length;
}

function formatStagingDatabaseName(now: Date, token: string): string {
  const stamp = now
    .toISOString()
    .slice(0, 19)
    .replace(/[-:]/gu, '')
    .replace('T', '_');
  return `postgram_restore_${stamp}_${token.replaceAll('-', '').slice(0, 8)}`;
}

function buildSwitchOverInstructions(input: {
  sourceDatabase: AdminBackupDatabaseDescriptor;
  stagingDatabaseName: string;
  stagingRedactedUrl: string;
}): AdminBackupSwitchOverInstructions {
  return {
    dockerCompose: [
      `For Docker Compose default wiring, run: POSTGRES_DB=${input.stagingDatabaseName} docker compose up -d mcp-server postgram-ui`,
      `If you use DATABASE_URL directly, update it to ${input.stagingRedactedUrl} and restart the API/UI services.`,
      'Keep the old database untouched until you have checked the restored admin UI, health page, search, and memory recall.'
    ],
    emergencyRollback: [
      `To roll back, restore the previous POSTGRES_DB=${input.sourceDatabase.name} setting and restart mcp-server/postgram-ui.`,
      `If you use DATABASE_URL directly, set it back to ${input.sourceDatabase.redactedUrl} and restart the API/UI services.`,
      'Do not drop either database until you have confirmed the app is stable on the chosen database.'
    ]
  };
}

export async function prepareAdminBackupRestore(
  input: PrepareAdminBackupRestoreInput
): Promise<ValidatedAdminBackupRestore> {
  const now = input.now ?? new Date();
  const token = randomUUID();
  const expiresAt = new Date(
    now.getTime() + (input.tokenTtlMs ?? 30 * 60 * 1000)
  ).toISOString();
  const rootDir = await mkdtemp(join(tmpdir(), 'postgram-admin-restore-'));
  const archivePath = join(rootDir, 'backup.tar.gz');
  const payloadDir = join(rootDir, 'payload');
  const manifestPath = join(payloadDir, 'manifest.json');
  const configurationPath = join(payloadDir, 'configuration.json');
  const databaseDumpPath = join(payloadDir, 'database.dump');
  const commandRunner = input.commandRunner ?? defaultCommandRunner;

  try {
    await mkdir(payloadDir);
    await writeFile(archivePath, input.data);
    await commandRunner({
      command: input.tarPath ?? 'tar',
      args: [
        '-xzf',
        archivePath,
        '-C',
        payloadDir,
        'manifest.json',
        'configuration.json',
        'database.dump'
      ],
      env: process.env
    });

    const manifest = await readAndValidateManifest(
      manifestPath,
      configurationPath
    );
    await stat(databaseDumpPath);
    const pgRestoreList = await commandRunner({
      command: input.pgRestorePath ?? 'pg_restore',
      args: ['--list', databaseDumpPath],
      env: process.env
    });

    const sourceDatabase = databaseDescriptorFromUrl(input.databaseUrl);
    const stagingDatabaseName = formatStagingDatabaseName(now, token);
    const stagingRedactedUrl = databaseDescriptorFromUrl(
      databaseUrlWithDatabaseName(input.databaseUrl, stagingDatabaseName)
    ).redactedUrl;
    return {
      token,
      expiresAt,
      rootDir,
      databaseDumpPath,
      stagingDatabaseName,
      manifest,
      sourceDatabase,
      validation: {
        archive: 'passed',
        pgRestoreList: 'passed',
        entries: countPgRestoreListEntries(pgRestoreList?.stdout)
      },
      switchOver: buildSwitchOverInstructions({
        sourceDatabase,
        stagingDatabaseName,
        stagingRedactedUrl
      }),
      cleanup: () => rm(rootDir, { recursive: true, force: true })
    };
  } catch (error) {
    await rm(rootDir, { recursive: true, force: true });
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(ErrorCode.VALIDATION, 'Unable to validate backup archive', {
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function stageAdminBackupRestore(
  input: StageAdminBackupRestoreInput
): Promise<StagedAdminBackupRestore> {
  const commandRunner = input.commandRunner ?? defaultCommandRunner;
  const env = {
    ...process.env,
    ...postgresEnvFromDatabaseUrl(input.databaseUrl)
  };
  const stagingDatabaseUrl = databaseUrlWithDatabaseName(
    input.databaseUrl,
    input.restore.stagingDatabaseName
  );

  try {
    await commandRunner({
      command: input.createdbPath ?? 'createdb',
      args: [input.restore.stagingDatabaseName],
      env
    });
    await commandRunner({
      command: input.pgRestorePath ?? 'pg_restore',
      args: [
        '--no-owner',
        '--no-acl',
        '--dbname',
        input.restore.stagingDatabaseName,
        input.restore.databaseDumpPath
      ],
      env
    });
    const verification = await input.verifier({
      databaseUrl: stagingDatabaseUrl,
      stagingDatabaseName: input.restore.stagingDatabaseName
    });

    return {
      status: 'staged',
      stagingDatabaseName: input.restore.stagingDatabaseName,
      sourceDatabase: input.restore.sourceDatabase,
      verification,
      switchOver: input.restore.switchOver
    };
  } catch (error) {
    await commandRunner({
      command: input.dropdbPath ?? 'dropdb',
      args: ['--if-exists', input.restore.stagingDatabaseName],
      env
    }).catch(() => undefined);
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      ErrorCode.INTERNAL,
      'Unable to restore backup into staging database',
      {
        message: error instanceof Error ? error.message : String(error)
      }
    );
  } finally {
    await input.restore.cleanup();
  }
}

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
  pgRestorePath?: string | undefined;
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
  restoreListPath: string;
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
  psqlPath?: string | undefined;
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

/**
 * Tables whose data every format-version-2 archive must contain.
 *
 * This is the v2 baseline and must not be extended. A restore requires every
 * entry here, so adding a table would make archives taken by older Postgram
 * versions unrestorable. Tables introduced after the baseline belong in
 * ADMIN_BACKUP_OPTIONAL_DATA_TABLES instead.
 */
const ADMIN_BACKUP_REQUIRED_DATA_TABLES = [
  'admin_auth_attempts',
  'admin_bootstrap_tokens',
  'admin_job_events',
  'admin_jobs',
  'admin_mfa_factors',
  'admin_onboarding_state',
  'admin_runtime_secrets',
  'admin_runtime_settings',
  'admin_sessions',
  'admin_users',
  'api_keys',
  'audit_log',
  'chunks',
  'document_sources',
  'edges',
  'embedding_models',
  'entities',
  'oauth_authorization_codes',
  'oauth_clients',
  'oauth_tokens'
] as const;

/**
 * Tables added after the v2 baseline (migration 018_workspace_tracking).
 *
 * New backups include their data and a restore applies it, but an archive
 * taken before these tables existed is still a valid archive, so they are
 * accepted when present rather than required.
 */
const ADMIN_BACKUP_OPTIONAL_DATA_TABLES = [
  'machines',
  'workspaces',
  'agent_sessions',
  'repositories'
] as const;

/**
 * Tables deliberately kept out of backups because their contents are derived
 * and rebuilt at runtime.
 *
 * New dumps exclude their data. Archives that already contain it stay valid,
 * and the data is dropped from the restore list rather than applied.
 *
 * `query_embedding_cache` is a pure memo of (client, model, query digest) ->
 * embedding (migration 015). It is also the only table holding digests of user
 * query text, which is reason enough not to ship it inside a downloadable
 * archive. `schema_migrations` is owned by the migration runner, which rebuilds
 * it while migrating the staging database.
 */
const ADMIN_BACKUP_EXCLUDED_DATA_TABLES = [
  'query_embedding_cache',
  'schema_migrations'
] as const;

/**
 * Every table whose data a backup carries and a restore may apply.
 */
const ADMIN_BACKUP_DATA_TABLES = [
  ...ADMIN_BACKUP_REQUIRED_DATA_TABLES,
  ...ADMIN_BACKUP_OPTIONAL_DATA_TABLES
] as const;

const ADMIN_BACKUP_DATA_TABLE_SET = new Set<string>(ADMIN_BACKUP_DATA_TABLES);

const ADMIN_BACKUP_EXCLUDED_DATA_TABLE_SET = new Set<string>(
  ADMIN_BACKUP_EXCLUDED_DATA_TABLES
);

/**
 * How every table in the Postgram schema is treated by backup and restore.
 *
 * Exported so a test can assert that each table created by a migration is
 * classified here. That assertion is the guard against the drift this
 * classification exists to prevent: before it, a new migration silently
 * produced archives that the restore validator rejected.
 */
export const adminBackupTableClassification = {
  required: ADMIN_BACKUP_REQUIRED_DATA_TABLES,
  optional: ADMIN_BACKUP_OPTIONAL_DATA_TABLES,
  excluded: ADMIN_BACKUP_EXCLUDED_DATA_TABLES
} as const;

const PG_RESTORE_TABLE_DATA_ENTRY =
  /^\d+;\s+\d+\s+\d+\s+TABLE DATA public ([a-z_][a-z0-9_]*) \S+$/u;

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
        '--data-only',
        '--no-blobs',
        '--no-owner',
        '--no-acl',
        ...ADMIN_BACKUP_EXCLUDED_DATA_TABLES.map(
          (table) => `--exclude-table-data=public.${table}`
        ),
        '--file',
        databaseDumpPath
      ],
      env: dumpEnv
    });

    // Validate the archive we just produced against the same rules the restore
    // path applies. Without this, a migration that adds a table produces
    // backups that look successful and only fail much later, during an actual
    // recovery, which is the failure mode reported in issue #131.
    const generatedToc = await commandRunner({
      command: input.pgRestorePath ?? 'pg_restore',
      args: ['--list', databaseDumpPath],
      env: process.env
    });
    assertGeneratedBackupIsRestorable(generatedToc?.stdout);

    const manifest = {
      formatVersion: 2,
      id: randomUUID(),
      generatedAt,
      product: 'postgram',
      contents: [
        {
          path: 'database.dump',
          type: 'postgres_custom_data_dump',
          validation:
            'Require a data-only pg_restore TOC containing only approved Postgram tables.'
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
          'Validate manifest.json and the data-only pg_restore TOC for database.dump.',
          'Restore into a fresh staging database name.',
          'Create the trusted schema from Postgram migrations, restore approved table data, and run health checks.',
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
  if (manifest.formatVersion !== 2) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'Unsupported Postgram backup format version'
    );
  }
  if (
    !hasArchivePath(
      manifest.contents,
      'database.dump',
      'postgres_custom_data_dump'
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
    formatVersion: 2
  };
}

function validatePgRestoreDataList(stdout: string | undefined): {
  entries: number;
  restoreList: string;
} {
  const restoreEntries = (stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith(';'));

  if (restoreEntries.length === 0) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'Backup database dump has no restorable Postgram table data'
    );
  }

  const seenTables = new Set<string>();
  const restorableEntries: string[] = [];
  for (const entry of restoreEntries) {
    const match = PG_RESTORE_TABLE_DATA_ENTRY.exec(entry);
    const tableName = match?.[1];
    // Every entry must be TABLE DATA for a table this version knows about.
    // Anything else - a FUNCTION, TRIGGER, EXTENSION, an unrecognised object
    // class, or a malformed row - is refused rather than ignored, because
    // pg_restore would execute it against the staging database that the
    // operator is then told to point the live application at.
    if (
      !tableName ||
      (!ADMIN_BACKUP_DATA_TABLE_SET.has(tableName) &&
        !ADMIN_BACKUP_EXCLUDED_DATA_TABLE_SET.has(tableName))
    ) {
      throw new AppError(
        ErrorCode.VALIDATION,
        'Backup database dump contains unsupported or active PostgreSQL objects'
      );
    }
    if (seenTables.has(tableName)) {
      throw new AppError(
        ErrorCode.VALIDATION,
        'Backup database dump contains duplicate table data entries'
      );
    }
    seenTables.add(tableName);
    // Data for an excluded table is tolerated so that archives taken before
    // the exclusion existed stay restorable, but it is never applied.
    if (!ADMIN_BACKUP_EXCLUDED_DATA_TABLE_SET.has(tableName)) {
      restorableEntries.push(entry);
    }
  }

  const missingTables = ADMIN_BACKUP_REQUIRED_DATA_TABLES.filter(
    (table) => !seenTables.has(table)
  );
  if (missingTables.length > 0) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'Backup database dump is missing required Postgram table data',
      { missingTables }
    );
  }

  if (restorableEntries.length === 0) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'Backup database dump has no restorable Postgram table data'
    );
  }

  return {
    entries: restorableEntries.length,
    restoreList: `${restorableEntries.join('\n')}\n`
  };
}

/**
 * Fail a backup that this build's own restore path would refuse.
 *
 * Reported as INTERNAL rather than VALIDATION: nothing about the operator's
 * request is wrong, the server produced an archive it cannot restore.
 */
function assertGeneratedBackupIsRestorable(stdout: string | undefined): void {
  try {
    validatePgRestoreDataList(stdout);
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError(
        ErrorCode.INTERNAL,
        'Generated backup would not pass Postgram restore validation, so it was discarded instead of being returned. A migration has probably added a table that is not yet classified in admin-backup-service.',
        { reason: error.message, details: error.details }
      );
    }
    throw error;
  }
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
  const restoreListPath = join(rootDir, 'restore.list');
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
    const validatedRestoreList = validatePgRestoreDataList(
      pgRestoreList?.stdout
    );
    await writeFile(restoreListPath, validatedRestoreList.restoreList);

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
      restoreListPath,
      stagingDatabaseName,
      manifest,
      sourceDatabase,
      validation: {
        archive: 'passed',
        pgRestoreList: 'passed',
        entries: validatedRestoreList.entries
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
    await input.verifier({
      databaseUrl: stagingDatabaseUrl,
      stagingDatabaseName: input.restore.stagingDatabaseName
    });
    await commandRunner({
      command: input.psqlPath ?? 'psql',
      args: [
        '--dbname',
        input.restore.stagingDatabaseName,
        '--command',
        `TRUNCATE TABLE ${ADMIN_BACKUP_DATA_TABLES.map((table) => `public.${table}`).join(', ')} RESTART IDENTITY CASCADE`
      ],
      env
    });
    await commandRunner({
      command: input.pgRestorePath ?? 'pg_restore',
      args: [
        '--data-only',
        '--no-owner',
        '--no-acl',
        '--exit-on-error',
        '--use-list',
        input.restore.restoreListPath,
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

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  adminBackupTableClassification,
  createAdminBackupArchive,
  prepareAdminBackupRestore,
  stageAdminBackupRestore,
  type AdminBackupCommandRunner,
  type AdminBackupCommandRunnerInput,
  type AdminBackupCommandRunnerResult
} from '../../src/services/admin-backup-service.js';

const DATABASE_URL = 'postgresql://postgram:s3cret@db.example.test:5544/postgram';

const RESTORED_TABLES = [
  ...adminBackupTableClassification.required,
  ...adminBackupTableClassification.optional
];

function tocEntry(table: string, index: number): string {
  return `${3356 + index}; 0 ${16385 + index} TABLE DATA public ${table} postgram`;
}

function tocFor(tables: readonly string[]): string {
  return tables.map((table, index) => tocEntry(table, index)).join('\n');
}

/** A dump produced by a current, correctly classified schema. */
function currentToc(): string {
  return tocFor(RESTORED_TABLES);
}

/** A dump from a Postgram older than migration 018_workspace_tracking. */
function legacyToc(): string {
  return tocFor(adminBackupTableClassification.required);
}

type BackupHarness = {
  commands: AdminBackupCommandRunnerInput[];
  runner: AdminBackupCommandRunner;
};

function backupHarness(toc: string): BackupHarness {
  const commands: AdminBackupCommandRunnerInput[] = [];
  const runner: AdminBackupCommandRunner = async (
    input
  ): Promise<AdminBackupCommandRunnerResult | void> => {
    commands.push(input);
    if (input.command === 'pg_dump') {
      const outputPath = input.args[input.args.indexOf('--file') + 1];
      if (!outputPath) {
        throw new Error('pg_dump output path missing');
      }
      await writeFile(outputPath, 'fake custom pg dump');
      return;
    }
    if (input.command === 'pg_restore' && input.args.includes('--list')) {
      return { stdout: `${toc}\n` };
    }
    if (input.command === 'tar') {
      const outputPath = input.args[input.args.indexOf('-czf') + 1];
      if (!outputPath) {
        throw new Error('tar output path missing');
      }
      await writeFile(outputPath, 'fake gzipped backup archive');
      return;
    }
    throw new Error(`Unexpected command ${input.command}`);
  };
  return { commands, runner };
}

type RestoreHarness = {
  commands: AdminBackupCommandRunnerInput[];
  runner: AdminBackupCommandRunner;
};

function restoreHarness(toc: string): RestoreHarness {
  const commands: AdminBackupCommandRunnerInput[] = [];
  const runner: AdminBackupCommandRunner = async (
    input
  ): Promise<AdminBackupCommandRunnerResult | void> => {
    commands.push(input);
    if (input.command === 'tar') {
      const outputDir = input.args[input.args.indexOf('-C') + 1];
      if (!outputDir) {
        throw new Error('tar extraction directory missing');
      }
      await mkdir(outputDir, { recursive: true });
      await writeFile(
        join(outputDir, 'manifest.json'),
        JSON.stringify({
          formatVersion: 2,
          id: 'backup-id',
          product: 'postgram',
          generatedAt: '2026-11-10T08:00:00.000Z',
          contents: [
            { path: 'database.dump', type: 'postgres_custom_data_dump' },
            {
              path: 'configuration.json',
              type: 'redacted_runtime_configuration'
            }
          ]
        })
      );
      await writeFile(join(outputDir, 'configuration.json'), '{}');
      await writeFile(join(outputDir, 'database.dump'), 'fake dump');
      return;
    }
    if (input.command === 'pg_restore' && input.args.includes('--list')) {
      return { stdout: `${toc}\n` };
    }
    return;
  };
  return { commands, runner };
}

async function prepare(toc: string) {
  const harness = restoreHarness(toc);
  const restore = await prepareAdminBackupRestore({
    filename: 'postgram-backup.tar.gz',
    data: Buffer.from('archive'),
    databaseUrl: DATABASE_URL,
    commandRunner: harness.runner
  });
  return { restore, commands: harness.commands };
}

describe('admin backup creation', () => {
  it('excludes data for every derived table from the dump', async () => {
    const harness = backupHarness(currentToc());
    const archive = await createAdminBackupArchive({
      databaseUrl: DATABASE_URL,
      commandRunner: harness.runner
    });
    await archive.cleanup();

    const dumpArgs = harness.commands[0]?.args ?? [];
    for (const table of adminBackupTableClassification.excluded) {
      expect(dumpArgs).toContain(`--exclude-table-data=public.${table}`);
    }
  });

  it('validates its own dump against the restore rules before writing the archive', async () => {
    const harness = backupHarness(currentToc());
    const archive = await createAdminBackupArchive({
      databaseUrl: DATABASE_URL,
      commandRunner: harness.runner
    });
    await archive.cleanup();

    expect(harness.commands.map((command) => command.command)).toEqual([
      'pg_dump',
      'pg_restore',
      'tar'
    ]);
    expect(harness.commands[1]?.args).toContain('--list');
  });

  it('fails the backup when the dump carries a table no version classifies', async () => {
    // Exactly the issue #131 shape: a migration adds a table, the dump picks
    // it up, and the restore validator would refuse the archive. The backup
    // must fail here rather than hand the operator an unrestorable file.
    const harness = backupHarness(
      `${currentToc()}\n${tocEntry('some_new_table', 99)}`
    );

    await expect(
      createAdminBackupArchive({
        databaseUrl: DATABASE_URL,
        commandRunner: harness.runner
      })
    ).rejects.toThrow(/would not pass Postgram restore validation/u);

    expect(harness.commands.map((command) => command.command)).not.toContain(
      'tar'
    );
  });

  it('fails the backup when the dump is missing a required table', async () => {
    const harness = backupHarness(
      tocFor(RESTORED_TABLES.filter((table) => table !== 'entities'))
    );

    await expect(
      createAdminBackupArchive({
        databaseUrl: DATABASE_URL,
        commandRunner: harness.runner
      })
    ).rejects.toThrow(/would not pass Postgram restore validation/u);
  });
});

describe('admin backup restore validation', () => {
  it('accepts a dump from the current schema and restores every classified table', async () => {
    const { restore } = await prepare(currentToc());
    const restoreList = await readFile(restore.restoreListPath, 'utf8');
    await restore.cleanup();

    expect(restore.validation.pgRestoreList).toBe('passed');
    expect(restore.validation.entries).toBe(RESTORED_TABLES.length);
    for (const table of RESTORED_TABLES) {
      expect(restoreList).toContain(` TABLE DATA public ${table} `);
    }
  });

  it('accepts an archive that still carries an excluded table and skips its data', async () => {
    // Archives taken before the exclusion existed stay restorable, but the
    // derived data is dropped instead of being applied.
    const { restore } = await prepare(
      `${currentToc()}\n${tocEntry('query_embedding_cache', 90)}`
    );
    const restoreList = await readFile(restore.restoreListPath, 'utf8');
    await restore.cleanup();

    expect(restoreList).not.toContain('query_embedding_cache');
    expect(restore.validation.entries).toBe(RESTORED_TABLES.length);
  });

  it('accepts an archive taken before the optional tables existed', async () => {
    const { restore } = await prepare(legacyToc());
    const restoreList = await readFile(restore.restoreListPath, 'utf8');
    await restore.cleanup();

    expect(restore.validation.entries).toBe(
      adminBackupTableClassification.required.length
    );
    for (const table of adminBackupTableClassification.optional) {
      expect(restoreList).not.toContain(` TABLE DATA public ${table} `);
    }
  });

  it('rejects an archive missing a required table and names it', async () => {
    const harness = restoreHarness(
      tocFor(RESTORED_TABLES.filter((table) => table !== 'api_keys'))
    );

    await expect(
      prepareAdminBackupRestore({
        filename: 'postgram-backup.tar.gz',
        data: Buffer.from('archive'),
        databaseUrl: DATABASE_URL,
        commandRunner: harness.runner
      })
    ).rejects.toThrow(/missing required Postgram table data/u);
  });

  it.each([
    {
      name: 'a function entry',
      entry: '218; 1255 16390 FUNCTION public evil() postgram'
    },
    {
      name: 'an event trigger entry',
      entry: '3210; 3466 16391 EVENT TRIGGER - evil_trigger postgram'
    },
    {
      name: 'a table definition entry',
      entry: '217; 1259 16385 TABLE public entities postgram'
    },
    {
      name: 'an unknown object class',
      entry: '42; 0 16385 MATERIALIZED VIEW DATA public entities postgram'
    },
    {
      name: 'a malformed row',
      entry: 'not-a-valid-pg-restore-entry'
    },
    {
      name: 'table data for an unclassified table',
      entry: '9001; 0 19999 TABLE DATA public pg_shadow_copy postgram'
    }
  ])(
    'refuses an uploaded archive containing $name rather than ignoring it',
    async ({ entry }) => {
      // pg_restore would execute a non-TABLE-DATA entry against the staging
      // database the operator is then told to point the live app at, so an
      // unrecognised entry must fail validation, never be skipped.
      const harness = restoreHarness(`${currentToc()}\n${entry}`);

      await expect(
        prepareAdminBackupRestore({
          filename: 'postgram-backup.tar.gz',
          data: Buffer.from('archive'),
          databaseUrl: DATABASE_URL,
          commandRunner: harness.runner
        })
      ).rejects.toThrow(/unsupported or active PostgreSQL objects/u);
    }
  );

  it('rejects a duplicate table data entry', async () => {
    const harness = restoreHarness(
      `${currentToc()}\n${tocEntry('entities', 91)}`
    );

    await expect(
      prepareAdminBackupRestore({
        filename: 'postgram-backup.tar.gz',
        data: Buffer.from('archive'),
        databaseUrl: DATABASE_URL,
        commandRunner: harness.runner
      })
    ).rejects.toThrow(/duplicate table data entries/u);
  });
});

describe('admin backup restore staging', () => {
  it('truncates every restorable table before applying the dump', async () => {
    const { restore } = await prepare(currentToc());
    const commands: AdminBackupCommandRunnerInput[] = [];

    await stageAdminBackupRestore({
      restore,
      databaseUrl: DATABASE_URL,
      commandRunner: (input) => {
        commands.push(input);
        return Promise.resolve();
      },
      verifier: () =>
        Promise.resolve({
          migrations: 'passed' as const,
          health: 'connected' as const
        })
    });

    const truncate = commands.find(
      (command) => command.command === 'psql'
    )?.args.join(' ');
    expect(truncate).toBeDefined();
    for (const table of RESTORED_TABLES) {
      expect(truncate).toContain(`public.${table}`);
    }
  });
});

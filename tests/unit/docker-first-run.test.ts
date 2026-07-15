import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

function makeSecretDir(): string {
  return mkdtempSync(join(tmpdir(), 'postgram-docker-first-run-'));
}

function runShellScript(
  script: string,
  args: string[],
  env: Record<string, string>
) {
  return spawnSync('sh', [script, ...args], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? '',
      ...env
    },
    encoding: 'utf8'
  });
}

function runBashScript(
  script: string,
  args: string[],
  env: Record<string, string>
) {
  return spawnSync('bash', [script, ...args], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? '',
      ...env
    },
    encoding: 'utf8'
  });
}

describe('Docker first-run scripts', () => {
  it('re-enters the container entrypoint before running pgm-admin', () => {
    const fakeDockerDir = makeSecretDir();
    const callsFile = join(fakeDockerDir, 'docker-calls');
    const fakeDocker = join(fakeDockerDir, 'docker');

    try {
      writeFileSync(
        fakeDocker,
        `#!/bin/sh
if [ "$1" = "compose" ] && [ "$2" = "ps" ]; then
  echo custom-project-mcp-server-1
  exit 0
fi
if [ "$1" = "inspect" ]; then
  echo true
  exit 0
fi
printf '%s\\n' "$@" > "$DOCKER_CALLS_FILE"
`
      );
      chmodSync(fakeDocker, 0o755);

      const result = runBashScript('bin/pgm-admin', ['stats'], {
        PATH: `${fakeDockerDir}:${process.env.PATH ?? ''}`,
        DOCKER_CALLS_FILE: callsFile
      });

      expect(result.status).toBe(0);
      expect(readFileSync(callsFile, 'utf8').trim().split('\n')).toEqual([
        'exec',
        '-i',
        'custom-project-mcp-server-1',
        '/app/docker-entrypoint.sh',
        'pgm-admin',
        'stats'
      ]);
    } finally {
      rmSync(fakeDockerDir, { recursive: true, force: true });
    }
  });

  it('refuses a destructive embedding migration while the live worker is running', () => {
    const fakeDockerDir = makeSecretDir();
    const fakeDocker = join(fakeDockerDir, 'docker');

    try {
      writeFileSync(
        fakeDocker,
        `#!/bin/sh
if [ "$1" = "compose" ] && [ "$2" = "ps" ]; then
  echo custom-project-mcp-server-1
  exit 0
fi
if [ "$1" = "inspect" ]; then
  echo true
  exit 0
fi
exit 99
`
      );
      chmodSync(fakeDocker, 0o755);

      const result = runBashScript(
        'bin/pgm-admin',
        [
          'embeddings',
          '--json',
          'migrate',
          '--target-dimensions',
          '1024',
          '--yes'
        ],
        {
          PATH: `${fakeDockerDir}:${process.env.PATH ?? ''}`
        }
      );

      expect(result.status).toBe(64);
      expect(result.stderr).toContain('docker compose stop mcp-server');
      expect(result.stderr).toContain('docker compose up -d mcp-server');
    } finally {
      rmSync(fakeDockerDir, { recursive: true, force: true });
    }
  });

  it('does not mistake unrelated command option values for an embedding migration', () => {
    const fakeDockerDir = makeSecretDir();
    const callsFile = join(fakeDockerDir, 'docker-calls');
    const fakeDocker = join(fakeDockerDir, 'docker');

    try {
      writeFileSync(
        fakeDocker,
        `#!/bin/sh
if [ "$1" = "compose" ] && [ "$2" = "ps" ]; then
  echo custom-project-mcp-server-1
  exit 0
fi
if [ "$1" = "inspect" ]; then
  echo true
  exit 0
fi
printf '%s\n' "$@" > "$DOCKER_CALLS_FILE"
`
      );
      chmodSync(fakeDocker, 0o755);

      const result = runBashScript(
        'bin/pgm-admin',
        [
          'memory',
          'groom-durable',
          '--mode',
          'mark',
          '--tag',
          'embeddings',
          'migrate',
          '--yes'
        ],
        {
          PATH: `${fakeDockerDir}:${process.env.PATH ?? ''}`,
          DOCKER_CALLS_FILE: callsFile
        }
      );

      expect(result.status).toBe(0);
      expect(readFileSync(callsFile, 'utf8')).toContain('groom-durable');
    } finally {
      rmSync(fakeDockerDir, { recursive: true, force: true });
    }
  });

  it('allows a confirmed dry-run while the live worker is running', () => {
    const fakeDockerDir = makeSecretDir();
    const callsFile = join(fakeDockerDir, 'docker-calls');
    const fakeDocker = join(fakeDockerDir, 'docker');

    try {
      writeFileSync(
        fakeDocker,
        `#!/bin/sh
if [ "$1" = "compose" ] && [ "$2" = "ps" ]; then
  echo custom-project-mcp-server-1
  exit 0
fi
if [ "$1" = "inspect" ]; then
  echo true
  exit 0
fi
printf '%s\n' "$@" > "$DOCKER_CALLS_FILE"
`
      );
      chmodSync(fakeDocker, 0o755);

      const result = runBashScript(
        'bin/pgm-admin',
        [
          'embeddings',
          'migrate',
          '--target-dimensions',
          '1024',
          '--dry-run',
          '--yes'
        ],
        {
          PATH: `${fakeDockerDir}:${process.env.PATH ?? ''}`,
          DOCKER_CALLS_FILE: callsFile
        }
      );

      expect(result.status).toBe(0);
      expect(readFileSync(callsFile, 'utf8')).toContain('--dry-run');
      expect(readFileSync(callsFile, 'utf8')).toContain('--yes');
    } finally {
      rmSync(fakeDockerDir, { recursive: true, force: true });
    }
  });

  it('creates persistent Docker secrets without requiring manual env-file edits', () => {
    const secretsDir = makeSecretDir();
    try {
      const result = runShellScript('docker/postgram-ensure-secrets.sh', [], {
        POSTGRAM_SECRETS_DIR: secretsDir
      });

      expect(result.status).toBe(0);

      const postgresPassword = readFileSync(
        join(secretsDir, 'postgres-password'),
        'utf8'
      ).trim();
      const adminMfaKey = readFileSync(
        join(secretsDir, 'admin-mfa-secret-key'),
        'utf8'
      ).trim();
      const adminSettingsKey = readFileSync(
        join(secretsDir, 'admin-settings-encryption-key'),
        'utf8'
      ).trim();

      expect(postgresPassword).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(adminMfaKey).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(adminSettingsKey).toMatch(/^[A-Za-z0-9_-]{43}$/u);

      const second = runShellScript('docker/postgram-ensure-secrets.sh', [], {
        POSTGRAM_SECRETS_DIR: secretsDir
      });
      expect(second.status).toBe(0);
      expect(
        readFileSync(join(secretsDir, 'admin-settings-encryption-key'), 'utf8').trim()
      ).toBe(adminSettingsKey);
    } finally {
      rmSync(secretsDir, { recursive: true, force: true });
    }
  });

  it('seeds the Docker Postgres password secret from a legacy POSTGRES_PASSWORD override', () => {
    const secretsDir = makeSecretDir();
    try {
      const result = runShellScript('docker/postgram-ensure-secrets.sh', [], {
        POSTGRAM_SECRETS_DIR: secretsDir,
        POSTGRES_PASSWORD: 'legacy-postgres-password'
      });

      expect(result.status).toBe(0);
      expect(readFileSync(join(secretsDir, 'postgres-password'), 'utf8').trim()).toBe(
        'legacy-postgres-password'
      );

      const second = runShellScript('docker/postgram-ensure-secrets.sh', [], {
        POSTGRAM_SECRETS_DIR: secretsDir,
        POSTGRES_PASSWORD: 'different-password'
      });
      expect(second.status).toBe(0);
      expect(readFileSync(join(secretsDir, 'postgres-password'), 'utf8').trim()).toBe(
        'legacy-postgres-password'
      );
    } finally {
      rmSync(secretsDir, { recursive: true, force: true });
    }
  });

  it('loads Docker secrets into server env and constructs DATABASE_URL from the password file', () => {
    const secretsDir = makeSecretDir();
    try {
      writeFileSync(join(secretsDir, 'postgres-password'), 'stable-postgres-pass\n');
      writeFileSync(
        join(secretsDir, 'admin-mfa-secret-key'),
        'stable-admin-mfa-secret-key-32-bytes\n'
      );
      writeFileSync(
        join(secretsDir, 'admin-settings-encryption-key'),
        '3ZowdtuLN12_15tV94qV3gMHnwv-gMZevpqvMjPDU5s\n'
      );

      const result = runShellScript(
        'docker/postgram-entrypoint.sh',
        [
          process.execPath,
          '-e',
          "process.stdout.write(JSON.stringify({DATABASE_URL:process.env.DATABASE_URL,ADMIN_MFA_SECRET_KEY:process.env.ADMIN_MFA_SECRET_KEY,ADMIN_SETTINGS_ENCRYPTION_KEY:process.env.ADMIN_SETTINGS_ENCRYPTION_KEY,EMBEDDING_PROVIDER:process.env.EMBEDDING_PROVIDER}))"
        ],
        {
          POSTGRAM_SECRETS_DIR: secretsDir
        }
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        DATABASE_URL:
          'postgres://postgram:stable-postgres-pass@postgres:5432/postgram',
        ADMIN_MFA_SECRET_KEY: 'stable-admin-mfa-secret-key-32-bytes',
        ADMIN_SETTINGS_ENCRYPTION_KEY:
          '3ZowdtuLN12_15tV94qV3gMHnwv-gMZevpqvMjPDU5s',
        EMBEDDING_PROVIDER: 'ollama'
      });
    } finally {
      rmSync(secretsDir, { recursive: true, force: true });
    }
  });

  it('constructs a passwordless DATABASE_URL for an external Postgres host when POSTGRES_PASSWORD is explicitly blank', () => {
    const secretsDir = makeSecretDir();
    try {
      writeFileSync(join(secretsDir, 'postgres-password'), 'generated-secret\n');
      writeFileSync(
        join(secretsDir, 'admin-mfa-secret-key'),
        'stable-admin-mfa-secret-key-32-bytes\n'
      );
      writeFileSync(
        join(secretsDir, 'admin-settings-encryption-key'),
        '3ZowdtuLN12_15tV94qV3gMHnwv-gMZevpqvMjPDU5s\n'
      );

      const result = runShellScript(
        'docker/postgram-entrypoint.sh',
        [
          process.execPath,
          '-e',
          "process.stdout.write(process.env.DATABASE_URL ?? '')"
        ],
        {
          POSTGRAM_SECRETS_DIR: secretsDir,
          POSTGRES_HOST: 'host.docker.internal',
          POSTGRES_PASSWORD: ''
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toBe(
        'postgres://postgram@host.docker.internal:5432/postgram'
      );
    } finally {
      rmSync(secretsDir, { recursive: true, force: true });
    }
  });

  it('uses an explicit POSTGRES_PASSWORD override when constructing DATABASE_URL for external Postgres', () => {
    const secretsDir = makeSecretDir();
    try {
      writeFileSync(join(secretsDir, 'postgres-password'), 'generated-secret\n');
      writeFileSync(
        join(secretsDir, 'admin-mfa-secret-key'),
        'stable-admin-mfa-secret-key-32-bytes\n'
      );
      writeFileSync(
        join(secretsDir, 'admin-settings-encryption-key'),
        '3ZowdtuLN12_15tV94qV3gMHnwv-gMZevpqvMjPDU5s\n'
      );

      const result = runShellScript(
        'docker/postgram-entrypoint.sh',
        [
          process.execPath,
          '-e',
          "process.stdout.write(process.env.DATABASE_URL ?? '')"
        ],
        {
          POSTGRAM_SECRETS_DIR: secretsDir,
          POSTGRES_DB: 'postgram data',
          POSTGRES_HOST: 'db.example.test',
          POSTGRES_PASSWORD: 'p@ss/word#1',
          POSTGRES_PORT: '6543',
          POSTGRES_USER: 'postgram-user'
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toBe(
        'postgres://postgram-user:p%40ss%2Fword%231@db.example.test:6543/postgram%20data'
      );
    } finally {
      rmSync(secretsDir, { recursive: true, force: true });
    }
  });

  it('keeps the OpenAI embedding default when a legacy OPENAI_API_KEY override is present', () => {
    const secretsDir = makeSecretDir();
    try {
      writeFileSync(join(secretsDir, 'postgres-password'), 'stable-postgres-pass\n');
      writeFileSync(
        join(secretsDir, 'admin-mfa-secret-key'),
        'stable-admin-mfa-secret-key-32-bytes\n'
      );
      writeFileSync(
        join(secretsDir, 'admin-settings-encryption-key'),
        '3ZowdtuLN12_15tV94qV3gMHnwv-gMZevpqvMjPDU5s\n'
      );

      const result = runShellScript(
        'docker/postgram-entrypoint.sh',
        [process.execPath, '-e', "process.stdout.write(process.env.EMBEDDING_PROVIDER ?? '')"],
        {
          POSTGRAM_SECRETS_DIR: secretsDir,
          OPENAI_API_KEY: 'sk-legacy'
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toBe('openai');
    } finally {
      rmSync(secretsDir, { recursive: true, force: true });
    }
  });

  it('fails closed when the persisted admin settings encryption key is invalid', () => {
    const secretsDir = makeSecretDir();
    try {
      writeFileSync(join(secretsDir, 'postgres-password'), 'stable-postgres-pass\n');
      writeFileSync(
        join(secretsDir, 'admin-mfa-secret-key'),
        'stable-admin-mfa-secret-key-32-bytes\n'
      );
      writeFileSync(
        join(secretsDir, 'admin-settings-encryption-key'),
        '*******************************************\n'
      );

      const result = runShellScript(
        'docker/postgram-entrypoint.sh',
        [process.execPath, '-e', 'process.exit(0)'],
        {
          POSTGRAM_SECRETS_DIR: secretsDir
        }
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'ADMIN_SETTINGS_ENCRYPTION_KEY must be a 32-byte base64url value'
      );
    } finally {
      rmSync(secretsDir, { recursive: true, force: true });
    }
  });
});

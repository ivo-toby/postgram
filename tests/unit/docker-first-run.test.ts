import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

describe('Docker first-run scripts', () => {
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
          "process.stdout.write(JSON.stringify({DATABASE_URL:process.env.DATABASE_URL,ADMIN_MFA_SECRET_KEY:process.env.ADMIN_MFA_SECRET_KEY,ADMIN_SETTINGS_ENCRYPTION_KEY:process.env.ADMIN_SETTINGS_ENCRYPTION_KEY}))"
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
          '3ZowdtuLN12_15tV94qV3gMHnwv-gMZevpqvMjPDU5s'
      });
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
        'too-short\n'
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
        'ADMIN_SETTINGS_ENCRYPTION_KEY must decode to 32 bytes'
      );
    } finally {
      rmSync(secretsDir, { recursive: true, force: true });
    }
  });
});

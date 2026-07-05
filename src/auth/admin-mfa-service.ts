import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';

import { ResultAsync } from 'neverthrow';
import type { Pool, PoolClient } from 'pg';

import type {
  AdminSessionRecord,
  AdminUserRecord,
  AdminUserStatus
} from './admin-service.js';
import type { ServiceResult } from '../types/common.js';
import { AppError, ErrorCode } from '../util/errors.js';

export type AdminMfaFactorStatus = 'pending' | 'verified' | 'disabled';
export type AdminMfaFactorType = 'totp';

export type AdminMfaFactorRecord = {
  id: string;
  adminUserId: string;
  type: AdminMfaFactorType;
  status: AdminMfaFactorStatus;
  createdAt: string;
  verifiedAt: string | null;
  disabledAt: string | null;
};

export type BeginAdminTotpEnrollmentInput = {
  adminUserId: string;
  accountName: string;
  issuer: string;
  secretKey: string;
  now?: Date | undefined;
};

export type BeginAdminTotpEnrollmentResult = {
  factor: AdminMfaFactorRecord;
  secret: string;
  otpauthUrl: string;
};

export type VerifyAdminTotpEnrollmentInput = {
  adminUserId: string;
  sessionId: string;
  factorId: string;
  code: string;
  secretKey: string;
  now?: Date | undefined;
};

export type VerifyAdminTotpChallengeInput = {
  adminUserId: string;
  sessionId: string;
  code: string;
  secretKey: string;
  now?: Date | undefined;
};

export type VerifyAdminTotpResult = {
  factor: AdminMfaFactorRecord;
  session: AdminSessionRecord;
  user: AdminUserRecord;
};

type AdminMfaFactorRow = {
  id: string;
  admin_user_id: string;
  factor_type: AdminMfaFactorType;
  status: AdminMfaFactorStatus;
  secret_ciphertext: string | null;
  created_at: Date;
  verified_at: Date | null;
  disabled_at: Date | null;
};

type AdminSessionRow = {
  id: string;
  admin_user_id: string;
  mfa_verified_at: Date | null;
  expires_at: Date;
  revoked_at: Date | null;
  last_used_at: Date | null;
  created_at: Date;
};

type AdminUserRow = {
  id: string;
  email: string;
  display_name: string | null;
  status: AdminUserStatus;
  mfa_required: boolean;
  password_changed_at: Date;
  created_at: Date;
  updated_at: Date;
};

type TotpAttemptType = 'mfa' | 'step_up';

const TOTP_SECRET_BYTES = 20;
const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_WINDOW = 1;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STORED_TOTP_SECRET_PREFIX = 'totp:v1:';
const TOTP_ENCRYPTION_IV_BYTES = 12;
const TOTP_ENCRYPTION_KEY_MIN_LENGTH = 32;

function toAppError(error: unknown, fallbackMessage: string): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (isPgErrorCode(error, '23505')) {
    return new AppError(ErrorCode.CONFLICT, fallbackMessage, {
      cause: 'unique_violation'
    });
  }

  if (error instanceof Error) {
    return new AppError(ErrorCode.INTERNAL, fallbackMessage, {
      cause: error.message
    });
  }

  return new AppError(ErrorCode.INTERNAL, fallbackMessage);
}

function isPgErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function mapAdminUser(row: AdminUserRow): AdminUserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    mfaRequired: row.mfa_required,
    passwordChangedAt: row.password_changed_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapAdminSession(row: AdminSessionRow): AdminSessionRecord {
  return {
    id: row.id,
    adminUserId: row.admin_user_id,
    mfaVerifiedAt: row.mfa_verified_at?.toISOString() ?? null,
    expiresAt: row.expires_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null,
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  };
}

function mapAdminMfaFactor(row: AdminMfaFactorRow): AdminMfaFactorRecord {
  return {
    id: row.id,
    adminUserId: row.admin_user_id,
    type: row.factor_type,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    verifiedAt: row.verified_at?.toISOString() ?? null,
    disabledAt: row.disabled_at?.toISOString() ?? null
  };
}

function encodeBase32(bytes: Buffer): string {
  let bits = '';
  let output = '';

  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, '0');
    while (bits.length >= 5) {
      const chunk = bits.slice(0, 5);
      bits = bits.slice(5);
      const index = Number.parseInt(chunk, 2);
      output += BASE32_ALPHABET[index] ?? '';
    }
  }

  if (bits.length > 0) {
    const index = Number.parseInt(bits.padEnd(5, '0'), 2);
    output += BASE32_ALPHABET[index] ?? '';
  }

  return output;
}

function decodeBase32(value: string): Buffer {
  let bits = '';
  const bytes: number[] = [];

  for (const character of value.replace(/=+$/u, '').toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) {
      throw new AppError(ErrorCode.INTERNAL, 'Stored TOTP secret is invalid');
    }
    bits += index.toString(2).padStart(5, '0');
  }

  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }

  return Buffer.from(bytes);
}

function generateTotpSecret(): string {
  return encodeBase32(randomBytes(TOTP_SECRET_BYTES));
}

function deriveTotpEncryptionKey(secretKey: string): Buffer {
  const normalized = secretKey.trim();
  if (normalized.length < TOTP_ENCRYPTION_KEY_MIN_LENGTH) {
    throw new AppError(
      ErrorCode.INTERNAL,
      'Admin MFA secret key is not configured'
    );
  }

  return createHash('sha256')
    .update('postgram-admin-mfa:', 'utf8')
    .update(normalized, 'utf8')
    .digest();
}

function storeTotpSecret(secret: string, secretKey: string): string {
  const iv = randomBytes(TOTP_ENCRYPTION_IV_BYTES);
  const cipher = createCipheriv(
    'aes-256-gcm',
    deriveTotpEncryptionKey(secretKey),
    iv
  );
  const ciphertext = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return `${STORED_TOTP_SECRET_PREFIX}${iv.toString(
    'base64url'
  )}.${authTag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function loadTotpSecret(
  secretCiphertext: string | null,
  secretKey: string
): string {
  if (!secretCiphertext?.startsWith(STORED_TOTP_SECRET_PREFIX)) {
    throw new AppError(ErrorCode.INTERNAL, 'Stored TOTP factor is invalid');
  }

  const sealed = secretCiphertext.slice(STORED_TOTP_SECRET_PREFIX.length);
  const [iv, authTag, ciphertext, extra] = sealed.split('.');
  if (!iv || !authTag || !ciphertext || extra !== undefined) {
    throw new AppError(ErrorCode.INTERNAL, 'Stored TOTP factor is invalid');
  }

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveTotpEncryptionKey(secretKey),
      Buffer.from(iv, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(authTag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(ErrorCode.INTERNAL, 'Stored TOTP factor is invalid');
  }
}

export function generateTotpCode(
  secret: string,
  options: { now?: Date | undefined } = {}
): string {
  const now = options.now ?? new Date();
  const counter = Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', decodeBase32(secret))
    .update(counterBuffer)
    .digest();
  const lastByte = digest[digest.length - 1];
  if (lastByte === undefined) {
    throw new AppError(ErrorCode.INTERNAL, 'Unable to generate TOTP code');
  }

  const offset = lastByte & 0x0f;
  const first = digest[offset];
  const second = digest[offset + 1];
  const third = digest[offset + 2];
  const fourth = digest[offset + 3];
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined
  ) {
    throw new AppError(ErrorCode.INTERNAL, 'Unable to generate TOTP code');
  }

  const binary =
    ((first & 0x7f) << 24) |
    ((second & 0xff) << 16) |
    ((third & 0xff) << 8) |
    (fourth & 0xff);

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

function isValidTotpCode(secret: string, code: string, now: Date): boolean {
  if (!/^\d{6}$/u.test(code)) {
    return false;
  }

  const actual = Buffer.from(code);
  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset += 1) {
    const expectedCode = generateTotpCode(secret, {
      now: new Date(now.getTime() + offset * TOTP_PERIOD_SECONDS * 1000)
    });
    const expected = Buffer.from(expectedCode);
    if (
      actual.length === expected.length &&
      timingSafeEqual(actual, expected)
    ) {
      return true;
    }
  }

  return false;
}

function createOtpAuthUrl(input: {
  secret: string;
  issuer: string;
  accountName: string;
}): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(
    input.accountName
  )}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS)
  });

  return `otpauth://totp/${label}?${params.toString()}`;
}

async function recordTotpAttempt(
  client: PoolClient,
  input: {
    adminUserId: string;
    attemptType: TotpAttemptType;
    succeeded: boolean;
    now: Date;
  }
): Promise<void> {
  await client.query(
    `
      INSERT INTO admin_auth_attempts (
        admin_user_id,
        attempt_type,
        identifier,
        succeeded,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      input.adminUserId,
      input.attemptType,
      input.adminUserId,
      input.succeeded,
      input.now
    ]
  );
}

async function writeAdminMfaAudit(
  client: PoolClient,
  input: {
    operation: string;
    adminUserId: string;
    factorId?: string | undefined;
    details?: Record<string, unknown> | undefined;
  }
): Promise<void> {
  const details = {
    adminUserId: input.adminUserId,
    ...(input.factorId ? { factorId: input.factorId } : {}),
    ...(input.details ?? {})
  };

  if (await auditLogHasAdminUserIdColumn(client)) {
    await client.query(
      `
        INSERT INTO audit_log (
          api_key_id,
          admin_user_id,
          operation,
          entity_id,
          details
        )
        VALUES (NULL, $1, $2, $3, $4)
      `,
      [input.adminUserId, input.operation, input.factorId ?? null, details]
    );
    return;
  }

  await client.query(
    `
      INSERT INTO audit_log (
        api_key_id,
        operation,
        entity_id,
        details
      )
      VALUES (NULL, $1, $2, $3)
    `,
    [input.operation, input.factorId ?? null, details]
  );
}

async function auditLogHasAdminUserIdColumn(
  client: PoolClient
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'audit_log'
          AND column_name = 'admin_user_id'
      ) AS exists
    `
  );

  return result.rows[0]?.exists === true;
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original failure.
  }
}

async function loadActiveSession(
  client: PoolClient,
  input: {
    adminUserId: string;
    sessionId: string;
    now: Date;
  }
): Promise<AdminSessionRow> {
  const result = await client.query<AdminSessionRow>(
    `
      SELECT *
      FROM admin_sessions
      WHERE id = $1
        AND admin_user_id = $2
        AND revoked_at IS NULL
        AND expires_at > $3
      FOR UPDATE
    `,
    [input.sessionId, input.adminUserId, input.now]
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid admin session');
  }

  return row;
}

async function loadUser(
  client: PoolClient,
  adminUserId: string
): Promise<AdminUserRow> {
  const result = await client.query<AdminUserRow>(
    `
      SELECT *
      FROM admin_users
      WHERE id = $1
      FOR UPDATE
    `,
    [adminUserId]
  );
  const row = result.rows[0];
  if (!row || row.status === 'disabled') {
    throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid admin user');
  }

  return row;
}

export function beginAdminTotpEnrollment(
  pool: Pool,
  input: BeginAdminTotpEnrollmentInput
): ServiceResult<BeginAdminTotpEnrollmentResult> {
  return ResultAsync.fromPromise(
    (async () => {
      const now = input.now ?? new Date();
      const secret = generateTotpSecret();
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await loadUser(client, input.adminUserId);

        const existingVerified = await client.query<{ id: string }>(
          `
            SELECT id
            FROM admin_mfa_factors
            WHERE admin_user_id = $1
              AND factor_type = 'totp'
              AND status = 'verified'
            LIMIT 1
          `,
          [input.adminUserId]
        );
        if (existingVerified.rows.length > 0) {
          throw new AppError(
            ErrorCode.CONFLICT,
            'A verified TOTP factor already exists'
          );
        }

        await client.query(
          `
            UPDATE admin_mfa_factors
            SET status = 'disabled',
                disabled_at = $2
            WHERE admin_user_id = $1
              AND factor_type = 'totp'
              AND status = 'pending'
          `,
          [input.adminUserId, now]
        );

        const created = await client.query<AdminMfaFactorRow>(
          `
            INSERT INTO admin_mfa_factors (
              admin_user_id,
              factor_type,
              status,
              secret_ciphertext,
              created_at
            )
            VALUES ($1, 'totp', 'pending', $2, $3)
            RETURNING *
          `,
          [input.adminUserId, storeTotpSecret(secret, input.secretKey), now]
        );
        const factor = created.rows[0];
        if (!factor) {
          throw new AppError(ErrorCode.INTERNAL, 'Failed to enroll TOTP MFA');
        }

        await writeAdminMfaAudit(client, {
          operation: 'admin.mfa.enroll',
          adminUserId: input.adminUserId,
          factorId: factor.id,
          details: {
            factorType: 'totp',
            status: 'pending'
          }
        });

        await client.query('COMMIT');
        return {
          factor: mapAdminMfaFactor(factor),
          secret,
          otpauthUrl: createOtpAuthUrl({
            secret,
            issuer: input.issuer,
            accountName: input.accountName
          })
        };
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to enroll TOTP MFA')
  );
}

export function verifyAdminTotpEnrollment(
  pool: Pool,
  input: VerifyAdminTotpEnrollmentInput
): ServiceResult<VerifyAdminTotpResult> {
  return ResultAsync.fromPromise(
    (async () => {
      const now = input.now ?? new Date();
      const client = await pool.connect();
      let transactionOpen = false;

      try {
        await client.query('BEGIN');
        transactionOpen = true;
        const user = await loadUser(client, input.adminUserId);
        await loadActiveSession(client, {
          adminUserId: input.adminUserId,
          sessionId: input.sessionId,
          now
        });

        const factorResult = await client.query<AdminMfaFactorRow>(
          `
            SELECT *
            FROM admin_mfa_factors
            WHERE id = $1
              AND admin_user_id = $2
              AND factor_type = 'totp'
              AND status = 'pending'
            FOR UPDATE
          `,
          [input.factorId, input.adminUserId]
        );
        const factor = factorResult.rows[0];
        if (!factor) {
          await recordTotpAttempt(client, {
            adminUserId: input.adminUserId,
            attemptType: 'mfa',
            succeeded: false,
            now
          });
          await client.query('COMMIT');
          transactionOpen = false;
          throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid MFA challenge');
        }

        const secret = loadTotpSecret(
          factor.secret_ciphertext,
          input.secretKey
        );
        if (!isValidTotpCode(secret, input.code, now)) {
          await recordTotpAttempt(client, {
            adminUserId: input.adminUserId,
            attemptType: 'mfa',
            succeeded: false,
            now
          });
          await client.query('COMMIT');
          transactionOpen = false;
          throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid MFA challenge');
        }

        const updatedFactor = await client.query<AdminMfaFactorRow>(
          `
            UPDATE admin_mfa_factors
            SET status = 'verified',
                verified_at = $3
            WHERE id = $1
              AND admin_user_id = $2
              AND status = 'pending'
            RETURNING *
          `,
          [input.factorId, input.adminUserId, now]
        );
        const updatedUser = await client.query<AdminUserRow>(
          `
            UPDATE admin_users
            SET status = CASE WHEN status = 'pending_mfa' THEN 'active' ELSE status END
            WHERE id = $1
            RETURNING *
          `,
          [input.adminUserId]
        );
        const updatedSession = await markSessionMfaVerified(client, {
          adminUserId: input.adminUserId,
          sessionId: input.sessionId,
          now
        });
        await recordTotpAttempt(client, {
          adminUserId: input.adminUserId,
          attemptType: 'mfa',
          succeeded: true,
          now
        });

        const verifiedFactor = updatedFactor.rows[0];
        const activeUser = updatedUser.rows[0] ?? user;
        if (!verifiedFactor) {
          throw new AppError(ErrorCode.INTERNAL, 'Failed to verify MFA factor');
        }

        await writeAdminMfaAudit(client, {
          operation: 'admin.mfa.verify',
          adminUserId: input.adminUserId,
          factorId: verifiedFactor.id,
          details: {
            factorType: 'totp',
            activatedAdmin: activeUser.status === 'active'
          }
        });

        await client.query('COMMIT');
        transactionOpen = false;
        return {
          factor: mapAdminMfaFactor(verifiedFactor),
          user: mapAdminUser(activeUser),
          session: mapAdminSession(updatedSession)
        };
      } catch (error) {
        if (transactionOpen) {
          await rollbackQuietly(client);
        }
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to verify TOTP enrollment')
  );
}

export function verifyAdminTotpChallenge(
  pool: Pool,
  input: VerifyAdminTotpChallengeInput
): ServiceResult<VerifyAdminTotpResult> {
  return verifyVerifiedTotpFactor(pool, input, 'mfa');
}

export function verifyAdminTotpStepUp(
  pool: Pool,
  input: VerifyAdminTotpChallengeInput
): ServiceResult<VerifyAdminTotpResult> {
  return verifyVerifiedTotpFactor(pool, input, 'step_up');
}

function verifyVerifiedTotpFactor(
  pool: Pool,
  input: VerifyAdminTotpChallengeInput,
  attemptType: TotpAttemptType
): ServiceResult<VerifyAdminTotpResult> {
  return ResultAsync.fromPromise(
    (async () => {
      const now = input.now ?? new Date();
      const client = await pool.connect();
      let transactionOpen = false;

      try {
        await client.query('BEGIN');
        transactionOpen = true;
        const user = await loadUser(client, input.adminUserId);
        await loadActiveSession(client, {
          adminUserId: input.adminUserId,
          sessionId: input.sessionId,
          now
        });

        const factorResult = await client.query<AdminMfaFactorRow>(
          `
            SELECT *
            FROM admin_mfa_factors
            WHERE admin_user_id = $1
              AND factor_type = 'totp'
              AND status = 'verified'
            ORDER BY verified_at DESC NULLS LAST, created_at DESC
            LIMIT 1
            FOR UPDATE
          `,
          [input.adminUserId]
        );
        const factor = factorResult.rows[0];
        if (!factor) {
          await recordTotpAttempt(client, {
            adminUserId: input.adminUserId,
            attemptType,
            succeeded: false,
            now
          });
          await client.query('COMMIT');
          transactionOpen = false;
          throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid MFA challenge');
        }

        const secret = loadTotpSecret(
          factor.secret_ciphertext,
          input.secretKey
        );
        if (!isValidTotpCode(secret, input.code, now)) {
          await recordTotpAttempt(client, {
            adminUserId: input.adminUserId,
            attemptType,
            succeeded: false,
            now
          });
          await client.query('COMMIT');
          transactionOpen = false;
          throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid MFA challenge');
        }

        const session = await markSessionMfaVerified(client, {
          adminUserId: input.adminUserId,
          sessionId: input.sessionId,
          now
        });
        await recordTotpAttempt(client, {
          adminUserId: input.adminUserId,
          attemptType,
          succeeded: true,
          now
        });
        await writeAdminMfaAudit(client, {
          operation:
            attemptType === 'step_up'
              ? 'admin.step_up'
              : 'admin.mfa.challenge',
          adminUserId: input.adminUserId,
          factorId: factor.id,
          details: {
            factorType: 'totp'
          }
        });

        await client.query('COMMIT');
        transactionOpen = false;
        return {
          factor: mapAdminMfaFactor(factor),
          user: mapAdminUser(user),
          session: mapAdminSession(session)
        };
      } catch (error) {
        if (transactionOpen) {
          await rollbackQuietly(client);
        }
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to verify TOTP challenge')
  );
}

async function markSessionMfaVerified(
  client: PoolClient,
  input: {
    adminUserId: string;
    sessionId: string;
    now: Date;
  }
): Promise<AdminSessionRow> {
  const sessionResult = await client.query<AdminSessionRow>(
    `
      UPDATE admin_sessions
      SET mfa_verified_at = $3
      WHERE id = $1
        AND admin_user_id = $2
        AND revoked_at IS NULL
        AND expires_at > $3
      RETURNING *
    `,
    [input.sessionId, input.adminUserId, input.now]
  );
  const session = sessionResult.rows[0];
  if (!session) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid admin session');
  }

  return session;
}

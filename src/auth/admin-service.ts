import { createHash, randomBytes } from 'node:crypto';

import argon2 from 'argon2';
import { ResultAsync } from 'neverthrow';
import type { Pool, PoolClient } from 'pg';

import type { ServiceResult } from '../types/common.js';
import { AppError, ErrorCode } from '../util/errors.js';

export type AdminUserStatus = 'pending_mfa' | 'active' | 'disabled';

export type AdminUserRecord = {
  id: string;
  email: string;
  displayName: string | null;
  status: AdminUserStatus;
  mfaRequired: boolean;
  passwordChangedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminSessionRecord = {
  id: string;
  adminUserId: string;
  mfaVerifiedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

export type BootstrapTokenRecord = {
  id: string;
  expiresAt: string;
  consumedAt: string | null;
  invalidatedAt: string | null;
  attemptCount: number;
  lastAttemptAt: string | null;
  createdAt: string;
};

export type CreateAdminUserInput = {
  email: string;
  password: string;
  displayName?: string | undefined;
};

export type VerifyAdminPasswordInput = {
  email: string;
  password: string;
};

export type CreateAdminSessionInput = {
  adminUserId: string;
  ttlMs: number;
  now?: Date | undefined;
  mfaVerified?: boolean | undefined;
};

export type CreateAdminSessionResult = {
  plaintextToken: string;
  session: AdminSessionRecord;
};

export type FindAdminSessionResult = {
  session: AdminSessionRecord;
  user: AdminUserRecord;
};

export type CreateBootstrapTokenInput = {
  ttlMs: number;
  now?: Date | undefined;
};

export type CreateBootstrapTokenResult = {
  plaintextToken: string;
  token: BootstrapTokenRecord;
};

export type EnsureFirstRunBootstrapTokenResult =
  | {
      status: 'created';
      plaintextToken: string;
      token: BootstrapTokenRecord;
    }
  | {
      status: 'existing';
      token: BootstrapTokenRecord;
    }
  | {
      status: 'configured';
    };

export type CreateFirstAdminInput = {
  bootstrapToken: string;
  email: string;
  password: string;
  displayName?: string | undefined;
  now?: Date | undefined;
};

type AdminUserRow = {
  id: string;
  email: string;
  display_name: string | null;
  password_hash: string;
  status: AdminUserStatus;
  mfa_required: boolean;
  password_changed_at: Date;
  created_at: Date;
  updated_at: Date;
};

type AdminSessionRow = {
  id: string;
  admin_user_id: string;
  token_hash: string;
  mfa_verified_at: Date | null;
  expires_at: Date;
  revoked_at: Date | null;
  last_used_at: Date | null;
  created_at: Date;
};

type BootstrapTokenRow = {
  id: string;
  token_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
  invalidated_at: Date | null;
  attempt_count: number;
  last_attempt_at: Date | null;
  created_at: Date;
};

type SessionLookupRow = AdminSessionRow & {
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  user_status: AdminUserStatus;
  user_mfa_required: boolean;
  user_password_changed_at: Date;
  user_created_at: Date;
  user_updated_at: Date;
};

const TOKEN_BYTES = 32;
const MIN_PASSWORD_LENGTH = 12;
const DUMMY_ADMIN_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$9xQbhMJBnnr3GdVXuMolRg$tREBV3P6npYAWNzcFAbPfdbyD6DtPdVNF5/kQCthblw';
const COMMON_WEAK_PASSWORDS = new Set([
  'admin',
  'password',
  'password1',
  'password12',
  'password123',
  'postgram',
  'qwerty123',
  'letmein123'
]);
const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 12 characters, include at least 3 of lowercase letters, uppercase letters, numbers, and symbols, and must not contain "password" or the email username';

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

function mapBootstrapToken(row: BootstrapTokenRow): BootstrapTokenRecord {
  return {
    id: row.id,
    expiresAt: row.expires_at.toISOString(),
    consumedAt: row.consumed_at?.toISOString() ?? null,
    invalidatedAt: row.invalidated_at?.toISOString() ?? null,
    attemptCount: row.attempt_count,
    lastAttemptAt: row.last_attempt_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  };
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new AppError(ErrorCode.VALIDATION, 'Invalid admin email', {
      field: 'email'
    });
  }

  return normalized;
}

function validatePassword(password: string, email: string): void {
  const lower = password.toLowerCase();
  const emailLocalPart = email.split('@')[0] ?? '';
  const categoryCount = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password)
  ].filter(Boolean).length;

  if (
    password.length < MIN_PASSWORD_LENGTH ||
    COMMON_WEAK_PASSWORDS.has(lower) ||
    lower.includes('password') ||
    categoryCount < 3 ||
    (emailLocalPart.length >= 3 && lower.includes(emailLocalPart))
  ) {
    throw new AppError(
      ErrorCode.VALIDATION,
      PASSWORD_POLICY_MESSAGE,
      {
        field: 'password',
        minLength: MIN_PASSWORD_LENGTH
      }
    );
  }
}

function generateToken(prefix: string): string {
  return `${prefix}-${randomBytes(TOKEN_BYTES).toString('base64url')}`;
}

function hashToken(
  purpose: 'bootstrap' | 'session',
  plaintext: string
): string {
  return createHash('sha256')
    .update(`${purpose}:${plaintext}`, 'utf8')
    .digest('hex');
}

function requirePositiveTtl(ttlMs: number): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new AppError(ErrorCode.VALIDATION, 'TTL must be a positive integer', {
      field: 'ttlMs'
    });
  }
}

async function hashAdminPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id
  });
}

export function createAdminUser(
  pool: Pool,
  input: CreateAdminUserInput
): ServiceResult<AdminUserRecord> {
  return ResultAsync.fromPromise(
    (async () => {
      const email = normalizeEmail(input.email);
      validatePassword(input.password, email);

      const passwordHash = await hashAdminPassword(input.password);
      const result = await pool.query<AdminUserRow>(
        `
          INSERT INTO admin_users (
            email,
            display_name,
            password_hash,
            status,
            mfa_required
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
        `,
        [email, input.displayName ?? null, passwordHash, 'pending_mfa', true]
      );

      const row = result.rows[0];
      if (!row) {
        throw new AppError(ErrorCode.INTERNAL, 'Failed to create admin user');
      }

      return mapAdminUser(row);
    })(),
    (error) => toAppError(error, 'Failed to create admin user')
  );
}

export function verifyAdminPassword(
  pool: Pool,
  input: VerifyAdminPasswordInput
): ServiceResult<AdminUserRecord> {
  return ResultAsync.fromPromise(
    (async () => {
      const email = normalizeEmail(input.email);
      const result = await pool.query<AdminUserRow>(
        `
          SELECT *
          FROM admin_users
          WHERE email = $1
          LIMIT 1
        `,
        [email]
      );

      const row = result.rows[0];
      const valid = await argon2.verify(
        row?.password_hash ?? DUMMY_ADMIN_PASSWORD_HASH,
        input.password
      );
      if (!row || row.status === 'disabled' || !valid) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid admin credentials');
      }

      return mapAdminUser(row);
    })(),
    (error) => toAppError(error, 'Failed to verify admin password')
  );
}

export function createAdminSession(
  pool: Pool,
  input: CreateAdminSessionInput
): ServiceResult<CreateAdminSessionResult> {
  return ResultAsync.fromPromise(
    (async () => {
      requirePositiveTtl(input.ttlMs);

      const now = input.now ?? new Date();
      const plaintextToken = generateToken('pgm-admin-session');
      const tokenHash = hashToken('session', plaintextToken);
      const expiresAt = new Date(now.getTime() + input.ttlMs);
      const mfaVerifiedAt = input.mfaVerified === true ? now : null;

      const result = await pool.query<AdminSessionRow>(
        `
          INSERT INTO admin_sessions (
            admin_user_id,
            token_hash,
            mfa_verified_at,
            expires_at,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
        `,
        [input.adminUserId, tokenHash, mfaVerifiedAt, expiresAt, now]
      );

      const row = result.rows[0];
      if (!row) {
        throw new AppError(
          ErrorCode.INTERNAL,
          'Failed to create admin session'
        );
      }

      return {
        plaintextToken,
        session: mapAdminSession(row)
      };
    })(),
    (error) => toAppError(error, 'Failed to create admin session')
  );
}

export function findAdminSession(
  pool: Pool,
  plaintextToken: string,
  options: { now?: Date | undefined } = {}
): ServiceResult<FindAdminSessionResult> {
  return ResultAsync.fromPromise(
    (async () => {
      const now = options.now ?? new Date();
      const tokenHash = hashToken('session', plaintextToken);
      const result = await pool.query<SessionLookupRow>(
        `
          SELECT
            s.*,
            u.id AS user_id,
            u.email AS user_email,
            u.display_name AS user_display_name,
            u.status AS user_status,
            u.mfa_required AS user_mfa_required,
            u.password_changed_at AS user_password_changed_at,
            u.created_at AS user_created_at,
            u.updated_at AS user_updated_at
          FROM admin_sessions s
          JOIN admin_users u ON u.id = s.admin_user_id
          WHERE s.token_hash = $1
          LIMIT 1
        `,
        [tokenHash]
      );

      const row = result.rows[0];
      if (
        !row ||
        row.revoked_at ||
        row.expires_at.getTime() <= now.getTime() ||
        row.user_status === 'disabled'
      ) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid admin session');
      }

      const updated = await pool.query<AdminSessionRow>(
        `
          UPDATE admin_sessions
          SET last_used_at = $2
          WHERE id = $1
            AND revoked_at IS NULL
            AND expires_at > $2
            AND EXISTS (
              SELECT 1
              FROM admin_users
              WHERE admin_users.id = admin_sessions.admin_user_id
                AND admin_users.status <> 'disabled'
            )
          RETURNING *
        `,
        [row.id, now]
      );

      const session = updated.rows[0];
      if (
        !session ||
        session.revoked_at ||
        session.expires_at.getTime() <= now.getTime()
      ) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid admin session');
      }

      const userResult = await pool.query<AdminUserRow>(
        `
          SELECT *
          FROM admin_users
          WHERE id = $1
          LIMIT 1
        `,
        [session.admin_user_id]
      );

      const user = userResult.rows[0];
      if (!user || user.status === 'disabled') {
        throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid admin session');
      }

      return {
        session: mapAdminSession(session),
        user: mapAdminUser(user)
      };
    })(),
    (error) => toAppError(error, 'Failed to find admin session')
  );
}

export function invalidateAdminSession(
  pool: Pool,
  plaintextToken: string,
  options: { now?: Date | undefined } = {}
): ServiceResult<{ invalidated: true }> {
  return ResultAsync.fromPromise(
    (async () => {
      const now = options.now ?? new Date();
      const tokenHash = hashToken('session', plaintextToken);
      const result = await pool.query(
        `
          UPDATE admin_sessions
          SET revoked_at = $2
          WHERE token_hash = $1
            AND revoked_at IS NULL
        `,
        [tokenHash, now]
      );

      if (result.rowCount !== 1) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid admin session');
      }

      return { invalidated: true as const };
    })(),
    (error) => toAppError(error, 'Failed to invalidate admin session')
  );
}

export function createBootstrapToken(
  pool: Pool,
  input: CreateBootstrapTokenInput
): ServiceResult<CreateBootstrapTokenResult> {
  return ResultAsync.fromPromise(
    (async () => {
      requirePositiveTtl(input.ttlMs);

      const now = input.now ?? new Date();
      const plaintextToken = generateToken('pgm-admin-bootstrap');
      const tokenHash = hashToken('bootstrap', plaintextToken);
      const expiresAt = new Date(now.getTime() + input.ttlMs);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query(
          'LOCK TABLE admin_bootstrap_tokens IN SHARE ROW EXCLUSIVE MODE'
        );

        const adminCount = await client.query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM admin_users'
        );
        if (adminCount.rows[0]?.count !== '0') {
          throw new AppError(
            ErrorCode.CONFLICT,
            'Admin bootstrap is already configured'
          );
        }

        const existing = await client.query<{ id: string }>(
          `
            SELECT id
            FROM admin_bootstrap_tokens
            WHERE consumed_at IS NULL
              AND invalidated_at IS NULL
              AND expires_at > $1
            LIMIT 1
          `,
          [now]
        );
        if (existing.rows.length > 0) {
          throw new AppError(
            ErrorCode.CONFLICT,
            'An unexpired admin bootstrap token already exists'
          );
        }

        const result = await client.query<BootstrapTokenRow>(
          `
            INSERT INTO admin_bootstrap_tokens (
              token_hash,
              expires_at,
              created_at
            )
            VALUES ($1, $2, $3)
            RETURNING *
          `,
          [tokenHash, expiresAt, now]
        );

        const row = result.rows[0];
        if (!row) {
          throw new AppError(
            ErrorCode.INTERNAL,
            'Failed to create bootstrap token'
          );
        }

        await client.query('COMMIT');
        return {
          plaintextToken,
          token: mapBootstrapToken(row)
        };
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to create bootstrap token')
  );
}

export function ensureFirstRunBootstrapToken(
  pool: Pool,
  input: CreateBootstrapTokenInput
): ServiceResult<EnsureFirstRunBootstrapTokenResult> {
  return ResultAsync.fromPromise(
    (async () => {
      requirePositiveTtl(input.ttlMs);

      const now = input.now ?? new Date();
      const expiresAt = new Date(now.getTime() + input.ttlMs);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query(
          'LOCK TABLE admin_users, admin_bootstrap_tokens IN SHARE ROW EXCLUSIVE MODE'
        );

        const adminCount = await client.query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM admin_users'
        );
        if (adminCount.rows[0]?.count !== '0') {
          await client.query('COMMIT');
          return { status: 'configured' };
        }

        const existing = await client.query<BootstrapTokenRow>(
          `
            SELECT *
            FROM admin_bootstrap_tokens
            WHERE consumed_at IS NULL
              AND invalidated_at IS NULL
              AND expires_at > $1
            ORDER BY created_at ASC
            LIMIT 1
          `,
          [now]
        );
        const existingRow = existing.rows[0];
        if (existingRow) {
          await client.query('COMMIT');
          return {
            status: 'existing',
            token: mapBootstrapToken(existingRow)
          };
        }

        const plaintextToken = generateToken('pgm-admin-bootstrap');
        const tokenHash = hashToken('bootstrap', plaintextToken);
        const inserted = await client.query<BootstrapTokenRow>(
          `
            INSERT INTO admin_bootstrap_tokens (
              token_hash,
              expires_at,
              created_at
            )
            VALUES ($1, $2, $3)
            RETURNING *
          `,
          [tokenHash, expiresAt, now]
        );

        const row = inserted.rows[0];
        if (!row) {
          throw new AppError(
            ErrorCode.INTERNAL,
            'Failed to create bootstrap token'
          );
        }

        await client.query('COMMIT');
        return {
          status: 'created',
          plaintextToken,
          token: mapBootstrapToken(row)
        };
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to ensure bootstrap token')
  );
}

export function consumeBootstrapToken(
  pool: Pool,
  plaintextToken: string,
  options: { now?: Date | undefined } = {}
): ServiceResult<BootstrapTokenRecord> {
  return ResultAsync.fromPromise(
    (async () => {
      const now = options.now ?? new Date();
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const token = await consumeBootstrapTokenWithClient(
          client,
          plaintextToken,
          now
        );
        await client.query('COMMIT');
        return token;
      } catch (error) {
        if (isUnauthorizedAppError(error)) {
          await commitFailedAttemptQuietly(client);
        } else {
          await rollbackQuietly(client);
        }
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to consume bootstrap token')
  );
}

export function createFirstAdminWithBootstrapToken(
  pool: Pool,
  input: CreateFirstAdminInput
): ServiceResult<AdminUserRecord> {
  return ResultAsync.fromPromise(
    (async () => {
      const email = normalizeEmail(input.email);
      const now = input.now ?? new Date();
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query(
          'LOCK TABLE admin_users IN SHARE ROW EXCLUSIVE MODE'
        );

        const adminCount = await client.query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM admin_users'
        );
        if (adminCount.rows[0]?.count !== '0') {
          throw new AppError(
            ErrorCode.CONFLICT,
            'First admin has already been created'
          );
        }

        await consumeBootstrapTokenWithClient(
          client,
          input.bootstrapToken,
          now
        );

        validatePassword(input.password, email);
        const passwordHash = await hashAdminPassword(input.password);

        const result = await client.query<AdminUserRow>(
          `
            INSERT INTO admin_users (
              email,
              display_name,
              password_hash,
              status,
              mfa_required,
              password_changed_at,
              created_at
            )
            VALUES ($1, $2, $3, 'pending_mfa', true, $4, $4)
            RETURNING *
          `,
          [email, input.displayName ?? null, passwordHash, now]
        );

        const row = result.rows[0];
        if (!row) {
          throw new AppError(
            ErrorCode.INTERNAL,
            'Failed to create first admin'
          );
        }

        await client.query(
          `
            UPDATE admin_bootstrap_tokens
            SET invalidated_at = $1
            WHERE consumed_at IS NULL
              AND invalidated_at IS NULL
          `,
          [now]
        );

        await client.query('COMMIT');
        return mapAdminUser(row);
      } catch (error) {
        if (isUnauthorizedAppError(error)) {
          await commitFailedAttemptQuietly(client);
        } else {
          await rollbackQuietly(client);
        }
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to create first admin')
  );
}

async function consumeBootstrapTokenWithClient(
  client: PoolClient,
  plaintextToken: string,
  now: Date
): Promise<BootstrapTokenRecord> {
  const tokenHash = hashToken('bootstrap', plaintextToken);
  const result = await client.query<BootstrapTokenRow>(
    `
      SELECT *
      FROM admin_bootstrap_tokens
      WHERE token_hash = $1
      FOR UPDATE
    `,
    [tokenHash]
  );

  const row = result.rows[0];
  if (
    !row ||
    row.consumed_at ||
    row.invalidated_at ||
    row.expires_at.getTime() <= now.getTime()
  ) {
    await recordFailedBootstrapAttempt(client, now);
    throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid bootstrap token');
  }

  const consumed = await client.query<BootstrapTokenRow>(
    `
      UPDATE admin_bootstrap_tokens
      SET consumed_at = $2,
          last_attempt_at = $2
      WHERE id = $1
      RETURNING *
    `,
    [row.id, now]
  );

  const consumedRow = consumed.rows[0];
  if (!consumedRow) {
    throw new AppError(ErrorCode.INTERNAL, 'Failed to consume bootstrap token');
  }

  return mapBootstrapToken(consumedRow);
}

async function recordFailedBootstrapAttempt(
  client: PoolClient,
  now: Date
): Promise<void> {
  await client.query(
    `
      UPDATE admin_bootstrap_tokens
      SET attempt_count = attempt_count + 1,
          last_attempt_at = $1
      WHERE consumed_at IS NULL
        AND invalidated_at IS NULL
        AND expires_at > $1
    `,
    [now]
  );

  await client.query(
    `
      INSERT INTO admin_auth_attempts (
        attempt_type,
        succeeded,
        created_at
      )
      VALUES ('bootstrap', false, $1)
    `,
    [now]
  );
}

function isUnauthorizedAppError(error: unknown): boolean {
  return error instanceof AppError && error.code === ErrorCode.UNAUTHORIZED;
}

async function commitFailedAttemptQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('COMMIT');
  } catch {
    await rollbackQuietly(client);
  }
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Ignore rollback errors so the original failure is preserved.
  }
}

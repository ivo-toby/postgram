import { randomBytes } from 'node:crypto';

import argon2 from 'argon2';
import { ResultAsync } from 'neverthrow';
import type { Pool } from 'pg';

import type { ServiceResult } from '../types/common.js';
import type { EntityType, Visibility } from '../types/entities.js';
import { AppError, ErrorCode } from '../util/errors.js';
import type { ApiKeyRecord, AuthContext, Scope } from './types.js';

type CreateKeyInput = {
  name: string;
  scopes?: Scope[] | undefined;
  allowedTypes?: EntityType[] | null | undefined;
  allowedVisibility?: Visibility[] | undefined;
};

type CreateKeyResult = {
  plaintextKey: string;
  record: ApiKeyRecord;
};

type ApiKeyRow = {
  id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes: Scope[];
  allowed_types: EntityType[] | null;
  allowed_visibility: Visibility[];
  is_active: boolean;
  created_at: Date;
  last_used_at: Date | null;
};

const KEY_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function toAppError(
  error: unknown,
  fallbackMessage: string
): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(ErrorCode.INTERNAL, fallbackMessage, {
      cause: error.message
    });
  }

  return new AppError(ErrorCode.INTERNAL, fallbackMessage);
}

function mapApiKeyRecord(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    name: row.name,
    keyHash: row.key_hash,
    keyPrefix: row.key_prefix,
    scopes: row.scopes,
    allowedTypes: row.allowed_types,
    allowedVisibility: row.allowed_visibility,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null
  };
}

function toAuthContext(record: ApiKeyRecord): AuthContext {
  return {
    apiKeyId: record.id,
    keyName: record.name,
    scopes: record.scopes,
    allowedTypes: record.allowedTypes,
    allowedVisibility: record.allowedVisibility
  };
}

function generateRandomToken(length: number): string {
  const bytes = randomBytes(length);

  return Array.from(bytes, (byte) => KEY_ALPHABET[byte % KEY_ALPHABET.length])
    .join('');
}

function generatePlaintextKey(name: string): string {
  return `pgm-${name}-${generateRandomToken(32)}`;
}

export function requireScope(auth: AuthContext, scope: Scope): void {
  if (!auth.scopes.includes(scope)) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      `Key '${auth.keyName}' lacks '${scope}' scope`
    );
  }
}

export function checkTypeAccess(
  auth: AuthContext,
  entityType: EntityType
): void {
  if (auth.allowedTypes && !auth.allowedTypes.includes(entityType)) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      `Key '${auth.keyName}' cannot access '${entityType}' entities`
    );
  }
}

export function checkVisibilityAccess(
  auth: AuthContext,
  visibility: Visibility
): void {
  if (!auth.allowedVisibility.includes(visibility)) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      `Key '${auth.keyName}' cannot access '${visibility}' visibility`
    );
  }
}

export function createKey(
  pool: Pool,
  input: CreateKeyInput
): ServiceResult<CreateKeyResult> {
  return ResultAsync.fromPromise(
    (async () => {
      const plaintextKey = generatePlaintextKey(input.name);
      const keyHash = await argon2.hash(plaintextKey, {
        type: argon2.argon2id
      });
      const keyPrefix = plaintextKey.slice(0, 8);

      const result = await pool.query<ApiKeyRow>(
        `
          INSERT INTO api_keys (
            name,
            key_hash,
            key_prefix,
            scopes,
            allowed_types,
            allowed_visibility
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING *
        `,
        [
          input.name,
          keyHash,
          keyPrefix,
          input.scopes ?? ['read'],
          input.allowedTypes ?? null,
          input.allowedVisibility ?? ['shared']
        ]
      );

      const row = result.rows[0];
      if (!row) {
        throw new AppError(ErrorCode.INTERNAL, 'Failed to create API key');
      }

      return {
        plaintextKey,
        record: mapApiKeyRecord(row)
      };
    })(),
    (error) => toAppError(error, 'Failed to create API key')
  );
}

export function validateKey(
  pool: Pool,
  plaintextKey: string
): ServiceResult<AuthContext> {
  return ResultAsync.fromPromise(
    (async () => {
      const keyPrefix = plaintextKey.slice(0, 8);
      const result = await pool.query<ApiKeyRow>(
        `
          SELECT *
          FROM api_keys
          WHERE key_prefix = $1
            AND is_active = true
          LIMIT 1
        `,
        [keyPrefix]
      );

      const row = result.rows[0];
      if (!row) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid API key');
      }

      const valid = await argon2.verify(row.key_hash, plaintextKey);
      if (!valid) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid API key');
      }

      return toAuthContext(mapApiKeyRecord(row));
    })(),
    (error) => toAppError(error, 'Failed to validate API key')
  );
}

export function revokeKey(
  pool: Pool,
  apiKeyId: string
): ServiceResult<{ revoked: true }> {
  return ResultAsync.fromPromise(
    (async () => {
      const result = await pool.query(
        `
          UPDATE api_keys
          SET is_active = false
          WHERE id = $1
        `,
        [apiKeyId]
      );

      if (result.rowCount !== 1) {
        throw new AppError(ErrorCode.NOT_FOUND, 'API key not found');
      }

      return { revoked: true as const };
    })(),
    (error) => toAppError(error, 'Failed to revoke API key')
  );
}

export async function touchLastUsedAt(
  pool: Pool,
  apiKeyId: string
): Promise<void> {
  await pool.query(
    `
      UPDATE api_keys
      SET last_used_at = now()
      WHERE id = $1
    `,
    [apiKeyId]
  );
}

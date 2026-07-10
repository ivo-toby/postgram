import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { ResultAsync } from 'neverthrow';
import type { Pool, PoolClient } from 'pg';

import type { ServiceResult } from '../types/common.js';
import { AppError, ErrorCode } from '../util/errors.js';

export const ADMIN_SETTINGS_HTTP_AUTHORITY_CONTRACT = {
  namespace: '/admin/api/*',
  ordinaryApiKeyBearer: 'rejected',
  mcpOAuthBearer: 'rejected',
  requiresAdminSessionCookie: true,
  requiresCsrfForMutations: true,
  secretWritesRequireStepUp: true
} as const;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type RuntimeSettingValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null';

export type RuntimeSettingClassification =
  | 'bootstrap_only'
  | 'runtime_editable'
  | 'restart_required'
  | 'dangerous_migration';

export type RuntimeSettingState = 'pending' | 'applied';

export type RuntimeValidationStatus =
  | 'unvalidated'
  | 'valid'
  | 'invalid'
  | 'error';

export type RuntimeSecretPurpose =
  | 'embedding'
  | 'extraction'
  | 'provider'
  | 'other';

export type RuntimeValidationRecord = {
  status: RuntimeValidationStatus;
  message: string | null;
  metadata: JsonObject;
  validatedAt: string | null;
};

export type RuntimeSettingRecord = {
  key: string;
  value: JsonValue;
  appliedValue: JsonValue | null;
  valueType: RuntimeSettingValueType;
  classification: RuntimeSettingClassification;
  state: RuntimeSettingState;
  validation: RuntimeValidationRecord;
  appliedVersion: number;
  appliedAt: string | null;
  updatedByAdminUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeSecretMetadata = {
  name: string;
  configured: true;
  provider: string | null;
  purpose: RuntimeSecretPurpose;
  algorithm: 'aes-256-gcm';
  keyVersion: string;
  validation: RuntimeValidationRecord;
  updatedByAdminUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeValidationInput = {
  status: RuntimeValidationStatus;
  message?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
  validatedAt?: Date | undefined;
};

export type SaveRuntimeSettingInput = {
  key: string;
  value: unknown;
  classification: RuntimeSettingClassification;
  state?: RuntimeSettingState | undefined;
  actorAdminUserId?: string | undefined;
  validation?: RuntimeValidationInput | undefined;
  now?: Date | undefined;
};

export type UpdateRuntimeSettingValidationInput = {
  key: string;
  status: RuntimeValidationStatus;
  message?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
  actorAdminUserId?: string | undefined;
  validatedAt?: Date | undefined;
};

export type SaveRuntimeSecretInput = {
  name: string;
  plaintext: string;
  provider?: string | null | undefined;
  purpose: RuntimeSecretPurpose;
  encryptionKey: string;
  keyVersion?: string | undefined;
  actorAdminUserId?: string | undefined;
  validation?: RuntimeValidationInput | undefined;
  now?: Date | undefined;
};

type RuntimeSettingRow = {
  key: string;
  value: JsonValue;
  applied_value: JsonValue | null;
  value_type: RuntimeSettingValueType;
  classification: RuntimeSettingClassification;
  state: RuntimeSettingState;
  validation_status: RuntimeValidationStatus;
  validation_message: string | null;
  validation_metadata: JsonObject;
  validated_at: Date | null;
  applied_version: number;
  applied_at: Date | null;
  updated_by_admin_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

type RuntimeSecretRow = {
  name: string;
  provider: string | null;
  purpose: RuntimeSecretPurpose;
  ciphertext: string;
  nonce: string;
  auth_tag: string;
  algorithm: 'aes-256-gcm';
  key_version: string;
  validation_status: RuntimeValidationStatus;
  validation_message: string | null;
  validation_metadata: JsonObject;
  validated_at: Date | null;
  updated_by_admin_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const SETTING_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/;
const SECRET_NAME_PATTERN = SETTING_KEY_PATTERN;
const PROVIDER_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const KEY_VERSION_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const SECRET_SETTING_KEYS = new Set([
  'ADMIN_SETTINGS_ENCRYPTION_KEY',
  'DATABASE_URL'
]);
const SECRET_SETTING_KEY_SUFFIXES = [
  '_API_KEY',
  '_PRIVATE_KEY',
  '_SECRET',
  '_TOKEN',
  '_PASSWORD'
] as const;
const SECRET_NONCE_BYTES = 12;
const SECRET_KEY_BYTES = 32;
const BASE64URL_32_BYTE_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const BASE64_32_BYTE_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const SETTING_CLASSIFICATIONS = [
  'bootstrap_only',
  'runtime_editable',
  'restart_required',
  'dangerous_migration'
] as const;
const SETTING_STATES = ['pending', 'applied'] as const;
const VALIDATION_STATUSES = [
  'unvalidated',
  'valid',
  'invalid',
  'error'
] as const;
const SECRET_PURPOSES = [
  'embedding',
  'extraction',
  'provider',
  'other'
] as const;

function toAppError(error: unknown, fallbackMessage: string): AppError {
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

function validationError(message: string, details: JsonObject): AppError {
  return new AppError(ErrorCode.VALIDATION, message, details);
}

function requireSettingKey(key: string): string {
  if (!SETTING_KEY_PATTERN.test(key)) {
    throw validationError('Invalid runtime setting key', {
      field: 'key',
      expected: 'SCREAMING_SNAKE_CASE'
    });
  }

  return key;
}

function isSecretSettingKey(key: string): boolean {
  return (
    SECRET_SETTING_KEYS.has(key) ||
    SECRET_SETTING_KEY_SUFFIXES.some((suffix) => key.endsWith(suffix))
  );
}

function requirePlainRuntimeSettingKey(key: string): string {
  const normalizedKey = requireSettingKey(key);

  if (isSecretSettingKey(normalizedKey)) {
    throw validationError('Runtime secrets must use the secret store', {
      field: 'key',
      secretStore: 'admin_runtime_secrets'
    });
  }

  return normalizedKey;
}

function requireSecretName(name: string): string {
  if (!SECRET_NAME_PATTERN.test(name)) {
    throw validationError('Invalid runtime secret name', {
      field: 'name',
      expected: 'SCREAMING_SNAKE_CASE'
    });
  }

  return name;
}

function requireProvider(provider: string | null | undefined): string | null {
  if (provider === undefined || provider === null || provider === '') {
    return null;
  }

  if (!PROVIDER_PATTERN.test(provider)) {
    throw validationError('Invalid runtime secret provider', {
      field: 'provider'
    });
  }

  return provider;
}

function requireKeyVersion(keyVersion: string | undefined): string {
  const version = keyVersion ?? 'v1';
  if (!KEY_VERSION_PATTERN.test(version)) {
    throw validationError('Invalid runtime secret key version', {
      field: 'keyVersion'
    });
  }

  return version;
}

function requirePlaintextSecret(plaintext: string): string {
  if (plaintext.length === 0) {
    throw validationError('Secret value must not be empty', {
      field: 'plaintext'
    });
  }

  return plaintext;
}

function requireSettingClassification(
  classification: RuntimeSettingClassification
): RuntimeSettingClassification {
  if (
    !(SETTING_CLASSIFICATIONS as readonly string[]).includes(classification)
  ) {
    throw validationError('Invalid runtime setting classification', {
      field: 'classification'
    });
  }

  return classification;
}

function requireSettingState(state: RuntimeSettingState): RuntimeSettingState {
  if (!(SETTING_STATES as readonly string[]).includes(state)) {
    throw validationError('Invalid runtime setting state', {
      field: 'state'
    });
  }

  return state;
}

function requireValidationStatus(
  status: RuntimeValidationStatus
): RuntimeValidationStatus {
  if (!(VALIDATION_STATUSES as readonly string[]).includes(status)) {
    throw validationError('Invalid runtime validation status', {
      field: 'status'
    });
  }

  return status;
}

function requireSecretPurpose(
  purpose: RuntimeSecretPurpose
): RuntimeSecretPurpose {
  if (!(SECRET_PURPOSES as readonly string[]).includes(purpose)) {
    throw validationError('Invalid runtime secret purpose', {
      field: 'purpose'
    });
  }

  return purpose;
}

function ensureJsonValue(value: unknown, field: string): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw validationError('JSON numbers must be finite', { field });
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      ensureJsonValue(item, `${field}.${index}`)
    );
  }

  if (typeof value === 'object' && value !== null) {
    const output: JsonObject = {};
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (item === undefined) {
        throw validationError('JSON values must not contain undefined', {
          field: `${field}.${key}`
        });
      }
      output[key] = ensureJsonValue(item, `${field}.${key}`);
    }

    return output;
  }

  throw validationError('Value must be JSON serializable', { field });
}

function ensureJsonObject(
  value: Record<string, unknown> | undefined,
  field: string
): JsonObject {
  if (value === undefined) {
    return {};
  }

  const json = ensureJsonValue(value, field);
  if (json === null || Array.isArray(json) || typeof json !== 'object') {
    throw validationError('Metadata must be a JSON object', { field });
  }

  return json;
}

function getJsonValueType(value: JsonValue): RuntimeSettingValueType {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  if (typeof value === 'object') {
    return 'object';
  }

  if (typeof value === 'string') {
    return 'string';
  }

  if (typeof value === 'number') {
    return 'number';
  }

  return 'boolean';
}

function normalizeValidation(input: RuntimeValidationInput | undefined): {
  status: RuntimeValidationStatus;
  message: string | null;
  metadata: JsonObject;
  validatedAt: Date | null;
} {
  return {
    status: requireValidationStatus(input?.status ?? 'unvalidated'),
    message: input?.message ?? null,
    metadata: ensureJsonObject(input?.metadata, 'validation.metadata'),
    validatedAt: input?.validatedAt ?? null
  };
}

function normalizeSecretValidation(input: RuntimeValidationInput | undefined): {
  status: RuntimeValidationStatus;
  message: string | null;
  metadata: JsonObject;
  validatedAt: Date | null;
} {
  const validation = normalizeValidation(input);
  return {
    ...validation,
    metadata: {}
  };
}

function mapValidation(row: {
  validation_status: RuntimeValidationStatus;
  validation_message: string | null;
  validation_metadata: JsonObject;
  validated_at: Date | null;
}): RuntimeValidationRecord {
  return {
    status: row.validation_status,
    message: row.validation_message,
    metadata: row.validation_metadata,
    validatedAt: row.validated_at?.toISOString() ?? null
  };
}

function mapSecretValidation(row: {
  validation_status: RuntimeValidationStatus;
  validation_message: string | null;
  validation_metadata: JsonObject;
  validated_at: Date | null;
}): RuntimeValidationRecord {
  return {
    ...mapValidation(row),
    metadata: {}
  };
}

function mapSetting(row: RuntimeSettingRow): RuntimeSettingRecord {
  return {
    key: row.key,
    value: row.value,
    appliedValue: row.applied_value,
    valueType: row.value_type,
    classification: row.classification,
    state: row.state,
    validation: mapValidation(row),
    appliedVersion: row.applied_version,
    appliedAt: row.applied_at?.toISOString() ?? null,
    updatedByAdminUserId: row.updated_by_admin_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapSecretMetadata(row: RuntimeSecretRow): RuntimeSecretMetadata {
  return {
    name: row.name,
    configured: true,
    provider: row.provider,
    purpose: row.purpose,
    algorithm: row.algorithm,
    keyVersion: row.key_version,
    validation: mapSecretValidation(row),
    updatedByAdminUserId: row.updated_by_admin_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function decodeEncryptionKey(rawKey: string): Buffer {
  const trimmed = rawKey.trim();
  const hasBase64Prefix = trimmed.startsWith('base64:');
  const encoded = hasBase64Prefix ? trimmed.slice('base64:'.length) : trimmed;
  const encoding: BufferEncoding = hasBase64Prefix ? 'base64' : 'base64url';

  if (
    (hasBase64Prefix && !BASE64_32_BYTE_KEY_PATTERN.test(encoded)) ||
    (!hasBase64Prefix && !BASE64URL_32_BYTE_KEY_PATTERN.test(encoded))
  ) {
    throw validationError(
      'ADMIN_SETTINGS_ENCRYPTION_KEY must be a 32-byte base64url value',
      {
        field: 'encryptionKey',
        format: hasBase64Prefix ? 'base64:base64-32-byte-key' : 'base64url'
      }
    );
  }

  const key = Buffer.from(encoded, encoding);

  if (key.length !== SECRET_KEY_BYTES) {
    throw validationError(
      'ADMIN_SETTINGS_ENCRYPTION_KEY must decode to 32 bytes',
      {
        field: 'encryptionKey',
        expectedBytes: SECRET_KEY_BYTES
      }
    );
  }

  return key;
}

function encryptSecret(
  plaintext: string,
  rawEncryptionKey: string
): {
  ciphertext: string;
  nonce: string;
  authTag: string;
} {
  const encryptionKey = decodeEncryptionKey(rawEncryptionKey);
  const nonce = randomBytes(SECRET_NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('base64url'),
    nonce: nonce.toString('base64url'),
    authTag: authTag.toString('base64url')
  };
}

function decryptSecret(
  row: RuntimeSecretRow,
  rawEncryptionKey: string
): string {
  const encryptionKey = decodeEncryptionKey(rawEncryptionKey);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey,
    Buffer.from(row.nonce, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(row.auth_tag, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original service error.
  }
}

async function writeAdminAudit(
  executor: PoolClient,
  input: {
    adminUserId: string | null;
    operation: string;
    details: JsonObject;
  }
): Promise<void> {
  await executor.query(
    `
      INSERT INTO audit_log (
        api_key_id,
        admin_user_id,
        operation,
        entity_id,
        details
      )
      VALUES (NULL, $1, $2, NULL, $3)
    `,
    [input.adminUserId, input.operation, input.details]
  );
}

export function saveRuntimeSetting(
  pool: Pool,
  input: SaveRuntimeSettingInput
): ServiceResult<RuntimeSettingRecord> {
  return ResultAsync.fromPromise(
    (async () => {
      const key = requirePlainRuntimeSettingKey(input.key);
      const value = ensureJsonValue(input.value, 'value');
      const valueType = getJsonValueType(value);
      const classification = requireSettingClassification(input.classification);
      const state = requireSettingState(input.state ?? 'pending');
      const appliedValueJson =
        state === 'applied' ? JSON.stringify(value) : null;
      const validation = normalizeValidation(input.validation);
      const now = input.now ?? new Date();
      const actorAdminUserId = input.actorAdminUserId ?? null;
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const saved = await client.query<RuntimeSettingRow>(
          `
            INSERT INTO admin_runtime_settings (
              key,
              value,
              applied_value,
              value_type,
              classification,
              state,
              validation_status,
              validation_message,
              validation_metadata,
              validated_at,
              updated_by_admin_user_id,
              created_at,
              updated_at
            )
            VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $12)
            ON CONFLICT (key) DO UPDATE SET
              value = EXCLUDED.value,
              applied_value = CASE
                WHEN EXCLUDED.state = 'applied' THEN EXCLUDED.value
                ELSE admin_runtime_settings.applied_value
              END,
              value_type = EXCLUDED.value_type,
              classification = EXCLUDED.classification,
              state = EXCLUDED.state,
              validation_status = EXCLUDED.validation_status,
              validation_message = EXCLUDED.validation_message,
              validation_metadata = EXCLUDED.validation_metadata,
              validated_at = EXCLUDED.validated_at,
              updated_by_admin_user_id = EXCLUDED.updated_by_admin_user_id,
              updated_at = EXCLUDED.updated_at
            RETURNING *
          `,
          [
            key,
            JSON.stringify(value),
            appliedValueJson,
            valueType,
            classification,
            state,
            validation.status,
            validation.message,
            JSON.stringify(validation.metadata),
            validation.validatedAt,
            actorAdminUserId,
            now
          ]
        );
        const row = saved.rows[0];
        if (!row) {
          throw new AppError(
            ErrorCode.INTERNAL,
            'Failed to save runtime setting'
          );
        }

        await writeAdminAudit(client, {
          adminUserId: actorAdminUserId,
          operation: 'admin.settings.save',
          details: {
            key,
            classification,
            state,
            validation_status: validation.status,
            value_changed: true
          }
        });

        await client.query('COMMIT');
        return mapSetting(row);
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to save runtime setting')
  );
}

export function getRuntimeSetting(
  pool: Pool,
  key: string
): ServiceResult<RuntimeSettingRecord | null> {
  return ResultAsync.fromPromise(
    (async () => {
      const normalizedKey = requirePlainRuntimeSettingKey(key);
      const result = await pool.query<RuntimeSettingRow>(
        `
          SELECT *
          FROM admin_runtime_settings
          WHERE key = $1
          LIMIT 1
        `,
        [normalizedKey]
      );

      const row = result.rows[0];
      return row ? mapSetting(row) : null;
    })(),
    (error) => toAppError(error, 'Failed to get runtime setting')
  );
}

export function updateRuntimeSettingValidation(
  pool: Pool,
  input: UpdateRuntimeSettingValidationInput
): ServiceResult<RuntimeSettingRecord> {
  return ResultAsync.fromPromise(
    (async () => {
      const key = requirePlainRuntimeSettingKey(input.key);
      const metadata = ensureJsonObject(input.metadata, 'metadata');
      const status = requireValidationStatus(input.status);
      const validatedAt = input.validatedAt ?? new Date();
      const actorAdminUserId = input.actorAdminUserId ?? null;
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const updated = await client.query<RuntimeSettingRow>(
          `
            UPDATE admin_runtime_settings
            SET
              validation_status = $2,
              validation_message = $3,
              validation_metadata = $4::jsonb,
              validated_at = $5,
              updated_by_admin_user_id = $6
            WHERE key = $1
            RETURNING *
          `,
          [
            key,
            status,
            input.message ?? null,
            JSON.stringify(metadata),
            validatedAt,
            actorAdminUserId
          ]
        );
        const row = updated.rows[0];
        if (!row) {
          throw new AppError(ErrorCode.NOT_FOUND, 'Runtime setting not found', {
            key
          });
        }

        await writeAdminAudit(client, {
          adminUserId: actorAdminUserId,
          operation: 'admin.settings.validate',
          details: {
            key,
            validation_status: status
          }
        });

        await client.query('COMMIT');
        return mapSetting(row);
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to update runtime setting validation')
  );
}

export function saveRuntimeSecret(
  pool: Pool,
  input: SaveRuntimeSecretInput
): ServiceResult<RuntimeSecretMetadata> {
  return ResultAsync.fromPromise(
    (async () => {
      const name = requireSecretName(input.name);
      const provider = requireProvider(input.provider);
      const purpose = requireSecretPurpose(input.purpose);
      const plaintext = requirePlaintextSecret(input.plaintext);
      const encrypted = encryptSecret(plaintext, input.encryptionKey);
      const validation = normalizeSecretValidation(input.validation);
      const keyVersion = requireKeyVersion(input.keyVersion);
      const now = input.now ?? new Date();
      const actorAdminUserId = input.actorAdminUserId ?? null;
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const saved = await client.query<RuntimeSecretRow>(
          `
            INSERT INTO admin_runtime_secrets (
              name,
              provider,
              purpose,
              ciphertext,
              nonce,
              auth_tag,
              algorithm,
              key_version,
              validation_status,
              validation_message,
              validation_metadata,
              validated_at,
              updated_by_admin_user_id,
              created_at,
              updated_at
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              'aes-256-gcm',
              $7,
              $8,
              $9,
              $10::jsonb,
              $11,
              $12,
              $13,
              $13
            )
            ON CONFLICT (name) DO UPDATE SET
              provider = EXCLUDED.provider,
              purpose = EXCLUDED.purpose,
              ciphertext = EXCLUDED.ciphertext,
              nonce = EXCLUDED.nonce,
              auth_tag = EXCLUDED.auth_tag,
              algorithm = EXCLUDED.algorithm,
              key_version = EXCLUDED.key_version,
              validation_status = EXCLUDED.validation_status,
              validation_message = EXCLUDED.validation_message,
              validation_metadata = EXCLUDED.validation_metadata,
              validated_at = EXCLUDED.validated_at,
              updated_by_admin_user_id = EXCLUDED.updated_by_admin_user_id,
              updated_at = EXCLUDED.updated_at
            RETURNING *
          `,
          [
            name,
            provider,
            purpose,
            encrypted.ciphertext,
            encrypted.nonce,
            encrypted.authTag,
            keyVersion,
            validation.status,
            validation.message,
            JSON.stringify(validation.metadata),
            validation.validatedAt,
            actorAdminUserId,
            now
          ]
        );
        const row = saved.rows[0];
        if (!row) {
          throw new AppError(
            ErrorCode.INTERNAL,
            'Failed to save runtime secret'
          );
        }

        await writeAdminAudit(client, {
          adminUserId: actorAdminUserId,
          operation: 'admin.secrets.save',
          details: {
            name,
            provider: provider ?? 'unassigned',
            purpose,
            configured: true,
            validation_status: validation.status,
            key_version: keyVersion,
            value_changed: true
          }
        });

        await client.query('COMMIT');
        return mapSecretMetadata(row);
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to save runtime secret')
  );
}

export function getRuntimeSecretMetadata(
  pool: Pool,
  name: string
): ServiceResult<RuntimeSecretMetadata | null> {
  return ResultAsync.fromPromise(
    (async () => {
      const result = await pool.query<RuntimeSecretRow>(
        `
          SELECT
            name,
            provider,
            purpose,
            ciphertext,
            nonce,
            auth_tag,
            algorithm,
            key_version,
            validation_status,
            validation_message,
            validation_metadata,
            validated_at,
            updated_by_admin_user_id,
            created_at,
            updated_at
          FROM admin_runtime_secrets
          WHERE name = $1
          LIMIT 1
        `,
        [requireSecretName(name)]
      );

      const row = result.rows[0];
      return row ? mapSecretMetadata(row) : null;
    })(),
    (error) => toAppError(error, 'Failed to get runtime secret metadata')
  );
}

export function getRuntimeSecretPlaintext(
  pool: Pool,
  input: {
    name: string;
    encryptionKey: string;
  }
): ServiceResult<string | null> {
  return ResultAsync.fromPromise(
    (async () => {
      const result = await pool.query<RuntimeSecretRow>(
        `
          SELECT
            name,
            provider,
            purpose,
            ciphertext,
            nonce,
            auth_tag,
            algorithm,
            key_version,
            validation_status,
            validation_message,
            validation_metadata,
            validated_at,
            updated_by_admin_user_id,
            created_at,
            updated_at
          FROM admin_runtime_secrets
          WHERE name = $1
          LIMIT 1
        `,
        [requireSecretName(input.name)]
      );

      const row = result.rows[0];
      return row ? decryptSecret(row, input.encryptionKey) : null;
    })(),
    (error) => toAppError(error, 'Failed to read runtime secret')
  );
}

export function listRuntimeSecrets(
  pool: Pool
): ServiceResult<RuntimeSecretMetadata[]> {
  return ResultAsync.fromPromise(
    (async () => {
      const result = await pool.query<RuntimeSecretRow>(
        `
          SELECT
            name,
            provider,
            purpose,
            ciphertext,
            nonce,
            auth_tag,
            algorithm,
            key_version,
            validation_status,
            validation_message,
            validation_metadata,
            validated_at,
            updated_by_admin_user_id,
            created_at,
            updated_at
          FROM admin_runtime_secrets
          ORDER BY name ASC
        `
      );

      return result.rows.map(mapSecretMetadata);
    })(),
    (error) => toAppError(error, 'Failed to list runtime secret metadata')
  );
}

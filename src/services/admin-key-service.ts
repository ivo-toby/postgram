import type { Pool, PoolClient } from 'pg';

import { createKey, revokeKey } from '../auth/key-service.js';
import type { Scope } from '../auth/types.js';
import type { EntityType, Visibility } from '../types/entities.js';

type ApiKeyMetadataRow = {
  id: string;
  name: string;
  client_id: string;
  scopes: Scope[];
  allowed_types: EntityType[] | null;
  allowed_visibility: Visibility[];
  is_active: boolean;
  created_at: Date;
  last_used_at: Date | null;
};

export type AdminApiKeyMetadata = {
  id: string;
  name: string;
  clientId: string;
  scopes: Scope[];
  allowedTypes: EntityType[] | null;
  allowedVisibility: Visibility[];
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

export type AdminCreateApiKeyInput = {
  name: string;
  clientId?: string | undefined;
  scopes?: Scope[] | undefined;
  allowedTypes?: EntityType[] | null | undefined;
  allowedVisibility?: Visibility[] | undefined;
  actorAdminUserId: string;
};

export type AdminApiKeyPagination = {
  limit: number;
  offset: number;
  nextOffset: number | null;
};

function toAdminApiKeyMetadata(row: ApiKeyMetadataRow): AdminApiKeyMetadata {
  return {
    id: row.id,
    name: row.name,
    clientId: row.client_id,
    scopes: row.scopes,
    allowedTypes: row.allowed_types,
    allowedVisibility: row.allowed_visibility,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null
  };
}

async function writeAdminKeyAudit(
  pool: Pool | PoolClient,
  input: {
    actorAdminUserId: string;
    operation: 'key.create' | 'key.list' | 'key.revoke';
    entityId?: string | null | undefined;
    details?: Record<string, unknown> | undefined;
  }
): Promise<void> {
  await pool.query(
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
    [
      input.actorAdminUserId,
      input.operation,
      input.entityId ?? null,
      input.details ?? {}
    ]
  );
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original error that triggered rollback.
  }
}

export async function listAdminApiKeys(
  pool: Pool,
  input: {
    actorAdminUserId: string;
    limit: number;
    offset: number;
  }
): Promise<{
  keys: AdminApiKeyMetadata[];
  pagination: AdminApiKeyPagination;
}> {
  const result = await pool.query<ApiKeyMetadataRow>(
    `
      SELECT
        id,
        name,
        client_id,
        scopes,
        allowed_types,
        allowed_visibility,
        is_active,
        created_at,
        last_used_at
      FROM api_keys
      ORDER BY created_at DESC, id DESC
      LIMIT $1
      OFFSET $2
    `,
    [input.limit + 1, input.offset]
  );
  const hasMore = result.rows.length > input.limit;
  const keys = result.rows.slice(0, input.limit).map(toAdminApiKeyMetadata);

  await writeAdminKeyAudit(pool, {
    actorAdminUserId: input.actorAdminUserId,
    operation: 'key.list',
    details: {
      limit: input.limit,
      offset: input.offset
    }
  });

  return {
    keys,
    pagination: {
      limit: input.limit,
      offset: input.offset,
      nextOffset: hasMore ? input.offset + input.limit : null
    }
  };
}

export async function createAdminApiKey(
  pool: Pool,
  input: AdminCreateApiKeyInput
): Promise<{
  plaintextKey: string;
  key: AdminApiKeyMetadata;
}> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const created = await createKey(client, {
      name: input.name,
      clientId: input.clientId,
      scopes: input.scopes,
      allowedTypes: input.allowedTypes,
      allowedVisibility: input.allowedVisibility
    });

    if (created.isErr()) {
      throw created.error;
    }

    await writeAdminKeyAudit(client, {
      actorAdminUserId: input.actorAdminUserId,
      operation: 'key.create',
      entityId: created.value.record.id,
      details: {
        name: created.value.record.name,
        clientId: created.value.record.clientId,
        scopes: created.value.record.scopes,
        allowedTypes: created.value.record.allowedTypes,
        allowedVisibility: created.value.record.allowedVisibility
      }
    });
    await client.query('COMMIT');

    return {
      plaintextKey: created.value.plaintextKey,
      key: {
        id: created.value.record.id,
        name: created.value.record.name,
        clientId: created.value.record.clientId,
        scopes: created.value.record.scopes,
        allowedTypes: created.value.record.allowedTypes,
        allowedVisibility: created.value.record.allowedVisibility,
        isActive: created.value.record.isActive,
        createdAt: created.value.record.createdAt,
        lastUsedAt: created.value.record.lastUsedAt
      }
    };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeAdminApiKey(
  pool: Pool,
  input: {
    id: string;
    actorAdminUserId: string;
  }
): Promise<{
  revoked: true;
  id: string;
}> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const revoked = await revokeKey(client, input.id);

    if (revoked.isErr()) {
      throw revoked.error;
    }

    await writeAdminKeyAudit(client, {
      actorAdminUserId: input.actorAdminUserId,
      operation: 'key.revoke',
      entityId: input.id
    });
    await client.query('COMMIT');

    return {
      revoked: true,
      id: input.id
    };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

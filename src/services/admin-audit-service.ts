import type { Pool } from 'pg';

type AuditRow = {
  id: string;
  api_key_id: string | null;
  key_name: string | null;
  admin_user_id: string | null;
  admin_email: string | null;
  operation: string;
  entity_id: string | null;
  details: unknown;
  timestamp: Date;
};

export type AdminAuditEntry = {
  id: string;
  timestamp: string;
  operation: string;
  entityId: string | null;
  apiKeyId: string | null;
  keyName: string | null;
  adminUserId: string | null;
  adminEmail: string | null;
  details: unknown;
};

export type AdminAuditQuery = {
  since?: Date | undefined;
  until?: Date | undefined;
  apiKeyId?: string | undefined;
  keyName?: string | undefined;
  adminUserId?: string | undefined;
  operation?: string[] | undefined;
  entityId?: string | undefined;
  limit: number;
  offset: number;
  actorAdminUserId: string;
};

export type AdminAuditPagination = {
  limit: number;
  offset: number;
  nextOffset: number | null;
};

const REDACTED = '[redacted]';
const ADMIN_AUDIT_QUERY_SOURCE = 'admin.api.audit.query';
const SENSITIVE_DETAIL_KEYS = [
  'access_key',
  'accesskey',
  'api_key',
  'apikey',
  'authorization',
  'auth_tag',
  'authtag',
  'ciphertext',
  'hash',
  'key_hash',
  'keyhash',
  'key_prefix',
  'keyprefix',
  'password',
  'plaintext',
  'plaintext_key',
  'plaintextkey',
  'prefix',
  'provider_api_key',
  'providerapikey',
  'secret',
  'token'
];
const SENSITIVE_VALUE_PATTERNS = [
  /pgm-[^\s"'`]{8,}/iu,
  /\bsk-[A-Za-z0-9_-]{16,}\b/u
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isSensitiveDetailKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, '');
  return SENSITIVE_DETAIL_KEYS.some((sensitiveKey) =>
    normalized.includes(sensitiveKey.replace(/[^a-z0-9]/gu, ''))
  );
}

function containsSensitiveDetailValue(value: string): boolean {
  return SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function redactAuditDetails(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactAuditDetails);
  }

  if (typeof value === 'string' && containsSensitiveDetailValue(value)) {
    return REDACTED;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      isSensitiveDetailKey(key) ? REDACTED : redactAuditDetails(nested)
    ])
  );
}

function toAdminAuditEntry(row: AuditRow): AdminAuditEntry {
  return {
    id: row.id,
    timestamp: row.timestamp.toISOString(),
    operation: row.operation,
    entityId: row.entity_id,
    apiKeyId: row.api_key_id,
    keyName: row.key_name,
    adminUserId: row.admin_user_id,
    adminEmail: row.admin_email,
    details: redactAuditDetails(row.details)
  };
}

async function writeAuditQueryAudit(
  pool: Pool,
  query: AdminAuditQuery
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
      VALUES (NULL, $1, 'audit.query', NULL, $2)
    `,
    [
      query.actorAdminUserId,
      {
        source: ADMIN_AUDIT_QUERY_SOURCE,
        since: query.since?.toISOString() ?? null,
        until: query.until?.toISOString() ?? null,
        apiKeyId: query.apiKeyId ?? null,
        keyName: query.keyName ?? null,
        adminUserId: query.adminUserId ?? null,
        operation: query.operation ?? null,
        entityId: query.entityId ?? null,
        limit: query.limit,
        offset: query.offset
      }
    ]
  );
}

export async function queryAdminAudit(
  pool: Pool,
  query: AdminAuditQuery
): Promise<{
  entries: AdminAuditEntry[];
  pagination: AdminAuditPagination;
}> {
  const filters: string[] = [];
  const params: unknown[] = [];

  params.push(ADMIN_AUDIT_QUERY_SOURCE);
  filters.push(
    `(a.operation <> 'audit.query' OR COALESCE(a.details->>'source', '') <> $${params.length})`
  );

  if (query.since) {
    params.push(query.since);
    filters.push(`a.timestamp >= $${params.length}`);
  }

  if (query.until) {
    params.push(query.until);
    filters.push(`a.timestamp <= $${params.length}`);
  }

  if (query.apiKeyId) {
    params.push(query.apiKeyId);
    filters.push(`a.api_key_id = $${params.length}`);
  }

  if (query.keyName) {
    params.push(query.keyName);
    filters.push(`k.name = $${params.length}`);
  }

  if (query.adminUserId) {
    params.push(query.adminUserId);
    filters.push(`a.admin_user_id = $${params.length}`);
  }

  if (query.operation?.length) {
    params.push(query.operation);
    filters.push(`a.operation = ANY($${params.length})`);
  } else {
    filters.push("a.operation <> 'audit.query'");
  }

  if (query.entityId) {
    params.push(query.entityId);
    filters.push(`a.entity_id = $${params.length}`);
  }

  params.push(query.limit + 1);
  const limitParam = params.length;
  params.push(query.offset);
  const offsetParam = params.length;

  const result = await pool.query<AuditRow>(
    `
      SELECT
        a.id,
        a.api_key_id,
        k.name AS key_name,
        a.admin_user_id,
        u.email AS admin_email,
        a.operation,
        a.entity_id,
        a.details,
        a.timestamp
      FROM audit_log a
      LEFT JOIN api_keys k ON k.id = a.api_key_id
      LEFT JOIN admin_users u ON u.id = a.admin_user_id
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY a.timestamp DESC, a.id DESC
      LIMIT $${limitParam}
      OFFSET $${offsetParam}
    `,
    params
  );
  const hasMore = result.rows.length > query.limit;
  const entries = result.rows.slice(0, query.limit).map(toAdminAuditEntry);

  await writeAuditQueryAudit(pool, query);

  return {
    entries,
    pagination: {
      limit: query.limit,
      offset: query.offset,
      nextOffset: hasMore ? query.offset + query.limit : null
    }
  };
}

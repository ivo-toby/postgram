import type { Pool } from 'pg';

type AuditEntryInput = {
  apiKeyId?: string | null;
  operation: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
};

export async function appendAuditEntry(
  pool: Pool,
  input: AuditEntryInput
): Promise<void> {
  await pool.query(
    `
      INSERT INTO audit_log (
        api_key_id,
        operation,
        entity_id,
        details
      )
      VALUES ($1, $2, $3, $4)
    `,
    [
      input.apiKeyId ?? null,
      input.operation,
      input.entityId ?? null,
      input.details ?? {}
    ]
  );
}

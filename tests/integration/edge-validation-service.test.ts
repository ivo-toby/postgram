import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  parseValidationResponse,
  validateEdgeBatch
} from '../../src/services/edge-validation-service.js';
import { storeEntity } from '../../src/services/entity-service.js';
import { createEdge } from '../../src/services/edge-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

function makeAuthContext(): AuthContext {
  return {
    apiKeyId: '00000000-0000-0000-0000-000000000501',
    keyName: 'edge-validation-key',
    scopes: ['read', 'write', 'delete'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared']
  };
}

describe('edge-validation-service', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    if (!database) throw new Error('test database not initialized');
    await resetTestDatabase(database.pool);
    await seedApiKey(database.pool, {
      id: '00000000-0000-0000-0000-000000000501',
      name: 'edge-validation-key'
    });
  });

  afterAll(async () => {
    if (database) await database.close();
  });

  describe('parseValidationResponse', () => {
    it('parses well-formed verdicts', () => {
      expect(
        parseValidationResponse('{"valid": true, "confidence": 0.9, "reason": "ok"}')
      ).toEqual({ valid: true, confidence: 0.9, reason: 'ok' });
    });

    it('extracts JSON from surrounding prose', () => {
      const response = 'Sure! Here is the verdict:\n{"valid": false, "confidence": 0.1}\nHope that helps.';
      expect(parseValidationResponse(response)).toEqual({ valid: false, confidence: 0.1 });
    });

    it('returns null for malformed responses', () => {
      expect(parseValidationResponse('not json')).toBeNull();
      expect(parseValidationResponse('{"valid": "maybe"}')).toBeNull();
    });
  });

  it('removes edges the LLM judges invalid and keeps valid ones with timestamp', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();

    const source = (await storeEntity(database.pool, auth, {
      type: 'memory',
      content: 'Alice works on Project Alpha.'
    }))._unsafeUnwrap();
    const keep = (await storeEntity(database.pool, auth, {
      type: 'project',
      content: 'Project Alpha'
    }))._unsafeUnwrap();
    const drop = (await storeEntity(database.pool, auth, {
      type: 'project',
      content: 'Unrelated project'
    }))._unsafeUnwrap();

    const validEdge = (await createEdge(database.pool, auth, {
      sourceId: source.id,
      targetId: keep.id,
      relation: 'involves',
      source: 'llm-extraction'
    }))._unsafeUnwrap();
    const hallucinatedEdge = (await createEdge(database.pool, auth, {
      sourceId: source.id,
      targetId: drop.id,
      relation: 'involves',
      source: 'llm-extraction'
    }))._unsafeUnwrap();

    const callLlm = async (prompt: string): Promise<string> => {
      if (prompt.includes('Unrelated project')) {
        return '{"valid": false, "confidence": 0.1, "reason": "not mentioned"}';
      }
      return '{"valid": true, "confidence": 0.95, "reason": "clearly supported"}';
    };

    const fixedNow = new Date('2026-04-22T10:00:00Z');
    const result = await validateEdgeBatch(database.pool, callLlm, {
      source: 'llm-extraction',
      now: () => fixedNow
    });

    expect(result).toMatchObject({ checked: 2, removed: 1, kept: 1, errored: 0 });

    const rows = await database.pool.query<{
      id: string;
      metadata: Record<string, unknown>;
    }>('SELECT id, metadata FROM edges');
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.id).toBe(validEdge.id);
    expect(rows.rows[0]?.metadata['last_validated_at']).toBe(fixedNow.toISOString());

    // The hallucinated edge is gone.
    const gone = await database.pool.query('SELECT 1 FROM edges WHERE id = $1', [
      hallucinatedEdge.id
    ]);
    expect(gone.rowCount).toBe(0);
  }, 120_000);

  it('skips edges validated within skipValidatedDays unless force is set', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();

    const src = (await storeEntity(database.pool, auth, {
      type: 'memory', content: 'source content'
    }))._unsafeUnwrap();
    const tgt = (await storeEntity(database.pool, auth, {
      type: 'project', content: 'target content'
    }))._unsafeUnwrap();

    const edge = (await createEdge(database.pool, auth, {
      sourceId: src.id,
      targetId: tgt.id,
      relation: 'involves',
      source: 'llm-extraction'
    }))._unsafeUnwrap();

    // Mark recently validated.
    const recent = new Date('2026-04-20T00:00:00Z');
    await database.pool.query(
      `UPDATE edges SET metadata = jsonb_set(metadata, '{last_validated_at}', to_jsonb($1::text)) WHERE id = $2`,
      [recent.toISOString(), edge.id]
    );

    let calls = 0;
    const callLlm = async (): Promise<string> => {
      calls += 1;
      return '{"valid": false, "confidence": 0.0}';
    };

    const now = () => new Date('2026-04-22T00:00:00Z');

    const skippedResult = await validateEdgeBatch(database.pool, callLlm, {
      skipValidatedDays: 7,
      now
    });
    expect(skippedResult.checked).toBe(0);
    expect(calls).toBe(0);

    const forcedResult = await validateEdgeBatch(database.pool, callLlm, {
      skipValidatedDays: 7,
      force: true,
      now
    });
    expect(forcedResult.checked).toBe(1);
    expect(forcedResult.removed).toBe(1);
    expect(calls).toBe(1);
  }, 120_000);

  it('dry-run does not delete or update edges', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();

    const src = (await storeEntity(database.pool, auth, {
      type: 'memory', content: 'source'
    }))._unsafeUnwrap();
    const tgt = (await storeEntity(database.pool, auth, {
      type: 'project', content: 'target'
    }))._unsafeUnwrap();

    await createEdge(database.pool, auth, {
      sourceId: src.id,
      targetId: tgt.id,
      relation: 'involves',
      source: 'llm-extraction'
    });

    const callLlm = async (): Promise<string> => '{"valid": false, "confidence": 0.1}';

    const result = await validateEdgeBatch(database.pool, callLlm, {
      dryRun: true
    });
    expect(result.removed).toBe(1);

    const row = await database.pool.query<{ metadata: Record<string, unknown> }>(
      'SELECT metadata FROM edges'
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]?.metadata['last_validated_at']).toBeUndefined();
  }, 120_000);
});

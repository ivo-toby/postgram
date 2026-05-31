import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { storeEntity } from '../../src/services/entity-service.js';
import {
  buildSessionContextPromotionPrompt,
  groomSessionContext,
  previewSessionContextGrooming
} from '../../src/services/memory-grooming-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

function makeAuthContext(): AuthContext {
  return {
    apiKeyId: null,
    keyName: 'groom-key',
    clientId: 'codex',
    scopes: ['read', 'write', 'delete'],
    allowedTypes: null,
    allowedVisibility: ['personal']
  };
}

describe('memory-grooming-service', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await resetTestDatabase(database.pool);
    await seedApiKey(database.pool, {
      id: '00000000-0000-0000-0000-000000000701',
      name: 'groom-key',
      clientId: 'codex',
      scopes: ['read', 'write', 'delete'],
      allowedVisibility: ['personal']
    });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('previews eligible session-context memories without mutating them', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const stored = (await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'Session context: decision was made to skip graph extraction.',
      visibility: 'personal',
      metadata: {
        memory_role: 'session_context',
        session_scope: { kind: 'client', client_id: 'codex' },
        groom_after: '2026-01-01T00:00:00.000Z'
      }
    }))._unsafeUnwrap();

    const preview = await previewSessionContextGrooming(database.pool, {
      clientId: 'codex',
      now: new Date('2026-05-31T00:00:00.000Z'),
      limit: 10
    });

    expect(preview.isOk()).toBe(true);
    expect(preview._unsafeUnwrap().eligible.map((entry) => entry.id)).toEqual([stored.id]);

    const row = await database.pool.query<{ status: string | null }>(
      'SELECT status FROM entities WHERE id = $1',
      [stored.id]
    );
    expect(row.rows[0]?.status).toBeNull();
  });

  it('requires confirmation before archiving outside dry-run', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const result = await groomSessionContext(database.pool, {
      clientId: 'codex',
      now: new Date('2026-05-31T00:00:00.000Z'),
      mode: 'archive',
      dryRun: false,
      confirm: false,
      limit: 10
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('VALIDATION');
  });

  it('archives stale session context without deleting it', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const stored = (await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'Session context that should be archived.',
      visibility: 'personal',
      metadata: {
        memory_role: 'session_context',
        session_scope: { kind: 'client', client_id: 'codex' },
        groom_after: '2026-01-01T00:00:00.000Z'
      }
    }))._unsafeUnwrap();

    const result = await groomSessionContext(database.pool, {
      clientId: 'codex',
      now: new Date('2026-05-31T00:00:00.000Z'),
      mode: 'archive',
      dryRun: false,
      confirm: true,
      limit: 10
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      archived: 1,
      promoted: 0,
      skipped: 0,
      dryRun: false,
      promotions: []
    });

    const row = await database.pool.query<{ status: string | null }>(
      'SELECT status FROM entities WHERE id = $1',
      [stored.id]
    );
    expect(row.rows[0]?.status).toBe('archived');
  });

  it('promotes session context through an LLM-distilled durable memory', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const stored = (await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'Session context: Ivo decided session-context memory should be embedded but should skip graph extraction.',
      visibility: 'personal',
      tags: ['session-context', 'postgram'],
      metadata: {
        memory_role: 'session_context',
        session_scope: { kind: 'client', client_id: 'codex' },
        groom_after: '2026-01-01T00:00:00.000Z'
      }
    }))._unsafeUnwrap();

    const prompts: Array<{ prompt: string; schema: object | undefined }> = [];
    const result = await groomSessionContext(database.pool, {
      clientId: 'codex',
      now: new Date('2026-05-31T00:00:00.000Z'),
      mode: 'promote',
      dryRun: false,
      confirm: true,
      limit: 10,
      callLlm: async (prompt, schema) => {
        prompts.push({ prompt, schema });
        return JSON.stringify({
          promote: true,
          content:
            'Ivo decided Postgram session-context memory should be embedded for recall but excluded from graph extraction.',
          reason: 'Stable design decision worth retaining across sessions.',
          tags: ['postgram', 'decision'],
          visibility: 'shared'
        });
      }
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchObject({
      archived: 1,
      promoted: 1,
      skipped: 0,
      dryRun: false
    });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.prompt).toContain('session_context');
    expect(prompts[0]?.prompt).toContain('durable_memory');
    expect(prompts[0]?.prompt).toContain('Do not promote verbatim');
    expect(prompts[0]?.prompt).toContain(stored.content);
    expect(prompts[0]?.schema).toEqual(expect.objectContaining({ type: 'object' }));

    const sourceRow = await database.pool.query<{
      status: string | null;
      metadata: Record<string, unknown>;
    }>('SELECT status, metadata FROM entities WHERE id = $1', [stored.id]);
    expect(sourceRow.rows[0]?.status).toBe('archived');

    const promotedId = sourceRow.rows[0]?.metadata.promoted_to;
    expect(typeof promotedId).toBe('string');

    const promotedRow = await database.pool.query<{
      type: string;
      content: string | null;
      visibility: string;
      tags: string[];
      source: string | null;
      metadata: Record<string, unknown>;
    }>('SELECT type, content, visibility, tags, source, metadata FROM entities WHERE id = $1', [
      promotedId
    ]);
    expect(promotedRow.rows[0]).toMatchObject({
      type: 'memory',
      content:
        'Ivo decided Postgram session-context memory should be embedded for recall but excluded from graph extraction.',
      visibility: 'personal',
      source: 'memory-grooming'
    });
    expect(promotedRow.rows[0]?.tags).toEqual(
      expect.arrayContaining(['memory', 'postgram', 'decision'])
    );
    expect(promotedRow.rows[0]?.tags).not.toContain('session-context');
    expect(promotedRow.rows[0]?.metadata).toMatchObject({
      memory_role: 'durable_memory',
      promoted_from: stored.id,
      promotion_source_role: 'session_context',
      promotion_reason: 'Stable design decision worth retaining across sessions.'
    });

    const edgeRows = await database.pool.query<{ relation: string }>(
      'SELECT relation FROM edges WHERE source_id = $1 AND target_id = $2',
      [stored.id, promotedId]
    );
    expect(edgeRows.rows).toEqual([{ relation: 'promoted_to' }]);
  });

  it('archives session context without promotion when the LLM rejects it', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const stored = (await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'Session context: transient note about what was open on screen.',
      visibility: 'personal',
      metadata: {
        memory_role: 'session_context',
        session_scope: { kind: 'client', client_id: 'codex' },
        groom_after: '2026-01-01T00:00:00.000Z'
      }
    }))._unsafeUnwrap();

    const result = await groomSessionContext(database.pool, {
      clientId: 'codex',
      now: new Date('2026-05-31T00:00:00.000Z'),
      mode: 'promote',
      dryRun: false,
      confirm: true,
      limit: 10,
      callLlm: async () =>
        JSON.stringify({
          promote: false,
          reason: 'Too transient to keep.'
        })
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchObject({
      archived: 1,
      promoted: 0,
      skipped: 1,
      dryRun: false
    });

    const row = await database.pool.query<{
      status: string | null;
      metadata: Record<string, unknown>;
    }>('SELECT status, metadata FROM entities WHERE id = $1', [stored.id]);
    expect(row.rows[0]?.status).toBe('archived');
    expect(row.rows[0]?.metadata.promotion_skipped_reason).toBe('Too transient to keep.');
  });

  it('builds a promotion prompt that asks for distilled durable memory', () => {
    const prompt = buildSessionContextPromotionPrompt({
      id: 'memory-1',
      content: 'Session context: an implementation choice exists.',
      visibility: 'personal',
      owner: null,
      tags: ['session-context'],
      metadata: { topic: 'postgram' },
      createdAt: '2026-05-24T00:00:00.000Z'
    });

    expect(prompt).toContain('session_context');
    expect(prompt).toContain('durable_memory');
    expect(prompt).toContain('Do not promote verbatim');
    expect(prompt).toContain('Session context: an implementation choice exists.');
  });
});

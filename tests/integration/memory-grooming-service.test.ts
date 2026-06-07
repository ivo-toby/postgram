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

async function backdateEntity(
  pool: TestDatabase['pool'],
  id: string,
  createdAt: string
): Promise<void> {
  await pool.query('UPDATE entities SET created_at = $2 WHERE id = $1', [
    id,
    createdAt
  ]);
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

    const stored = (
      await storeEntity(database.pool, makeAuthContext(), {
        type: 'memory',
        content: 'Session context: decision was made to skip graph extraction.',
        visibility: 'personal',
        metadata: {
          memory_role: 'session_context',
          session_scope: { kind: 'client', client_id: 'codex' },
          groom_after: '2026-01-01T00:00:00.000Z'
        }
      })
    )._unsafeUnwrap();

    const preview = await previewSessionContextGrooming(database.pool, {
      clientId: 'codex',
      now: new Date('2026-05-31T00:00:00.000Z'),
      limit: 10
    });

    expect(preview.isOk()).toBe(true);
    expect(preview._unsafeUnwrap().eligible.map((entry) => entry.id)).toEqual([
      stored.id
    ]);

    const row = await database.pool.query<{ status: string | null }>(
      'SELECT status FROM entities WHERE id = $1',
      [stored.id]
    );
    expect(row.rows[0]?.status).toBeNull();
  });

  it('ignores malformed groom_after values without aborting preview', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'Session context with malformed groom_after.',
      visibility: 'personal',
      metadata: {
        memory_role: 'session_context',
        session_scope: { kind: 'client', client_id: 'codex' },
        groom_after: 'not-a-date'
      }
    });

    const valid = (
      await storeEntity(database.pool, makeAuthContext(), {
        type: 'memory',
        content: 'Session context with valid groom_after.',
        visibility: 'personal',
        metadata: {
          memory_role: 'session_context',
          session_scope: { kind: 'client', client_id: 'codex' },
          groom_after: '2026-01-01T00:00:00.000Z'
        }
      })
    )._unsafeUnwrap();

    const preview = await previewSessionContextGrooming(database.pool, {
      clientId: 'codex',
      now: new Date('2026-05-31T00:00:00.000Z'),
      limit: 10
    });

    expect(preview.isOk()).toBe(true);
    expect(preview._unsafeUnwrap().eligible.map((entry) => entry.id)).toEqual([
      valid.id
    ]);
  });

  it('promotes all-client session context without aborting on malformed client scope rows', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const valid = (
      await storeEntity(
        database.pool,
        { ...makeAuthContext(), clientId: 'codex' },
        {
          type: 'memory',
          content: 'Codex session context that should be promoted.',
          visibility: 'personal',
          metadata: {
            memory_role: 'session_context',
            session_scope: { kind: 'client', client_id: 'codex' },
            groom_after: '2025-12-01T00:00:00.000Z'
          }
        }
      )
    )._unsafeUnwrap();

    const malformed = (
      await storeEntity(
        database.pool,
        { ...makeAuthContext(), clientId: 'orion' },
        {
          type: 'memory',
          content: 'Malformed session context with a numeric client id.',
          visibility: 'personal',
          metadata: {
            memory_role: 'session_context',
            session_scope: { kind: 'client', client_id: 123 },
            groom_after: '2025-12-01T00:00:00.000Z'
          }
        }
      )
    )._unsafeUnwrap();

    let callCount = 0;
    const result = await groomSessionContext(database.pool, {
      scope: { kind: 'all_clients' },
      now: new Date('2026-06-07T14:00:00.000Z'),
      mode: 'promote',
      dryRun: false,
      confirm: true,
      limit: 10,
      callLlm: () => {
        callCount += 1;
        return Promise.resolve(
          JSON.stringify({
            promote: true,
            content: 'Codex uses a stable client-scoped session context.',
            reason: 'Stable client-scoped note worth preserving.',
            tags: ['decision']
          })
        );
      }
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchObject({
      archived: 1,
      promoted: 1,
      skipped: 0,
      dryRun: false
    });
    expect(callCount).toBe(1);

    const rows = await database.pool.query<{
      id: string;
      status: string | null;
      metadata: Record<string, unknown>;
    }>('SELECT id, status, metadata FROM entities WHERE id = ANY($1)', [
      [valid.id, malformed.id]
    ]);
    const byId = Object.fromEntries(rows.rows.map((row) => [row.id, row]));
    expect(byId[valid.id]?.status).toBe('archived');
    expect(typeof byId[valid.id]?.metadata.promoted_to).toBe('string');
    expect(byId[malformed.id]?.status).toBeNull();
    expect(byId[malformed.id]?.metadata.promoted_to).toBeUndefined();
  });

  it('ignores ISO-shaped invalid groom_after values without aborting preview', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'Session context with ISO-shaped invalid groom_after.',
      visibility: 'personal',
      metadata: {
        memory_role: 'session_context',
        session_scope: { kind: 'client', client_id: 'codex' },
        groom_after: '2026-99-99T00:00:00.000Z'
      }
    });

    const valid = (
      await storeEntity(database.pool, makeAuthContext(), {
        type: 'memory',
        content:
          'Session context with valid groom_after alongside invalid ISO.',
        visibility: 'personal',
        metadata: {
          memory_role: 'session_context',
          session_scope: { kind: 'client', client_id: 'codex' },
          groom_after: '2026-01-01T00:00:00.000Z'
        }
      })
    )._unsafeUnwrap();

    const preview = await previewSessionContextGrooming(database.pool, {
      clientId: 'codex',
      now: new Date('2026-05-31T00:00:00.000Z'),
      limit: 10
    });

    expect(preview.isOk()).toBe(true);
    expect(preview._unsafeUnwrap().eligible.map((entry) => entry.id)).toEqual([
      valid.id
    ]);
  });

  it('supports all-client preview with age and metadata filters without crossing client boundaries', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const commonMetadata = {
      memory_role: 'session_context',
      groom_after: '2025-12-01T00:00:00.000Z',
      topic: 'grooming-foundation',
      session_id: 'session-a'
    };

    const codexOld = (
      await storeEntity(
        database.pool,
        { ...makeAuthContext(), clientId: 'codex' },
        {
          type: 'memory',
          content: 'Codex session context that should be eligible.',
          visibility: 'personal',
          tags: ['alpha', 'shared'],
          metadata: {
            ...commonMetadata,
            session_scope: { kind: 'client', client_id: 'codex' }
          }
        }
      )
    )._unsafeUnwrap();
    await backdateEntity(
      database.pool,
      codexOld.id,
      '2026-05-31T22:00:00.000Z'
    );

    const talonOld = (
      await storeEntity(
        database.pool,
        { ...makeAuthContext(), clientId: 'talon' },
        {
          type: 'memory',
          content: 'Talon session context that should also be eligible.',
          visibility: 'personal',
          tags: ['alpha', 'shared'],
          metadata: {
            ...commonMetadata,
            session_scope: { kind: 'client', client_id: 'talon' }
          }
        }
      )
    )._unsafeUnwrap();
    await backdateEntity(
      database.pool,
      talonOld.id,
      '2026-05-31T21:30:00.000Z'
    );

    const wrongTopic = (
      await storeEntity(
        database.pool,
        { ...makeAuthContext(), clientId: 'codex' },
        {
          type: 'memory',
          content: 'Codex session context with the wrong topic.',
          visibility: 'personal',
          tags: ['alpha', 'shared'],
          metadata: {
            memory_role: 'session_context',
            session_scope: { kind: 'client', client_id: 'codex' },
            topic: 'other-topic',
            session_id: 'session-a'
          }
        }
      )
    )._unsafeUnwrap();
    await backdateEntity(
      database.pool,
      wrongTopic.id,
      '2026-05-31T20:30:00.000Z'
    );

    const tooYoung = (
      await storeEntity(
        database.pool,
        { ...makeAuthContext(), clientId: 'codex' },
        {
          type: 'memory',
          content: 'Codex session context that is too recent.',
          visibility: 'personal',
          tags: ['alpha', 'shared'],
          metadata: {
            memory_role: 'session_context',
            session_scope: { kind: 'client', client_id: 'codex' },
            topic: 'grooming-foundation',
            session_id: 'session-a'
          }
        }
      )
    )._unsafeUnwrap();
    await backdateEntity(
      database.pool,
      tooYoung.id,
      '2026-06-07T13:40:00.000Z'
    );

    const preview = await previewSessionContextGrooming(database.pool, {
      scope: { kind: 'all_clients' },
      now: new Date('2026-06-07T14:00:00.000Z'),
      olderThanMs: 60 * 60 * 1000,
      limit: 10,
      topic: 'grooming-foundation',
      sessionId: 'session-a',
      tags: ['alpha']
    } as never);

    expect(preview.isOk()).toBe(true);
    expect(
      preview
        ._unsafeUnwrap()
        .eligible.map((entry) => entry.id)
        .sort()
    ).toEqual([codexOld.id, talonOld.id].sort());
    expect(
      preview
        ._unsafeUnwrap()
        .eligible.every(
          (entry) =>
            (entry.metadata.session_scope as { client_id?: string } | undefined)
              ?.client_id === (entry.id === codexOld.id ? 'codex' : 'talon')
        )
    ).toBe(true);
  });

  it('includes current matching memory when olderThanMs is zero', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const stored = (
      await storeEntity(database.pool, makeAuthContext(), {
        type: 'memory',
        content: 'Session context that is eligible immediately.',
        visibility: 'personal',
        tags: ['alpha'],
        metadata: {
          memory_role: 'session_context',
          session_scope: { kind: 'client', client_id: 'codex' },
          topic: 'immediate-grooming',
          session_id: 'session-zero'
        }
      })
    )._unsafeUnwrap();

    const now = new Date(Date.now() + 60_000);
    const preview = await previewSessionContextGrooming(database.pool, {
      scope: { kind: 'client', clientId: 'codex' },
      now,
      olderThanMs: 0,
      limit: 10,
      topic: 'immediate-grooming',
      sessionId: 'session-zero',
      tags: ['alpha']
    } as never);

    expect(preview.isOk()).toBe(true);
    expect(preview._unsafeUnwrap().eligible.map((entry) => entry.id)).toEqual([
      stored.id
    ]);
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

    const stored = (
      await storeEntity(database.pool, makeAuthContext(), {
        type: 'memory',
        content: 'Session context that should be archived.',
        visibility: 'personal',
        metadata: {
          memory_role: 'session_context',
          session_scope: { kind: 'client', client_id: 'codex' },
          groom_after: '2026-01-01T00:00:00.000Z'
        }
      })
    )._unsafeUnwrap();

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

  it('promotes all-client session context with per-client promotion metadata', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const codexStored = (
      await storeEntity(
        database.pool,
        { ...makeAuthContext(), clientId: 'codex' },
        {
          type: 'memory',
          content: 'Codex session context ready for promotion.',
          visibility: 'personal',
          tags: ['session-context', 'alpha'],
          metadata: {
            memory_role: 'session_context',
            session_scope: { kind: 'client', client_id: 'codex' },
            topic: 'promotion-foundation',
            session_id: 'promo-codex'
          }
        }
      )
    )._unsafeUnwrap();
    await backdateEntity(
      database.pool,
      codexStored.id,
      '2026-05-31T20:00:00.000Z'
    );

    const talonStored = (
      await storeEntity(
        database.pool,
        { ...makeAuthContext(), clientId: 'talon' },
        {
          type: 'memory',
          content: 'Talon session context ready for promotion.',
          visibility: 'personal',
          tags: ['session-context', 'beta'],
          metadata: {
            memory_role: 'session_context',
            session_scope: { kind: 'client', client_id: 'talon' },
            topic: 'promotion-foundation',
            session_id: 'promo-talon'
          }
        }
      )
    )._unsafeUnwrap();
    await backdateEntity(
      database.pool,
      talonStored.id,
      '2026-05-31T19:30:00.000Z'
    );

    const result = await groomSessionContext(database.pool, {
      scope: { kind: 'all_clients' },
      now: new Date('2026-06-07T14:00:00.000Z'),
      mode: 'promote',
      dryRun: false,
      confirm: true,
      limit: 10,
      olderThanMs: 60 * 60 * 1000,
      topic: 'promotion-foundation',
      tags: ['session-context'],
      callLlm: () =>
        Promise.resolve(
          JSON.stringify({
            promote: true,
            content: 'Promoted durable memory for all-client grooming.',
            reason: 'Stable design decision worth retaining.',
            tags: ['promotion-foundation']
          })
        )
    } as never);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchObject({
      archived: 2,
      promoted: 2,
      skipped: 0,
      dryRun: false
    });

    const sourceRows = await database.pool.query<{
      id: string;
      status: string | null;
      metadata: Record<string, unknown>;
    }>(
      'SELECT id, status, metadata FROM entities WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[codexStored.id, talonStored.id]]
    );

    expect(sourceRows.rows.every((row) => row.status === 'archived')).toBe(
      true
    );
    expect(
      sourceRows.rows.every(
        (row) => typeof row.metadata.promoted_to === 'string'
      )
    ).toBe(true);

    const durableIds = sourceRows.rows.map(
      (row) => row.metadata.promoted_to as string
    );
    const durableRows = await database.pool.query<{
      id: string;
      content: string | null;
      visibility: string;
      source: string | null;
      metadata: Record<string, unknown>;
    }>(
      'SELECT id, content, visibility, source, metadata FROM entities WHERE id = ANY($1::uuid[])',
      [durableIds]
    );

    expect(durableRows.rows).toHaveLength(2);
    expect(
      durableRows.rows
        .map((row) => row.metadata)
        .every((metadata) => {
          const scope = metadata.session_scope as
            | { kind?: string; client_id?: string }
            | undefined;
          return (
            metadata.memory_role === 'durable_memory' &&
            metadata.promotion_source_role === 'session_context' &&
            (metadata.promotion_client_id === 'codex' ||
              metadata.promotion_client_id === 'talon') &&
            scope?.kind === 'client' &&
            (scope.client_id === 'codex' || scope.client_id === 'talon')
          );
        })
    ).toBe(true);

    expect(
      durableRows.rows.some(
        (row) => row.metadata.promotion_client_id === 'codex'
      )
    ).toBe(true);
    expect(
      durableRows.rows.some(
        (row) => row.metadata.promotion_client_id === 'talon'
      )
    ).toBe(true);
    expect(
      durableRows.rows.every((row) => row.source === 'memory-grooming')
    ).toBe(true);
  });

  it('promotes session context through an LLM-distilled durable memory', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const stored = (
      await storeEntity(database.pool, makeAuthContext(), {
        type: 'memory',
        content:
          'Session context: Ivo decided session-context memory should be embedded but should skip graph extraction.',
        visibility: 'personal',
        tags: ['session-context', 'postgram'],
        metadata: {
          memory_role: 'session_context',
          session_scope: { kind: 'client', client_id: 'codex' },
          groom_after: '2026-01-01T00:00:00.000Z'
        }
      })
    )._unsafeUnwrap();

    const prompts: Array<{ prompt: string; schema: object | undefined }> = [];
    const result = await groomSessionContext(database.pool, {
      clientId: 'codex',
      now: new Date('2026-05-31T00:00:00.000Z'),
      mode: 'promote',
      dryRun: false,
      confirm: true,
      limit: 10,
      callLlm: (prompt, schema) => {
        prompts.push({ prompt, schema });
        return Promise.resolve(
          JSON.stringify({
            promote: true,
            content:
              'Ivo decided Postgram session-context memory should be embedded for recall but excluded from graph extraction.',
            reason: 'Stable design decision worth retaining across sessions.',
            tags: ['postgram', 'decision'],
            visibility: 'shared'
          })
        );
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
    expect(prompts[0]?.schema).toEqual(
      expect.objectContaining({ type: 'object' })
    );

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
    }>(
      'SELECT type, content, visibility, tags, source, metadata FROM entities WHERE id = $1',
      [promotedId]
    );
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
      promotion_reason:
        'Stable design decision worth retaining across sessions.'
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

    const stored = (
      await storeEntity(database.pool, makeAuthContext(), {
        type: 'memory',
        content:
          'Session context: transient note about what was open on screen.',
        visibility: 'personal',
        metadata: {
          memory_role: 'session_context',
          session_scope: { kind: 'client', client_id: 'codex' },
          groom_after: '2026-01-01T00:00:00.000Z'
        }
      })
    )._unsafeUnwrap();

    const result = await groomSessionContext(database.pool, {
      clientId: 'codex',
      now: new Date('2026-05-31T00:00:00.000Z'),
      mode: 'promote',
      dryRun: false,
      confirm: true,
      limit: 10,
      callLlm: () =>
        Promise.resolve(
          JSON.stringify({
            promote: false,
            reason: 'Too transient to keep.'
          })
        )
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
    expect(row.rows[0]?.metadata.promotion_skipped_reason).toBe(
      'Too transient to keep.'
    );
  });

  it('skips malformed promotion decisions without aborting all-client grooming', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const codexStored = (
      await storeEntity(
        database.pool,
        { ...makeAuthContext(), clientId: 'codex' },
        {
          type: 'memory',
          content: 'Codex session context ready for promotion.',
          visibility: 'personal',
          tags: ['session-context', 'codex'],
          metadata: {
            memory_role: 'session_context',
            session_scope: { kind: 'client', client_id: 'codex' },
            topic: 'malformed-promotion'
          }
        }
      )
    )._unsafeUnwrap();
    await backdateEntity(
      database.pool,
      codexStored.id,
      '2026-05-31T20:00:00.000Z'
    );

    const talonStored = (
      await storeEntity(
        database.pool,
        { ...makeAuthContext(), clientId: 'talon' },
        {
          type: 'memory',
          content:
            'Talon session context that receives malformed promotion JSON.',
          visibility: 'personal',
          tags: ['session-context', 'talon'],
          metadata: {
            memory_role: 'session_context',
            session_scope: { kind: 'client', client_id: 'talon' },
            topic: 'malformed-promotion'
          }
        }
      )
    )._unsafeUnwrap();
    await backdateEntity(
      database.pool,
      talonStored.id,
      '2026-05-31T19:30:00.000Z'
    );

    let callCount = 0;
    const result = await groomSessionContext(database.pool, {
      scope: { kind: 'all_clients' },
      now: new Date('2026-06-07T14:00:00.000Z'),
      mode: 'promote',
      dryRun: false,
      confirm: true,
      limit: 10,
      olderThanMs: 60 * 60 * 1000,
      topic: 'malformed-promotion',
      callLlm: () => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve(
            JSON.stringify({
              promote: true,
              content: 'Codex has a stable durable grooming note.',
              reason: 'Stable enough to preserve.',
              tags: ['durable']
            })
          );
        }

        return Promise.resolve(
          JSON.stringify({
            reason: 'Missing the promote boolean.'
          })
        );
      }
    } as never);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchObject({
      archived: 2,
      promoted: 1,
      skipped: 1,
      dryRun: false
    });
    expect(callCount).toBe(2);

    const sourceRows = await database.pool.query<{
      id: string;
      status: string | null;
      metadata: Record<string, unknown>;
    }>('SELECT id, status, metadata FROM entities WHERE id = ANY($1::uuid[])', [
      [codexStored.id, talonStored.id]
    ]);
    const byId = Object.fromEntries(
      sourceRows.rows.map((row) => [row.id, row])
    );

    expect(byId[codexStored.id]?.status).toBe('archived');
    expect(byId[codexStored.id]?.metadata.promoted_to).toEqual(
      expect.any(String)
    );
    expect(byId[talonStored.id]?.status).toBe('archived');
    expect(byId[talonStored.id]?.metadata.promoted_to).toBeUndefined();
    expect(byId[talonStored.id]?.metadata.promotion_skipped_reason).toContain(
      'Promotion decision must include promote boolean'
    );
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
    expect(prompt).toContain(
      'Session context: an implementation choice exists.'
    );
  });
});

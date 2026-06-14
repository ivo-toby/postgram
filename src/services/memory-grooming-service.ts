import { ResultAsync } from 'neverthrow';
import type { Pool } from 'pg';

import type { ServiceResult } from '../types/common.js';
import type { Visibility } from '../types/entities.js';
import { AppError, ErrorCode } from '../util/errors.js';

export type GroomingCandidate = {
  id: string;
  content: string | null;
  visibility: Visibility;
  owner: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type GroomingScope =
  | { kind: 'client'; clientId: string }
  | { kind: 'all_clients' };

export type GroomingFilters = {
  olderThanMs: number;
  limit?: number | undefined;
  topic?: string | undefined;
  sessionId?: string | undefined;
  tags?: string[] | undefined;
};

export type GroomingPreview = {
  eligible: GroomingCandidate[];
};

export type SessionContextGroomingFilters = {
  olderThanMs?: number | undefined;
  topic?: string | undefined;
  sessionId?: string | undefined;
  tags?: string[] | undefined;
};

export type CallLlm = (prompt: string, schema?: object) => Promise<string>;

type PromotionDecision = {
  promote: boolean;
  content?: string | undefined;
  reason?: string | undefined;
  tags?: string[] | undefined;
};

type GroomingMode = 'archive' | 'promote';

type GroomingInput = {
  scope?: GroomingScope | undefined;
  clientId?: string | undefined;
  allowedVisibility?: Visibility[] | undefined;
  now: Date;
  limit?: number | undefined;
  olderThanMs?: number | undefined;
  topic?: string | undefined;
  sessionId?: string | undefined;
  tags?: string[] | undefined;
};

export type GroomingResult = {
  archived: number;
  promoted: number;
  skipped: number;
  dryRun: boolean;
  promotions: Array<{ sourceId: string; durableId: string }>;
};

export const SESSION_CONTEXT_PROMOTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['promote', 'reason'],
  properties: {
    promote: {
      type: 'boolean',
      description:
        'Whether this session context contains durable information worth preserving.'
    },
    content: {
      type: 'string',
      description:
        'A concise, third-person durable memory. Required only when promote is true.'
    },
    reason: {
      type: 'string',
      description:
        'Brief explanation for promoting or skipping the session context.'
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Short durable-memory tags to attach when promote is true.'
    }
  }
} as const;

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

function stripMarkdownFences(response: string): string {
  const trimmed = response.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1] ? match[1].trim() : trimmed;
}

function parsePromotionDecision(response: string): PromotionDecision {
  const parsed = JSON.parse(stripMarkdownFences(response)) as Record<
    string,
    unknown
  >;
  if (typeof parsed.promote !== 'boolean') {
    throw new AppError(
      ErrorCode.VALIDATION,
      'Promotion decision must include promote boolean'
    );
  }

  const reason =
    typeof parsed.reason === 'string' && parsed.reason.trim().length > 0
      ? parsed.reason.trim()
      : undefined;

  if (!reason) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'Promotion decision must include a reason'
    );
  }

  const content =
    typeof parsed.content === 'string' && parsed.content.trim().length > 0
      ? parsed.content.trim()
      : undefined;

  if (parsed.promote && !content) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'Promotion decision must include content when promote is true'
    );
  }

  const tags = Array.isArray(parsed.tags)
    ? parsed.tags
        .filter(
          (tag): tag is string =>
            typeof tag === 'string' && tag.trim().length > 0
        )
        .map((tag) => tag.trim())
    : undefined;

  return {
    promote: parsed.promote,
    content,
    reason,
    tags
  };
}

function promotionParseErrorDecision(error: unknown): PromotionDecision {
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message.trim()
      : 'Malformed promotion response';

  return {
    promote: false,
    reason: `Invalid promotion decision: ${message}`
  };
}

function normalizeTags(
  sourceTags: string[],
  decisionTags: string[] | undefined
): string[] {
  const durableTags = [
    'memory',
    ...sourceTags.filter(
      (tag) => tag !== 'session-context' && tag !== 'session_context'
    ),
    ...(decisionTags ?? [])
  ];

  return Array.from(
    new Set(durableTags.map((tag) => tag.trim()).filter(Boolean))
  );
}

function normalizeFilters(input: GroomingInput): GroomingFilters {
  if (input.limit !== undefined) {
    if (!Number.isInteger(input.limit) || input.limit <= 0) {
      throw new AppError(
        ErrorCode.VALIDATION,
        'limit must be a positive integer'
      );
    }
  }

  const olderThanMs = input.olderThanMs ?? 7 * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(olderThanMs) || olderThanMs < 0) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'olderThanMs must be a non-negative number'
    );
  }

  return {
    olderThanMs,
    limit: input.limit,
    topic:
      typeof input.topic === 'string' && input.topic.trim().length > 0
        ? input.topic.trim()
        : undefined,
    sessionId:
      typeof input.sessionId === 'string' && input.sessionId.trim().length > 0
        ? input.sessionId.trim()
        : undefined,
    tags: input.tags?.length
      ? Array.from(
          new Set(
            input.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0)
          )
        )
      : undefined
  };
}

function normalizeScope(input: GroomingInput): GroomingScope {
  if (input.scope) {
    if (
      input.scope.kind === 'client' &&
      typeof input.scope.clientId === 'string' &&
      input.scope.clientId.trim().length > 0
    ) {
      return { kind: 'client', clientId: input.scope.clientId.trim() };
    }

    if (input.scope.kind === 'all_clients') {
      return { kind: 'all_clients' };
    }

    throw new AppError(
      ErrorCode.VALIDATION,
      'client scope requires a clientId'
    );
  }

  if (typeof input.clientId === 'string' && input.clientId.trim().length > 0) {
    return { kind: 'client', clientId: input.clientId.trim() };
  }

  throw new AppError(
    ErrorCode.VALIDATION,
    'grooming scope requires a clientId or all_clients scope'
  );
}

function getCandidateClientId(
  candidate: GroomingCandidate
): string | undefined {
  const sessionScope = candidate.metadata.session_scope as
    | { kind?: unknown; client_id?: unknown }
    | undefined;
  const clientId = sessionScope?.client_id;
  return typeof clientId === 'string' && clientId.trim().length > 0
    ? clientId.trim()
    : undefined;
}

function buildCandidateQuery({
  scope,
  filters,
  allowedVisibility,
  now
}: {
  scope: GroomingScope;
  filters: GroomingFilters;
  allowedVisibility?: Visibility[] | undefined;
  now: Date;
}): { text: string; values: unknown[] } {
  const conditions = [
    "type = 'memory'",
    "status IS DISTINCT FROM 'archived'",
    "metadata->>'memory_role' = 'session_context'",
    "metadata->>'promoted_to' IS NULL"
  ];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (scope.kind === 'client') {
    conditions.push(
      `metadata #>> '{session_scope,client_id}' = $${paramIndex++}`
    );
    values.push(scope.clientId);
  } else {
    conditions.push(
      `jsonb_typeof(metadata #> '{session_scope,client_id}') = 'string'`
    );
    conditions.push(
      `NULLIF(BTRIM(metadata #>> '{session_scope,client_id}'), '') IS NOT NULL`
    );
  }

  if (allowedVisibility !== undefined) {
    conditions.push(`visibility = ANY($${paramIndex++}::text[])`);
    values.push(allowedVisibility);
  }

  const ageCutoff = new Date(now.getTime() - filters.olderThanMs);
  conditions.push(
    `(
      CASE
        WHEN COALESCE(
          pg_input_is_valid(metadata->>'groom_after', 'timestamptz'),
          false
        )
        THEN (metadata->>'groom_after')::timestamptz <= $${paramIndex}
        ELSE false
      END
      OR created_at <= $${paramIndex + 1}::timestamptz
    )`
  );
  values.push(now.toISOString(), ageCutoff.toISOString());
  paramIndex += 2;

  if (filters.topic) {
    conditions.push(`metadata->>'topic' = $${paramIndex++}`);
    values.push(filters.topic);
  }

  if (filters.sessionId) {
    conditions.push(`metadata->>'session_id' = $${paramIndex++}`);
    values.push(filters.sessionId);
  }

  if (filters.tags?.length) {
    conditions.push(`tags @> $${paramIndex++}::text[]`);
    values.push(filters.tags);
  }

  const limitClause =
    filters.limit === undefined ? '' : `LIMIT $${paramIndex}`;
  if (filters.limit !== undefined) {
    values.push(filters.limit);
  }

  return {
    text: `
      SELECT id, content, visibility, owner, tags, metadata, created_at
      FROM entities
      WHERE ${conditions.join('\n        AND ')}
      ORDER BY
        COALESCE(metadata #>> '{session_scope,client_id}', ''),
        created_at ASC,
        id ASC
      ${limitClause}
    `,
    values
  };
}

export function buildSessionContextPromotionPrompt(
  candidate: GroomingCandidate
): string {
  return [
    'You are Postgram memory grooming. Assess whether a session_context memory should be promoted to durable_memory.',
    '',
    'Session-context memory is working continuity. Durable memory is long-lived truth that should help future agents without carrying transient thread noise.',
    '',
    'Rules:',
    '- Promote only stable facts, decisions, constraints, preferences, root causes, or completed work outcomes.',
    '- Do not promote temporary screen state, step-by-step chatter, duplicate context, or vague intentions.',
    '- Do not promote verbatim. Distill the essential information into one concise third-person memory.',
    '- Preserve scope and caveats when they matter. Do not overgeneralize from a single session note.',
    '- Return strict JSON matching the provided schema.',
    '',
    'Candidate:',
    JSON.stringify(
      {
        id: candidate.id,
        role: 'session_context',
        targetRole: 'durable_memory',
        createdAt: candidate.createdAt,
        visibility: candidate.visibility,
        owner: candidate.owner,
        tags: candidate.tags,
        metadata: candidate.metadata,
        content: candidate.content
      },
      null,
      2
    )
  ].join('\n');
}

export function previewSessionContextGrooming(
  pool: Pool,
  input: GroomingInput
): ServiceResult<GroomingPreview> {
  return ResultAsync.fromPromise(
    (async () => {
      const scope = normalizeScope(input);
      const filters = normalizeFilters(input);
      const result = await pool.query<{
        id: string;
        content: string | null;
        visibility: Visibility;
        owner: string | null;
        tags: string[];
        metadata: Record<string, unknown>;
        created_at: Date;
      }>(
        buildCandidateQuery({
          scope,
          filters,
          allowedVisibility: input.allowedVisibility,
          now: input.now
        })
      );

      return {
        eligible: result.rows.map((row) => ({
          id: row.id,
          content: row.content,
          visibility: row.visibility,
          owner: row.owner,
          tags: row.tags,
          metadata: row.metadata,
          createdAt: row.created_at.toISOString()
        }))
      };
    })(),
    (error) => toAppError(error, 'Failed to preview memory grooming')
  );
}

export function groomSessionContext(
  pool: Pool,
  input: {
    scope?: GroomingScope | undefined;
    clientId?: string | undefined;
    allowedVisibility?: Visibility[] | undefined;
    now: Date;
    mode: GroomingMode;
    dryRun: boolean;
    confirm: boolean;
    limit?: number | undefined;
    olderThanMs?: number | undefined;
    topic?: string | undefined;
    sessionId?: string | undefined;
    tags?: string[] | undefined;
    callLlm?: CallLlm | undefined;
  }
): ServiceResult<GroomingResult> {
  return ResultAsync.fromPromise(
    (async () => {
      const scope = normalizeScope(input);
      const filters = normalizeFilters(input);

      if (!input.dryRun && !input.confirm) {
        throw new AppError(
          ErrorCode.VALIDATION,
          '--yes is required outside dry-run'
        );
      }

      if (input.mode === 'promote' && !input.dryRun && !input.callLlm) {
        throw new AppError(
          ErrorCode.VALIDATION,
          'callLlm is required for session-context promotion grooming'
        );
      }

      const preview = await previewSessionContextGrooming(pool, {
        ...input,
        scope,
        allowedVisibility: input.allowedVisibility,
        limit: filters.limit,
        olderThanMs: filters.olderThanMs,
        topic: filters.topic,
        sessionId: filters.sessionId,
        tags: filters.tags
      });
      if (preview.isErr()) {
        throw preview.error;
      }

      const ids = preview.value.eligible.map((candidate) => candidate.id);
      if (input.dryRun || ids.length === 0) {
        return {
          archived: 0,
          promoted: 0,
          skipped: 0,
          dryRun: input.dryRun,
          promotions: []
        };
      }

      if (input.mode === 'archive') {
        await pool.query(
          `
            UPDATE entities
            SET status = 'archived',
                metadata = metadata || $2::jsonb
            WHERE id = ANY($1::uuid[])
          `,
          [
            ids,
            JSON.stringify({
              groomed_at: input.now.toISOString(),
              groomed_mode: 'archive'
            })
          ]
        );

        return {
          archived: ids.length,
          promoted: 0,
          skipped: 0,
          dryRun: false,
          promotions: []
        };
      }

      const groupedCandidates = new Map<string, GroomingCandidate[]>();
      for (const candidate of preview.value.eligible) {
        const candidateClientId = getCandidateClientId(candidate);
        if (!candidateClientId) {
          throw new AppError(
            ErrorCode.INTERNAL,
            'Session-context candidate is missing a source client scope'
          );
        }

        const current = groupedCandidates.get(candidateClientId) ?? [];
        current.push(candidate);
        groupedCandidates.set(candidateClientId, current);
      }

      const decisions: Array<{
        candidate: GroomingCandidate;
        decision: PromotionDecision;
        clientId: string;
      }> = [];
      for (const [, clientCandidates] of groupedCandidates) {
        for (const candidate of clientCandidates) {
          const response = await input.callLlm!(
            buildSessionContextPromotionPrompt(candidate),
            SESSION_CONTEXT_PROMOTION_SCHEMA
          );
          let decision: PromotionDecision;
          try {
            decision = parsePromotionDecision(response);
          } catch (error) {
            decision = promotionParseErrorDecision(error);
          }

          decisions.push({
            candidate,
            clientId: getCandidateClientId(candidate)!,
            decision
          });
        }
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        let promoted = 0;
        let skipped = 0;
        const promotions: Array<{ sourceId: string; durableId: string }> = [];

        for (const {
          candidate,
          decision,
          clientId: sourceClientId
        } of decisions) {
          if (!decision.promote) {
            skipped += 1;
            await client.query(
              `
                UPDATE entities
                SET status = 'archived',
                    metadata = metadata || $2::jsonb
                WHERE id = $1
              `,
              [
                candidate.id,
                JSON.stringify({
                  groomed_at: input.now.toISOString(),
                  groomed_mode: 'promote',
                  promotion_skipped_reason: decision.reason
                })
              ]
            );
            continue;
          }

          const insertResult = await client.query<{ id: string }>(
            `
              INSERT INTO entities (
                type,
                content,
                visibility,
                owner,
                status,
                enrichment_status,
                tags,
                source,
                metadata
              )
              VALUES ('memory', $1, $2, $3, NULL, 'pending', $4, 'memory-grooming', $5)
              RETURNING id
            `,
            [
              decision.content,
              candidate.visibility,
              candidate.owner,
              normalizeTags(candidate.tags, decision.tags),
              JSON.stringify({
                memory_role: 'durable_memory',
                session_scope: candidate.metadata.session_scope ?? {
                  kind: 'client',
                  client_id: sourceClientId
                },
                promoted_from: candidate.id,
                promotion_source_role: 'session_context',
                promotion_reason: decision.reason,
                promotion_client_id: sourceClientId,
                promoted_at: input.now.toISOString()
              })
            ]
          );

          const durableId = insertResult.rows[0]?.id;
          if (!durableId) {
            throw new AppError(
              ErrorCode.INTERNAL,
              'Failed to create promoted memory'
            );
          }

          await client.query(
            `
              UPDATE entities
              SET status = 'archived',
                  metadata = metadata || $2::jsonb
              WHERE id = $1
            `,
            [
              candidate.id,
              JSON.stringify({
                groomed_at: input.now.toISOString(),
                groomed_mode: 'promote',
                promoted_to: durableId,
                promoted_at: input.now.toISOString(),
                promotion_reason: decision.reason
              })
            ]
          );

          await client.query(
            `
              INSERT INTO edges (source_id, target_id, relation, confidence, source, metadata)
              VALUES ($1, $2, 'promoted_to', 1, 'memory-grooming', $3)
              ON CONFLICT (source_id, target_id, relation)
              DO UPDATE SET
                confidence = EXCLUDED.confidence,
                source = EXCLUDED.source,
                metadata = EXCLUDED.metadata
            `,
            [
              candidate.id,
              durableId,
              JSON.stringify({
                reason: decision.reason,
                promoted_at: input.now.toISOString()
              })
            ]
          );

          promoted += 1;
          promotions.push({ sourceId: candidate.id, durableId });
        }

        await client.query('COMMIT');

        return {
          archived: decisions.length,
          promoted,
          skipped,
          dryRun: false,
          promotions
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to groom session context')
  );
}

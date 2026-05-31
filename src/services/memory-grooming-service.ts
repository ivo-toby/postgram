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

export type GroomingPreview = {
  eligible: GroomingCandidate[];
};

export type CallLlm = (prompt: string, schema?: object) => Promise<string>;

type PromotionDecision = {
  promote: boolean;
  content?: string | undefined;
  reason?: string | undefined;
  tags?: string[] | undefined;
};

type GroomingMode = 'archive' | 'promote';

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
      description: 'Whether this session context contains durable information worth preserving.'
    },
    content: {
      type: 'string',
      description:
        'A concise, third-person durable memory. Required only when promote is true.'
    },
    reason: {
      type: 'string',
      description: 'Brief explanation for promoting or skipping the session context.'
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
  const parsed = JSON.parse(stripMarkdownFences(response)) as Record<string, unknown>;
  if (typeof parsed.promote !== 'boolean') {
    throw new AppError(ErrorCode.VALIDATION, 'Promotion decision must include promote boolean');
  }

  const reason =
    typeof parsed.reason === 'string' && parsed.reason.trim().length > 0
      ? parsed.reason.trim()
      : undefined;

  if (!reason) {
    throw new AppError(ErrorCode.VALIDATION, 'Promotion decision must include a reason');
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
        .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
        .map((tag) => tag.trim())
    : undefined;

  return {
    promote: parsed.promote,
    content,
    reason,
    tags
  };
}

function normalizeTags(sourceTags: string[], decisionTags: string[] | undefined): string[] {
  const durableTags = [
    'memory',
    ...sourceTags.filter((tag) => tag !== 'session-context' && tag !== 'session_context'),
    ...(decisionTags ?? [])
  ];

  return Array.from(new Set(durableTags.map((tag) => tag.trim()).filter(Boolean)));
}

export function buildSessionContextPromotionPrompt(candidate: GroomingCandidate): string {
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
  input: { clientId: string; now: Date; limit: number }
): ServiceResult<GroomingPreview> {
  return ResultAsync.fromPromise(
    (async () => {
      const result = await pool.query<{
        id: string;
        content: string | null;
        visibility: Visibility;
        owner: string | null;
        tags: string[];
        metadata: Record<string, unknown>;
        created_at: Date;
      }>(
        `
          SELECT id, content, visibility, owner, tags, metadata, created_at
          FROM entities
          WHERE type = 'memory'
            AND status IS DISTINCT FROM 'archived'
            AND metadata->>'memory_role' = 'session_context'
            AND metadata #>> '{session_scope,client_id}' = $1
            AND metadata->>'promoted_to' IS NULL
            AND (
              (metadata->>'groom_after')::timestamptz <= $2
              OR created_at <= $2::timestamptz - interval '7 days'
            )
          ORDER BY created_at ASC
          LIMIT $3
        `,
        [input.clientId, input.now.toISOString(), input.limit]
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
    clientId: string;
    now: Date;
    mode: GroomingMode;
    dryRun: boolean;
    confirm: boolean;
    limit: number;
    callLlm?: CallLlm | undefined;
  }
): ServiceResult<GroomingResult> {
  return ResultAsync.fromPromise(
    (async () => {
      if (!input.dryRun && !input.confirm) {
        throw new AppError(ErrorCode.VALIDATION, '--yes is required outside dry-run');
      }

      if (input.mode === 'promote' && !input.dryRun && !input.callLlm) {
        throw new AppError(
          ErrorCode.VALIDATION,
          'callLlm is required for session-context promotion grooming'
        );
      }

      const preview = await previewSessionContextGrooming(pool, input);
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

      const decisions: Array<{ candidate: GroomingCandidate; decision: PromotionDecision }> = [];
      for (const candidate of preview.value.eligible) {
        decisions.push({
          candidate,
          decision: parsePromotionDecision(
            await input.callLlm!(
              buildSessionContextPromotionPrompt(candidate),
              SESSION_CONTEXT_PROMOTION_SCHEMA
            )
          )
        });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        let promoted = 0;
        let skipped = 0;
        const promotions: Array<{ sourceId: string; durableId: string }> = [];

        for (const { candidate, decision } of decisions) {
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
                promoted_from: candidate.id,
                promotion_source_role: 'session_context',
                promotion_reason: decision.reason,
                promotion_client_id: input.clientId,
                promoted_at: input.now.toISOString()
              })
            ]
          );

          const durableId = insertResult.rows[0]?.id;
          if (!durableId) {
            throw new AppError(ErrorCode.INTERNAL, 'Failed to create promoted memory');
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

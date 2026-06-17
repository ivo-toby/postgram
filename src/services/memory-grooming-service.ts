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
type DurableGroomingMode = 'review' | 'mark';
type DurableGroomingApplicationMode = 'auto' | 'rewrite' | 'archive';
type DurableGroomingApplicationAction = 'rewrite' | 'archive' | 'skip';

export type DurableGroomingOutcome =
  | 'keep'
  | 'needs_grooming'
  | 'archive'
  | 'superseded';

type DurableGroomingDecision = {
  outcome: DurableGroomingOutcome;
  reason: string;
  suggestedAction?: string | undefined;
  suggestedContent?: string | undefined;
  suggestedTags?: string[] | undefined;
};

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

type DurableGroomingInput = {
  now: Date;
  limit?: number | undefined;
  olderThanMs?: number | undefined;
  topic?: string | undefined;
  tags?: string[] | undefined;
  visibility?: Visibility | undefined;
  includeReviewed?: boolean | undefined;
};

type DurableGroomingApplicationInput = {
  now: Date;
  mode: DurableGroomingApplicationMode;
  dryRun: boolean;
  confirm: boolean;
  statuses?: DurableGroomingOutcome[] | undefined;
  limit?: number | undefined;
  topic?: string | undefined;
  tags?: string[] | undefined;
  visibility?: Visibility | undefined;
  callLlm?: CallLlm | undefined;
};

type DurableRewriteDecision = {
  content: string;
  tags?: string[] | undefined;
};

export type GroomingResult = {
  archived: number;
  promoted: number;
  skipped: number;
  dryRun: boolean;
  promotions: Array<{ sourceId: string; durableId: string }>;
};

export type DurableMemoryGroomingResult = {
  reviewed: number;
  marked: number;
  dryRun: boolean;
  outcomes: Array<{
    id: string;
    outcome: DurableGroomingOutcome;
    reason: string;
    suggestedAction?: string | undefined;
    suggestedContent?: string | undefined;
    suggestedTags?: string[] | undefined;
  }>;
};

export type DurableGroomingApplicationResult = {
  reviewed: number;
  rewritten: number;
  archived: number;
  skipped: number;
  dryRun: boolean;
  outcomes: Array<{
    id: string;
    status: DurableGroomingOutcome;
    action: DurableGroomingApplicationAction;
    reason: string;
    content?: string | undefined;
    tags?: string[] | undefined;
  }>;
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

export const DURABLE_MEMORY_GROOMING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['outcome', 'reason'],
  properties: {
    outcome: {
      type: 'string',
      enum: ['keep', 'needs_grooming', 'archive', 'superseded'],
      description: 'Durable memory grooming classification.'
    },
    reason: {
      type: 'string',
      description: 'Brief explanation for this classification.'
    },
    suggested_action: {
      type: 'string',
      description:
        'Optional operator action such as distill, merge, inspect, or retain.'
    },
    suggested_content: {
      type: 'string',
      description:
        'Optional replacement or distilled durable memory suggestion.'
    },
    suggested_tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional tag suggestions for a later rewrite.'
    }
  }
} as const;

export const DURABLE_MEMORY_REWRITE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['content'],
  properties: {
    content: {
      type: 'string',
      description:
        'Clean durable memory content. Preserve stable truth and remove transient execution noise.'
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional durable-memory tags to add.'
    }
  }
} as const;

const DEFAULT_DURABLE_APPLY_STATUSES: DurableGroomingOutcome[] = [
  'needs_grooming',
  'archive',
  'superseded'
];

function durableApplyStatusesForMode(
  mode: DurableGroomingApplicationMode
): DurableGroomingOutcome[] {
  if (mode === 'rewrite') {
    return ['needs_grooming'];
  }

  if (mode === 'archive') {
    return ['archive', 'superseded'];
  }

  return DEFAULT_DURABLE_APPLY_STATUSES;
}

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

function isDurableGroomingOutcome(
  value: unknown
): value is DurableGroomingOutcome {
  return (
    value === 'keep' ||
    value === 'needs_grooming' ||
    value === 'archive' ||
    value === 'superseded'
  );
}

function readOptionalString(
  parsed: Record<string, unknown>,
  snakeKey: string,
  camelKey: string
): string | undefined {
  const value = parsed[snakeKey] ?? parsed[camelKey];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function parseDurableGroomingDecision(
  response: string
): DurableGroomingDecision {
  const parsed = JSON.parse(stripMarkdownFences(response)) as Record<
    string,
    unknown
  >;

  if (!isDurableGroomingOutcome(parsed.outcome)) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'Durable grooming decision must include outcome'
    );
  }

  const reason =
    typeof parsed.reason === 'string' && parsed.reason.trim().length > 0
      ? parsed.reason.trim()
      : undefined;

  if (!reason) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'Durable grooming decision must include a reason'
    );
  }

  const suggestedTagsValue = parsed.suggested_tags ?? parsed.suggestedTags;
  const suggestedTags = Array.isArray(suggestedTagsValue)
    ? suggestedTagsValue
        .filter(
          (tag): tag is string =>
            typeof tag === 'string' && tag.trim().length > 0
        )
        .map((tag) => tag.trim())
    : undefined;

  return {
    outcome: parsed.outcome,
    reason,
    suggestedAction: readOptionalString(
      parsed,
      'suggested_action',
      'suggestedAction'
    ),
    suggestedContent: readOptionalString(
      parsed,
      'suggested_content',
      'suggestedContent'
    ),
    suggestedTags
  };
}

function parseDurableRewriteDecision(response: string): DurableRewriteDecision {
  const parsed = JSON.parse(stripMarkdownFences(response)) as Record<
    string,
    unknown
  >;

  const content =
    typeof parsed.content === 'string' && parsed.content.trim().length > 0
      ? parsed.content.trim()
      : undefined;

  if (!content) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'Durable rewrite decision must include content'
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
    content,
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

function durableGroomingParseErrorDecision(
  error: unknown
): DurableGroomingDecision {
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message.trim()
      : 'Malformed durable grooming response';

  return {
    outcome: 'needs_grooming',
    reason: `Invalid durable grooming decision: ${message}`,
    suggestedAction: 'inspect'
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

function normalizeDurableFilters(input: DurableGroomingInput): GroomingFilters & {
  visibility?: Visibility | undefined;
  includeReviewed: boolean;
} {
  const normalized = normalizeFilters({
    ...input,
    olderThanMs: input.olderThanMs ?? 30 * 24 * 60 * 60 * 1000
  });

  return {
    ...normalized,
    visibility: input.visibility,
    includeReviewed: input.includeReviewed ?? false
  };
}

function normalizeDurableApplicationInput(
  input: DurableGroomingApplicationInput
): {
  mode: DurableGroomingApplicationMode;
  statuses: DurableGroomingOutcome[];
  limit?: number | undefined;
  topic?: string | undefined;
  tags?: string[] | undefined;
  visibility?: Visibility | undefined;
} {
  if (
    input.mode !== 'auto' &&
    input.mode !== 'rewrite' &&
    input.mode !== 'archive'
  ) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'mode must be auto, rewrite, or archive'
    );
  }

  if (input.limit !== undefined) {
    if (!Number.isInteger(input.limit) || input.limit <= 0) {
      throw new AppError(
        ErrorCode.VALIDATION,
        'limit must be a positive integer'
      );
    }
  }

  const requestedStatuses = Array.from(
    new Set(input.statuses?.length ? input.statuses : DEFAULT_DURABLE_APPLY_STATUSES)
  );
  if (!requestedStatuses.every(isDurableGroomingOutcome)) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'statuses must be durable grooming outcomes'
    );
  }
  const actionableStatuses = durableApplyStatusesForMode(input.mode);
  const statuses =
    input.mode === 'auto'
      ? requestedStatuses
      : requestedStatuses.filter((status) =>
          actionableStatuses.includes(status)
        );

  return {
    mode: input.mode,
    statuses,
    limit: input.limit,
    topic:
      typeof input.topic === 'string' && input.topic.trim().length > 0
        ? input.topic.trim()
        : undefined,
    tags: input.tags?.length
      ? Array.from(
          new Set(
            input.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0)
          )
        )
      : undefined,
    visibility: input.visibility
  };
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

function buildDurableCandidateQuery({
  filters,
  now
}: {
  filters: ReturnType<typeof normalizeDurableFilters>;
  now: Date;
}): { text: string; values: unknown[] } {
  const conditions = [
    "type = 'memory'",
    "status IS DISTINCT FROM 'archived'",
    "COALESCE(metadata->>'memory_role', 'durable_memory') = 'durable_memory'"
  ];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (!filters.includeReviewed) {
    conditions.push("metadata #>> '{durable_grooming,reviewed_at}' IS NULL");
  }

  const ageCutoff = new Date(now.getTime() - filters.olderThanMs);
  conditions.push(`created_at <= $${paramIndex++}::timestamptz`);
  values.push(ageCutoff.toISOString());

  if (filters.topic) {
    conditions.push(`metadata->>'topic' = $${paramIndex++}`);
    values.push(filters.topic);
  }

  if (filters.tags?.length) {
    conditions.push(`tags @> $${paramIndex++}::text[]`);
    values.push(filters.tags);
  }

  if (filters.visibility) {
    conditions.push(`visibility = $${paramIndex++}`);
    values.push(filters.visibility);
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
      ORDER BY created_at ASC, id ASC
      ${limitClause}
    `,
    values
  };
}

function buildDurableApplicationCandidateQuery({
  filters
}: {
  filters: ReturnType<typeof normalizeDurableApplicationInput>;
}): { text: string; values: unknown[] } {
  const conditions = [
    "type = 'memory'",
    "status IS DISTINCT FROM 'archived'",
    "COALESCE(metadata->>'memory_role', 'durable_memory') = 'durable_memory'",
    "metadata #>> '{durable_grooming,applied_at}' IS NULL",
    `metadata #>> '{durable_grooming,status}' = ANY($1::text[])`
  ];
  const values: unknown[] = [filters.statuses];
  let paramIndex = 2;

  if (filters.topic) {
    conditions.push(`metadata->>'topic' = $${paramIndex++}`);
    values.push(filters.topic);
  }

  if (filters.tags?.length) {
    conditions.push(`tags @> $${paramIndex++}::text[]`);
    values.push(filters.tags);
  }

  if (filters.visibility) {
    conditions.push(`visibility = $${paramIndex++}`);
    values.push(filters.visibility);
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
      ORDER BY created_at ASC, id ASC
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

export function buildDurableMemoryGroomingPrompt(
  candidate: GroomingCandidate
): string {
  return [
    'You are Postgram durable memory grooming. Classify whether a durable_memory record needs follow-up.',
    '',
    'Durable memory is long-lived project or user knowledge that future agents may trust. The goal is to preserve stable truth while identifying stale execution breadcrumbs, duplicate wording, mixed concerns, or obsolete status notes.',
    '',
    'Outcomes:',
    '- keep: the durable memory remains useful as-is.',
    '- needs_grooming: the memory is valuable but should later be distilled, split, merged, or cleaned.',
    '- archive: the memory no longer appears useful. Use this sparingly.',
    '- superseded: the memory appears replaced by newer durable memory.',
    '',
    'Rules:',
    '- Preserve durable decisions, constraints, root causes, preferences, and verified outcomes.',
    '- Do not recommend archiving solely because a memory is old.',
    '- Prefer needs_grooming when stable truth is mixed with stale execution noise.',
    '- Use archive only when the memory no longer appears useful.',
    '- Do not rewrite the memory. Suggested content is only an operator hint for a later workflow.',
    '- Return strict JSON matching the provided schema.',
    '',
    'Candidate:',
    JSON.stringify(
      {
        id: candidate.id,
        role: 'durable_memory',
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

export function buildDurableMemoryRewritePrompt(
  candidate: GroomingCandidate
): string {
  const durableGrooming = getDurableGroomingMetadata(candidate);

  return [
    'Rewrite this durable_memory record into clean durable memory content.',
    '',
    'Durable memory is long-lived project or user knowledge that future agents may trust. Preserve stable decisions, constraints, root causes, preferences, and verified outcomes. Remove stale execution breadcrumbs, transient branch status, duplicate chatter, and session transcript noise.',
    '',
    'Rules:',
    '- Preserve stable decisions and outcomes exactly enough that future agents can rely on them.',
    '- Do not invent facts or broaden scope beyond the original memory.',
    '- Prefer one concise third-person or project-scoped paragraph.',
    '- Return strict JSON matching the provided schema.',
    '',
    'Grooming label:',
    JSON.stringify(durableGrooming, null, 2),
    '',
    'Candidate:',
    JSON.stringify(
      {
        id: candidate.id,
        role: 'durable_memory',
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

function mapGroomingCandidate(row: {
  id: string;
  content: string | null;
  visibility: Visibility;
  owner: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: Date;
}): GroomingCandidate {
  return {
    id: row.id,
    content: row.content,
    visibility: row.visibility,
    owner: row.owner,
    tags: row.tags,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString()
  };
}

function getDurableGroomingMetadata(
  candidate: GroomingCandidate
): Record<string, unknown> {
  const value = candidate.metadata.durable_grooming;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getDurableApplicationStatus(
  candidate: GroomingCandidate
): DurableGroomingOutcome {
  const status = getDurableGroomingMetadata(candidate).status;
  if (!isDurableGroomingOutcome(status)) {
    throw new AppError(
      ErrorCode.VALIDATION,
      `durable grooming status is invalid for ${candidate.id}`
    );
  }

  return status;
}

function getSuggestedTags(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value
        .filter(
          (tag): tag is string =>
            typeof tag === 'string' && tag.trim().length > 0
        )
        .map((tag) => tag.trim())
    : undefined;
}

function mergeTags(existing: string[], additional: string[] | undefined): string[] {
  return Array.from(
    new Set(
      [...existing, ...(additional ?? [])]
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
    )
  );
}

function planDurableApplicationAction(
  status: DurableGroomingOutcome,
  mode: DurableGroomingApplicationMode
): DurableGroomingApplicationAction {
  if (mode === 'rewrite') {
    return status === 'needs_grooming' ? 'rewrite' : 'skip';
  }

  if (mode === 'archive') {
    return status === 'archive' || status === 'superseded'
      ? 'archive'
      : 'skip';
  }

  if (status === 'needs_grooming') {
    return 'rewrite';
  }

  if (status === 'archive' || status === 'superseded') {
    return 'archive';
  }

  return 'skip';
}

function buildApplicationOutcome(
  candidate: GroomingCandidate,
  mode: DurableGroomingApplicationMode
): DurableGroomingApplicationResult['outcomes'][number] {
  const status = getDurableApplicationStatus(candidate);
  const action = planDurableApplicationAction(status, mode);
  const durableGrooming = getDurableGroomingMetadata(candidate);
  const reason =
    typeof durableGrooming.reason === 'string' &&
    durableGrooming.reason.trim().length > 0
      ? durableGrooming.reason.trim()
      : action === 'skip'
        ? `Status ${status} is not actionable in ${mode} mode`
        : `Apply ${status} durable grooming label`;

  return {
    id: candidate.id,
    status,
    action,
    reason
  };
}

function buildAppliedDurableGroomingMetadata({
  prior,
  nextStatus,
  appliedAction,
  now
}: {
  prior: Record<string, unknown>;
  nextStatus?: DurableGroomingOutcome | undefined;
  appliedAction: Exclude<DurableGroomingApplicationAction, 'skip'>;
  now: Date;
}): Record<string, unknown> {
  const previousStatus = prior.status;
  const previousReason = prior.reason;

  return {
    ...prior,
    ...(nextStatus ? { status: nextStatus } : {}),
    ...(typeof previousStatus === 'string'
      ? { previous_status: previousStatus }
      : {}),
    ...(typeof previousReason === 'string'
      ? { previous_reason: previousReason }
      : {}),
    applied_action: appliedAction,
    applied_at: now.toISOString(),
    applied_by: 'pgm-admin memory apply-durable-grooming'
  };
}

async function resolveRewriteDecision(
  candidate: GroomingCandidate,
  callLlm: CallLlm | undefined
): Promise<DurableRewriteDecision | undefined> {
  const durableGrooming = getDurableGroomingMetadata(candidate);
  const suggestedContent = readOptionalString(
    durableGrooming,
    'suggested_content',
    'suggestedContent'
  );

  if (suggestedContent) {
    return {
      content: suggestedContent,
      tags: getSuggestedTags(
        durableGrooming.suggested_tags ?? durableGrooming.suggestedTags
      )
    };
  }

  if (!callLlm) {
    return undefined;
  }

  const response = await callLlm(
    buildDurableMemoryRewritePrompt(candidate),
    DURABLE_MEMORY_REWRITE_SCHEMA
  );
  return parseDurableRewriteDecision(response);
}

export function applyDurableGrooming(
  pool: Pool,
  input: DurableGroomingApplicationInput
): ServiceResult<DurableGroomingApplicationResult> {
  return ResultAsync.fromPromise(
    (async () => {
      const filters = normalizeDurableApplicationInput(input);

      if (!input.dryRun && !input.confirm) {
        throw new AppError(
          ErrorCode.VALIDATION,
          '--yes is required outside dry-run'
        );
      }

      const result = await pool.query<{
        id: string;
        content: string | null;
        visibility: Visibility;
        owner: string | null;
        tags: string[];
        metadata: Record<string, unknown>;
        created_at: Date;
      }>(
        buildDurableApplicationCandidateQuery({
          filters
        })
      );
      const candidates = result.rows.map(mapGroomingCandidate);
      const planned = candidates.map((candidate) =>
        buildApplicationOutcome(candidate, filters.mode)
      );

      if (input.dryRun || candidates.length === 0) {
        return {
          reviewed: planned.length,
          rewritten: 0,
          archived: 0,
          skipped: planned.filter((outcome) => outcome.action === 'skip')
            .length,
          dryRun: input.dryRun,
          outcomes: planned
        };
      }

      const outcomes: DurableGroomingApplicationResult['outcomes'] = [];
      let rewritten = 0;
      let archived = 0;
      let skipped = 0;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        for (const candidate of candidates) {
          const plannedOutcome = buildApplicationOutcome(candidate, filters.mode);
          if (plannedOutcome.action === 'skip') {
            skipped += 1;
            outcomes.push(plannedOutcome);
            continue;
          }

          const durableGrooming = getDurableGroomingMetadata(candidate);

          if (plannedOutcome.action === 'archive') {
            const nextDurableGrooming = buildAppliedDurableGroomingMetadata({
              prior: durableGrooming,
              appliedAction: 'archive',
              now: input.now
            });

            await client.query(
              `
                UPDATE entities
                SET
                  status = 'archived',
                  metadata = jsonb_set(metadata, '{durable_grooming}', $2::jsonb, true)
                WHERE id = $1
              `,
              [candidate.id, JSON.stringify(nextDurableGrooming)]
            );
            archived += 1;
            outcomes.push(plannedOutcome);
            continue;
          }

          let rewrite: DurableRewriteDecision | undefined;
          try {
            rewrite = await resolveRewriteDecision(candidate, input.callLlm);
          } catch (error) {
            skipped += 1;
            outcomes.push({
              ...plannedOutcome,
              action: 'skip',
              reason:
                error instanceof Error && error.message.trim().length > 0
                  ? `Skipped rewrite: ${error.message.trim()}`
                  : 'Skipped rewrite: invalid rewrite response'
            });
            continue;
          }

          if (!rewrite) {
            skipped += 1;
            outcomes.push({
              ...plannedOutcome,
              action: 'skip',
              reason:
                'Skipped rewrite: no suggested_content was available and no LLM rewriter was configured'
            });
            continue;
          }

          const nextDurableGrooming = buildAppliedDurableGroomingMetadata({
            prior: durableGrooming,
            nextStatus: 'keep',
            appliedAction: 'rewrite',
            now: input.now
          });
          const nextTags = mergeTags(candidate.tags, rewrite.tags);

          await client.query(
            `
              DELETE FROM edges
              WHERE source_id = $1
                AND source = 'llm-extraction'
            `,
            [candidate.id]
          );
          await client.query('DELETE FROM chunks WHERE entity_id = $1', [
            candidate.id
          ]);
          await client.query(
            `
              UPDATE entities
              SET
                content = $2,
                tags = $3,
                metadata = jsonb_set(metadata, '{durable_grooming}', $4::jsonb, true),
                enrichment_status = 'pending',
                enrichment_attempts = 0,
                enrichment_error = NULL,
                version = version + 1
              WHERE id = $1
            `,
            [
              candidate.id,
              rewrite.content,
              nextTags,
              JSON.stringify(nextDurableGrooming)
            ]
          );

          rewritten += 1;
          outcomes.push({
            ...plannedOutcome,
            content: rewrite.content,
            ...(rewrite.tags?.length ? { tags: rewrite.tags } : {})
          });
        }

        await client.query('COMMIT');

        return {
          reviewed: planned.length,
          rewritten,
          archived,
          skipped,
          dryRun: false,
          outcomes
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to apply durable grooming')
  );
}

export function previewDurableMemoryGrooming(
  pool: Pool,
  input: DurableGroomingInput
): ServiceResult<GroomingPreview> {
  return ResultAsync.fromPromise(
    (async () => {
      const filters = normalizeDurableFilters(input);
      const result = await pool.query<{
        id: string;
        content: string | null;
        visibility: Visibility;
        owner: string | null;
        tags: string[];
        metadata: Record<string, unknown>;
        created_at: Date;
      }>(
        buildDurableCandidateQuery({
          filters,
          now: input.now
        })
      );

      return {
        eligible: result.rows.map(mapGroomingCandidate)
      };
    })(),
    (error) => toAppError(error, 'Failed to preview durable memory grooming')
  );
}

function buildDurableGroomingMetadata(
  decision: DurableGroomingDecision,
  now: Date
): Record<string, unknown> {
  const durableGrooming: Record<string, unknown> = {
    status: decision.outcome,
    reason: decision.reason,
    reviewed_at: now.toISOString(),
    reviewed_by: 'pgm-admin memory groom-durable'
  };

  if (decision.suggestedAction) {
    durableGrooming.suggested_action = decision.suggestedAction;
  }

  if (decision.suggestedContent) {
    durableGrooming.suggested_content = decision.suggestedContent;
  }

  if (decision.suggestedTags?.length) {
    durableGrooming.suggested_tags = decision.suggestedTags;
  }

  return { durable_grooming: durableGrooming };
}

function mapDurableOutcome(
  candidate: GroomingCandidate,
  decision: DurableGroomingDecision
): DurableMemoryGroomingResult['outcomes'][number] {
  return {
    id: candidate.id,
    outcome: decision.outcome,
    reason: decision.reason,
    ...(decision.suggestedAction
      ? { suggestedAction: decision.suggestedAction }
      : {}),
    ...(decision.suggestedContent
      ? { suggestedContent: decision.suggestedContent }
      : {}),
    ...(decision.suggestedTags?.length
      ? { suggestedTags: decision.suggestedTags }
      : {})
  };
}

export function groomDurableMemory(
  pool: Pool,
  input: DurableGroomingInput & {
    mode: DurableGroomingMode;
    dryRun: boolean;
    confirm: boolean;
    callLlm?: CallLlm | undefined;
  }
): ServiceResult<DurableMemoryGroomingResult> {
  return ResultAsync.fromPromise(
    (async () => {
      const filters = normalizeDurableFilters(input);

      if (input.mode !== 'review' && input.mode !== 'mark') {
        throw new AppError(
          ErrorCode.VALIDATION,
          'mode must be review or mark'
        );
      }

      if (!input.dryRun && input.mode === 'mark' && !input.confirm) {
        throw new AppError(
          ErrorCode.VALIDATION,
          '--yes is required outside dry-run'
        );
      }

      if (input.mode === 'mark' && !input.dryRun && !input.callLlm) {
        throw new AppError(
          ErrorCode.VALIDATION,
          'callLlm is required for durable memory grooming'
        );
      }

      const preview = await previewDurableMemoryGrooming(pool, {
        ...input,
        limit: filters.limit,
        olderThanMs: filters.olderThanMs,
        topic: filters.topic,
        tags: filters.tags,
        visibility: filters.visibility,
        includeReviewed: filters.includeReviewed
      });
      if (preview.isErr()) {
        throw preview.error;
      }

      const decisions: Array<{
        candidate: GroomingCandidate;
        decision: DurableGroomingDecision;
      }> = [];

      for (const candidate of preview.value.eligible) {
        if (!input.callLlm) {
          decisions.push({
            candidate,
            decision: {
              outcome: 'keep',
              reason: 'Preview candidate; no LLM classifier was provided.'
            }
          });
          continue;
        }

        const response = await input.callLlm(
          buildDurableMemoryGroomingPrompt(candidate),
          DURABLE_MEMORY_GROOMING_SCHEMA
        );
        let decision: DurableGroomingDecision;
        try {
          decision = parseDurableGroomingDecision(response);
        } catch (error) {
          decision = durableGroomingParseErrorDecision(error);
        }

        decisions.push({ candidate, decision });
      }

      const outcomes = decisions.map(({ candidate, decision }) =>
        mapDurableOutcome(candidate, decision)
      );

      if (input.dryRun || input.mode === 'review' || decisions.length === 0) {
        return {
          reviewed: decisions.length,
          marked: 0,
          dryRun: input.dryRun,
          outcomes
        };
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        for (const { candidate, decision } of decisions) {
          await client.query(
            `
              UPDATE entities
              SET metadata = metadata || $2::jsonb
              WHERE id = $1
            `,
            [
              candidate.id,
              JSON.stringify(buildDurableGroomingMetadata(decision, input.now))
            ]
          );
        }

        await client.query('COMMIT');

        return {
          reviewed: decisions.length,
          marked: decisions.length,
          dryRun: false,
          outcomes
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to groom durable memory')
  );
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
        eligible: result.rows.map(mapGroomingCandidate)
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

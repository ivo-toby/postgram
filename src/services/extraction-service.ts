import type { Pool } from 'pg';
import type { AuthContext } from '../auth/types.js';
import { createEdge } from './edge-service.js';
import type {
  ActiveEmbeddingModel,
  EmbeddingService
} from './embedding-service.js';
import { vectorToSql } from './embedding-service.js';

type ExtractionResult = {
  targetName: string;
  /**
   * null when the model omitted the field or returned a value outside the
   * supported enum. Downstream callers treat null as "type unknown" and
   * relax type-based filtering accordingly — this avoids the old silent
   * coercion to `'memory'`, which broke matching whenever a provider
   * without structured-output support (OpenAI/Anthropic today) dropped the
   * field.
   */
  targetType: string | null;
  relation: string;
  confidence: number;
};

type RawExtraction = {
  target_name?: string;
  target_type?: string;
  relation?: string;
  confidence?: number;
};

const TARGET_TYPES = [
  'memory',
  'person',
  'project',
  'task',
  'interaction',
  'document'
] as const;

const RELATIONS = [
  'involves',
  'assigned_to',
  'part_of',
  'blocked_by',
  'mentioned_in',
  'related_to'
] as const;

// JSON Schema passed to Ollama's `format` field. Ollama's structured-output
// mode constrains the model's decoder to emit JSON that validates against
// this schema — models like Gemma3 that don't reliably follow prose
// instructions ("return a JSON array …") still produce the right shape here
// because the constraint is enforced at token-sampling time.
export const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          target_name: { type: 'string' },
          target_type: { type: 'string', enum: [...TARGET_TYPES] },
          relation: { type: 'string', enum: [...RELATIONS] },
          confidence: { type: 'number', minimum: 0, maximum: 1 }
        },
        required: ['target_name', 'target_type', 'relation']
      }
    }
  },
  required: ['relationships']
} as const;

function stripMarkdownFences(input: string): string {
  const trimmed = input.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  // Drop the opening fence (``` or ```json etc.) up to and including its newline.
  const afterOpen = trimmed.replace(/^```[^\n]*\n?/, '');
  // Drop a trailing fence if present.
  return afterOpen.replace(/\n?```\s*$/, '').trim();
}

function looksLikeSingleExtraction(value: Record<string, unknown>): boolean {
  return (
    typeof value.target_name === 'string' &&
    typeof value.relation === 'string'
  );
}

export function parseExtractionResponse(response: string): ExtractionResult[] {
  try {
    const parsed: unknown = JSON.parse(stripMarkdownFences(response));

    let items: unknown[];
    if (Array.isArray(parsed)) {
      items = parsed;
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      // Lax models sometimes return a single relationship object directly
      // instead of wrapping it in a list. Treat that as a one-item array so
      // we don't silently drop the extraction.
      if (looksLikeSingleExtraction(obj)) {
        items = [obj];
      } else {
        // Otherwise find the first array value (e.g. { "relationships": [...] }).
        const arrayValue = Object.values(obj).find((v) => Array.isArray(v));
        if (!arrayValue) return [];
        items = arrayValue as unknown[];
      }
    } else {
      return [];
    }

    return (items as RawExtraction[])
      .filter((item) =>
        typeof item.target_name === 'string' && item.target_name.length > 0 &&
        typeof item.relation === 'string' && item.relation.length > 0
      )
      .map((item) => ({
        targetName: item.target_name!,
        targetType:
          typeof item.target_type === 'string' &&
          (TARGET_TYPES as readonly string[]).includes(item.target_type)
            ? item.target_type
            : null,
        relation: item.relation!,
        confidence: typeof item.confidence === 'number'
          ? Math.max(0, Math.min(1, item.confidence))
          : 0.5
      }));
  } catch {
    return [];
  }
}

export function buildExtractionPrompt(type: string, content: string): string {
  return `Given this knowledge entity, identify relationships to other entities.

Entity type: ${type}
Content: ${content}

Return a JSON object with a "relationships" array:
{
  "relationships": [
    {
      "target_name": "name of the referenced entity",
      "target_type": "person|project|task|memory|interaction|document",
      "relation": "involves|assigned_to|part_of|blocked_by|mentioned_in|related_to",
      "confidence": 0.0-1.0
    }
  ]
}

Only include clear, explicit relationships. Do not infer or speculate.
Return {"relationships": []} if no relationships are found.`;
}

type AutoCreateOptions = {
  enabled: boolean;
  types: readonly string[];
  minConfidence: number;
};

type ExtractionOptions = {
  callLlm?:
    | ((prompt: string, schema?: object) => Promise<string>)
    | undefined;
  autoCreate?: AutoCreateOptions | undefined;
  embeddingService?: EmbeddingService | undefined;
  /**
   * Minimum cosine similarity (0..1) required for a semantic chunk match to
   * count as the target. Default 0.5 is a pragmatic balance:
   *  - low enough that paraphrased targets ("EXO migration" ↔ "EXO agent
   *    migration") still match under real embedding models;
   *  - high enough that the ILIKE hub-node false-positives we saw with the
   *    old substring matcher don't re-appear.
   * Production operators should tune via EXTRACTION_MATCH_MIN_SIMILARITY.
   */
  matchMinSimilarity?: number | undefined;
};

export type ExtractionSource = {
  id: string;
  type: string;
  content: string;
  visibility: string;
  owner: string | null;
};

type FindMatchParams = {
  targetName: string;
  /**
   * null means the LLM did not supply a valid target_type. In that case the
   * type-based filters are relaxed so we can still link targets produced by
   * providers that ignore the extraction schema.
   */
  targetType: string | null;
  sourceId: string;
  minSimilarity: number;
  /**
   * Lazy accessor for the active embedding model. Called only when the
   * exact-match stage misses and we need to run a chunk-similarity query.
   * This lets extraction still resolve exact-name targets on installs that
   * lack an active embedding model row, or during a temporary embedding
   * outage.
   */
  getActiveModel: () => Promise<ActiveEmbeddingModel>;
};

export type FindMatchResult =
  | { id: string }
  | { id: null; reason: 'no_match' | 'semantic_skipped' };

/**
 * Thrown by `extractAndLinkRelationships` when one or more targets couldn't
 * be matched because the embedding path was unavailable (missing active
 * model, embedding provider outage, dimension mismatch). The caller is
 * expected to catch this and leave the entity retry-eligible — either by
 * marking `extraction_status = 'failed'` (the enrichment worker already
 * does this on any thrown error) so an operator can re-queue it, or by
 * scheduling its own retry. The error carries `linkedSoFar` so operators
 * can tell how much work was salvaged before the outage hit.
 */
export class SemanticMatchUnavailableError extends Error {
  readonly linkedSoFar: number;
  constructor(linkedSoFar: number) {
    super(
      'extraction deferred: one or more targets required semantic matching ' +
        'but the embedding path was unavailable — retry once embeddings recover'
    );
    this.name = 'SemanticMatchUnavailableError';
    this.linkedSoFar = linkedSoFar;
  }
}

function escapeLikePattern(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

/**
 * Resolve a target name (as emitted by the LLM) to an existing entity id.
 *
 * Three-stage strategy:
 *   1. Exact case-insensitive match on `metadata.title` OR `content`, across
 *      all types. Precise enough that cross-type matches here are almost
 *      always intended (and the old ILIKE behaviour accepted them too).
 *   2. ILIKE substring fallback, restricted to entities that do not yet
 *      have chunks. This keeps extraction linking working during the brief
 *      pending-enrichment window when stage 3 can't help, without
 *      re-introducing the old hub-node false positives (those came from
 *      substring matches against *long-content, fully-chunked* entities,
 *      which are explicitly excluded here).
 *   3. Cosine-similarity search over stored chunks, filtered by
 *      `model_id = activeModel.id` (required — distances across embedding
 *      models are meaningless) and, when the LLM supplied a valid
 *      `targetType`, also by `e.type`. When `targetType` is null, the type
 *      filter is relaxed so providers that ignore the schema still match
 *      paraphrased targets.
 *
 * Returns null when no candidate is good enough.
 */
export async function findMatchingEntityByName(
  pool: Pool,
  embeddingService: EmbeddingService,
  params: FindMatchParams
): Promise<FindMatchResult> {
  const exactMatch = await pool.query<{ id: string }>(
    `
      SELECT id FROM entities
      WHERE status IS DISTINCT FROM 'archived'
        AND id != $1
        AND (
          lower(metadata->>'title') = lower($2)
          OR lower(content) = lower($2)
        )
      ORDER BY
        CASE WHEN lower(metadata->>'title') = lower($2) THEN 0 ELSE 1 END,
        created_at DESC
      LIMIT 1
    `,
    [params.sourceId, params.targetName]
  );
  if (exactMatch.rows[0]) {
    return { id: exactMatch.rows[0].id };
  }

  const escapedName = escapeLikePattern(params.targetName);
  const substringMatch = await pool.query<{ id: string }>(
    `
      SELECT e.id
      FROM entities e
      WHERE e.status IS DISTINCT FROM 'archived'
        AND e.id != $1
        AND e.content ILIKE $2
        AND ($3::text IS NULL OR e.type = $3)
        AND NOT EXISTS (
          SELECT 1 FROM chunks c WHERE c.entity_id = e.id
        )
      ORDER BY length(e.content) ASC, e.created_at DESC
      LIMIT 1
    `,
    [params.sourceId, `%${escapedName}%`, params.targetType]
  );
  if (substringMatch.rows[0]) {
    return { id: substringMatch.rows[0].id };
  }

  // Exact + substring missed → try semantic. Resolving the active model and
  // embedding the target are both wrapped in try/catch: any failure here
  // (missing active model, embedding provider outage, dimension mismatch)
  // degrades to `semantic_skipped` instead of throwing. A throw would bubble
  // up to processNextExtractionEntity and mark the whole entity's extraction
  // as failed — which is never retried — so a transient embedding outage
  // could permanently drop edges for otherwise valid entities. The caller
  // disables auto-create on `semantic_skipped` to avoid creating duplicate
  // stubs for entities the semantic search would have matched.
  let activeModel: ActiveEmbeddingModel;
  try {
    activeModel = await params.getActiveModel();
  } catch {
    return { id: null, reason: 'semantic_skipped' };
  }

  let vector: number[] | undefined;
  try {
    [vector] = await embeddingService.embedBatch([params.targetName], activeModel);
  } catch {
    return { id: null, reason: 'semantic_skipped' };
  }
  if (!vector) return { id: null, reason: 'semantic_skipped' };

  const chunkMatch = await pool.query<{ id: string; similarity: string }>(
    `
      SELECT e.id, 1 - (c.embedding <=> $1::vector) AS similarity
      FROM chunks c
      JOIN entities e ON e.id = c.entity_id
      WHERE e.status IS DISTINCT FROM 'archived'
        AND e.id != $2
        AND c.model_id = $3
        AND ($4::text IS NULL OR e.type = $4)
      ORDER BY c.embedding <=> $1::vector
      LIMIT 1
    `,
    [
      vectorToSql(vector),
      params.sourceId,
      activeModel.id,
      params.targetType
    ]
  );
  const row = chunkMatch.rows[0];
  if (!row) return { id: null, reason: 'no_match' };
  const similarity = Number(row.similarity);
  return similarity >= params.minSimilarity
    ? { id: row.id }
    : { id: null, reason: 'no_match' };
}

const DEFAULT_MATCH_MIN_SIMILARITY = 0.5;

export async function extractAndLinkRelationships(
  pool: Pool,
  auth: AuthContext,
  source: ExtractionSource,
  options: ExtractionOptions = {}
): Promise<number> {
  const prompt = buildExtractionPrompt(source.type, source.content);
  if (!options.callLlm) {
    throw new Error('callLlm is required — configure an extraction provider');
  }
  if (!options.embeddingService) {
    throw new Error(
      'embeddingService is required — semantic matching replaces the old ILIKE lookup'
    );
  }
  const callLlm = options.callLlm;
  const embeddingService = options.embeddingService;
  const minSimilarity = options.matchMinSimilarity ?? DEFAULT_MATCH_MIN_SIMILARITY;

  const response = await callLlm(prompt, EXTRACTION_SCHEMA);
  const extractions = parseExtractionResponse(response);

  let linked = 0;
  const autoCreate = options.autoCreate;

  // Memoize the active-model lookup so at most one DB round-trip happens per
  // extraction pass, and only if a chunk-stage match is actually needed.
  let modelPromise: Promise<ActiveEmbeddingModel> | undefined;
  const getActiveModel = (): Promise<ActiveEmbeddingModel> => {
    if (!modelPromise) {
      modelPromise = embeddingService.getActiveModel(pool);
    }
    return modelPromise;
  };

  let deferredCount = 0;

  for (const extraction of extractions) {
    const matchResult = await findMatchingEntityByName(pool, embeddingService, {
      targetName: extraction.targetName,
      targetType: extraction.targetType,
      sourceId: source.id,
      minSimilarity,
      getActiveModel
    });

    let matchedEntityId: string | null = matchResult.id;

    if (!matchedEntityId) {
      // If the semantic stage couldn't run (embedding provider down, no
      // active model), don't fall through to auto-create: the real target
      // may already exist and would have been matched once embeddings
      // recover. Auto-creating now would produce a duplicate that sticks.
      // We track these as deferred and throw at the end so the caller can
      // leave the entity retry-eligible.
      if ('reason' in matchResult && matchResult.reason === 'semantic_skipped') {
        deferredCount += 1;
        continue;
      }
      if (
        !autoCreate?.enabled ||
        extraction.targetType === null ||
        !autoCreate.types.includes(extraction.targetType) ||
        extraction.confidence < autoCreate.minConfidence
      ) {
        continue;
      }

      // Inherit visibility + owner from the source entity so that references
      // extracted from a personal/work note do not leak into globally visible
      // stubs. `shared` source → `shared` stub, `personal` source owned by
      // Ivo → `personal` stub owned by Ivo.
      const created = await pool.query<{ id: string }>(
        `
          INSERT INTO entities (type, content, visibility, owner, enrichment_status, metadata, tags)
          VALUES ($1, $2, $4, $5, 'pending', $3, ARRAY['auto-created'])
          RETURNING id
        `,
        [
          extraction.targetType,
          extraction.targetName,
          JSON.stringify({
            title: extraction.targetName,
            auto_created_by: 'llm-extraction',
            source_entity_id: source.id
          }),
          source.visibility,
          source.owner
        ]
      );
      matchedEntityId = created.rows[0]?.id ?? null;
      if (!matchedEntityId) continue;
    }

    const result = await createEdge(pool, auth, {
      sourceId: source.id,
      targetId: matchedEntityId,
      relation: extraction.relation,
      confidence: extraction.confidence,
      source: 'llm-extraction'
    });

    if (result.isOk()) linked += 1;
  }

  if (deferredCount > 0) {
    throw new SemanticMatchUnavailableError(linked);
  }

  return linked;
}


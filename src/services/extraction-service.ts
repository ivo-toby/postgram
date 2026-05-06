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

// Relation vocabulary. Order matters only for prompt readability — the schema
// enforces membership at decode time. The richer set (supersedes, derived_from,
// caused_by, discussed_with, references) was added to give the model better
// alternatives to `mentioned_in`, which previously dominated extracted edges
// because it was the safest fallback.
export const RELATIONS = [
  'involves',
  'assigned_to',
  'part_of',
  'blocked_by',
  'related_to',
  'supersedes',
  'derived_from',
  'caused_by',
  'discussed_with',
  'references',
  'mentioned_in'
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
  return `Given this knowledge entity, identify relationships from this entity (the source) to other entities it references.

Source entity:
  Type: ${type}
  Content: ${content}

Schema:
  - target_name: the name or title of the referenced entity (string)
  - target_type: one of person | project | task | memory | interaction | document
  - relation: one of ${RELATIONS.join(' | ')}
  - confidence: 0.0–1.0

Direction:
  Edges go FROM this entity TO the target. "A part_of B" means this entity (A) is part of B.

Type guidance:
  - person: a named human individual
  - project: a named system, product, or initiative
  - task: a discrete work item
  - interaction: a meeting, conversation, or event
  - memory: a recorded preference, decision, or observation
  - document: a written artifact (PRD, proposal, post)

Relation guidance — prefer specific relations over mentioned_in:
  - involves: this entity actively engages target (e.g. a meeting involves a person)
  - assigned_to: this entity is owned by or directed at target
  - part_of: this entity is a component of a larger target
  - blocked_by: this entity cannot proceed until target resolves
  - related_to: this entity is thematically connected without a clearer relation
  - supersedes: this entity replaces the target (newer decision, doc version)
  - derived_from: this entity was based on or derived from the target
  - caused_by: this entity exists because of the target (e.g. a bug caused by a config change)
  - discussed_with: this entity was discussed with the target person
  - references: explicit citation of the target (stronger than mentioned_in)
  - mentioned_in: target is referenced in passing only; reserve for weak signal

Examples:
  - Document about a meeting with a named individual:
    { "target_name": "Alice", "target_type": "person", "relation": "involves", "confidence": 0.95 }
  - Task assigned to a person:
    { "target_name": "Alice", "target_type": "person", "relation": "assigned_to", "confidence": 0.9 }
  - Section of a project roadmap:
    { "target_name": "Platform 2026", "target_type": "project", "relation": "part_of", "confidence": 0.9 }
  - PRD that depends on another PRD:
    { "target_name": "Auth Rework PRD", "target_type": "document", "relation": "blocked_by", "confidence": 0.8 }
  - Memo loosely related to another topic:
    { "target_name": "Onboarding revamp", "target_type": "memory", "relation": "related_to", "confidence": 0.7 }
  - Decision that replaces an older one:
    { "target_name": "ADR-012", "target_type": "document", "relation": "supersedes", "confidence": 0.9 }
  - Architecture doc derived from an earlier proposal:
    { "target_name": "Original Sync Proposal", "target_type": "document", "relation": "derived_from", "confidence": 0.9 }
  - Bug caused by a config change:
    { "target_name": "Cache TTL change", "target_type": "memory", "relation": "caused_by", "confidence": 0.8 }
  - 1:1 notes with a teammate:
    { "target_name": "Bob", "target_type": "person", "relation": "discussed_with", "confidence": 0.9 }
  - Memory citing a decision document:
    { "target_name": "ADR-014", "target_type": "document", "relation": "references", "confidence": 0.85 }
  - Document referenced in passing:
    { "target_name": "Quarterly review", "target_type": "document", "relation": "mentioned_in", "confidence": 0.5 }

Short content can still have relationships. If the content names a person, project, or other entity, emit an edge — do not return [] just because the content is brief.

Only include clear, explicit references. Do not invent targets that are not present in the content.
Return {"relationships": []} if and only if the content references no other entities.`;
}

type AutoCreateOptions = {
  enabled: boolean;
  types: readonly string[];
  /**
   * Global confidence floor. Used as the fallback when the extraction's
   * target type has no entry in `minConfidenceByType`.
   */
  minConfidence: number;
  /**
   * Per-type confidence overrides. A single global threshold is too blunt:
   * persons are routinely emitted at 0.5–0.7 even when clearly named, so a
   * 0.7 floor blocks every first-mention person and the graph stays
   * person-less forever. Default config sets `person: 0.5, project: 0.6` and
   * everything else falls through to `minConfidence`.
   */
  minConfidenceByType?: Readonly<Record<string, number>> | undefined;
};

type SemanticNeighborsOptions = {
  enabled: boolean;
  /**
   * Maximum number of neighbor edges to create per entity. Default 10.
   * The neighbor query returns candidates sorted by similarity descending,
   * so the top-N most similar entities are linked.
   */
  maxNeighbors?: number | undefined;
  /**
   * Minimum cosine similarity (0..1) for an entity to qualify as a neighbor.
   * Default 0.80. Higher than `matchMinSimilarity` because we're looking for
   * genuine topical siblings, not just paraphrase matches.
   * Production operators should tune via EXTRACTION_SEMANTIC_NEIGHBORS_MIN_SIMILARITY.
   */
  minSimilarity?: number | undefined;
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
  /**
   * Skip extraction entirely when source content is shorter than this many
   * characters. Tiny personality/prompt fragment files were producing
   * `Ollama API error: 400` failures and polluting operational dashboards.
   * Default 0 (no skip) preserves prior behaviour for callers that don't
   * pass this option.
   */
  minContentChars?: number | undefined;
  /**
   * Diagnostic callback invoked at every decision point in the extraction
   * pipeline. Off by default — enable via EXTRACTION_DEBUG_LOG to figure
   * out where extractions are being lost (LLM didn't emit them /
   * matcher discarded them / auto-create floor blocked them). Receives
   * structured events: `extraction.skipped_min_chars`,
   * `extraction.llm_response`, `extraction.decision`,
   * `extraction.semantic_neighbor`. Payloads include the source entity id
   * so events can be correlated to one entity.
   */
  debugLog?: ExtractionDebugLogger | undefined;
  /**
   * When enabled, a second pass runs after LLM extraction that finds
   * existing entities with high embedding similarity to the source and
   * links them with `related_to`. This catches thematically-related
   * entities that the LLM pass misses because they are not explicitly
   * named in the source content.
   *
   * Uses the source entity's stored chunks (written by enrichment before
   * extraction runs), so no extra embedding API calls are needed.
   */
  semanticNeighbors?: SemanticNeighborsOptions | undefined;
};

/**
 * Structured event names emitted to `debugLog`. Stable strings so
 * dashboards/log queries can pin to them.
 */
export type ExtractionDebugEvent =
  | 'extraction.skipped_min_chars'
  | 'extraction.llm_response'
  | 'extraction.decision'
  | 'extraction.semantic_neighbor';

export type ExtractionDecision =
  | 'matched_existing'
  | 'auto_created'
  | 'skipped_below_confidence'
  | 'skipped_type_not_allowed'
  | 'skipped_auto_create_disabled'
  | 'skipped_type_unknown'
  | 'deferred_semantic_skipped'
  | 'edge_failed';

export type ExtractionDebugLogger = (
  event: ExtractionDebugEvent,
  payload: Record<string, unknown>
) => void;

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
const DEFAULT_SEMANTIC_NEIGHBORS_MAX = 10;
const DEFAULT_SEMANTIC_NEIGHBORS_MIN_SIMILARITY = 0.80;

/**
 * Find existing entities that are topically similar to the source entity
 * by comparing the source entity's stored chunk embeddings against all other
 * chunk embeddings in the store.
 *
 * Reading vectors from the DB (rather than re-embedding) avoids extra API
 * calls — enrichment always runs before extraction, so the source entity's
 * chunks are guaranteed to exist by the time this is called.
 *
 * The pgvector text format `[v1,v2,...,vN]` returned by `embedding::text`
 * can be passed directly as a `$N::vector` parameter in subsequent queries,
 * so no JSON parsing or re-serialization is needed.
 */
export async function findSemanticNeighbors(
  pool: Pool,
  params: {
    sourceId: string;
    modelId: string;
    excludeIds: Set<string>;
    maxNeighbors: number;
    minSimilarity: number;
  }
): Promise<Array<{ entityId: string; similarity: number }>> {
  const chunkRows = await pool.query<{ embedding: string }>(
    `SELECT embedding::text AS embedding
     FROM chunks
     WHERE entity_id = $1 AND model_id = $2`,
    [params.sourceId, params.modelId]
  );

  if (chunkRows.rows.length === 0) return [];

  // Buffer extra candidates per chunk to give the merge step enough to pick
  // the true top-N after deduplication across multiple source chunks.
  const searchLimit = params.maxNeighbors * 3;
  type NeighborRow = { entity_id: string; similarity: string };
  const similarityMap = new Map<string, number>();

  for (const { embedding } of chunkRows.rows) {
    const rows = await pool.query<NeighborRow>(
      `
        SELECT e.id AS entity_id,
               (1 - (c.embedding <=> $1::vector))::float8 AS similarity
        FROM chunks c
        JOIN entities e ON e.id = c.entity_id
        WHERE e.id != $2
          AND c.model_id = $3
          AND e.status IS DISTINCT FROM 'archived'
          AND NOT ('auto-created' = ANY(e.tags))
        ORDER BY c.embedding <=> $1::vector
        LIMIT $4
      `,
      [embedding, params.sourceId, params.modelId, searchLimit]
    );

    for (const row of rows.rows) {
      const sim = Number(row.similarity);
      const prev = similarityMap.get(row.entity_id) ?? 0;
      if (sim > prev) similarityMap.set(row.entity_id, sim);
    }
  }

  return [...similarityMap.entries()]
    .filter(([id, sim]) => !params.excludeIds.has(id) && sim >= params.minSimilarity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, params.maxNeighbors)
    .map(([entityId, similarity]) => ({ entityId, similarity }));
}

export async function extractAndLinkRelationships(
  pool: Pool,
  auth: AuthContext,
  source: ExtractionSource,
  options: ExtractionOptions = {}
): Promise<number> {
  if (!options.callLlm) {
    throw new Error('callLlm is required — configure an extraction provider');
  }
  if (!options.embeddingService) {
    throw new Error(
      'embeddingService is required — semantic matching replaces the old ILIKE lookup'
    );
  }
  const debugLog = options.debugLog;

  // Skip tiny inputs before they reach the LLM. Short personality/prompt
  // fragment files were the dominant source of `Ollama API error: 400` in
  // production — there's nothing useful to extract from <80 chars and the
  // failures pollute the dashboard. Counting trimmed chars so whitespace-only
  // padding doesn't sneak through.
  const trimmedLength = source.content.trim().length;
  const minContentChars = options.minContentChars ?? 0;
  if (minContentChars > 0 && trimmedLength < minContentChars) {
    debugLog?.('extraction.skipped_min_chars', {
      entityId: source.id,
      type: source.type,
      contentChars: trimmedLength,
      minContentChars
    });
    return 0;
  }

  const prompt = buildExtractionPrompt(source.type, source.content);
  const callLlm = options.callLlm;
  const embeddingService = options.embeddingService;
  const minSimilarity = options.matchMinSimilarity ?? DEFAULT_MATCH_MIN_SIMILARITY;

  const response = await callLlm(prompt, EXTRACTION_SCHEMA);
  const extractions = parseExtractionResponse(response);

  debugLog?.('extraction.llm_response', {
    entityId: source.id,
    type: source.type,
    contentChars: trimmedLength,
    raw: response,
    parsedCount: extractions.length,
    parsed: extractions.map((e) => ({
      targetName: e.targetName,
      targetType: e.targetType,
      relation: e.relation,
      confidence: e.confidence
    }))
  });

  let linked = 0;
  const autoCreate = options.autoCreate;
  // Track every entity ID linked in the LLM pass so the neighbor pass can
  // exclude them — avoids creating a duplicate `related_to` alongside an
  // already-created stronger-typed edge for the same pair.
  const linkedEntityIds = new Set<string>();

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
    const baseLog = {
      entityId: source.id,
      target: extraction.targetName,
      targetType: extraction.targetType,
      relation: extraction.relation,
      confidence: extraction.confidence
    };
    const matchResult = await findMatchingEntityByName(pool, embeddingService, {
      targetName: extraction.targetName,
      targetType: extraction.targetType,
      sourceId: source.id,
      minSimilarity,
      getActiveModel
    });

    let matchedEntityId: string | null = matchResult.id;
    let wasAutoCreated = false;

    if (!matchedEntityId) {
      // If the semantic stage couldn't run (embedding provider down, no
      // active model), don't fall through to auto-create: the real target
      // may already exist and would have been matched once embeddings
      // recover. Auto-creating now would produce a duplicate that sticks.
      // We track these as deferred and throw at the end so the caller can
      // leave the entity retry-eligible.
      if ('reason' in matchResult && matchResult.reason === 'semantic_skipped') {
        debugLog?.('extraction.decision', {
          ...baseLog,
          decision: 'deferred_semantic_skipped'
        });
        deferredCount += 1;
        continue;
      }
      if (!autoCreate?.enabled) {
        debugLog?.('extraction.decision', {
          ...baseLog,
          decision: 'skipped_auto_create_disabled'
        });
        continue;
      }
      if (extraction.targetType === null) {
        debugLog?.('extraction.decision', {
          ...baseLog,
          decision: 'skipped_type_unknown'
        });
        continue;
      }
      if (!autoCreate.types.includes(extraction.targetType)) {
        debugLog?.('extraction.decision', {
          ...baseLog,
          decision: 'skipped_type_not_allowed',
          allowedTypes: [...autoCreate.types]
        });
        continue;
      }
      const perTypeFloor =
        autoCreate.minConfidenceByType?.[extraction.targetType];
      const requiredConfidence =
        perTypeFloor !== undefined ? perTypeFloor : autoCreate.minConfidence;
      if (extraction.confidence < requiredConfidence) {
        debugLog?.('extraction.decision', {
          ...baseLog,
          decision: 'skipped_below_confidence',
          requiredConfidence
        });
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
      if (!matchedEntityId) {
        debugLog?.('extraction.decision', {
          ...baseLog,
          decision: 'edge_failed',
          reason: 'auto_create_returned_no_id'
        });
        continue;
      }
      wasAutoCreated = true;
    }

    const result = await createEdge(pool, auth, {
      sourceId: source.id,
      targetId: matchedEntityId,
      relation: extraction.relation,
      confidence: extraction.confidence,
      source: 'llm-extraction'
    });

    if (result.isOk()) {
      linked += 1;
      linkedEntityIds.add(matchedEntityId);
      debugLog?.('extraction.decision', {
        ...baseLog,
        decision: wasAutoCreated ? 'auto_created' : 'matched_existing',
        matchedEntityId
      });
    } else {
      debugLog?.('extraction.decision', {
        ...baseLog,
        decision: 'edge_failed',
        matchedEntityId,
        error: result.error.message
      });
    }
  }

  if (deferredCount > 0) {
    throw new SemanticMatchUnavailableError(linked);
  }

  // Semantic neighbor pass: find entities that are topically similar to the
  // source by cosine distance over stored chunks, and link them with
  // `related_to`. This catches thematically-related entities that the LLM
  // pass missed because they are not explicitly named in the source content
  // (e.g. a weekly kickoff meeting about the same initiative, a wiki page
  // covering the same strategy).
  if (options.semanticNeighbors?.enabled) {
    const maxNeighbors =
      options.semanticNeighbors.maxNeighbors ?? DEFAULT_SEMANTIC_NEIGHBORS_MAX;
    const neighborMinSimilarity =
      options.semanticNeighbors.minSimilarity ?? DEFAULT_SEMANTIC_NEIGHBORS_MIN_SIMILARITY;

    let activeModel: ActiveEmbeddingModel | undefined;
    try {
      activeModel = await getActiveModel();
    } catch {
      // Embedding model unavailable — skip neighbor pass without failing extraction.
    }

    if (activeModel) {
      const neighbors = await findSemanticNeighbors(pool, {
        sourceId: source.id,
        modelId: activeModel.id,
        excludeIds: new Set([source.id, ...linkedEntityIds]),
        maxNeighbors,
        minSimilarity: neighborMinSimilarity
      });

      for (const neighbor of neighbors) {
        const result = await createEdge(pool, auth, {
          sourceId: source.id,
          targetId: neighbor.entityId,
          relation: 'related_to',
          confidence: neighbor.similarity,
          source: 'semantic-neighbor'
        });

        if (result.isOk()) {
          linked += 1;
          linkedEntityIds.add(neighbor.entityId);
          debugLog?.('extraction.semantic_neighbor', {
            entityId: source.id,
            targetId: neighbor.entityId,
            similarity: neighbor.similarity,
            decision: 'linked'
          });
        } else {
          debugLog?.('extraction.semantic_neighbor', {
            entityId: source.id,
            targetId: neighbor.entityId,
            similarity: neighbor.similarity,
            decision: 'edge_failed',
            error: result.error.message
          });
        }
      }
    }
  }

  return linked;
}


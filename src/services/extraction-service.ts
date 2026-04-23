import type { Pool } from 'pg';
import type { AuthContext } from '../auth/types.js';
import { createEdge } from './edge-service.js';

type ExtractionResult = {
  targetName: string;
  targetType: string;
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
        required: ['target_name', 'relation']
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
        targetType: item.target_type ?? 'memory',
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
};

export type ExtractionSource = {
  id: string;
  type: string;
  content: string;
  visibility: string;
  owner: string | null;
};

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
  const callLlm = options.callLlm;

  const response = await callLlm(prompt, EXTRACTION_SCHEMA);
  const extractions = parseExtractionResponse(response);

  let linked = 0;
  const autoCreate = options.autoCreate;

  for (const extraction of extractions) {
    // Escape ILIKE wildcards (% and _) in the target name
    const escapedName = extraction.targetName
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');

    const matches = await pool.query<{ id: string }>(
      `
        SELECT id FROM entities
        WHERE status IS DISTINCT FROM 'archived'
          AND id != $1
          AND (
            metadata->>'title' ILIKE $2
            OR content ILIKE $3
          )
        ORDER BY
          CASE WHEN metadata->>'title' ILIKE $2 THEN 0 ELSE 1 END,
          created_at DESC
        LIMIT 1
      `,
      [source.id, escapedName, `%${escapedName}%`]
    );

    let matchedEntityId = matches.rows[0]?.id;

    if (!matchedEntityId) {
      if (
        !autoCreate?.enabled ||
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
      matchedEntityId = created.rows[0]?.id;
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

  return linked;
}


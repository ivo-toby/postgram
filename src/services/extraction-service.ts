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

export function parseExtractionResponse(response: string): ExtractionResult[] {
  try {
    const parsed: unknown = JSON.parse(response);
    if (!Array.isArray(parsed)) return [];

    return (parsed as RawExtraction[])
      .filter((item) =>
        typeof item.target_name === 'string' && item.target_name.length > 0 &&
        typeof item.relation === 'string' && item.relation.length > 0
      )
      .map((item) => ({
        targetName: item.target_name!,
        targetType: item.target_type ?? 'memory',
        relation: item.relation!,
        confidence: typeof item.confidence === 'number' ? item.confidence : 0.5
      }));
  } catch {
    return [];
  }
}

export function buildExtractionPrompt(type: string, content: string): string {
  return `Given this knowledge entity, identify relationships to other entities.

Entity type: ${type}
Content: ${content}

Return a JSON array of relationships:
[
  {
    "target_name": "name of the referenced entity",
    "target_type": "person|project|task|memory|interaction|document",
    "relation": "involves|assigned_to|part_of|blocked_by|mentioned_in|related_to",
    "confidence": 0.0-1.0
  }
]

Only include clear, explicit relationships. Do not infer or speculate.
Return [] if no relationships are found.`;
}

type ExtractionOptions = {
  callLlm?: (prompt: string) => Promise<string>;
};

export async function extractAndLinkRelationships(
  pool: Pool,
  auth: AuthContext,
  entityId: string,
  entityType: string,
  content: string,
  options: ExtractionOptions = {}
): Promise<number> {
  const prompt = buildExtractionPrompt(entityType, content);
  const callLlm = options.callLlm ?? defaultCallLlm;

  const response = await callLlm(prompt);
  const extractions = parseExtractionResponse(response);

  let linked = 0;

  for (const extraction of extractions) {
    const matches = await pool.query<{ id: string }>(
      `
        SELECT id FROM entities
        WHERE status IS DISTINCT FROM 'archived'
          AND id != $1
          AND (
            metadata->>'title' ILIKE $2
            OR content ILIKE $3
          )
        LIMIT 1
      `,
      [entityId, extraction.targetName, `%${extraction.targetName}%`]
    );

    const matchedEntity = matches.rows[0];
    if (!matchedEntity) continue;

    const result = await createEdge(pool, auth, {
      sourceId: entityId,
      targetId: matchedEntity.id,
      relation: extraction.relation,
      confidence: extraction.confidence,
      source: 'llm-extraction'
    });

    if (result.isOk()) linked += 1;
  }

  return linked;
}

async function defaultCallLlm(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const model = process.env.EXTRACTION_MODEL ?? 'gpt-4o-mini';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0
    })
  });

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status}`);
  }

  const body = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  return body.choices[0]?.message?.content ?? '[]';
}

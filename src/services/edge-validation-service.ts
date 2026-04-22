import type { Logger } from 'pino';
import type { Pool } from 'pg';

type LlmCaller = (prompt: string) => Promise<string>;

export type EdgeValidationOptions = {
  source?: string | undefined;
  limit?: number | undefined;
  minConfidence?: number;
  skipValidatedDays?: number;
  force?: boolean;
  dryRun?: boolean;
  logger?: Logger;
  now?: () => Date;
};

export type EdgeValidationResult = {
  checked: number;
  removed: number;
  kept: number;
  skipped: number;
  errored: number;
};

type CandidateEdgeRow = {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  confidence: number;
  metadata: Record<string, unknown> | null;
  source_content: string | null;
  source_type: string;
  target_content: string | null;
  target_type: string;
  target_title: string | null;
};

type Verdict = {
  valid: boolean;
  confidence: number;
  reason?: string;
};

export function buildValidationPrompt(edge: {
  sourceType: string;
  sourceContent: string;
  targetType: string;
  targetContent: string;
  targetTitle: string | null;
  relation: string;
}): string {
  const targetLabel = edge.targetTitle
    ? `${edge.targetTitle} (${edge.targetType})`
    : `(${edge.targetType})`;

  return `You are reviewing a knowledge-graph edge for quality. Decide whether the relationship is actually supported by the source content.

Source entity (${edge.sourceType}):
${edge.sourceContent}

Target entity ${targetLabel}:
${edge.targetContent}

Claimed relationship: source --[${edge.relation}]--> target

Respond with a single JSON object:
{
  "valid": true | false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}

Set valid=false when: the source does not actually reference the target, the relation does not match what the source says, the target is only mentioned incidentally with no meaningful relationship, or the relation label is clearly wrong. Otherwise valid=true.`;
}

export function parseValidationResponse(response: string): Verdict | null {
  const trimmed = response.trim();
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj['valid'] !== 'boolean') return null;
    const rawConf = obj['confidence'];
    const confidence = typeof rawConf === 'number' ? Math.max(0, Math.min(1, rawConf)) : 0.5;
    const reason = typeof obj['reason'] === 'string' ? obj['reason'] : undefined;
    return reason !== undefined
      ? { valid: obj['valid'], confidence, reason }
      : { valid: obj['valid'], confidence };
  } catch {
    return null;
  }
}

export async function validateEdgeBatch(
  pool: Pool,
  callLlm: LlmCaller,
  options: EdgeValidationOptions = {}
): Promise<EdgeValidationResult> {
  const source = options.source ?? 'llm-extraction';
  const limit = options.limit ?? 100;
  const minConfidence = options.minConfidence ?? 0.4;
  const skipDays = options.skipValidatedDays ?? 7;
  const force = options.force ?? false;
  const dryRun = options.dryRun ?? false;
  const now = options.now ?? (() => new Date());
  const logger = options.logger;

  // Always exclude edges whose source or target has no content — we cannot
  // judge the relationship without text. Filtering at the SQL layer (rather
  // than just skipping in the runtime loop) prevents these unvalidatable
  // rows from filling the LIMIT every run and starving newer candidates,
  // since the candidate ordering is `created_at ASC`.
  const conditions: string[] = [
    'src.content IS NOT NULL',
    'tgt.content IS NOT NULL'
  ];
  const params: unknown[] = [];

  if (source !== 'any') {
    params.push(source);
    conditions.push(`e.source = $${params.length}`);
  }

  if (!force) {
    const cutoff = new Date(now().getTime() - skipDays * 24 * 60 * 60 * 1000).toISOString();
    params.push(cutoff);
    conditions.push(
      `(e.metadata->>'last_validated_at' IS NULL OR e.metadata->>'last_validated_at' < $${params.length})`
    );
  }

  params.push(limit);
  const limitParamIndex = params.length;

  const whereSql = `WHERE ${conditions.join(' AND ')}`;

  const query = `
    SELECT
      e.id,
      e.source_id,
      e.target_id,
      e.relation,
      e.confidence,
      e.metadata,
      src.content   AS source_content,
      src.type      AS source_type,
      tgt.content   AS target_content,
      tgt.type      AS target_type,
      tgt.metadata->>'title' AS target_title
    FROM edges e
    JOIN entities src ON src.id = e.source_id
    JOIN entities tgt ON tgt.id = e.target_id
    ${whereSql}
    ORDER BY e.created_at ASC
    LIMIT $${limitParamIndex}
  `;

  const candidates = await pool.query<CandidateEdgeRow>(query, params);

  const result: EdgeValidationResult = {
    checked: 0,
    removed: 0,
    kept: 0,
    skipped: 0,
    errored: 0
  };

  for (const edge of candidates.rows) {
    result.checked += 1;

    if (!edge.source_content || !edge.target_content) {
      result.skipped += 1;
      logger?.info(
        { edgeId: edge.id, reason: 'missing content' },
        'skipping edge validation'
      );
      continue;
    }

    const prompt = buildValidationPrompt({
      sourceType: edge.source_type,
      sourceContent: edge.source_content,
      targetType: edge.target_type,
      targetContent: edge.target_content,
      targetTitle: edge.target_title,
      relation: edge.relation
    });

    let verdict: Verdict | null;
    try {
      const response = await callLlm(prompt);
      verdict = parseValidationResponse(response);
    } catch (error) {
      result.errored += 1;
      logger?.warn(
        { err: error, edgeId: edge.id },
        'edge validation LLM call failed'
      );
      continue;
    }

    if (!verdict) {
      result.errored += 1;
      logger?.warn(
        { edgeId: edge.id },
        'edge validation response could not be parsed'
      );
      continue;
    }

    const shouldRemove = !verdict.valid || verdict.confidence < minConfidence;

    if (shouldRemove) {
      result.removed += 1;
      logger?.info(
        {
          edgeId: edge.id,
          relation: edge.relation,
          verdict
        },
        dryRun ? 'would remove edge' : 'removing edge'
      );
      if (!dryRun) {
        await pool.query('DELETE FROM edges WHERE id = $1', [edge.id]);
      }
    } else {
      result.kept += 1;
      if (!dryRun) {
        const nextMetadata = {
          ...(edge.metadata ?? {}),
          last_validated_at: now().toISOString(),
          last_validation_confidence: verdict.confidence
        };
        await pool.query('UPDATE edges SET metadata = $1 WHERE id = $2', [
          JSON.stringify(nextMetadata),
          edge.id
        ]);
      }
    }
  }

  return result;
}

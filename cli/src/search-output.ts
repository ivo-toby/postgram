export type FullSearchResponse = {
  results: Array<{
    entity: {
      id: string;
      type: string;
      content: string | null;
      tags?: string[];
    };
    chunk_content: string;
    score: number;
    edges?: CompactSearchEdgeSummary;
    related?: Array<{
      entity: {
        id: string;
        type: string;
        content: string | null;
      };
      relation: string;
      direction: string;
    }>;
  }>;
};

export type FullStoredEntity = {
  id: string;
  type: string;
  content: string | null;
  visibility?: string;
  owner?: string | null;
  status?: string | null;
  enrichment_status?: string | null;
  version?: number;
  tags?: string[];
  source?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type CompactStoredEntity = {
  id: string;
  type: string;
  version?: number;
  content?: string | null;
  status?: string;
  visibility?: string;
  owner?: string;
  enrichment_status?: string;
  tags?: string[];
  source?: string;
};

export type EntityListResponse = {
  items: FullStoredEntity[];
  total: number;
  limit: number;
  offset: number;
};

export type CompactEntityListResponse = {
  items: CompactStoredEntity[];
  total: number;
  limit: number;
  offset: number;
};

export type FullEdge = {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  confidence?: number;
  source?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
};

export type CompactEdge = {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  confidence?: number;
};

export type FullGraphResponse = {
  entities: Array<{
    id: string;
    type: string;
    content: string | null;
    metadata?: Record<string, unknown>;
  }>;
  edges: FullEdge[];
};

export type CompactGraphResponse = {
  entities: Array<{
    id: string;
    type: string;
    content: string | null;
  }>;
  edges: CompactEdge[];
};

export type CompactSearchResponse = {
  results: CompactSearchResult[];
};

export type CompactSearchResult = {
  id: string;
  type: string;
  score: number;
  content: string | null;
  chunk: string;
  tags?: string[];
  edges?: CompactSearchEdgeSummary;
  related?: CompactRelatedResult[];
};

export type CompactSearchEdgeSummary = {
  count: number;
  relations: Array<{ relation: string; count: number }>;
};

type CompactRelatedResult = {
  id: string;
  type: string;
  relation: string;
  direction: string;
  content: string | null;
};

export function compactStoredEntity(
  entity: FullStoredEntity,
  options: { includeContent?: boolean } = {}
): CompactStoredEntity {
  return {
    id: entity.id,
    type: entity.type,
    ...(entity.version !== undefined ? { version: entity.version } : {}),
    ...(options.includeContent ? { content: entity.content } : {}),
    ...(entity.status ? { status: entity.status } : {}),
    ...(entity.visibility ? { visibility: entity.visibility } : {}),
    ...(entity.owner ? { owner: entity.owner } : {}),
    ...(entity.enrichment_status
      ? { enrichment_status: entity.enrichment_status }
      : {}),
    ...(entity.tags?.length ? { tags: entity.tags } : {}),
    ...(entity.source ? { source: entity.source } : {})
  };
}

export function compactStoredEntityResponse(response: {
  entity: FullStoredEntity;
}) {
  return {
    entity: compactStoredEntity(response.entity)
  };
}

export function compactEntityListResponse(
  response: EntityListResponse
): CompactEntityListResponse {
  return {
    items: response.items.map((entity) =>
      compactStoredEntity(entity, { includeContent: true })
    ),
    total: response.total,
    limit: response.limit,
    offset: response.offset
  };
}

export function compactEdge(edge: FullEdge): CompactEdge {
  return {
    id: edge.id,
    source_id: edge.source_id,
    target_id: edge.target_id,
    relation: edge.relation,
    ...(edge.confidence !== undefined ? { confidence: edge.confidence } : {})
  };
}

export function compactEdgeResponse(response: { edge: FullEdge }) {
  return {
    edge: compactEdge(response.edge)
  };
}

export function compactGraphResponse(
  response: FullGraphResponse
): CompactGraphResponse {
  return {
    entities: response.entities.map((entity) => ({
      id: entity.id,
      type: entity.type,
      content: entity.content
    })),
    edges: response.edges.map(compactEdge)
  };
}

export function compactSearchResponse(
  response: FullSearchResponse
): CompactSearchResponse {
  return {
    results: response.results.map((entry) => ({
      id: entry.entity.id,
      type: entry.entity.type,
      score: entry.score,
      content: entry.entity.content,
      chunk: entry.chunk_content,
      ...(entry.entity.tags?.length ? { tags: entry.entity.tags } : {}),
      ...(entry.edges ? { edges: entry.edges } : {}),
      ...(entry.related?.length
        ? {
            related: entry.related.map((related) => ({
              id: related.entity.id,
              type: related.entity.type,
              relation: related.relation,
              direction: related.direction,
              content: related.entity.content
            }))
          }
        : {})
    }))
  };
}

function toonScalar(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  let scalar: string;
  if (Array.isArray(value)) {
    scalar = value.join('|');
  } else if (typeof value === 'object') {
    scalar = JSON.stringify(value);
  } else if (typeof value === 'string') {
    scalar = value;
  } else if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    scalar = value.toString();
  } else {
    scalar = JSON.stringify(value);
  }

  return /[,\n\r"]/u.test(scalar) ? JSON.stringify(scalar) : scalar;
}

function formatEdgeSummary(edges?: CompactSearchEdgeSummary): string {
  if (!edges || edges.count === 0) {
    return '';
  }

  const relations = edges.relations
    .map((entry) => `${entry.relation}=${entry.count}`)
    .join('|');

  return `${edges.count} edges${relations ? `: ${relations}` : ''}`;
}

export function searchResponseToToon(response: CompactSearchResponse): string {
  const lines = [
    `results[${response.results.length}]{id,type,score,content,chunk,tags,edges,related}:`
  ];

  for (const result of response.results) {
    lines.push(
      [
        result.id,
        result.type,
        Number.isFinite(result.score)
          ? Number(result.score.toFixed(6))
          : result.score,
        result.content,
        result.chunk,
        result.tags,
        formatEdgeSummary(result.edges),
        result.related?.length ? `${result.related.length} related` : ''
      ]
        .map(toonScalar)
        .join(',')
    );

    if (result.related?.length) {
      lines.push(
        `  related[${result.related.length}]{id,type,relation,direction,content}:`
      );
      for (const related of result.related) {
        lines.push(
          `  ${[
            related.id,
            related.type,
            related.relation,
            related.direction,
            related.content
          ]
            .map(toonScalar)
            .join(',')}`
        );
      }
    }
  }

  return lines.join('\n');
}

export function entityListResponseToToon(
  response: CompactEntityListResponse
): string {
  const lines = [
    `items[${response.items.length}]{id,type,status,version,content,tags,owner}:`
  ];

  for (const item of response.items) {
    lines.push(
      [
        item.id,
        item.type,
        item.status,
        item.version,
        item.content,
        item.tags,
        item.owner
      ]
        .map(toonScalar)
        .join(',')
    );
  }

  lines.push(`total,${response.total}`);
  lines.push(`limit,${response.limit}`);
  lines.push(`offset,${response.offset}`);
  return lines.join('\n');
}

export function graphResponseToToon(response: CompactGraphResponse): string {
  const lines = [`entities[${response.entities.length}]{id,type,content}:`];

  for (const entity of response.entities) {
    lines.push(
      [entity.id, entity.type, entity.content].map(toonScalar).join(',')
    );
  }

  lines.push(
    `edges[${response.edges.length}]{id,source_id,target_id,relation,confidence}:`
  );
  for (const edge of response.edges) {
    lines.push(
      [edge.id, edge.source_id, edge.target_id, edge.relation, edge.confidence]
        .map(toonScalar)
        .join(',')
    );
  }

  return lines.join('\n');
}

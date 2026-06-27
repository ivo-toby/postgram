import { describe, expect, it } from 'vitest';

import {
  compactEdgeResponse,
  compactEntityListResponse,
  compactGraphResponse,
  compactStoredEntityResponse,
  compactSearchResponse,
  entityListResponseToToon,
  graphResponseToToon,
  searchResponseToToon
} from '../../src/util/search-output.js';

const fullEntity = {
  id: '01234567-89ab-cdef-0123-456789abcdef',
  type: 'memory',
  content: 'token compact search response shape',
  visibility: 'personal',
  owner: null,
  status: null,
  enrichment_status: 'completed',
  version: 3,
  tags: ['tokens'],
  source: null,
  metadata: { memory_role: 'durable_memory' },
  created_at: '2026-06-07T00:00:00.000Z',
  updated_at: '2026-06-07T00:01:00.000Z'
};

const fullSearchResponse = {
  results: [
    {
      entity: fullEntity,
      chunk_content: 'token compact search response shape',
      similarity: 0.99,
      score: 0.88,
      edges: {
        count: 3,
        relations: [
          { relation: 'mentioned_in', count: 2 },
          { relation: 'depends_on', count: 1 }
        ]
      },
      related: [
        {
          entity: {
            id: 'fedcba98-7654-3210-fedc-ba9876543210',
            type: 'project',
            content: 'Postgram',
            metadata: { noisy: true }
          },
          relation: 'part_of',
          direction: 'outgoing' as const
        }
      ]
    }
  ]
};

describe('search output formatting', () => {
  it('compacts entity acknowledgements without content metadata or timestamps', () => {
    expect(compactStoredEntityResponse({ entity: fullEntity })).toEqual({
      entity: {
        id: '01234567-89ab-cdef-0123-456789abcdef',
        type: 'memory',
        version: 3,
        visibility: 'personal',
        enrichment_status: 'completed',
        tags: ['tokens']
      }
    });
  });

  it('compacts list responses and serializes them as TOON', () => {
    const compact = compactEntityListResponse({
      items: [fullEntity],
      total: 1,
      limit: 50,
      offset: 0
    });

    expect(compact).toEqual({
      items: [
        {
          id: '01234567-89ab-cdef-0123-456789abcdef',
          type: 'memory',
          version: 3,
          content: 'token compact search response shape',
          visibility: 'personal',
          enrichment_status: 'completed',
          tags: ['tokens']
        }
      ],
      total: 1,
      limit: 50,
      offset: 0
    });

    const toon = entityListResponseToToon(compact);
    expect(toon).toContain(
      'items[1]{id,type,status,version,content,tags,owner}:'
    );
    expect(toon).not.toContain('metadata');
    expect(toon).not.toContain('created_at');
  });

  it('compacts edge acknowledgements', () => {
    expect(
      compactEdgeResponse({
        edge: {
          id: 'edge-1',
          source_id: 'source-1',
          target_id: 'target-1',
          relation: 'depends_on',
          confidence: 0.8,
          source: 'llm-extraction',
          metadata: { noisy: true },
          created_at: '2026-06-07T00:00:00.000Z'
        }
      })
    ).toEqual({
      edge: {
        id: 'edge-1',
        source_id: 'source-1',
        target_id: 'target-1',
        relation: 'depends_on',
        confidence: 0.8
      }
    });
  });

  it('compacts graph responses and serializes them as TOON', () => {
    const compact = compactGraphResponse({
      entities: [
        {
          id: 'source-1',
          type: 'memory',
          content: 'Source memory',
          metadata: { noisy: true }
        }
      ],
      edges: [
        {
          id: 'edge-1',
          source_id: 'source-1',
          target_id: 'target-1',
          relation: 'depends_on',
          confidence: 1,
          source: 'manual',
          metadata: { noisy: true },
          created_at: '2026-06-07T00:00:00.000Z'
        }
      ]
    });

    expect(compact).toEqual({
      entities: [{ id: 'source-1', type: 'memory', content: 'Source memory' }],
      edges: [
        {
          id: 'edge-1',
          source_id: 'source-1',
          target_id: 'target-1',
          relation: 'depends_on',
          confidence: 1
        }
      ]
    });

    const toon = graphResponseToToon(compact);
    expect(toon).toContain('entities[1]{id,type,content}:');
    expect(toon).toContain(
      'edges[1]{id,source_id,target_id,relation,confidence}:'
    );
    expect(toon).not.toContain('metadata');
    expect(toon).not.toContain('created_at');
  });

  it('compacts search responses for agent-token-efficient defaults', () => {
    expect(compactSearchResponse(fullSearchResponse)).toEqual({
      results: [
        {
          id: '01234567-89ab-cdef-0123-456789abcdef',
          type: 'memory',
          score: 0.88,
          content: 'token compact search response shape',
          chunk: 'token compact search response shape',
          tags: ['tokens'],
          edges: {
            count: 3,
            relations: [
              { relation: 'mentioned_in', count: 2 },
              { relation: 'depends_on', count: 1 }
            ]
          },
          related: [
            {
              id: 'fedcba98-7654-3210-fedc-ba9876543210',
              type: 'project',
              relation: 'part_of',
              direction: 'outgoing',
              content: 'Postgram'
            }
          ]
        }
      ]
    });
  });

  it('serializes compact search responses as TOON without full entity metadata', () => {
    const toon = searchResponseToToon(
      compactSearchResponse(fullSearchResponse)
    );

    expect(toon).toContain(
      'results[1]{id,type,score,content,chunk,tags,edges,related}:'
    );
    expect(toon).toContain('01234567-89ab-cdef-0123-456789abcdef,memory,0.88');
    expect(toon).toContain('tokens');
    expect(toon).toContain('3 edges: mentioned_in=2|depends_on=1');
    expect(toon).toContain('related[1]{id,type,relation,direction,content}:');
    expect(toon).not.toContain('metadata');
    expect(toon).not.toContain('created_at');
    expect(toon).not.toContain('similarity');
  });
});

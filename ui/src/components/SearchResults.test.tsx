import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SearchResult } from '../lib/types.ts';
import SearchResults from './SearchResults.tsx';

const result: SearchResult = {
  entity: {
    id: 'entity-1',
    type: 'memory',
    content: 'Search result',
    visibility: 'personal',
    owner: 'ivo',
    status: 'active',
    enrichment_status: 'completed',
    version: 1,
    tags: [],
    source: null,
    metadata: {},
    created_at: '2026-06-14T08:00:00.000Z',
    updated_at: '2026-06-14T08:15:00.000Z',
  },
  chunk_content: 'Search result chunk',
  similarity: 0.91,
  score: 0.0123456,
};

describe('SearchResults score display', () => {
  it('shows the relative relevance score as a number rather than a percentage', () => {
    render(<SearchResults results={[result]} onSelect={vi.fn()} />);

    expect(screen.getByTitle('Relative relevance score')).toHaveTextContent('Score 0.012346');
    expect(screen.queryByText('1%')).not.toBeInTheDocument();
  });
});

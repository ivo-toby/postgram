export type Entity = {
  id: string;
  type: string;
  content: string | null;
  visibility: string;
  owner: string | null;
  status: string | null;
  enrichment_status: string | null;
  version: number;
  tags: string[];
  source: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type Edge = {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  confidence: number;
  source: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type GraphNeighbour = {
  id: string;
  type: string;
  content: string | null;
  metadata: Record<string, unknown>;
};

export type SearchResult = {
  entity: Entity;
  chunk_content: string;
  similarity: number;
  score: number;
  related?: Array<{
    entity: GraphNeighbour;
    relation: string;
    direction: 'incoming' | 'outgoing';
  }>;
};

export type QueueStatus = {
  embedding: {
    pending: number;
    completed: number;
    failed: number;
    retry_eligible: number;
    oldest_pending_secs: number | null;
  };
  extraction: {
    pending: number;
    completed: number;
    failed: number;
  } | null;
};

export type GraphData = {
  entities: GraphNeighbour[];
  edges: Edge[];
};

export type ListResponse<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

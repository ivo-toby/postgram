export type EntityType =
  | 'memory'
  | 'person'
  | 'project'
  | 'task'
  | 'interaction'
  | 'document';

export type Visibility = 'personal' | 'work' | 'shared';

export type EntityStatus =
  | 'active'
  | 'done'
  | 'archived'
  | 'inbox'
  | 'next'
  | 'waiting'
  | 'scheduled'
  | 'someday';

export type EnrichmentStatus = 'pending' | 'completed' | 'failed' | null;

export type Entity = {
  id: string;
  type: EntityType;
  content: string | null;
  visibility: Visibility;
  owner: string | null;
  status: EntityStatus | null;
  enrichmentStatus: EnrichmentStatus;
  version: number;
  tags: string[];
  source: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type Chunk = {
  id: string;
  entityId: string;
  chunkIndex: number;
  content: string;
  modelId: string;
  tokenCount: number;
  createdAt: string;
};

export type EmbeddingModel = {
  id: string;
  name: string;
  provider: string;
  dimensions: number;
  chunkSize: number;
  chunkOverlap: number;
  isActive: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type StoredEntity = Entity;

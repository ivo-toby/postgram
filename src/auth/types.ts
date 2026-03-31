import type { EntityType, Visibility } from '../types/entities.js';

export type Scope = 'read' | 'write' | 'delete' | 'sync';

export type ApiKeyRecord = {
  id: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  scopes: Scope[];
  allowedTypes: EntityType[] | null;
  allowedVisibility: Visibility[];
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

export type AuthContext = {
  apiKeyId: string | null;
  keyName: string;
  scopes: Scope[];
  allowedTypes: EntityType[] | null;
  allowedVisibility: Visibility[];
};

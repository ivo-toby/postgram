import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Entity } from '../lib/types.ts';

const STORAGE_VERSION = 1;
const STORAGE_PREFIX = `pgm_cleanup_basket:v${STORAGE_VERSION}:`;

export type CleanupBasketItem = Pick<
  Entity,
  'id' | 'type' | 'content' | 'visibility' | 'owner' | 'status' | 'tags' | 'updated_at'
> & {
  archiveError?: string;
};

export type CleanupBasketArchiveResult = {
  archived: Array<{ id: string }>;
  failed: Array<{ id: string; code?: string; message?: string }>;
};

type StoredCleanupBasket = {
  version: typeof STORAGE_VERSION;
  items: CleanupBasketItem[];
};

type UseCleanupBasketOptions = {
  apiKey: string | null | undefined;
};

function fingerprintApiKey(apiKey: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < apiKey.length; index += 1) {
    hash ^= apiKey.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function getCleanupBasketStorageKey(apiKey: string | null | undefined): string | null {
  const normalized = apiKey?.trim();
  if (!normalized) return null;
  return `${STORAGE_PREFIX}${fingerprintApiKey(normalized)}`;
}

export function createCleanupBasketItem(entity: Entity): CleanupBasketItem {
  return {
    id: entity.id,
    type: entity.type,
    content: entity.content,
    visibility: entity.visibility,
    owner: entity.owner,
    status: entity.status,
    tags: [...entity.tags],
    updated_at: entity.updated_at,
  };
}

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function normalizeBasketItem(value: unknown): CleanupBasketItem | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.type !== 'string') return null;
  if (!isNullableString(value.content)) return null;
  if (typeof value.visibility !== 'string') return null;
  if (!isNullableString(value.owner)) return null;
  if (!isNullableString(value.status)) return null;
  if (!Array.isArray(value.tags) || !value.tags.every(tag => typeof tag === 'string')) return null;
  if (typeof value.updated_at !== 'string') return null;
  if (value.archiveError !== undefined && typeof value.archiveError !== 'string') return null;

  return {
    id: value.id,
    type: value.type,
    content: value.content,
    visibility: value.visibility,
    owner: value.owner,
    status: value.status,
    tags: [...value.tags],
    updated_at: value.updated_at,
    ...(value.archiveError ? { archiveError: value.archiveError } : {}),
  };
}

function dedupeItems(items: CleanupBasketItem[]): CleanupBasketItem[] {
  const byId = new Map<string, CleanupBasketItem>();
  for (const item of items) {
    byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

function parseStoredItems(raw: string | null): CleanupBasketItem[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return [];
    if (parsed.version !== STORAGE_VERSION) return [];
    if (!Array.isArray(parsed.items)) return [];
    return dedupeItems(parsed.items.map(normalizeBasketItem).filter(item => item !== null));
  } catch {
    return [];
  }
}

function readStoredItems(storageKey: string | null): CleanupBasketItem[] {
  if (!storageKey) return [];
  const storage = getLocalStorage();
  if (!storage) return [];
  return parseStoredItems(storage.getItem(storageKey));
}

function writeStoredItems(storageKey: string | null, items: CleanupBasketItem[]) {
  if (!storageKey) return;
  const storage = getLocalStorage();
  if (!storage) return;

  try {
    if (items.length === 0) {
      storage.removeItem(storageKey);
      return;
    }

    const payload: StoredCleanupBasket = {
      version: STORAGE_VERSION,
      items,
    };
    storage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    // Persistence should not block in-memory cleanup basket state.
  }
}

export function applyCleanupBasketArchiveResult(
  items: CleanupBasketItem[],
  result: CleanupBasketArchiveResult
): CleanupBasketItem[] {
  const archivedIds = new Set(result.archived.map(entry => entry.id));
  const failedMessages = new Map(
    result.failed.map(entry => [entry.id, entry.message ?? entry.code ?? 'Archive failed'] as const)
  );

  return items
    .filter(item => !archivedIds.has(item.id))
    .map(item => {
      const archiveError = failedMessages.get(item.id);
      return archiveError ? { ...item, archiveError } : item;
    });
}

function mergeSnapshots(current: CleanupBasketItem[], snapshots: CleanupBasketItem[]): CleanupBasketItem[] {
  return dedupeItems([...current, ...snapshots]);
}

export function useCleanupBasket({ apiKey }: UseCleanupBasketOptions) {
  const storageKey = useMemo(() => getCleanupBasketStorageKey(apiKey), [apiKey]);
  const [items, setItems] = useState<CleanupBasketItem[]>(() => readStoredItems(getCleanupBasketStorageKey(apiKey)));

  useEffect(() => {
    setItems(readStoredItems(storageKey));
  }, [storageKey]);

  const updateItems = useCallback(
    (updater: (current: CleanupBasketItem[]) => CleanupBasketItem[]) => {
      setItems(current => {
        const next = updater(current);
        writeStoredItems(storageKey, next);
        return next;
      });
    },
    [storageKey]
  );

  const add = useCallback(
    (entity: Entity) => {
      updateItems(current => mergeSnapshots(current, [createCleanupBasketItem(entity)]));
    },
    [updateItems]
  );

  const addMany = useCallback(
    (entities: Entity[]) => {
      updateItems(current => mergeSnapshots(current, entities.map(createCleanupBasketItem)));
    },
    [updateItems]
  );

  const remove = useCallback(
    (id: string) => {
      updateItems(current => current.filter(item => item.id !== id));
    },
    [updateItems]
  );

  const clear = useCallback(() => {
    setItems([]);
    writeStoredItems(storageKey, []);
  }, [storageKey]);

  const markFailed = useCallback(
    (id: string, message: string) => {
      updateItems(current => current.map(item => (item.id === id ? { ...item, archiveError: message } : item)));
    },
    [updateItems]
  );

  const removeArchived = useCallback(
    (ids: string[]) => {
      const archivedIds = new Set(ids);
      updateItems(current => current.filter(item => !archivedIds.has(item.id)));
    },
    [updateItems]
  );

  const applyArchiveResult = useCallback(
    (result: CleanupBasketArchiveResult) => {
      updateItems(current => applyCleanupBasketArchiveResult(current, result));
    },
    [updateItems]
  );

  const ids = useMemo(() => new Set(items.map(item => item.id)), [items]);
  const has = useCallback((id: string) => ids.has(id), [ids]);

  return {
    items,
    count: items.length,
    storageKey,
    has,
    add,
    addMany,
    remove,
    clear,
    markFailed,
    removeArchived,
    applyArchiveResult,
  };
}

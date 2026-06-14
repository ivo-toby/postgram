import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyCleanupBasketArchiveResult,
  getCleanupBasketStorageKey,
  useCleanupBasket,
  type CleanupBasketItem,
} from './useCleanupBasket.ts';
import type { Entity } from '../lib/types.ts';

function installLocalStorage() {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  });
}

function entity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'entity-1',
    type: 'memory',
    content: 'First entity',
    visibility: 'personal',
    owner: 'ivo',
    status: 'active',
    enrichment_status: null,
    version: 1,
    tags: ['cleanup'],
    source: null,
    metadata: {},
    created_at: '2026-06-14T08:00:00.000Z',
    updated_at: '2026-06-14T08:15:00.000Z',
    ...overrides,
  };
}

function basketItem(overrides: Partial<CleanupBasketItem> = {}): CleanupBasketItem {
  return {
    id: 'entity-1',
    type: 'memory',
    content: 'First entity',
    visibility: 'personal',
    owner: 'ivo',
    status: 'active',
    tags: ['cleanup'],
    updated_at: '2026-06-14T08:15:00.000Z',
    ...overrides,
  };
}

function readStoredItems(apiKey: string): CleanupBasketItem[] {
  const key = getCleanupBasketStorageKey(apiKey);
  expect(key).not.toBeNull();
  const raw = window.localStorage.getItem(key!);
  expect(raw).not.toBeNull();
  const parsed = JSON.parse(raw!) as { items: CleanupBasketItem[] };
  return parsed.items;
}

describe('getCleanupBasketStorageKey', () => {
  it('uses a versioned API-key fingerprint without storing the raw API key', () => {
    const storageKey = getCleanupBasketStorageKey('sk-test-secret');

    expect(storageKey).toMatch(/^pgm_cleanup_basket:v1:/);
    expect(storageKey).not.toContain('sk-test-secret');
    expect(storageKey).toBe(getCleanupBasketStorageKey('sk-test-secret'));
    expect(storageKey).not.toBe(getCleanupBasketStorageKey('sk-other-secret'));
  });
});

describe('useCleanupBasket', () => {
  beforeEach(() => {
    installLocalStorage();
    window.localStorage.clear();
  });

  it('loads a persisted basket for the active API key', () => {
    const apiKey = 'sk-persisted';
    const key = getCleanupBasketStorageKey(apiKey);
    expect(key).not.toBeNull();
    window.localStorage.setItem(
      key!,
      JSON.stringify({
        version: 1,
        items: [basketItem({ id: 'entity-1' }), basketItem({ id: 'entity-2', content: 'Second entity' })],
      })
    );

    const { result } = renderHook(() => useCleanupBasket({ apiKey }));

    expect(result.current.items.map(item => item.id)).toEqual(['entity-1', 'entity-2']);
    expect(result.current.count).toBe(2);
    expect(result.current.has('entity-2')).toBe(true);
  });

  it('tolerates malformed storage and persists valid state after the next update', () => {
    const apiKey = 'sk-malformed';
    const key = getCleanupBasketStorageKey(apiKey);
    expect(key).not.toBeNull();
    window.localStorage.setItem(key!, '{not-valid-json');

    const { result } = renderHook(() => useCleanupBasket({ apiKey }));

    expect(result.current.items).toEqual([]);

    act(() => {
      result.current.add(entity({ id: 'entity-1' }));
    });

    expect(readStoredItems(apiKey).map(item => item.id)).toEqual(['entity-1']);
  });

  it('dedupes added entities by ID, refreshes their display snapshot, and persists them', () => {
    const apiKey = 'sk-dedupe';
    const { result } = renderHook(() => useCleanupBasket({ apiKey }));

    act(() => {
      result.current.addMany([
        entity({ id: 'entity-1', content: 'Original content' }),
        entity({ id: 'entity-2', content: 'Second entity' }),
        entity({ id: 'entity-1', content: 'Updated content', tags: ['updated'] }),
      ]);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0]).toMatchObject({
      id: 'entity-1',
      content: 'Updated content',
      tags: ['updated'],
    });
    expect(result.current.items.map(item => item.id)).toEqual(['entity-1', 'entity-2']);
    expect(readStoredItems(apiKey).map(item => item.id)).toEqual(['entity-1', 'entity-2']);
  });

  it('removes individual items and clears persisted basket state', () => {
    const apiKey = 'sk-remove-clear';
    const { result } = renderHook(() => useCleanupBasket({ apiKey }));

    act(() => {
      result.current.addMany([entity({ id: 'entity-1' }), entity({ id: 'entity-2' })]);
    });
    act(() => {
      result.current.remove('entity-1');
    });

    expect(result.current.items.map(item => item.id)).toEqual(['entity-2']);
    expect(readStoredItems(apiKey).map(item => item.id)).toEqual(['entity-2']);

    act(() => {
      result.current.clear();
    });

    expect(result.current.items).toEqual([]);
    expect(window.localStorage.getItem(getCleanupBasketStorageKey(apiKey)!)).toBeNull();
  });

  it('marks failed items without removing them', () => {
    const apiKey = 'sk-mark-failed';
    const { result } = renderHook(() => useCleanupBasket({ apiKey }));

    act(() => {
      result.current.addMany([entity({ id: 'entity-1' }), entity({ id: 'entity-2' })]);
    });
    act(() => {
      result.current.markFailed('entity-2', 'Archive was not allowed');
    });

    expect(result.current.items.find(item => item.id === 'entity-2')?.archiveError).toBe('Archive was not allowed');
    expect(result.current.items.find(item => item.id === 'entity-1')?.archiveError).toBeUndefined();
    expect(readStoredItems(apiKey).find(item => item.id === 'entity-2')?.archiveError).toBe('Archive was not allowed');
  });

  it('removes archived IDs and retains failed IDs with archive messages', () => {
    const apiKey = 'sk-archive-result';
    const { result } = renderHook(() => useCleanupBasket({ apiKey }));

    act(() => {
      result.current.addMany([
        entity({ id: 'entity-1' }),
        entity({ id: 'entity-2' }),
        entity({ id: 'entity-3' }),
      ]);
    });
    act(() => {
      result.current.applyArchiveResult({
        archived: [{ id: 'entity-1' }],
        failed: [{ id: 'entity-2', code: 'forbidden', message: 'No access' }],
      });
    });

    expect(result.current.items.map(item => item.id)).toEqual(['entity-2', 'entity-3']);
    expect(result.current.items.find(item => item.id === 'entity-2')?.archiveError).toBe('No access');
    expect(result.current.items.find(item => item.id === 'entity-3')?.archiveError).toBeUndefined();
    expect(readStoredItems(apiKey).map(item => item.id)).toEqual(['entity-2', 'entity-3']);
  });
});

describe('applyCleanupBasketArchiveResult', () => {
  it('applies archived and failed entries to a basket item list', () => {
    const next = applyCleanupBasketArchiveResult(
      [
        basketItem({ id: 'entity-1' }),
        basketItem({ id: 'entity-2', archiveError: 'Old failure' }),
        basketItem({ id: 'entity-3' }),
      ],
      {
        archived: [{ id: 'entity-1' }],
        failed: [{ id: 'entity-2', code: 'not_found', message: 'Entity missing' }],
      }
    );

    expect(next).toEqual([
      basketItem({ id: 'entity-2', archiveError: 'Entity missing' }),
      basketItem({ id: 'entity-3' }),
    ]);
  });
});

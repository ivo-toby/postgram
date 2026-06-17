import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiClient, BulkArchiveEntitiesResponse } from '../lib/api.ts';
import type { Entity } from '../lib/types.ts';
import SearchPage from './SearchPage.tsx';
import { getCleanupBasketStorageKey, type CleanupBasketItem } from '../hooks/useCleanupBasket.ts';

const API_KEY = 'sk-search-selection';

function entity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'entity-1',
    type: 'memory',
    content: 'First cleanup candidate',
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

const EMPTY_ARCHIVE_RESPONSE: BulkArchiveEntitiesResponse = { archived: [], failed: [] };

function apiWithEntities(
  entities: Entity[],
  total = entities.length,
  archiveResponse: BulkArchiveEntitiesResponse = EMPTY_ARCHIVE_RESPONSE
): ApiClient {
  return {
    listEntities: vi.fn(async () => ({
      items: entities,
      total,
      limit: 20,
      offset: 0,
    })),
    searchEntities: vi.fn(),
    getEntity: vi.fn(),
    listEdges: vi.fn(async () => ({ edges: [] })),
    deleteEntity: vi.fn(),
    bulkArchiveEntities: vi.fn(async () => archiveResponse),
  } as unknown as ApiClient;
}

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

function installBrowserApis() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: true,
      media: '(min-width: 768px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  class NoopIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds = [];
    disconnect = vi.fn();
    observe = vi.fn();
    takeRecords = vi.fn((): IntersectionObserverEntry[] => []);
    unobserve = vi.fn();
  }

  Object.defineProperty(window, 'IntersectionObserver', {
    configurable: true,
    value: NoopIntersectionObserver,
  });
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    value: NoopIntersectionObserver,
  });
}

async function renderSearchPage(
  entities: Entity[],
  total = entities.length,
  archiveResponse: BulkArchiveEntitiesResponse = EMPTY_ARCHIVE_RESPONSE
) {
  const user = userEvent.setup();
  const api = apiWithEntities(entities, total, archiveResponse);
  window.localStorage.setItem('pgm_api_key', API_KEY);

  render(<SearchPage api={api} onOpenInGraph={vi.fn()} />);

  await screen.findByText(entities[0]!.content!);
  return { api, user };
}

function readBasketItems(): CleanupBasketItem[] {
  const storageKey = getCleanupBasketStorageKey(API_KEY);
  expect(storageKey).not.toBeNull();
  const raw = window.localStorage.getItem(storageKey!);
  expect(raw).not.toBeNull();
  return (JSON.parse(raw!) as { items: CleanupBasketItem[] }).items;
}

describe('SearchPage result selection', () => {
  beforeEach(() => {
    installLocalStorage();
    installBrowserApis();
    window.localStorage.clear();
  });

  it('toggles a result checkbox without opening detail', async () => {
    const { api, user } = await renderSearchPage([
      entity({ id: 'entity-1', content: 'First cleanup candidate' }),
    ]);

    await user.click(screen.getByRole('checkbox', { name: 'Select First cleanup candidate' }));

    expect(screen.getByRole('checkbox', { name: 'Select First cleanup candidate' })).toBeChecked();
    expect(api.listEdges).not.toHaveBeenCalled();
  });

  it('opens detail from the result card body', async () => {
    const { api, user } = await renderSearchPage([
      entity({ id: 'entity-1', content: 'First cleanup candidate' }),
    ]);

    await user.click(screen.getByRole('button', { name: /open first cleanup candidate detail/i }));

    await waitFor(() => expect(api.listEdges).toHaveBeenCalledWith('entity-1'));
  });

  it('filters browse results by session-context memory role', async () => {
    const { api, user } = await renderSearchPage([
      entity({
        id: 'entity-1',
        content: 'Session context cleanup candidate',
        metadata: { memory_role: 'session_context' },
      }),
    ]);

    await user.click(screen.getByRole('button', { name: /^filters/i }));
    await user.click(screen.getByRole('button', { name: /filter memory role session context/i }));

    await waitFor(() => {
      expect(api.listEntities).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'memory',
          memory_role: 'session_context',
        })
      );
    });
  });

  it('shift-click selects a visible result range from the previous anchor', async () => {
    const { user } = await renderSearchPage([
      entity({ id: 'entity-1', content: 'First cleanup candidate' }),
      entity({ id: 'entity-2', content: 'Second cleanup candidate' }),
      entity({ id: 'entity-3', content: 'Third cleanup candidate' }),
      entity({ id: 'entity-4', content: 'Fourth cleanup candidate' }),
    ]);

    await user.click(screen.getByRole('checkbox', { name: 'Select First cleanup candidate' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Third cleanup candidate' }), { shiftKey: true });

    expect(screen.getByRole('checkbox', { name: 'Select First cleanup candidate' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Second cleanup candidate' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Third cleanup candidate' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Fourth cleanup candidate' })).not.toBeChecked();
  });

  it('selects all loaded visible results without selecting unloaded results', async () => {
    const { user } = await renderSearchPage([
      entity({ id: 'entity-1', content: 'First cleanup candidate' }),
      entity({ id: 'entity-2', content: 'Second cleanup candidate' }),
      entity({ id: 'entity-3', content: 'Third cleanup candidate' }),
    ], 40);

    await user.click(screen.getByRole('button', { name: /select all loaded results/i }));

    expect(screen.getByRole('checkbox', { name: 'Select First cleanup candidate' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Second cleanup candidate' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Third cleanup candidate' })).toBeChecked();
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    expect(screen.queryByText('40 selected')).not.toBeInTheDocument();
  });

  it('adds selected result snapshots to the cleanup basket and clears the current selection', async () => {
    const { user } = await renderSearchPage([
      entity({ id: 'entity-1', content: 'First cleanup candidate', tags: ['cleanup', 'old'] }),
      entity({ id: 'entity-2', content: 'Second cleanup candidate', visibility: 'work' }),
      entity({ id: 'entity-3', content: 'Third cleanup candidate' }),
    ]);

    await user.click(screen.getByRole('checkbox', { name: 'Select First cleanup candidate' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Second cleanup candidate' }));
    await user.click(screen.getByRole('button', { name: /add selected to basket/i }));

    expect(readBasketItems()).toMatchObject([
      { id: 'entity-1', content: 'First cleanup candidate', tags: ['cleanup', 'old'] },
      { id: 'entity-2', content: 'Second cleanup candidate', visibility: 'work' },
    ]);
    expect(screen.getByRole('checkbox', { name: 'Select First cleanup candidate' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Second cleanup candidate' })).not.toBeChecked();
    expect(screen.queryByText('2 selected')).not.toBeInTheDocument();
  });

  it('opens and closes the cleanup basket drawer from the header count', async () => {
    const { user } = await renderSearchPage([
      entity({ id: 'entity-1', content: 'First cleanup candidate' }),
      entity({ id: 'entity-2', content: 'Second cleanup candidate' }),
    ]);

    await user.click(screen.getByRole('checkbox', { name: 'Select First cleanup candidate' }));
    await user.click(screen.getByRole('button', { name: /add selected to basket/i }));

    const openBasket = screen.getByRole('button', { name: /open cleanup basket, 1 item/i });
    expect(openBasket).toHaveTextContent('1');

    await user.click(openBasket);

    expect(screen.getByRole('dialog', { name: /cleanup basket/i })).toBeInTheDocument();
    expect(screen.getByText('1 reviewed ID')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /close cleanup basket/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /cleanup basket/i })).not.toBeInTheDocument();
    });
  });

  it('archives reviewed basket IDs and removes archived entities from search state', async () => {
    const { api, user } = await renderSearchPage([
      entity({ id: 'entity-1', content: 'First cleanup candidate' }),
      entity({ id: 'entity-2', content: 'Second cleanup candidate' }),
      entity({ id: 'entity-3', content: 'Third cleanup candidate' }),
    ], 3, {
      archived: [{ id: 'entity-1' }, { id: 'entity-2' }],
      failed: [],
    });

    await user.click(screen.getByRole('button', { name: /open first cleanup candidate detail/i }));
    await waitFor(() => expect(api.listEdges).toHaveBeenCalledWith('entity-1'));

    await user.click(screen.getByRole('checkbox', { name: 'Select First cleanup candidate' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Second cleanup candidate' }));
    await user.click(screen.getByRole('button', { name: /add selected to basket/i }));
    await user.click(screen.getByRole('checkbox', { name: 'Select First cleanup candidate' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /open cleanup basket, 2 items/i }));
    await user.click(screen.getByRole('button', { name: /archive 2 reviewed ids/i }));

    expect(api.bulkArchiveEntities).toHaveBeenCalledWith(['entity-1', 'entity-2']);
    expect(await screen.findByText('Archived 2 entities.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('checkbox', { name: 'Select First cleanup candidate' })).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: 'Select Second cleanup candidate' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('checkbox', { name: 'Select Third cleanup candidate' })).toBeInTheDocument();
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
    expect(screen.getByText('Cleanup basket is empty.')).toBeInTheDocument();
  });

  it('keeps partial archive failures in the cleanup basket with messages', async () => {
    const { api, user } = await renderSearchPage([
      entity({ id: 'entity-1', content: 'First cleanup candidate' }),
      entity({ id: 'entity-2', content: 'Second cleanup candidate' }),
      entity({ id: 'entity-3', content: 'Third cleanup candidate' }),
    ], 3, {
      archived: [{ id: 'entity-1' }],
      failed: [{ id: 'entity-2', code: 'FORBIDDEN', message: 'Entity not found or not deletable' }],
    });

    await user.click(screen.getByRole('checkbox', { name: 'Select First cleanup candidate' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Second cleanup candidate' }));
    await user.click(screen.getByRole('button', { name: /add selected to basket/i }));
    await user.click(screen.getByRole('button', { name: /open cleanup basket, 2 items/i }));
    await user.click(screen.getByRole('button', { name: /archive 2 reviewed ids/i }));

    expect(api.bulkArchiveEntities).toHaveBeenCalledWith(['entity-1', 'entity-2']);
    expect(await screen.findByText('Archived 1 entity. 1 item needs attention.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('checkbox', { name: 'Select First cleanup candidate' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('checkbox', { name: 'Select Second cleanup candidate' })).toBeInTheDocument();
    const dialog = screen.getByRole('dialog', { name: /cleanup basket/i });
    expect(within(dialog).getByText('1 reviewed ID')).toBeInTheDocument();
    expect(within(dialog).getByText('Second cleanup candidate')).toBeInTheDocument();
    expect(within(dialog).getByText('Entity not found or not deletable')).toBeInTheDocument();
  });
});

import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiClient, BulkArchiveEntitiesResponse } from '../lib/api.ts';
import {
  applyCleanupBasketArchiveResult,
  type CleanupBasketItem,
} from '../hooks/useCleanupBasket.ts';
import CleanupBasketDrawer from './CleanupBasketDrawer.tsx';

function basketItem(overrides: Partial<CleanupBasketItem> = {}): CleanupBasketItem {
  return {
    id: 'entity-1',
    type: 'memory',
    content: 'First cleanup candidate',
    visibility: 'personal',
    owner: 'ivo',
    status: 'active',
    tags: ['cleanup'],
    updated_at: '2026-06-14T08:15:00.000Z',
    ...overrides,
  };
}

function apiWithArchiveResponse(response: BulkArchiveEntitiesResponse): ApiClient {
  return {
    bulkArchiveEntities: vi.fn(async () => response),
  } as unknown as ApiClient;
}

function renderStatefulDrawer({
  initialItems,
  response,
}: {
  initialItems: CleanupBasketItem[];
  response: BulkArchiveEntitiesResponse;
}) {
  const user = userEvent.setup();
  const api = apiWithArchiveResponse(response);

  function Harness() {
    const [items, setItems] = useState(initialItems);

    return (
      <CleanupBasketDrawer
        api={api}
        items={items}
        onArchiveResult={result => {
          setItems(current => applyCleanupBasketArchiveResult(current, result));
        }}
        onClear={() => setItems([])}
        onClose={vi.fn()}
        onRemoveItem={id => setItems(current => current.filter(item => item.id !== id))}
      />
    );
  }

  render(<Harness />);
  return { api, user };
}

describe('CleanupBasketDrawer', () => {
  it('summarizes basket counts by type, status, and visibility', () => {
    render(
      <CleanupBasketDrawer
        api={apiWithArchiveResponse({ archived: [], failed: [] })}
        items={[
          basketItem({ id: 'memory-1', type: 'memory', status: 'active', visibility: 'personal' }),
          basketItem({ id: 'memory-2', type: 'memory', status: 'active', visibility: 'work' }),
          basketItem({ id: 'task-1', type: 'task', status: 'archived', visibility: 'personal' }),
        ]}
        onArchiveResult={vi.fn()}
        onClear={vi.fn()}
        onClose={vi.fn()}
        onRemoveItem={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: /cleanup basket/i })).toBeInTheDocument();
    expect(screen.getByText('3 reviewed IDs')).toBeInTheDocument();

    const typeSummary = screen.getByRole('region', { name: /type summary/i });
    expect(within(typeSummary).getByRole('listitem', { name: /memory\s+2/i })).toBeInTheDocument();
    expect(within(typeSummary).getByRole('listitem', { name: /task\s+1/i })).toBeInTheDocument();

    const statusSummary = screen.getByRole('region', { name: /status summary/i });
    expect(within(statusSummary).getByRole('listitem', { name: /active\s+2/i })).toBeInTheDocument();
    expect(within(statusSummary).getByRole('listitem', { name: /archived\s+1/i })).toBeInTheDocument();

    const visibilitySummary = screen.getByRole('region', { name: /visibility summary/i });
    expect(within(visibilitySummary).getByRole('listitem', { name: /personal\s+2/i })).toBeInTheDocument();
    expect(within(visibilitySummary).getByRole('listitem', { name: /work\s+1/i })).toBeInTheDocument();
  });

  it('removes one basket item through an explicit callback', async () => {
    const user = userEvent.setup();
    const onRemoveItem = vi.fn();

    render(
      <CleanupBasketDrawer
        api={apiWithArchiveResponse({ archived: [], failed: [] })}
        items={[
          basketItem({ id: 'entity-1', content: 'First cleanup candidate' }),
          basketItem({ id: 'entity-2', content: 'Second cleanup candidate' }),
        ]}
        onArchiveResult={vi.fn()}
        onClear={vi.fn()}
        onClose={vi.fn()}
        onRemoveItem={onRemoveItem}
      />
    );

    await user.click(screen.getByRole('button', { name: /remove first cleanup candidate/i }));

    expect(onRemoveItem).toHaveBeenCalledWith('entity-1');
  });

  it('clears the basket through an explicit callback', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();

    render(
      <CleanupBasketDrawer
        api={apiWithArchiveResponse({ archived: [], failed: [] })}
        items={[basketItem({ id: 'entity-1' })]}
        onArchiveResult={vi.fn()}
        onClear={onClear}
        onClose={vi.fn()}
        onRemoveItem={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /clear basket/i }));

    expect(onClear).toHaveBeenCalled();
  });

  it('archives reviewed IDs and applies successful basket cleanup', async () => {
    const { api, user } = renderStatefulDrawer({
      initialItems: [
        basketItem({ id: 'entity-1', content: 'First cleanup candidate' }),
        basketItem({ id: 'entity-2', content: 'Second cleanup candidate' }),
      ],
      response: {
        archived: [{ id: 'entity-1' }, { id: 'entity-2' }],
        failed: [],
      },
    });

    await user.click(screen.getByRole('button', { name: /archive 2 reviewed ids/i }));

    expect(api.bulkArchiveEntities).toHaveBeenCalledWith(['entity-1', 'entity-2']);
    expect(await screen.findByText('Archived 2 entities.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('First cleanup candidate')).not.toBeInTheDocument();
      expect(screen.queryByText('Second cleanup candidate')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Cleanup basket is empty.')).toBeInTheDocument();
  });

  it('retains failed archive items and displays their messages', async () => {
    const { api, user } = renderStatefulDrawer({
      initialItems: [
        basketItem({ id: 'entity-1', content: 'First cleanup candidate' }),
        basketItem({ id: 'entity-2', content: 'Second cleanup candidate' }),
      ],
      response: {
        archived: [{ id: 'entity-1' }],
        failed: [{ id: 'entity-2', code: 'FORBIDDEN', message: 'Entity not found or not deletable' }],
      },
    });

    await user.click(screen.getByRole('button', { name: /archive 2 reviewed ids/i }));

    expect(api.bulkArchiveEntities).toHaveBeenCalledWith(['entity-1', 'entity-2']);
    expect(await screen.findByText('Archived 1 entity. 1 item needs attention.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('First cleanup candidate')).not.toBeInTheDocument());
    expect(screen.getByText('Second cleanup candidate')).toBeInTheDocument();
    expect(screen.getByText('Entity not found or not deletable')).toBeInTheDocument();
  });
});

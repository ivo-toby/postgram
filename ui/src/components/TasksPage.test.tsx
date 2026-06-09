import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ApiClient } from '../lib/api.ts';
import type { Entity, TaskStatus } from '../lib/types.ts';
import TasksPage from './TasksPage.tsx';

function task(id: string, status: TaskStatus, content: string): Entity {
  return {
    id,
    type: 'task',
    content,
    visibility: 'personal',
    owner: null,
    status,
    enrichment_status: null,
    version: 1,
    tags: [],
    source: null,
    metadata: {},
    created_at: '2026-06-08T08:00:00.000Z',
    updated_at: '2026-06-08T08:00:00.000Z',
  };
}

function apiWithTasks(tasksByStatus: Partial<Record<TaskStatus, Entity[]>>): ApiClient {
  return {
    listTasks: vi.fn(async ({ status }: { status?: TaskStatus }) => ({
      items: status ? tasksByStatus[status] ?? [] : [],
      total: status ? tasksByStatus[status]?.length ?? 0 : 0,
      limit: 50,
      offset: 0,
    })),
    updateTask: vi.fn(),
    completeTask: vi.fn(),
  } as unknown as ApiClient;
}

describe('TasksPage', () => {
  it('loads and renders GTD board lanes', async () => {
    const api = apiWithTasks({
      inbox: [task('task-1', 'inbox', 'Clarify inbox item')],
      next: [task('task-2', 'next', 'Draft the plan')],
      waiting: [],
      scheduled: [],
      someday: [],
    });

    render(<TasksPage api={api} />);

    expect(await screen.findByText('Clarify inbox item')).toBeInTheDocument();
    expect(screen.getByText('Draft the plan')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /inbox/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /next/i })).toBeInTheDocument();
    expect(api.listTasks).toHaveBeenCalledWith({ status: 'inbox', limit: 50, offset: 0 });
    expect(api.listTasks).toHaveBeenCalledWith({ status: 'someday', limit: 50, offset: 0 });
  });

  it('shows a lane retry state when a lane fails to load', async () => {
    const api = apiWithTasks({});
    vi.mocked(api.listTasks).mockImplementation(async ({ status }: { status?: TaskStatus }) => {
      if (status === 'waiting') throw new Error('Waiting failed');
      return { items: [], total: 0, limit: 50, offset: 0 };
    });

    render(<TasksPage api={api} />);

    await waitFor(() => expect(screen.getByText('Waiting failed')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /retry waiting/i })).toBeInTheDocument();
  });
});

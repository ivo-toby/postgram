import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('moves an inbox task to next with one visible button', async () => {
    const user = userEvent.setup();
    const api = apiWithTasks({ inbox: [task('task-1', 'inbox', 'Clarify inbox item')] });
    vi.mocked(api.updateTask).mockResolvedValueOnce({
      entity: { ...task('task-1', 'next', 'Clarify inbox item'), version: 2 },
    });

    render(<TasksPage api={api} />);

    await screen.findByText('Clarify inbox item');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(api.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ version: 1, status: 'next' }));
    expect(await screen.findByRole('heading', { level: 2, name: /next/i })).toBeInTheDocument();
  });

  it('completes a task through the complete endpoint', async () => {
    const user = userEvent.setup();
    const api = apiWithTasks({ next: [task('task-1', 'next', 'Finish work')] });
    vi.mocked(api.completeTask).mockResolvedValueOnce({
      entity: { ...task('task-1', 'done', 'Finish work'), version: 2 },
    });

    render(<TasksPage api={api} />);

    await screen.findByText('Finish work');
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(api.completeTask).toHaveBeenCalledWith('task-1', 1);
    await waitFor(() => expect(screen.queryByText('Finish work')).not.toBeInTheDocument());
  });

  it('schedules a task with a date-only picker', async () => {
    const user = userEvent.setup();
    const api = apiWithTasks({ inbox: [task('task-1', 'inbox', 'Schedule me')] });
    vi.mocked(api.updateTask).mockResolvedValueOnce({
      entity: {
        ...task('task-1', 'scheduled', 'Schedule me'),
        version: 2,
        metadata: { scheduled_for: '2026-06-12' },
      },
    });

    render(<TasksPage api={api} />);

    await screen.findByText('Schedule me');
    await user.click(screen.getByRole('button', { name: 'Schedule' }));
    await user.type(screen.getByLabelText(/schedule date/i), '2026-06-12');
    await user.click(screen.getByRole('button', { name: /apply schedule/i }));

    expect(api.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
      version: 1,
      status: 'scheduled',
      metadata: { scheduled_for: '2026-06-12' },
    }));
  });

  it('edits task fields with a focused drawer and segmented status control', async () => {
    const user = userEvent.setup();
    const api = apiWithTasks({
      inbox: [task('task-1', 'inbox', 'Original task')],
    });
    vi.mocked(api.updateTask).mockResolvedValueOnce({
      entity: {
        ...task('task-1', 'waiting', 'Updated task'),
        version: 2,
        metadata: { context: '@desk', due_date: '2026-06-15', priority: 'high' },
        tags: ['focus'],
      },
    });

    render(<TasksPage api={api} />);

    await screen.findByText('Original task');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText(/task content/i));
    await user.type(screen.getByLabelText(/task content/i), 'Updated task');
    await user.click(screen.getByRole('button', { name: 'Set status Waiting' }));
    await user.type(screen.getByLabelText(/^context$/i), '@desk');
    await user.type(screen.getByLabelText(/due date/i), '2026-06-15');
    await user.type(screen.getByLabelText(/priority/i), 'high');
    await user.type(screen.getByLabelText(/tags/i), 'focus');
    await user.click(screen.getByRole('button', { name: /save task/i }));

    expect(api.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
      version: 1,
      content: 'Updated task',
      status: 'waiting',
      context: '@desk',
      due_date: '2026-06-15',
      tags: ['focus'],
      metadata: expect.objectContaining({ priority: 'high' }),
    }));
  });

  it('bulk moves selected tasks to another status', async () => {
    const user = userEvent.setup();
    const api = apiWithTasks({
      inbox: [task('task-1', 'inbox', 'One'), task('task-2', 'inbox', 'Two')],
    });
    vi.mocked(api.updateTask)
      .mockResolvedValueOnce({ entity: { ...task('task-1', 'next', 'One'), version: 2 } })
      .mockResolvedValueOnce({ entity: { ...task('task-2', 'next', 'Two'), version: 2 } });

    render(<TasksPage api={api} />);

    await screen.findByText('One');
    await user.click(screen.getAllByRole('button', { name: 'Select' })[0]!);
    await user.click(screen.getByLabelText('Select One'));
    await user.click(screen.getByLabelText('Select Two'));
    await user.click(screen.getByRole('button', { name: /bulk next/i }));

    expect(api.updateTask).toHaveBeenCalledTimes(2);
    expect(api.updateTask).toHaveBeenNthCalledWith(1, 'task-1', expect.objectContaining({ status: 'next' }));
    expect(api.updateTask).toHaveBeenNthCalledWith(2, 'task-2', expect.objectContaining({ status: 'next' }));
  });

  it('keeps failed bulk updates selected and reports a failure count', async () => {
    const user = userEvent.setup();
    const api = apiWithTasks({
      inbox: [task('task-1', 'inbox', 'One'), task('task-2', 'inbox', 'Two')],
    });
    vi.mocked(api.updateTask)
      .mockResolvedValueOnce({ entity: { ...task('task-1', 'next', 'One'), version: 2 } })
      .mockRejectedValueOnce(new Error('Conflict'));

    render(<TasksPage api={api} />);

    await screen.findByText('One');
    await user.click(screen.getAllByRole('button', { name: 'Select' })[0]!);
    await user.click(screen.getByLabelText('Select One'));
    await user.click(screen.getByLabelText('Select Two'));
    await user.click(screen.getByRole('button', { name: /bulk next/i }));

    expect(await screen.findByText('1 task failed to update')).toBeInTheDocument();
    expect(screen.getByLabelText('Select Two')).toBeChecked();
  });

  it('bulk schedules selected tasks with one date', async () => {
    const user = userEvent.setup();
    const api = apiWithTasks({
      inbox: [task('task-1', 'inbox', 'One'), task('task-2', 'inbox', 'Two')],
    });
    vi.mocked(api.updateTask)
      .mockResolvedValueOnce({ entity: { ...task('task-1', 'scheduled', 'One'), version: 2, metadata: { scheduled_for: '2026-06-20' } } })
      .mockResolvedValueOnce({ entity: { ...task('task-2', 'scheduled', 'Two'), version: 2, metadata: { scheduled_for: '2026-06-20' } } });

    render(<TasksPage api={api} />);

    await screen.findByText('One');
    await user.click(screen.getAllByRole('button', { name: 'Select' })[0]!);
    await user.click(screen.getByLabelText('Select One'));
    await user.click(screen.getByLabelText('Select Two'));
    await user.click(screen.getByRole('button', { name: /bulk schedule/i }));
    await user.type(screen.getByLabelText(/schedule date/i), '2026-06-20');
    await user.click(screen.getByRole('button', { name: /apply schedule/i }));

    expect(api.updateTask).toHaveBeenNthCalledWith(1, 'task-1', expect.objectContaining({
      status: 'scheduled',
      metadata: { scheduled_for: '2026-06-20' },
    }));
    expect(api.updateTask).toHaveBeenNthCalledWith(2, 'task-2', expect.objectContaining({
      status: 'scheduled',
      metadata: { scheduled_for: '2026-06-20' },
    }));
  });
});

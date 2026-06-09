# GTD Tasks Kanban Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated responsive `Tasks` view for GTD task triage with direct one-button state transitions, intuitive editing, and bulk status changes.

**Architecture:** Extend the existing React/Vite UI without adding a router. Add typed task API helpers, task-specific view utilities, and a `TasksPage` composed from focused lane/card/editor/bulk components. Use existing `/api/tasks` endpoints and preserve task metadata when writing scheduled dates.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS, Vitest, Testing Library, native fetch API client.

---

## File Structure

- Modify `ui/src/lib/types.ts`: add task status and task metadata helper types used by the UI.
- Modify `ui/src/lib/api.ts`: add `listTasks`, `updateTask`, and `completeTask` typed helpers.
- Modify `ui/src/lib/api.test.ts`: cover task helper URLs and request bodies.
- Create `ui/src/components/tasks/taskModel.ts`: status constants, metadata extraction, action calculation, lane helpers.
- Create `ui/src/components/tasks/taskModel.test.ts`: unit tests for status/action/metadata behavior.
- Create `ui/src/components/tasks/TaskCard.tsx`: compact card with visible status buttons and select mode.
- Create `ui/src/components/tasks/TaskLane.tsx`: lane header, loading/error/empty states, card list.
- Create `ui/src/components/tasks/ScheduleDialog.tsx`: date-only schedule confirmation used by single and bulk actions.
- Create `ui/src/components/tasks/TaskEditDrawer.tsx`: desktop side drawer and mobile bottom sheet for task editing.
- Create `ui/src/components/tasks/BulkActionBar.tsx`: sticky action bar for selected tasks.
- Create `ui/src/components/TasksPage.tsx`: board orchestration, loading, transitions, bulk updates, responsive active lane tabs.
- Create `ui/src/components/TasksPage.test.tsx`: integration tests for loading, mobile lane switching, direct state transitions, completion, edit, and bulk actions.
- Modify `ui/src/components/TopBar.tsx`: add `tasks` to the `Page` union and navigation tab.
- Modify `ui/src/App.tsx`: persist and render the new `Tasks` page.

---

## Task 1: Task API Helpers

**Files:**
- Modify: `ui/src/lib/types.ts`
- Modify: `ui/src/lib/api.ts`
- Test: `ui/src/lib/api.test.ts`

- [ ] **Step 1: Write failing API helper tests**

Add these tests to `ui/src/lib/api.test.ts` inside `describe('createApiClient', () => { ... })`:

```ts
  it('lists tasks with status, pagination, and context filters', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [], total: 0, limit: 25, offset: 50 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createApiClient({ apiKey: 'key', onUnauthorized: vi.fn() });
    await client.listTasks({ status: 'inbox', context: '@home', limit: 25, offset: 50 });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tasks?status=inbox&context=%40home&limit=25&offset=50',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer key' }),
      })
    );
  });

  it('PATCHes task updates with optimistic locking fields', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ entity: taskEntity({ id: 'task-1', version: 3, status: 'next' }) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createApiClient({ apiKey: 'key', onUnauthorized: vi.fn() });
    await client.updateTask('task-1', {
      version: 2,
      status: 'next',
      content: 'Review note',
      context: '@desk',
      due_date: '2026-06-09',
      metadata: { priority: 2, scheduled_for: '2026-06-10' },
      tags: ['review'],
      visibility: 'personal',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tasks/task-1',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          Authorization: 'Bearer key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          version: 2,
          status: 'next',
          content: 'Review note',
          context: '@desk',
          due_date: '2026-06-09',
          metadata: { priority: 2, scheduled_for: '2026-06-10' },
          tags: ['review'],
          visibility: 'personal',
        }),
      })
    );
  });

  it('completes tasks through the completion endpoint', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ entity: taskEntity({ id: 'task-1', version: 4, status: 'done' }) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createApiClient({ apiKey: 'key', onUnauthorized: vi.fn() });
    await client.completeTask('task-1', 3);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tasks/task-1/complete',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ version: 3 }),
      })
    );
  });
```

Add this helper near the top of `ui/src/lib/api.test.ts`, after imports:

```ts
function taskEntity(overrides: Partial<import('./types.ts').Entity> = {}): import('./types.ts').Entity {
  return {
    id: 'task-1',
    type: 'task',
    content: 'Task content',
    visibility: 'personal',
    owner: null,
    status: 'inbox',
    enrichment_status: null,
    version: 1,
    tags: [],
    source: null,
    metadata: {},
    created_at: '2026-06-08T08:00:00.000Z',
    updated_at: '2026-06-08T08:00:00.000Z',
    ...overrides,
  };
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk npm --prefix ui test -- src/lib/api.test.ts
```

Expected: FAIL because `client.listTasks`, `client.updateTask`, and `client.completeTask` do not exist.

- [ ] **Step 3: Add task types**

Add to `ui/src/lib/types.ts` after `EntityEmbedding`:

```ts
export type TaskStatus = 'inbox' | 'next' | 'waiting' | 'scheduled' | 'someday' | 'done' | 'archived';

export type TaskMetadata = {
  context?: string;
  due_date?: string;
  scheduled_for?: string;
  priority?: string | number;
  completed_at?: string;
  [key: string]: unknown;
};
```

- [ ] **Step 4: Add API client methods**

Change the import in `ui/src/lib/api.ts` to include `TaskStatus`:

```ts
import type { Entity, Edge, SearchResult, QueueStatus, GraphData, ListResponse, EntityEmbedding, TaskStatus } from './types.ts';
```

Add these methods inside the returned object from `createApiClient`, after `deleteEntity` and before `searchEntities`:

```ts
    listTasks(params: {
      status?: TaskStatus;
      context?: string;
      limit?: number;
      offset?: number;
      include_archived?: boolean;
    } = {}) {
      const qs = new URLSearchParams();
      if (params.status) qs.set('status', params.status);
      if (params.context) qs.set('context', params.context);
      qs.set('limit', String(params.limit ?? 50));
      qs.set('offset', String(params.offset ?? 0));
      if (params.include_archived) qs.set('include_archived', 'true');
      return r<ListResponse<Entity>>(`/api/tasks?${qs}`);
    },

    updateTask(id: string, input: {
      version: number;
      content?: string;
      status?: TaskStatus | null;
      context?: string;
      due_date?: string;
      tags?: string[];
      visibility?: string;
      metadata?: Record<string, unknown>;
    }) {
      return r<{ entity: Entity }>(`/api/tasks/${id}`, { method: 'PATCH', body: input });
    },

    completeTask(id: string, version: number) {
      return r<{ entity: Entity }>(`/api/tasks/${id}/complete`, {
        method: 'POST',
        body: { version },
      });
    },
```

- [ ] **Step 5: Run API helper tests**

Run:

```bash
rtk npm --prefix ui test -- src/lib/api.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add ui/src/lib/types.ts ui/src/lib/api.ts ui/src/lib/api.test.ts
rtk git commit -m "feat(ui): add task API helpers"
```

---

## Task 2: Task Model Utilities

**Files:**
- Create: `ui/src/components/tasks/taskModel.ts`
- Test: `ui/src/components/tasks/taskModel.test.ts`

- [ ] **Step 1: Write failing model tests**

Create `ui/src/components/tasks/taskModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Entity } from '../../lib/types.ts';
import {
  BOARD_STATUSES,
  getAvailableStatusActions,
  getTaskMetadata,
  isBoardStatus,
  moveTaskLocally,
  taskTitle,
} from './taskModel.ts';

function task(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'task-1',
    type: 'task',
    content: 'First line\nSecond line',
    visibility: 'personal',
    owner: null,
    status: 'inbox',
    enrichment_status: null,
    version: 1,
    tags: [],
    source: null,
    metadata: {},
    created_at: '2026-06-08T08:00:00.000Z',
    updated_at: '2026-06-08T08:00:00.000Z',
    ...overrides,
  };
}

describe('taskModel', () => {
  it('defines the actionable board statuses', () => {
    expect(BOARD_STATUSES).toEqual(['inbox', 'next', 'waiting', 'scheduled', 'someday']);
    expect(isBoardStatus('done')).toBe(false);
    expect(isBoardStatus('next')).toBe(true);
  });

  it('extracts task metadata using stable field names', () => {
    expect(getTaskMetadata(task({
      metadata: { context: '@desk', due_date: '2026-06-09', scheduled_for: '2026-06-10', priority: 2 },
    }))).toEqual({
      context: '@desk',
      dueDate: '2026-06-09',
      scheduledFor: '2026-06-10',
      priority: 2,
    });
  });

  it('returns visible one-button actions excluding the current status', () => {
    expect(getAvailableStatusActions(task({ status: 'inbox' })).map(action => action.status)).toEqual([
      'next',
      'waiting',
      'scheduled',
      'someday',
      'done',
    ]);
    expect(getAvailableStatusActions(task({ status: 'next' })).map(action => action.status)).toEqual([
      'done',
      'inbox',
      'waiting',
      'scheduled',
      'someday',
    ]);
  });

  it('uses the first content line as the readable title', () => {
    expect(taskTitle(task())).toBe('First line');
    expect(taskTitle(task({ content: null }))).toBe('Untitled task');
  });

  it('moves tasks between local lane arrays', () => {
    const lanes = {
      inbox: [task({ id: 'a', status: 'inbox' })],
      next: [],
      waiting: [],
      scheduled: [],
      someday: [],
    };

    const moved = moveTaskLocally(lanes, task({ id: 'a', status: 'next', version: 2 }), 'inbox', 'next');

    expect(moved.inbox).toEqual([]);
    expect(moved.next.map(item => item.id)).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk npm --prefix ui test -- src/components/tasks/taskModel.test.ts
```

Expected: FAIL because `taskModel.ts` does not exist.

- [ ] **Step 3: Implement task model utilities**

Create `ui/src/components/tasks/taskModel.ts`:

```ts
import type { Entity, TaskMetadata, TaskStatus } from '../../lib/types.ts';

export type BoardStatus = 'inbox' | 'next' | 'waiting' | 'scheduled' | 'someday';

export const BOARD_STATUSES: BoardStatus[] = ['inbox', 'next', 'waiting', 'scheduled', 'someday'];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  inbox: 'Inbox',
  next: 'Next',
  waiting: 'Waiting',
  scheduled: 'Scheduled',
  someday: 'Someday',
  done: 'Done',
  archived: 'Archived',
};

export type StatusAction = {
  status: TaskStatus;
  label: string;
  needsDate?: boolean;
};

export type TaskLanes = Record<BoardStatus, Entity[]>;

export function isBoardStatus(status: string | null | undefined): status is BoardStatus {
  return BOARD_STATUSES.includes(status as BoardStatus);
}

export function taskTitle(task: Entity): string {
  const title = (task.content ?? '').split('\n').find(line => line.trim())?.trim();
  return title || 'Untitled task';
}

export function getTaskMetadata(task: Entity): {
  context?: string;
  dueDate?: string;
  scheduledFor?: string;
  priority?: string | number;
} {
  const metadata = task.metadata as TaskMetadata;
  return {
    ...(typeof metadata.context === 'string' && metadata.context ? { context: metadata.context } : {}),
    ...(typeof metadata.due_date === 'string' && metadata.due_date ? { dueDate: metadata.due_date } : {}),
    ...(typeof metadata.scheduled_for === 'string' && metadata.scheduled_for ? { scheduledFor: metadata.scheduled_for } : {}),
    ...(metadata.priority !== undefined && metadata.priority !== '' ? { priority: metadata.priority } : {}),
  };
}

export function getAvailableStatusActions(task: Entity): StatusAction[] {
  const current = task.status;
  const order: TaskStatus[] = current === 'inbox'
    ? ['next', 'waiting', 'scheduled', 'someday', 'done']
    : ['done', 'inbox', 'next', 'waiting', 'scheduled', 'someday'];

  return order
    .filter(status => status !== current)
    .map(status => ({
      status,
      label: status === 'scheduled' ? 'Schedule' : STATUS_LABELS[status],
      ...(status === 'scheduled' ? { needsDate: true } : {}),
    }));
}

export function emptyTaskLanes(): TaskLanes {
  return {
    inbox: [],
    next: [],
    waiting: [],
    scheduled: [],
    someday: [],
  };
}

export function moveTaskLocally(
  lanes: TaskLanes,
  task: Entity,
  fromStatus: BoardStatus | null,
  toStatus: TaskStatus
): TaskLanes {
  const next: TaskLanes = {
    inbox: [...lanes.inbox],
    next: [...lanes.next],
    waiting: [...lanes.waiting],
    scheduled: [...lanes.scheduled],
    someday: [...lanes.someday],
  };

  for (const status of BOARD_STATUSES) {
    next[status] = next[status].filter(item => item.id !== task.id);
  }

  if (isBoardStatus(toStatus)) {
    next[toStatus] = [task, ...next[toStatus]];
  }

  if (fromStatus && !isBoardStatus(toStatus)) {
    next[fromStatus] = next[fromStatus].filter(item => item.id !== task.id);
  }

  return next;
}
```

- [ ] **Step 4: Run model tests**

Run:

```bash
rtk npm --prefix ui test -- src/components/tasks/taskModel.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
rtk git add ui/src/components/tasks/taskModel.ts ui/src/components/tasks/taskModel.test.ts
rtk git commit -m "feat(ui): add GTD task model helpers"
```

---

## Task 3: Load and Render the Task Board

**Files:**
- Create: `ui/src/components/tasks/TaskCard.tsx`
- Create: `ui/src/components/tasks/TaskLane.tsx`
- Create: `ui/src/components/TasksPage.tsx`
- Test: `ui/src/components/TasksPage.test.tsx`

- [ ] **Step 1: Write failing board rendering tests**

Create `ui/src/components/TasksPage.test.tsx`:

```tsx
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
    expect(screen.getByRole('heading', { name: /inbox/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /next/i })).toBeInTheDocument();
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk npm --prefix ui test -- src/components/TasksPage.test.tsx
```

Expected: FAIL because `TasksPage.tsx` and task components do not exist.

- [ ] **Step 3: Implement the task card**

Create `ui/src/components/tasks/TaskCard.tsx`:

```tsx
import type { Entity, TaskStatus } from '../../lib/types.ts';
import { getAvailableStatusActions, getTaskMetadata, taskTitle } from './taskModel.ts';

type Props = {
  task: Entity;
  selected: boolean;
  selectMode: boolean;
  onToggleSelected: (taskId: string) => void;
  onEdit: (task: Entity) => void;
  onStatusChange: (task: Entity, status: TaskStatus) => void;
};

export default function TaskCard({ task, selected, selectMode, onToggleSelected, onEdit, onStatusChange }: Props) {
  const metadata = getTaskMetadata(task);
  const actions = getAvailableStatusActions(task).slice(0, 5);

  return (
    <article
      className={`rounded-lg border bg-gray-900 p-3 text-sm shadow-sm ${selected ? 'border-blue-400' : 'border-gray-800'}`}
      onClick={() => { if (selectMode) onToggleSelected(task.id); }}
    >
      <div className="flex items-start gap-2">
        {selectMode && (
          <input
            aria-label={`Select ${taskTitle(task)}`}
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelected(task.id)}
            onClick={event => event.stopPropagation()}
            className="mt-1 h-4 w-4 accent-blue-500"
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-medium text-gray-100">{taskTitle(task)}</h3>
          {task.content && task.content !== taskTitle(task) && (
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-gray-400">{task.content}</p>
          )}
        </div>
      </div>

      {(metadata.context || metadata.dueDate || metadata.scheduledFor || metadata.priority !== undefined || task.tags.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          {metadata.context && <span className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-300">{metadata.context}</span>}
          {metadata.dueDate && <span className="rounded bg-yellow-500/10 px-1.5 py-0.5 text-yellow-300">Due {metadata.dueDate}</span>}
          {metadata.scheduledFor && <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-300">Scheduled {metadata.scheduledFor}</span>}
          {metadata.priority !== undefined && <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-purple-300">P{String(metadata.priority)}</span>}
          {task.tags.map(tag => <span key={tag} className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-400">{tag}</span>)}
        </div>
      )}

      {!selectMode && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {actions.map(action => (
            <button
              key={action.status}
              type="button"
              onClick={() => onStatusChange(task, action.status)}
              className="rounded-md bg-gray-800 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
            >
              {action.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onEdit(task)}
            className="ml-auto rounded-md bg-gray-800 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
          >
            Edit
          </button>
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 4: Implement the task lane**

Create `ui/src/components/tasks/TaskLane.tsx`:

```tsx
import type { Entity, TaskStatus } from '../../lib/types.ts';
import type { BoardStatus } from './taskModel.ts';
import { STATUS_LABELS } from './taskModel.ts';
import TaskCard from './TaskCard.tsx';

type Props = {
  status: BoardStatus;
  tasks: Entity[];
  loading: boolean;
  error: string | null;
  selectedIds: Set<string>;
  selectMode: boolean;
  onRetry: (status: BoardStatus) => void;
  onToggleSelectMode: (status: BoardStatus) => void;
  onToggleSelected: (taskId: string) => void;
  onEdit: (task: Entity) => void;
  onStatusChange: (task: Entity, status: TaskStatus) => void;
};

export default function TaskLane({
  status,
  tasks,
  loading,
  error,
  selectedIds,
  selectMode,
  onRetry,
  onToggleSelectMode,
  onToggleSelected,
  onEdit,
  onStatusChange,
}: Props) {
  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-gray-800 bg-gray-950/70">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-800 bg-gray-950 px-3 py-2">
        <h2 className="text-sm font-semibold text-white">{STATUS_LABELS[status]}</h2>
        <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">{tasks.length}</span>
        {loading && <span className="text-xs text-gray-500">Loading...</span>}
        <button
          type="button"
          onClick={() => onToggleSelectMode(status)}
          className="ml-auto rounded-md bg-gray-800 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
        >
          {selectMode ? 'Cancel' : 'Select'}
        </button>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
            <p>{error}</p>
            <button type="button" onClick={() => onRetry(status)} className="mt-2 underline">
              Retry {STATUS_LABELS[status]}
            </button>
          </div>
        )}
        {!error && !loading && tasks.length === 0 && (
          <p className="rounded-lg border border-dashed border-gray-800 p-4 text-center text-xs text-gray-500">No {STATUS_LABELS[status].toLowerCase()} tasks</p>
        )}
        {tasks.map(task => (
          <TaskCard
            key={task.id}
            task={task}
            selected={selectedIds.has(task.id)}
            selectMode={selectMode}
            onToggleSelected={onToggleSelected}
            onEdit={onEdit}
            onStatusChange={onStatusChange}
          />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Implement initial TasksPage**

Create `ui/src/components/TasksPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiClient } from '../lib/api.ts';
import type { Entity, TaskStatus } from '../lib/types.ts';
import TaskLane from './tasks/TaskLane.tsx';
import { BOARD_STATUSES, emptyTaskLanes, isBoardStatus, type BoardStatus, type TaskLanes } from './tasks/taskModel.ts';

type Props = {
  api: ApiClient;
};

type LaneState = Record<BoardStatus, { loading: boolean; error: string | null }>;

function initialLaneState(): LaneState {
  return {
    inbox: { loading: true, error: null },
    next: { loading: true, error: null },
    waiting: { loading: true, error: null },
    scheduled: { loading: true, error: null },
    someday: { loading: true, error: null },
  };
}

export default function TasksPage({ api }: Props) {
  const [lanes, setLanes] = useState<TaskLanes>(() => emptyTaskLanes());
  const [laneState, setLaneState] = useState<LaneState>(() => initialLaneState());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);

  const selectedTasks = useMemo(() => {
    const allTasks = BOARD_STATUSES.flatMap(status => lanes[status]);
    return allTasks.filter(task => selectedIds.has(task.id));
  }, [lanes, selectedIds]);

  const loadLane = useCallback(async (status: BoardStatus) => {
    setLaneState(prev => ({ ...prev, [status]: { loading: true, error: null } }));
    try {
      const result = await api.listTasks({ status, limit: 50, offset: 0 });
      setLanes(prev => ({ ...prev, [status]: result.items }));
      setLaneState(prev => ({ ...prev, [status]: { loading: false, error: null } }));
    } catch (error) {
      setLaneState(prev => ({
        ...prev,
        [status]: { loading: false, error: error instanceof Error ? error.message : 'Failed to load lane' },
      }));
    }
  }, [api]);

  useEffect(() => {
    for (const status of BOARD_STATUSES) {
      void loadLane(status);
    }
  }, [loadLane]);

  const toggleSelectMode = useCallback(() => {
    setSelectMode(prev => !prev);
    setSelectedIds(new Set());
  }, []);

  const toggleSelected = useCallback((taskId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  }, []);

  const handleEdit = useCallback((_task: Entity) => {
    return undefined;
  }, []);

  const handleStatusChange = useCallback(async (_task: Entity, _status: TaskStatus) => {
    return undefined;
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-950 text-gray-100">
      <div className="flex items-center gap-3 border-b border-gray-800 px-4 py-3">
        <h1 className="text-base font-semibold text-white">Tasks</h1>
        <span className="text-xs text-gray-500">{selectedTasks.length} selected</span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 md:grid-cols-5">
        {BOARD_STATUSES.map(status => (
          <TaskLane
            key={status}
            status={status}
            tasks={lanes[status]}
            loading={laneState[status].loading}
            error={laneState[status].error}
            selectedIds={selectedIds}
            selectMode={selectMode}
            onRetry={loadLane}
            onToggleSelectMode={toggleSelectMode}
            onToggleSelected={toggleSelected}
            onEdit={handleEdit}
            onStatusChange={handleStatusChange}
          />
        ))}
      </div>
    </div>
  );
}
```

Use this exact import list in `ui/src/components/TasksPage.tsx` for this task:

```tsx
import { BOARD_STATUSES, emptyTaskLanes, type BoardStatus, type TaskLanes } from './tasks/taskModel.ts';
```

- [ ] **Step 6: Run board rendering tests**

Run:

```bash
rtk npm --prefix ui test -- src/components/TasksPage.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
rtk git add ui/src/components/TasksPage.tsx ui/src/components/TasksPage.test.tsx ui/src/components/tasks/TaskCard.tsx ui/src/components/tasks/TaskLane.tsx
rtk git commit -m "feat(ui): render GTD task board"
```

---

## Task 4: Direct Single-Button Status Changes and Scheduling

**Files:**
- Modify: `ui/src/components/TasksPage.tsx`
- Create: `ui/src/components/tasks/ScheduleDialog.tsx`
- Modify: `ui/src/components/TasksPage.test.tsx`

- [ ] **Step 1: Add failing direct action tests**

Add imports to `ui/src/components/TasksPage.test.tsx`:

```ts
import userEvent from '@testing-library/user-event';
```

Add tests:

```tsx
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
    expect(await screen.findByRole('heading', { name: /next/i })).toBeInTheDocument();
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk npm --prefix ui test -- src/components/TasksPage.test.tsx
```

Expected: FAIL because status changes and schedule dialog are not implemented.

- [ ] **Step 3: Add ScheduleDialog**

Create `ui/src/components/tasks/ScheduleDialog.tsx`:

```tsx
import { useState } from 'react';

type Props = {
  open: boolean;
  title: string;
  onCancel: () => void;
  onConfirm: (date: string) => void;
};

export default function ScheduleDialog({ open, title, onCancel, onConfirm }: Props) {
  const [date, setDate] = useState('');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-800 bg-gray-900 p-4 shadow-2xl">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <label className="mt-4 block text-xs uppercase tracking-wide text-gray-500">
          Schedule date
          <input
            type="date"
            value={date}
            onChange={event => setDate(event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md px-3 py-2 text-sm text-gray-400 hover:text-white">
            Cancel
          </button>
          <button
            type="button"
            disabled={!date}
            onClick={() => onConfirm(date)}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Apply schedule
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement status updates in TasksPage**

In `ui/src/components/TasksPage.tsx`, import `ScheduleDialog` and `moveTaskLocally`:

```tsx
import ScheduleDialog from './tasks/ScheduleDialog.tsx';
import { BOARD_STATUSES, emptyTaskLanes, isBoardStatus, moveTaskLocally, taskTitle, type BoardStatus, type TaskLanes } from './tasks/taskModel.ts';
```

Add state:

```tsx
  const [pendingSchedule, setPendingSchedule] = useState<{ task: Entity } | null>(null);
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({});
```

Replace `handleStatusChange` with:

```tsx
  const applyUpdatedTask = useCallback((task: Entity, updated: Entity, targetStatus: TaskStatus) => {
    const fromStatus = isBoardStatus(task.status) ? task.status : null;
    setLanes(prev => moveTaskLocally(prev, updated, fromStatus, targetStatus));
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.delete(task.id);
      return next;
    });
  }, []);

  const updateTaskStatus = useCallback(async (task: Entity, status: TaskStatus, scheduledFor?: string) => {
    setTaskErrors(prev => ({ ...prev, [task.id]: '' }));
    try {
      if (status === 'done') {
        const result = await api.completeTask(task.id, task.version);
        applyUpdatedTask(task, result.entity, status);
        return;
      }

      const metadata = {
        ...task.metadata,
        ...(scheduledFor ? { scheduled_for: scheduledFor } : {}),
      };
      const result = await api.updateTask(task.id, {
        version: task.version,
        status,
        metadata,
      });
      applyUpdatedTask(task, result.entity, status);
    } catch (error) {
      setTaskErrors(prev => ({
        ...prev,
        [task.id]: error instanceof Error ? error.message : 'Task update failed',
      }));
      if (isBoardStatus(task.status)) void loadLane(task.status);
    }
  }, [api, applyUpdatedTask, loadLane]);

  const handleStatusChange = useCallback(async (task: Entity, status: TaskStatus) => {
    if (status === 'scheduled') {
      setPendingSchedule({ task });
      return;
    }
    await updateTaskStatus(task, status);
  }, [updateTaskStatus]);
```

Thread `taskErrors` through `TaskLane` and `TaskCard` in this task:

1. Add `taskErrors: Record<string, string>;` to the `TaskLane` props.
2. Pass `error={taskErrors[task.id] || null}` from `TaskLane` to each `TaskCard`.
3. Add `error: string | null;` to the `TaskCard` props.
4. Render the card-level error below the action row:

```tsx
      {error && (
        <p className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300">
          {error}
        </p>
      )}
```

Pass `taskErrors={taskErrors}` from `TasksPage` to each `TaskLane`.

Render the dialog before the closing root `</div>`:

```tsx
      <ScheduleDialog
        open={Boolean(pendingSchedule)}
        title={pendingSchedule ? `Schedule ${taskTitle(pendingSchedule.task)}` : 'Schedule task'}
        onCancel={() => setPendingSchedule(null)}
        onConfirm={date => {
          const task = pendingSchedule?.task;
          setPendingSchedule(null);
          if (task) void updateTaskStatus(task, 'scheduled', date);
        }}
      />
```

- [ ] **Step 5: Run direct action tests**

Run:

```bash
rtk npm --prefix ui test -- src/components/TasksPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add ui/src/components/TasksPage.tsx ui/src/components/TasksPage.test.tsx ui/src/components/tasks/ScheduleDialog.tsx
rtk git commit -m "feat(ui): add direct task status actions"
```

---

## Task 5: Intuitive Task Editing Drawer

**Files:**
- Create: `ui/src/components/tasks/TaskEditDrawer.tsx`
- Modify: `ui/src/components/TasksPage.tsx`
- Modify: `ui/src/components/TasksPage.test.tsx`

- [ ] **Step 1: Add failing edit test**

Add to `ui/src/components/TasksPage.test.tsx`:

```tsx
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
    await user.click(screen.getByRole('button', { name: 'Waiting' }));
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk npm --prefix ui test -- src/components/TasksPage.test.tsx
```

Expected: FAIL because edit drawer is not implemented.

- [ ] **Step 3: Implement TaskEditDrawer**

Create `ui/src/components/tasks/TaskEditDrawer.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { Entity, TaskStatus } from '../../lib/types.ts';
import { getTaskMetadata, STATUS_LABELS } from './taskModel.ts';

const EDIT_STATUSES: TaskStatus[] = ['inbox', 'next', 'waiting', 'scheduled', 'someday', 'done'];

type Props = {
  task: Entity | null;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (input: {
    content: string;
    status: TaskStatus;
    context: string;
    dueDate: string;
    scheduledFor: string;
    priority: string;
    tags: string[];
    visibility: string;
  }) => void;
};

export default function TaskEditDrawer({ task, saving, error, onCancel, onSave }: Props) {
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<TaskStatus>('inbox');
  const [context, setContext] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [priority, setPriority] = useState('');
  const [tags, setTags] = useState('');
  const [visibility, setVisibility] = useState('personal');

  useEffect(() => {
    if (!task) return;
    const metadata = getTaskMetadata(task);
    setContent(task.content ?? '');
    setStatus((task.status as TaskStatus | null) ?? 'inbox');
    setContext(metadata.context ?? '');
    setDueDate(metadata.dueDate ?? '');
    setScheduledFor(metadata.scheduledFor ?? '');
    setPriority(metadata.priority !== undefined ? String(metadata.priority) : '');
    setTags(task.tags.join(', '));
    setVisibility(task.visibility);
  }, [task]);

  if (!task) return null;

  return (
    <div className="fixed inset-0 z-40 bg-black/50 md:flex md:justify-end">
      <aside className="fixed inset-x-0 bottom-0 max-h-[90vh] overflow-y-auto rounded-t-xl border border-gray-800 bg-gray-900 p-4 shadow-2xl md:inset-y-0 md:left-auto md:w-[420px] md:rounded-none md:border-y-0 md:border-r-0">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Edit task</h2>
          <button type="button" onClick={onCancel} className="text-xl leading-none text-gray-500 hover:text-white">x</button>
        </div>

        <label className="mt-4 block text-xs uppercase tracking-wide text-gray-500">
          Task content
          <textarea
            value={content}
            onChange={event => setContent(event.target.value)}
            className="mt-1 min-h-32 w-full rounded-lg border border-gray-700 bg-gray-800 p-3 text-sm normal-case tracking-normal text-white"
          />
        </label>

        <div className="mt-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Status</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {EDIT_STATUSES.map(option => (
              <button
                key={option}
                type="button"
                onClick={() => setStatus(option)}
                className={`rounded-md px-2 py-1 text-xs ${status === option ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
              >
                {STATUS_LABELS[option]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs uppercase tracking-wide text-gray-500">
            Context
            <input value={context} onChange={event => setContext(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm normal-case tracking-normal text-white" />
          </label>
          <label className="block text-xs uppercase tracking-wide text-gray-500">
            Due date
            <input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm normal-case tracking-normal text-white" />
          </label>
          <label className="block text-xs uppercase tracking-wide text-gray-500">
            Scheduled date
            <input type="date" value={scheduledFor} onChange={event => setScheduledFor(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm normal-case tracking-normal text-white" />
          </label>
          <label className="block text-xs uppercase tracking-wide text-gray-500">
            Priority
            <input value={priority} onChange={event => setPriority(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm normal-case tracking-normal text-white" />
          </label>
          <label className="block text-xs uppercase tracking-wide text-gray-500 sm:col-span-2">
            Tags
            <input aria-label="Tags" value={tags} onChange={event => setTags(event.target.value)} placeholder="comma, separated" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm normal-case tracking-normal text-white" />
          </label>
          <label className="block text-xs uppercase tracking-wide text-gray-500 sm:col-span-2">
            Visibility
            <select value={visibility} onChange={event => setVisibility(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm normal-case tracking-normal text-white">
              <option value="personal">personal</option>
              <option value="work">work</option>
              <option value="shared">shared</option>
            </select>
          </label>
        </div>

        {error && <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md px-3 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
          <button
            type="button"
            disabled={saving || !content.trim()}
            onClick={() => onSave({
              content,
              status,
              context,
              dueDate,
              scheduledFor,
              priority,
              tags: tags.split(',').map(tag => tag.trim()).filter(Boolean),
              visibility,
            })}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save task'}
          </button>
        </div>
      </aside>
    </div>
  );
}
```

- [ ] **Step 4: Wire edit drawer into TasksPage**

In `ui/src/components/TasksPage.tsx`, import:

```tsx
import TaskEditDrawer from './tasks/TaskEditDrawer.tsx';
```

Add state:

```tsx
  const [editingTask, setEditingTask] = useState<Entity | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
```

Replace `handleEdit`:

```tsx
  const handleEdit = useCallback((task: Entity) => {
    setEditingTask(task);
    setEditError(null);
  }, []);
```

Add save handler:

```tsx
  const handleSaveEdit = useCallback(async (input: {
    content: string;
    status: TaskStatus;
    context: string;
    dueDate: string;
    scheduledFor: string;
    priority: string;
    tags: string[];
    visibility: string;
  }) => {
    if (!editingTask) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const metadata = {
        ...editingTask.metadata,
        ...(input.scheduledFor ? { scheduled_for: input.scheduledFor } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
      };
      const result = await api.updateTask(editingTask.id, {
        version: editingTask.version,
        content: input.content,
        status: input.status,
        context: input.context,
        due_date: input.dueDate,
        tags: input.tags,
        visibility: input.visibility,
        metadata,
      });
      applyUpdatedTask(editingTask, result.entity, input.status);
      setEditingTask(null);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Failed to save task');
      if (isBoardStatus(editingTask.status)) void loadLane(editingTask.status);
    } finally {
      setEditSaving(false);
    }
  }, [api, applyUpdatedTask, editingTask, loadLane]);
```

Render before `ScheduleDialog`:

```tsx
      <TaskEditDrawer
        task={editingTask}
        saving={editSaving}
        error={editError}
        onCancel={() => setEditingTask(null)}
        onSave={handleSaveEdit}
      />
```

- [ ] **Step 5: Run edit tests**

Run:

```bash
rtk npm --prefix ui test -- src/components/TasksPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add ui/src/components/TasksPage.tsx ui/src/components/TasksPage.test.tsx ui/src/components/tasks/TaskEditDrawer.tsx
rtk git commit -m "feat(ui): add focused task editing drawer"
```

---

## Task 6: Bulk Selection and Bulk State Transitions

**Files:**
- Create: `ui/src/components/tasks/BulkActionBar.tsx`
- Modify: `ui/src/components/TasksPage.tsx`
- Modify: `ui/src/components/TasksPage.test.tsx`

- [ ] **Step 1: Add failing bulk tests**

Add to `ui/src/components/TasksPage.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk npm --prefix ui test -- src/components/TasksPage.test.tsx
```

Expected: FAIL because bulk action bar is not implemented.

- [ ] **Step 3: Implement BulkActionBar**

Create `ui/src/components/tasks/BulkActionBar.tsx`:

```tsx
import type { TaskStatus } from '../../lib/types.ts';
import { STATUS_LABELS } from './taskModel.ts';

const BULK_STATUSES: TaskStatus[] = ['inbox', 'next', 'waiting', 'scheduled', 'someday', 'done'];

type Props = {
  count: number;
  failureCount: number;
  onClear: () => void;
  onMove: (status: TaskStatus) => void;
};

export default function BulkActionBar({ count, failureCount, onClear, onMove }: Props) {
  if (count === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-800 bg-gray-900 p-3 shadow-2xl md:sticky md:bottom-auto md:top-0">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2">
        <span className="text-sm text-white">{count} selected</span>
        {failureCount > 0 && (
          <span className="rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-300">
            {failureCount} {failureCount === 1 ? 'task' : 'tasks'} failed to update
          </span>
        )}
        <div className="flex flex-wrap gap-1.5">
          {BULK_STATUSES.map(status => (
            <button
              key={status}
              type="button"
              onClick={() => onMove(status)}
              className="rounded-md bg-gray-800 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
            >
              Bulk {status === 'scheduled' ? 'Schedule' : STATUS_LABELS[status]}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClear} className="ml-auto rounded-md px-2 py-1 text-xs text-gray-400 hover:text-white">
          Clear
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire bulk updates into TasksPage**

In `ui/src/components/TasksPage.tsx`, import:

```tsx
import BulkActionBar from './tasks/BulkActionBar.tsx';
```

Add state:

```tsx
  const [bulkFailureCount, setBulkFailureCount] = useState(0);
  const [pendingBulkSchedule, setPendingBulkSchedule] = useState(false);
```

Add helper:

```tsx
  const applyBulkStatus = useCallback(async (status: TaskStatus, scheduledFor?: string) => {
    setBulkFailureCount(0);
    let failures = 0;
    const failedIds = new Set<string>();

    for (const task of selectedTasks) {
      try {
        if (status === 'done') {
          const result = await api.completeTask(task.id, task.version);
          applyUpdatedTask(task, result.entity, status);
        } else {
          const result = await api.updateTask(task.id, {
            version: task.version,
            status,
            metadata: {
              ...task.metadata,
              ...(scheduledFor ? { scheduled_for: scheduledFor } : {}),
            },
          });
          applyUpdatedTask(task, result.entity, status);
        }
      } catch {
        failures += 1;
        failedIds.add(task.id);
        if (isBoardStatus(task.status)) void loadLane(task.status);
      }
    }

    setSelectedIds(failedIds);
    setBulkFailureCount(failures);
  }, [api, applyUpdatedTask, loadLane, selectedTasks]);
```

Render `BulkActionBar` below the toolbar:

```tsx
      <BulkActionBar
        count={selectedIds.size}
        failureCount={bulkFailureCount}
        onClear={() => {
          setSelectedIds(new Set());
          setBulkFailureCount(0);
        }}
        onMove={status => {
          if (status === 'scheduled') {
            setPendingBulkSchedule(true);
            return;
          }
          void applyBulkStatus(status);
        }}
      />
```

Change `ScheduleDialog` state handling so it supports either single task or bulk schedule:

```tsx
      <ScheduleDialog
        open={Boolean(pendingSchedule) || pendingBulkSchedule}
        title={pendingBulkSchedule ? 'Schedule selected tasks' : pendingSchedule ? `Schedule ${taskTitle(pendingSchedule.task)}` : 'Schedule task'}
        onCancel={() => {
          setPendingSchedule(null);
          setPendingBulkSchedule(false);
        }}
        onConfirm={date => {
          const task = pendingSchedule?.task;
          setPendingSchedule(null);
          setPendingBulkSchedule(false);
          if (task) {
            void updateTaskStatus(task, 'scheduled', date);
            return;
          }
          void applyBulkStatus('scheduled', date);
        }}
      />
```

- [ ] **Step 5: Run bulk tests**

Run:

```bash
rtk npm --prefix ui test -- src/components/TasksPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add ui/src/components/TasksPage.tsx ui/src/components/TasksPage.test.tsx ui/src/components/tasks/BulkActionBar.tsx
rtk git commit -m "feat(ui): add bulk task transitions"
```

---

## Task 7: Mobile Lane Tabs and App Navigation

**Files:**
- Modify: `ui/src/components/TasksPage.tsx`
- Modify: `ui/src/components/TasksPage.test.tsx`
- Modify: `ui/src/components/TopBar.tsx`
- Create: `ui/src/components/TopBar.test.tsx`
- Modify: `ui/src/App.tsx`

- [ ] **Step 1: Add failing navigation/mobile tests**

Add to `ui/src/components/TasksPage.test.tsx`:

```tsx
  it('switches the active mobile lane with status tabs', async () => {
    const user = userEvent.setup();
    const api = apiWithTasks({
      inbox: [task('task-1', 'inbox', 'Inbox task')],
      waiting: [task('task-2', 'waiting', 'Waiting task')],
    });

    render(<TasksPage api={api} />);

    expect(await screen.findByText('Inbox task')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /waiting/i }));

    expect(screen.getByText('Waiting task')).toBeInTheDocument();
  });
```

Create `ui/src/components/TopBar.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TopBar from './TopBar.tsx';

describe('TopBar', () => {
  it('renders a Tasks tab and navigates to tasks', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(<TopBar onLogout={vi.fn()} currentPage="search" onNavigate={onNavigate} />);

    await user.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(onNavigate).toHaveBeenCalledWith('tasks');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk npm --prefix ui test -- src/components/TasksPage.test.tsx
```

Expected: FAIL because mobile lane tabs do not exist.

- [ ] **Step 3: Add active lane tabs to TasksPage**

In `ui/src/components/TasksPage.tsx`, add state:

```tsx
  const [activeMobileStatus, setActiveMobileStatus] = useState<BoardStatus>('inbox');
```

Render status tabs between toolbar and board:

```tsx
      <div role="tablist" aria-label="Task lanes" className="flex gap-1 overflow-x-auto border-b border-gray-800 px-3 py-2 md:hidden">
        {BOARD_STATUSES.map(status => (
          <button
            key={status}
            role="tab"
            aria-selected={activeMobileStatus === status}
            type="button"
            onClick={() => setActiveMobileStatus(status)}
            className={`shrink-0 rounded-md px-3 py-1.5 text-sm ${activeMobileStatus === status ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300'}`}
          >
            {status}
          </button>
        ))}
      </div>
```

Change each lane wrapper in the board map to hide inactive mobile lanes:

```tsx
          <div key={status} className={activeMobileStatus === status ? 'block min-h-[50vh]' : 'hidden md:block'}>
            <TaskLane ... />
          </div>
```

Move the `key` from `TaskLane` to this wrapper.

- [ ] **Step 4: Add Tasks tab to TopBar**

In `ui/src/components/TopBar.tsx`, change:

```ts
export type Page = 'search' | 'graph' | 'projector';
```

to:

```ts
export type Page = 'search' | 'graph' | 'projector' | 'tasks';
```

Add the tab:

```tsx
        <TabButton active={currentPage === 'tasks'} onClick={() => onNavigate('tasks')}>Tasks</TabButton>
```

- [ ] **Step 5: Render TasksPage in App**

In `ui/src/App.tsx`, add:

```ts
import TasksPage from './components/TasksPage.tsx';
```

Change saved page validation:

```ts
    if (saved === 'graph' || saved === 'projector' || saved === 'tasks') return saved;
```

Add before the graph layout branch:

```tsx
  if (currentPage === 'tasks') {
    return (
      <div className="flex flex-col h-full bg-gray-950">
        <TopBar onLogout={handleLogout} currentPage={currentPage} onNavigate={handleNavigate} />
        <div className="flex-1 min-h-0">
          <TasksPage api={api} />
        </div>
      </div>
    );
  }
```

- [ ] **Step 6: Run page tests and typecheck**

Run:

```bash
rtk npm --prefix ui test -- src/components/TasksPage.test.tsx
rtk npm --prefix ui test -- src/components/TopBar.test.tsx
rtk npm --prefix ui run typecheck
```

Expected: PASS and typecheck exit 0.

- [ ] **Step 7: Commit**

Run:

```bash
rtk git add ui/src/components/TasksPage.tsx ui/src/components/TasksPage.test.tsx ui/src/components/TopBar.tsx ui/src/components/TopBar.test.tsx ui/src/App.tsx
rtk git commit -m "feat(ui): add responsive tasks navigation"
```

---

## Task 8: Full Verification and Visual Check

**Files:**
- Modify only files needed for fixes found by verification.

- [ ] **Step 1: Run full UI tests**

Run:

```bash
rtk npm --prefix ui test
```

Expected: all Vitest suites pass.

- [ ] **Step 2: Run UI build**

Run:

```bash
rtk npm --prefix ui run build
```

Expected: TypeScript build and Vite production build complete with exit 0.

- [ ] **Step 3: Start dev server for browser verification**

Run:

```bash
rtk npm --prefix ui run dev -- --host 127.0.0.1
```

Expected: Vite prints a local URL, usually `http://127.0.0.1:5173/`.

- [ ] **Step 4: Verify layout in browser**

Use the Browser plugin against the Vite URL. Check:

- Desktop width: top bar includes `Tasks`; board shows five lanes.
- Mobile width: one lane is visible; status tabs switch lanes; bulk bar stays visible at the bottom when selected.
- Task card buttons are readable and do not overlap.
- Edit drawer appears as side drawer on desktop and bottom sheet on mobile.
- Schedule dialog is usable on mobile.

- [ ] **Step 5: Fix any visual defects**

For each defect, make the smallest targeted edit in the relevant component, then rerun:

```bash
rtk npm --prefix ui test -- src/components/TasksPage.test.tsx
rtk npm --prefix ui run build
```

Expected: PASS and build exit 0.

- [ ] **Step 6: Final commit when verification changes files**

When verification changes files, run:

```bash
rtk git add ui/src
rtk git commit -m "fix(ui): polish GTD task board"
```

When verification does not change files, do not create an empty commit.

---

## Self-Review Checklist

- Spec coverage:
  - Dedicated `Tasks` view: Task 7.
  - Responsive kanban: Tasks 3 and 7.
  - No capture: all tasks omit capture UI.
  - One-button status changes: Task 4.
  - Date-only scheduling: Tasks 4 and 6.
  - Intuitive editing with visible status control: Task 5.
  - Bulk state transitions: Task 6.
  - Existing `/api/tasks` endpoints: Task 1.
  - Error handling and partial bulk failure: Tasks 3, 4, 5, and 6.
  - Verification: Task 8.
- No placeholders: each task has exact file paths, commands, expected outcomes, and concrete code.
- Type consistency: status types use `TaskStatus`; board lanes use `BoardStatus`; task entities reuse `Entity`.

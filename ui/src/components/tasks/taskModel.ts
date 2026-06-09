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

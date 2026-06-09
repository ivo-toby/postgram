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

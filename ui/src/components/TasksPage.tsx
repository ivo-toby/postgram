import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiClient } from '../lib/api.ts';
import type { Entity, TaskStatus } from '../lib/types.ts';
import ScheduleDialog from './tasks/ScheduleDialog.tsx';
import TaskLane from './tasks/TaskLane.tsx';
import {
  BOARD_STATUSES,
  emptyTaskLanes,
  isBoardStatus,
  moveTaskLocally,
  taskTitle,
  type BoardStatus,
  type TaskLanes,
} from './tasks/taskModel.ts';

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
  const [pendingSchedule, setPendingSchedule] = useState<{ task: Entity } | null>(null);
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({});

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

  const handleEdit = useCallback((_task: Entity) => {
    return undefined;
  }, []);

  const handleStatusChange = useCallback(async (task: Entity, status: TaskStatus) => {
    if (status === 'scheduled') {
      setPendingSchedule({ task });
      return;
    }
    await updateTaskStatus(task, status);
  }, [updateTaskStatus]);

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
            taskErrors={taskErrors}
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
    </div>
  );
}

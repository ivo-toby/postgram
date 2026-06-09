import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiClient } from '../lib/api.ts';
import type { Entity, TaskStatus } from '../lib/types.ts';
import TaskLane from './tasks/TaskLane.tsx';
import { BOARD_STATUSES, emptyTaskLanes, type BoardStatus, type TaskLanes } from './tasks/taskModel.ts';

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

import { useState, type ReactNode } from 'react';
import { useResizable } from '../hooks/useResizable.ts';

type Props = {
  children: ReactNode;
};

export default function LeftPanel({ children }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const resize = useResizable({
    initial: 288,
    min: 220,
    max: 520,
    storageKey: 'pgm_left_panel_width',
    direction: 'right',
  });

  return (
    <aside
      className="flex flex-col bg-gray-900 border-r border-gray-800 shrink-0 relative"
      style={{ width: collapsed ? 40 : resize.width, transition: resize.dragging ? 'none' : 'width 200ms' }}
    >
      <div className="flex items-center justify-end px-2 py-2 border-b border-gray-800">
        <button
          onClick={() => setCollapsed(c => !c)}
          className="text-gray-500 hover:text-white transition-colors p-1 rounded"
          title={collapsed ? 'Expand panel' : 'Collapse panel'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>
      {!collapsed && <div className="flex-1 overflow-y-auto">{children}</div>}
      {!collapsed && (
        <div
          onMouseDown={resize.onMouseDown}
          className={`hidden md:block absolute right-0 top-0 bottom-0 w-1.5 -mr-0.5 cursor-col-resize group z-10 ${
            resize.dragging ? 'bg-blue-500/40' : 'hover:bg-blue-500/30'
          }`}
          title="Drag to resize"
          aria-label="Resize sidebar"
        >
          <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-gray-800 group-hover:bg-blue-500" />
        </div>
      )}
    </aside>
  );
}

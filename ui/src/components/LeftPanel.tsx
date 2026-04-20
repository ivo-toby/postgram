import { useState, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
};

export default function LeftPanel({ children }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`flex flex-col bg-gray-900 border-r border-gray-800 transition-all duration-200 shrink-0 ${
        collapsed ? 'w-10' : 'w-72'
      }`}
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
    </aside>
  );
}

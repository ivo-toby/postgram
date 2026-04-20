import type { ReactNode } from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
};

export default function RightPanel({ open, onClose, children }: Props) {
  return (
    <aside
      className={`flex flex-col bg-gray-900 border-l border-gray-800 shrink-0 transition-all duration-200 overflow-hidden ${
        open ? 'w-96' : 'w-0'
      }`}
    >
      {open && (
        <>
          <div className="flex items-center justify-end px-4 py-2 border-b border-gray-800">
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-white transition-colors text-lg leading-none"
              title="Close"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
        </>
      )}
    </aside>
  );
}

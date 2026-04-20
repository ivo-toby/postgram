import { type ReactNode, useState, useCallback, useRef } from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
};

const MIN_WIDTH = 280;
const MAX_WIDTH = 800;
const DEFAULT_WIDTH = 384; // equivalent to w-96

export default function RightPanel({ open, onClose, children }: Props) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      // Panel is flush against the right edge; dragging the left handle leftward widens it
      const newWidth = window.innerWidth - ev.clientX;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newWidth)));
    };

    const onMouseUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, []);

  return (
    <aside
      className="relative flex flex-col bg-gray-900 border-l border-gray-800 shrink-0 overflow-hidden"
      style={{ width: open ? width : 0, transition: dragging.current ? 'none' : 'width 0.2s' }}
    >
      {open && (
        <>
          {/* Drag handle on the left edge */}
          <div
            onMouseDown={onMouseDown}
            className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500 transition-colors z-10"
          />
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

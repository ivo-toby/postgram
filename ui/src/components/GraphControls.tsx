import type { LayoutType } from '../hooks/useLayout.ts';

type Props = {
  layout: LayoutType;
  onLayoutChange: (layout: LayoutType) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  nodeCount: number;
};

const LAYOUTS: { id: LayoutType; label: string; title: string }[] = [
  { id: 'force', label: '⬡', title: 'Force-directed' },
  { id: 'radial', label: '◎', title: 'Radial' },
  { id: 'hierarchy', label: '⊤', title: 'Hierarchy' },
];

export default function GraphControls({ layout, onLayoutChange, onZoomIn, onZoomOut, nodeCount }: Props) {
  return (
    <div className="absolute bottom-4 right-4 flex flex-col gap-2">
      <div className="flex flex-col bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        {LAYOUTS.map(l => {
          const disabled = l.id === 'hierarchy' && nodeCount > 200;
          return (
            <button
              key={l.id}
              onClick={() => !disabled && onLayoutChange(l.id)}
              title={disabled ? 'Hierarchy (disabled for graphs > 200 nodes)' : l.title}
              disabled={disabled}
              className={`w-9 h-9 text-sm flex items-center justify-center transition-colors ${
                disabled
                  ? 'text-gray-600 cursor-not-allowed'
                  : layout === l.id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {l.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-col bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        <button onClick={onZoomIn} className="w-9 h-9 text-lg text-gray-400 hover:bg-gray-700 hover:text-white flex items-center justify-center">+</button>
        <button onClick={onZoomOut} className="w-9 h-9 text-lg text-gray-400 hover:bg-gray-700 hover:text-white flex items-center justify-center">−</button>
      </div>
    </div>
  );
}

import type { LayoutType } from '../hooks/useLayout.ts';

type Props = {
  layout: LayoutType;
  onLayoutChange: (layout: LayoutType) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRedraw: () => void;
  nodeCount: number;
  layoutLoading?: boolean;
};

const LAYOUTS: { id: LayoutType; label: string; title: string }[] = [
  { id: 'force', label: '⬡', title: 'Force-directed' },
  { id: 'radial', label: '◎', title: 'Radial' },
  { id: 'hierarchy', label: '⊤', title: 'Hierarchy' },
  { id: 'semantic', label: '✦', title: 'Semantic (UMAP of embeddings)' },
];

export default function GraphControls({
  layout,
  onLayoutChange,
  onZoomIn,
  onZoomOut,
  onRedraw,
  nodeCount,
  layoutLoading = false,
}: Props) {
  return (
    <div className="absolute bottom-4 right-4 flex flex-col gap-2">
      <div className="flex flex-col bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        <button
          onClick={onRedraw}
          title="Redraw layout"
          className="w-9 h-9 text-sm text-gray-400 hover:bg-gray-700 hover:text-white flex items-center justify-center transition-colors"
        >
          ↺
        </button>
      </div>
      <div className="flex flex-col bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        {LAYOUTS.map(l => {
          const hierarchyDisabled = l.id === 'hierarchy' && nodeCount > 200;
          const semanticComputing = l.id === 'semantic' && layoutLoading;
          const disabled = hierarchyDisabled || semanticComputing;
          const title = hierarchyDisabled
            ? 'Hierarchy (disabled for graphs > 200 nodes)'
            : semanticComputing
              ? 'Computing semantic layout…'
              : l.title;
          const active = layout === l.id;
          return (
            <button
              key={l.id}
              onClick={() => !disabled && onLayoutChange(l.id)}
              title={title}
              disabled={disabled}
              className={`w-9 h-9 text-sm flex items-center justify-center transition-colors ${
                disabled
                  ? 'text-gray-600 cursor-not-allowed'
                  : active
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {semanticComputing ? (
                <span className="inline-block w-3 h-3 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
              ) : (
                l.label
              )}
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

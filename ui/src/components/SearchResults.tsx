import ReactMarkdown from 'react-markdown';
import type { SearchResult } from '../lib/types.ts';
import { ENTITY_COLORS } from '../lib/nodeStyles.ts';

type Props = {
  results: SearchResult[];
  onSelect: (entityId: string) => void;
};

export default function SearchResults({ results, onSelect }: Props) {
  if (results.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5 mt-1">
      {results.map(r => {
        const color = ENTITY_COLORS[r.entity.type] ?? ENTITY_COLORS['default']!;
        return (
          <button
            key={r.entity.id}
            onClick={() => onSelect(r.entity.id)}
            className="text-left px-2 py-2 rounded hover:bg-gray-800 transition-colors"
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <span className="text-xs text-gray-400 uppercase tracking-wide">{r.entity.type}</span>
              <span className="text-xs text-gray-600 ml-auto">{Math.round(r.score * 100)}%</span>
            </div>
            <div className="text-sm text-gray-200 line-clamp-2 prose prose-sm prose-invert max-w-none">
              <ReactMarkdown>{r.chunk_content}</ReactMarkdown>
            </div>
          </button>
        );
      })}
    </div>
  );
}

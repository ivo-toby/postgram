import { ENTITY_COLORS } from '../lib/nodeStyles.ts';

type Props = {
  types: string[];
  visible: Set<string>;
  onToggle: (type: string) => void;
};

export default function FilterChips({ types, visible, onToggle }: Props) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {types.map(type => {
        const color = ENTITY_COLORS[type] ?? ENTITY_COLORS['default']!;
        const isVisible = visible.has(type);
        return (
          <button
            key={type}
            onClick={() => onToggle(type)}
            className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-opacity ${
              isVisible ? 'opacity-100' : 'opacity-40'
            }`}
            style={{ borderColor: color, color: isVisible ? color : '#6B7280' }}
          >
            {type}
          </button>
        );
      })}
    </div>
  );
}

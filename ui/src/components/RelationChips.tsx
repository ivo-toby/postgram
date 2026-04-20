type Props = {
  relations: string[];
  visible: Set<string>;
  onToggle: (relation: string) => void;
};

export default function RelationChips({ relations, visible, onToggle }: Props) {
  if (relations.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {relations.map(rel => (
        <button
          key={rel}
          onClick={() => onToggle(rel)}
          className={`px-2 py-0.5 rounded-full text-xs border border-gray-600 transition-opacity ${
            visible.has(rel) ? 'text-gray-300 opacity-100' : 'text-gray-500 opacity-40'
          }`}
        >
          {rel}
        </button>
      ))}
    </div>
  );
}

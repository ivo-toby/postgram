import type { Edge } from '../lib/types.ts';

type Props = {
  edges: Edge[];
  entityId: string;
  onNavigate: (entityId: string) => void;
  getLabel: (id: string) => string;
};

function groupByRelation(edges: Edge[]): Record<string, Edge[]> {
  return edges.reduce<Record<string, Edge[]>>((acc, edge) => {
    const key = edge.relation;
    if (!acc[key]) acc[key] = [];
    acc[key]!.push(edge);
    return acc;
  }, {});
}

export default function EdgeList({ edges, entityId, onNavigate, getLabel }: Props) {
  if (edges.length === 0) {
    return <p className="text-xs text-gray-600 italic">No connections yet</p>;
  }

  const grouped = groupByRelation(edges);

  return (
    <div className="flex flex-col gap-3">
      {Object.entries(grouped).map(([relation, relEdges]) => (
        <div key={relation}>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{relation}</p>
          <div className="flex flex-col gap-0.5">
            {relEdges.map(edge => (
              <button
                key={edge.id}
                onClick={() => onNavigate(edge.source_id === entityId ? edge.target_id : edge.source_id)}
                className="flex items-center gap-2 text-left px-2 py-1.5 rounded hover:bg-gray-800 transition-colors"
              >
                <span className="text-gray-600 text-xs">→</span>
                <span className="text-sm text-gray-300 truncate">
                  {getLabel(edge.source_id === entityId ? edge.target_id : edge.source_id)}
                </span>
                <span className="text-xs text-gray-600 ml-auto">{Math.round(edge.confidence * 100)}%</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

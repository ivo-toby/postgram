export const ENTITY_COLORS: Record<string, string> = {
  document: '#3B82F6',
  memory: '#8B5CF6',
  person: '#F97316',
  project: '#22C55E',
  task: '#EAB308',
  interaction: '#14B8A6',
  default: '#6B7280',
};

const FIXED_SIZE_TYPES = new Set(['memory', 'task', 'interaction']);
const FIXED_SIZES: Record<string, number> = {
  memory: 8,
  task: 6,
  interaction: 6,
  project: 12,
};

export function getNodeColor(type: string): string {
  return ENTITY_COLORS[type] ?? ENTITY_COLORS['default']!;
}

export function getNodeSize(type: string, edgeCount: number): number {
  if (FIXED_SIZE_TYPES.has(type)) return FIXED_SIZES[type] ?? 6;
  if (type === 'project') return FIXED_SIZES['project']!;
  return Math.min(6 + Math.sqrt(edgeCount) * 2, 20);
}

export function getNodeOpacity(enrichmentStatus: string | null): number {
  return enrichmentStatus === 'pending' ? 0.6 : 1.0;
}

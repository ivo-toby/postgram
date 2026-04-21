import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import ReactMarkdown from 'react-markdown';
import type { ApiClient } from '../lib/api.ts';
import type { Entity } from '../lib/types.ts';
import { ENTITY_COLORS } from '../lib/nodeStyles.ts';
import type {
  ProjectionAlgorithm,
  ProjectionRequest,
  ProjectionResponse,
} from '../workers/projection.worker.ts';

type Props = {
  api: ApiClient;
  onOpenInGraph: (entityId: string) => void;
  onOpenInSearch?: (entityId: string) => void;
};

type PointRecord = {
  id: string;
  entity: Entity;
  position: THREE.Vector3;
  color: THREE.Color;
};

type ColourBy = 'type' | 'visibility' | 'status' | 'none';

const ENTITY_PAGE_SIZE = 500;
const EMBEDDING_BATCH = 500;
const KNN_K = 8;
const POINT_SIZE = 0.12;
const POSITION_SCALE = 1.5;

function colourForEntity(entity: Entity, mode: ColourBy): string {
  if (mode === 'type') return ENTITY_COLORS[entity.type] ?? ENTITY_COLORS['default']!;
  if (mode === 'visibility') {
    switch (entity.visibility) {
      case 'personal': return '#F472B6';
      case 'work': return '#60A5FA';
      case 'shared': return '#34D399';
      default: return '#9CA3AF';
    }
  }
  if (mode === 'status') {
    switch (entity.status) {
      case 'done': return '#10B981';
      case 'archived': return '#6B7280';
      case 'active':
      case 'next':
        return '#F59E0B';
      case 'waiting':
      case 'scheduled':
      case 'someday':
        return '#A78BFA';
      case 'inbox':
      default:
        return '#60A5FA';
    }
  }
  return '#9CA3AF';
}

function truncateLabel(content: string | null, id: string, max = 40): string {
  const text = (content ?? '').trim();
  if (!text) return id.slice(0, 8);
  const first = text.split('\n')[0]!.trim();
  return first.length > max ? first.slice(0, max) + '…' : first;
}

export default function ProjectorPage({ api, onOpenInGraph, onOpenInSearch }: Props) {
  const [entities, setEntities] = useState<Map<string, Entity>>(new Map());
  const [positions, setPositions] = useState<Map<string, THREE.Vector3>>(new Map());
  const [knn, setKnn] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<string>('Fetching entities…');
  const [error, setError] = useState<string | null>(null);
  const [algorithm, setAlgorithm] = useState<ProjectionAlgorithm>('umap');
  const [colourBy, setColourBy] = useState<ColourBy>('type');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const projectionCacheRef = useRef<
    Map<string, { positions: Map<string, THREE.Vector3>; knn: Record<string, string[]> }>
  >(new Map());

  // Fetch all entities on mount
  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      setLoading(true);
      setLoadingStage('Fetching entities…');
      setError(null);
      try {
        const all: Entity[] = [];
        let offset = 0;
        while (true) {
          const res = await api.listEntities({ limit: ENTITY_PAGE_SIZE, offset });
          if (cancelled) return;
          all.push(...(res.items as Entity[]));
          if (res.items.length < ENTITY_PAGE_SIZE) break;
          offset += ENTITY_PAGE_SIZE;
        }
        const map = new Map<string, Entity>();
        for (const e of all) map.set(e.id, e);
        if (cancelled) return;
        setEntities(map);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load entities');
          setLoading(false);
        }
      }
    }
    void loadAll();
    return () => { cancelled = true; };
  }, [api]);

  // Fetch embeddings and project whenever algorithm or entity set changes
  useEffect(() => {
    if (entities.size === 0) return;
    let cancelled = false;

    async function project() {
      setLoading(true);
      setError(null);

      const entityIds = [...entities.keys()];
      const cacheKey = `${algorithm}:${entityIds.length}`;
      const cached = projectionCacheRef.current.get(cacheKey);
      if (cached) {
        setPositions(cached.positions);
        setKnn(cached.knn);
        setLoading(false);
        return;
      }

      setLoadingStage('Fetching embeddings…');
      try {
        const embeddingMap = new Map<string, number[]>();
        for (let i = 0; i < entityIds.length; i += EMBEDDING_BATCH) {
          const batch = entityIds.slice(i, i + EMBEDDING_BATCH);
          const res = await api.getEmbeddings(batch);
          if (cancelled) return;
          for (const e of res.embeddings) embeddingMap.set(e.id, e.embedding);
        }

        const embeddedIds: string[] = [];
        const embeddings: number[][] = [];
        for (const id of entityIds) {
          const v = embeddingMap.get(id);
          if (v) {
            embeddedIds.push(id);
            embeddings.push(v);
          }
        }

        if (embeddings.length < 2) {
          if (!cancelled) {
            setError('Not enough enriched entities to project (need ≥2).');
            setLoading(false);
          }
          return;
        }

        setLoadingStage(`Projecting ${embeddings.length} points…`);

        if (workerRef.current) workerRef.current.terminate();
        const worker = new Worker(
          new URL('../workers/projection.worker.ts', import.meta.url),
          { type: 'module' },
        );
        workerRef.current = worker;

        await new Promise<void>((resolve, reject) => {
          worker.onmessage = (event: MessageEvent<ProjectionResponse>) => {
            const msg = event.data;
            if (msg.type === 'progress') {
              if (!cancelled) {
                setLoadingStage(
                  `Projecting ${embeddings.length} points (${msg.epoch}/${msg.epochs})…`,
                );
              }
            } else if (msg.type === 'result') {
              if (cancelled) return resolve();
              const next = new Map<string, THREE.Vector3>();
              for (const pos of msg.positions) {
                const [x = 0, y = 0, z = 0] = pos.coords;
                next.set(
                  pos.id,
                  new THREE.Vector3(
                    x * POSITION_SCALE,
                    y * POSITION_SCALE,
                    z * POSITION_SCALE,
                  ),
                );
              }
              projectionCacheRef.current.set(cacheKey, {
                positions: next,
                knn: msg.knn ?? {},
              });
              setPositions(next);
              setKnn(msg.knn ?? {});
              resolve();
            } else if (msg.type === 'error') {
              reject(new Error(msg.message));
            }
          };
          worker.onerror = (e) => reject(new Error(e.message || 'Worker error'));

          const request: ProjectionRequest = {
            ids: embeddedIds,
            embeddings,
            dim: 3,
            algorithm,
            knn: KNN_K,
          };
          worker.postMessage(request);
        });

        if (workerRef.current) {
          workerRef.current.terminate();
          workerRef.current = null;
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Projection failed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void project();
    return () => {
      cancelled = true;
    };
  }, [api, entities, algorithm]);

  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  const points: PointRecord[] = useMemo(() => {
    const out: PointRecord[] = [];
    positions.forEach((position, id) => {
      const entity = entities.get(id);
      if (!entity) return;
      out.push({
        id,
        entity,
        position,
        color: new THREE.Color(colourForEntity(entity, colourBy)),
      });
    });
    return out;
  }, [positions, entities, colourBy]);

  const selectedEntity = selectedId ? entities.get(selectedId) ?? null : null;
  const hoveredEntity = hoveredId ? entities.get(hoveredId) ?? null : null;
  const selectedNeighbours = selectedId ? knn[selectedId] ?? [] : [];

  return (
    <div className="flex flex-col h-full bg-gray-950 overflow-hidden">
      <ProjectorToolbar
        algorithm={algorithm}
        onAlgorithmChange={setAlgorithm}
        colourBy={colourBy}
        onColourByChange={setColourBy}
        loading={loading}
        loadingStage={loadingStage}
        error={error}
        pointCount={points.length}
      />

      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
        <div className={`flex-1 min-h-0 relative ${selectedId ? 'hidden md:block' : ''}`}>
          <Canvas
            camera={{ position: [0, 0, 25], fov: 55 }}
            onPointerMissed={() => setSelectedId(null)}
          >
            <color attach="background" args={['#030712']} />
            <ambientLight intensity={0.8} />
            <PointCloud
              points={points}
              selectedId={selectedId}
              hoveredId={hoveredId}
              onSelect={setSelectedId}
              onHover={setHoveredId}
            />
            {selectedId && selectedNeighbours.length > 0 && (
              <KnnLines
                from={selectedId}
                to={selectedNeighbours}
                positions={positions}
              />
            )}
            {selectedId && positions.get(selectedId) && (
              <HighlightRing position={positions.get(selectedId)!} />
            )}
            <OrbitControls
              enableDamping
              dampingFactor={0.1}
              makeDefault
            />
          </Canvas>

          {hoveredEntity && hoveredId !== selectedId && (
            <HoverTooltip entity={hoveredEntity} />
          )}

          <Legend colourBy={colourBy} />
        </div>

        {selectedId && (
          <aside className="md:w-[380px] md:border-l md:border-gray-800 bg-gray-900 flex-1 md:flex-initial overflow-y-auto">
            <DetailPanel
              entity={selectedEntity}
              neighbours={selectedNeighbours}
              entities={entities}
              onClose={() => setSelectedId(null)}
              onNavigate={(id) => setSelectedId(id)}
              onOpenInGraph={() => selectedId && onOpenInGraph(selectedId)}
              onOpenInSearch={
                onOpenInSearch && selectedId
                  ? () => onOpenInSearch(selectedId)
                  : undefined
              }
            />
          </aside>
        )}
      </div>
    </div>
  );
}

type PointCloudProps = {
  points: PointRecord[];
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
};

function PointCloud({ points, selectedId, hoveredId, onSelect, onHover }: PointCloudProps) {
  const { gl } = useThree();
  const geometryRef = useRef<THREE.BufferGeometry>(null!);

  const { positionArray, colorArray } = useMemo(() => {
    const pos = new Float32Array(points.length * 3);
    const col = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i]!;
      pos[i * 3] = p.position.x;
      pos[i * 3 + 1] = p.position.y;
      pos[i * 3 + 2] = p.position.z;
      col[i * 3] = p.color.r;
      col[i * 3 + 1] = p.color.g;
      col[i * 3 + 2] = p.color.b;
    }
    return { positionArray: pos, colorArray: col };
  }, [points]);

  const handlePointerMove = useCallback(
    (event: { index?: number; stopPropagation: () => void }) => {
      if (event.index === undefined) return;
      event.stopPropagation();
      const p = points[event.index];
      if (p) {
        onHover(p.id);
        gl.domElement.style.cursor = 'pointer';
      }
    },
    [points, onHover, gl],
  );

  const handlePointerOut = useCallback(() => {
    onHover(null);
    gl.domElement.style.cursor = '';
  }, [onHover, gl]);

  const handleClick = useCallback(
    (event: { index?: number; stopPropagation: () => void }) => {
      if (event.index === undefined) return;
      event.stopPropagation();
      const p = points[event.index];
      if (p) onSelect(p.id);
    },
    [points, onSelect],
  );

  // Dim non-selected points when a selection is active
  const material = useMemo(() => {
    const mat = new THREE.PointsMaterial({
      size: POINT_SIZE,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    return mat;
  }, []);

  useEffect(() => {
    material.opacity = selectedId ? 0.35 : 0.9;
    material.needsUpdate = true;
  }, [selectedId, material]);

  if (points.length === 0) return null;

  return (
    <>
      <points
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
      >
        <bufferGeometry ref={geometryRef}>
          <bufferAttribute
            attach="attributes-position"
            args={[positionArray, 3]}
          />
          <bufferAttribute
            attach="attributes-color"
            args={[colorArray, 3]}
          />
        </bufferGeometry>
        <primitive object={material} attach="material" />
      </points>
      {hoveredId && hoveredId !== selectedId && (
        <HighlightPoint
          position={points.find((p) => p.id === hoveredId)?.position}
          color="#ffffff"
        />
      )}
    </>
  );
}

function HighlightPoint({
  position,
  color,
}: {
  position: THREE.Vector3 | undefined;
  color: string;
}) {
  if (!position) return null;
  return (
    <mesh position={position}>
      <sphereGeometry args={[0.2, 12, 12]} />
      <meshBasicMaterial color={color} transparent opacity={0.6} />
    </mesh>
  );
}

function HighlightRing({ position }: { position: THREE.Vector3 }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.z += delta * 0.5;
  });
  return (
    <mesh ref={ref} position={position}>
      <ringGeometry args={[0.3, 0.4, 32]} />
      <meshBasicMaterial color="#3B82F6" side={THREE.DoubleSide} transparent opacity={0.8} />
    </mesh>
  );
}

function KnnLines({
  from,
  to,
  positions,
}: {
  from: string;
  to: string[];
  positions: Map<string, THREE.Vector3>;
}) {
  const fromPos = positions.get(from);
  if (!fromPos) return null;

  return (
    <>
      {to.map((id) => {
        const pos = positions.get(id);
        if (!pos) return null;
        const points = [fromPos, pos];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        return (
          <primitive
            key={id}
            object={new THREE.Line(
              geometry,
              new THREE.LineBasicMaterial({
                color: '#3B82F6',
                transparent: true,
                opacity: 0.4,
              }),
            )}
          />
        );
      })}
    </>
  );
}

function HoverTooltip({ entity }: { entity: Entity }) {
  return (
    <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 bg-gray-900/90 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 max-w-md">
      <div className="flex items-center gap-2 mb-0.5">
        <span
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: ENTITY_COLORS[entity.type] ?? ENTITY_COLORS['default'] }}
        />
        <span className="uppercase tracking-wider text-gray-400">{entity.type}</span>
      </div>
      <div className="truncate">{truncateLabel(entity.content, entity.id, 80)}</div>
    </div>
  );
}

function Legend({ colourBy }: { colourBy: ColourBy }) {
  let entries: { label: string; color: string }[] = [];
  if (colourBy === 'type') {
    entries = Object.entries(ENTITY_COLORS)
      .filter(([k]) => k !== 'default')
      .map(([label, color]) => ({ label, color }));
  } else if (colourBy === 'visibility') {
    entries = [
      { label: 'personal', color: '#F472B6' },
      { label: 'work', color: '#60A5FA' },
      { label: 'shared', color: '#34D399' },
    ];
  } else if (colourBy === 'status') {
    entries = [
      { label: 'active / next', color: '#F59E0B' },
      { label: 'done', color: '#10B981' },
      { label: 'waiting / scheduled / someday', color: '#A78BFA' },
      { label: 'inbox', color: '#60A5FA' },
      { label: 'archived', color: '#6B7280' },
    ];
  } else {
    return null;
  }

  return (
    <div className="absolute bottom-3 left-3 bg-gray-900/80 border border-gray-800 rounded-lg px-3 py-2 text-[11px] text-gray-300 flex flex-col gap-1 max-h-[40vh] overflow-y-auto">
      <p className="uppercase text-gray-500 tracking-wide text-[10px] mb-1">Colour: {colourBy}</p>
      {entries.map((e) => (
        <div key={e.label} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: e.color }} />
          <span className="truncate">{e.label}</span>
        </div>
      ))}
    </div>
  );
}

type ToolbarProps = {
  algorithm: ProjectionAlgorithm;
  onAlgorithmChange: (a: ProjectionAlgorithm) => void;
  colourBy: ColourBy;
  onColourByChange: (m: ColourBy) => void;
  loading: boolean;
  loadingStage: string;
  error: string | null;
  pointCount: number;
};

function ProjectorToolbar({
  algorithm,
  onAlgorithmChange,
  colourBy,
  onColourByChange,
  loading,
  loadingStage,
  error,
  pointCount,
}: ToolbarProps) {
  return (
    <div className="shrink-0 border-b border-gray-800 bg-gray-900">
      <div className="max-w-6xl mx-auto w-full px-3 sm:px-6 py-3 flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2 text-gray-300">
          <span className="text-gray-500 uppercase tracking-wide text-[10px]">Algorithm</span>
          <div className="flex rounded-md border border-gray-700 overflow-hidden">
            <button
              className={`px-3 py-1.5 ${algorithm === 'umap' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`}
              onClick={() => onAlgorithmChange('umap')}
            >
              UMAP
            </button>
            <button
              className={`px-3 py-1.5 ${algorithm === 'pca' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`}
              onClick={() => onAlgorithmChange('pca')}
            >
              PCA
            </button>
          </div>
        </label>

        <label className="flex items-center gap-2 text-gray-300">
          <span className="text-gray-500 uppercase tracking-wide text-[10px]">Colour by</span>
          <select
            value={colourBy}
            onChange={(e) => onColourByChange(e.target.value as ColourBy)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="type">type</option>
            <option value="visibility">visibility</option>
            <option value="status">status</option>
            <option value="none">none</option>
          </select>
        </label>

        <div className="ml-auto flex items-center gap-3 text-gray-400">
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
              {loadingStage}
            </span>
          ) : error ? (
            <span className="text-red-400">{error}</span>
          ) : (
            <span>{pointCount} points</span>
          )}
        </div>
      </div>
    </div>
  );
}

type DetailPanelProps = {
  entity: Entity | null;
  neighbours: string[];
  entities: Map<string, Entity>;
  onClose: () => void;
  onNavigate: (id: string) => void;
  onOpenInGraph: () => void;
  onOpenInSearch?: (() => void) | undefined;
};

function DetailPanel({
  entity,
  neighbours,
  entities,
  onClose,
  onNavigate,
  onOpenInGraph,
  onOpenInSearch,
}: DetailPanelProps) {
  if (!entity) {
    return (
      <div className="p-4 text-sm text-gray-500">
        <button
          onClick={onClose}
          className="md:hidden text-sm text-gray-400 hover:text-white mb-3"
        >
          ‹ Back
        </button>
        Entity not found.
      </div>
    );
  }
  const color = ENTITY_COLORS[entity.type] ?? ENTITY_COLORS['default']!;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0">
        <button
          onClick={onClose}
          className="md:hidden text-sm text-gray-400 hover:text-white"
        >
          ‹ Back
        </button>
        <span className="hidden md:inline text-xs text-gray-500 uppercase tracking-wide">Detail</span>
        <button
          onClick={onClose}
          className="hidden md:block text-gray-500 hover:text-white text-lg leading-none"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="px-2 py-0.5 rounded-full text-xs font-medium"
            style={{ backgroundColor: color + '22', color }}
          >
            {entity.type}
          </span>
          {entity.status && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-gray-800 text-gray-300">{entity.status}</span>
          )}
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">{entity.visibility}</span>
          <span className="text-xs text-gray-500 font-mono ml-auto">{entity.id.slice(0, 8)}</span>
        </div>

        {entity.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {entity.tags.map((t) => (
              <span key={t} className="px-2 py-0.5 rounded-full text-xs bg-gray-800 text-gray-300">
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="prose prose-sm prose-invert max-w-none text-sm text-gray-200 break-words">
          {entity.content ? (
            <ReactMarkdown>{entity.content}</ReactMarkdown>
          ) : (
            <span className="text-gray-600 italic">No content</span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={onOpenInGraph}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm"
          >
            Open in graph
          </button>
          {onOpenInSearch && (
            <button
              onClick={onOpenInSearch}
              className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm"
            >
              Open in search
            </button>
          )}
        </div>

        <div className="border-t border-gray-800 pt-3">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">
            Nearest in embedding space
          </p>
          {neighbours.length === 0 ? (
            <p className="text-xs text-gray-600 italic">None.</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {neighbours.map((id) => {
                const n = entities.get(id);
                const c = n
                  ? ENTITY_COLORS[n.type] ?? ENTITY_COLORS['default']!
                  : ENTITY_COLORS['default']!;
                return (
                  <button
                    key={id}
                    onClick={() => onNavigate(id)}
                    className="flex items-center gap-2 text-left px-2 py-1.5 rounded hover:bg-gray-800 transition-colors"
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c }} />
                    <span className="text-sm text-gray-300 truncate">
                      {n ? truncateLabel(n.content, n.id) : id.slice(0, 8)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

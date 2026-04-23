import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { ApiClient } from '../lib/api.ts';
import type { Edge, Entity } from '../lib/types.ts';
import { ENTITY_COLORS } from '../lib/nodeStyles.ts';
import { entityTitle } from '../lib/entityTitle.ts';
import EntityDetail from './EntityDetail.tsx';
import EdgeList from './EdgeList.tsx';
import type {
  KnnEntry,
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

export default function ProjectorPage({ api, onOpenInGraph, onOpenInSearch }: Props) {
  const [entities, setEntities] = useState<Map<string, Entity>>(new Map());
  const [positions, setPositions] = useState<Map<string, THREE.Vector3>>(new Map());
  const [knn, setKnn] = useState<Record<string, KnnEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<string>('Fetching entities…');
  const [error, setError] = useState<string | null>(null);
  const [algorithm, setAlgorithm] = useState<ProjectionAlgorithm>('umap');
  const [colourBy, setColourBy] = useState<ColourBy>('type');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const projectionCacheRef = useRef<
    Map<string, { positions: Map<string, THREE.Vector3>; knn: Record<string, KnnEntry[]> }>
  >(new Map());
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const pointsRef = useRef<PointRecord[]>([]);
  const sceneApiRef = useRef<{
    raycaster: THREE.Raycaster;
    camera: THREE.Camera;
    scene: THREE.Scene;
  } | null>(null);

  useEffect(() => {
    hoveredIdRef.current = hoveredId;
  }, [hoveredId]);

  // Tap-to-select: we wire the handlers natively at the wrapper (for pointerdown)
  // and at the window level (for pointerup), because OrbitControls calls
  // setPointerCapture on the canvas and React's synthetic onMouseUp on ancestor
  // divs doesn't fire reliably in Firefox-based browsers (e.g. Zen) or in
  // desktop layouts once the pointer has been captured.
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;

    let downState: { x: number; y: number; time: number } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return; // primary button only
      downState = { x: e.clientX, y: e.clientY, time: Date.now() };
    };

    const onUp = (e: PointerEvent) => {
      const ds = downState;
      downState = null;
      if (!ds) return;
      const dx = e.clientX - ds.x;
      const dy = e.clientY - ds.y;
      if (dx * dx + dy * dy > 36) return; // drag → ignore (6px tolerance)
      if (Date.now() - ds.time > 500) return; // long hold → ignore

      // Primary: the currently-hovered point (set by r3f's pointermove).
      const hovered = hoveredIdRef.current;
      if (hovered) {
        setSelectedId(hovered);
        return;
      }

      // Fallback: manual raycast from the release position. Handles cases
      // where the browser didn't fire onPointerOut→onPointerMove fast
      // enough (common in Firefox-based browsers after a drag-release).
      const api = sceneApiRef.current;
      if (!api) return;
      const rect = el.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        return; // release outside canvas
      }
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      api.raycaster.setFromCamera(ndc, api.camera);
      const hits = api.raycaster.intersectObject(api.scene, true);
      const pointHit = hits.find(
        (i) => i.object.type === 'Points' && typeof i.index === 'number',
      );
      if (pointHit && typeof pointHit.index === 'number') {
        const rec = pointsRef.current[pointHit.index];
        if (rec) setSelectedId(rec.id);
      }
    };

    const onCancel = () => {
      downState = null;
    };

    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, []);

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
          setLoadingStage(`Fetching entities (${all.length}/${res.total})…`);
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

      setLoadingStage(`Fetching embeddings (0/${entityIds.length})…`);
      try {
        const embeddingMap = new Map<string, number[]>();
        for (let i = 0; i < entityIds.length; i += EMBEDDING_BATCH) {
          const batch = entityIds.slice(i, i + EMBEDDING_BATCH);
          const res = await api.getEmbeddings(batch);
          if (cancelled) return;
          for (const e of res.embeddings) embeddingMap.set(e.id, e.embedding);
          setLoadingStage(
            `Fetching embeddings (${Math.min(i + EMBEDDING_BATCH, entityIds.length)}/${entityIds.length})…`,
          );
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

        const missing = entityIds.length - embeddings.length;
        setLoadingStage(
          missing > 0
            ? `Running ${algorithm.toUpperCase()} on ${embeddings.length} points (${missing} without embeddings skipped)…`
            : `Running ${algorithm.toUpperCase()} on ${embeddings.length} points…`,
        );

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
                  `Running ${algorithm.toUpperCase()} on ${embeddings.length} points — epoch ${msg.epoch}/${msg.epochs}…`,
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Esc closes the details sidebar first, then clears the selection.
      if (detailsOpen) setDetailsOpen(false);
      else setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailsOpen]);

  // Clearing the selection always closes the details panel too.
  useEffect(() => {
    if (!selectedId) setDetailsOpen(false);
  }, [selectedId]);

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

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

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

      {selectedId && selectedEntity && (
        <SelectionBar
          entity={selectedEntity}
          detailsOpen={detailsOpen}
          onToggleDetails={() => setDetailsOpen((v) => !v)}
          onClose={() => setSelectedId(null)}
        />
      )}

      <div className="flex-1 min-h-0 flex flex-row overflow-hidden relative">
        <div
          ref={canvasWrapRef}
          onMouseMove={(e) => {
            const rect = canvasWrapRef.current?.getBoundingClientRect();
            if (!rect) return;
            setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          }}
          onMouseLeave={() => {
            setCursor(null);
            setHoveredId(null);
          }}
          className="flex-1 min-w-0 min-h-0 relative"
        >
          <Canvas
            camera={{ position: [0, 0, 25], fov: 55 }}
            onCreated={({ raycaster }) => {
              // Default threshold is 1. We want a forgiving hit-radius so hover
              // feels natural; zoom-aware tuning happens each frame in RaycasterTuner.
              raycaster.params.Points = { threshold: 0.5 };
            }}
          >
            <color attach="background" args={['#030712']} />
            <ambientLight intensity={0.8} />
            <RaycasterTuner />
            <SceneBridge apiRef={sceneApiRef} />
            <PointCloud
              points={points}
              selectedId={selectedId}
              hoveredId={hoveredId}
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

          {hoveredEntity && hoveredId !== selectedId && cursor && (
            <HoverTooltip entity={hoveredEntity} cursor={cursor} />
          )}

          <Legend colourBy={colourBy} />
        </div>

        {selectedId && detailsOpen && (
          <aside className="w-full max-w-md md:w-[420px] md:max-w-none md:border-l md:border-gray-800 bg-gray-900 overflow-y-auto absolute md:static inset-y-0 right-0 z-20 md:z-auto shadow-xl md:shadow-none">
            <DetailPanel
              api={api}
              entity={selectedEntity}
              entityId={selectedId}
              position={positions.get(selectedId) ?? null}
              neighbours={selectedNeighbours}
              entities={entities}
              onClose={() => setDetailsOpen(false)}
              onNavigate={(id) => setSelectedId(id)}
              onOpenInGraph={() => onOpenInGraph(selectedId)}
              onOpenInSearch={
                onOpenInSearch ? () => onOpenInSearch(selectedId) : undefined
              }
              onUpdateEntity={(updated) => {
                setEntities((prev) => {
                  const next = new Map(prev);
                  next.set(updated.id, updated);
                  return next;
                });
              }}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

type SelectionBarProps = {
  entity: Entity;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onClose: () => void;
};

function SelectionBar({ entity, detailsOpen, onToggleDetails, onClose }: SelectionBarProps) {
  const color = ENTITY_COLORS[entity.type] ?? ENTITY_COLORS['default'] ?? '#9CA3AF';
  const title = entityTitle(entity, 120);
  return (
    <div className="shrink-0 border-b border-gray-800 bg-gray-900">
      <div className="max-w-6xl mx-auto w-full px-3 sm:px-6 py-2 flex items-center gap-3 text-sm">
        <span
          className="px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0"
          style={{ backgroundColor: color + '22', color }}
        >
          {entity.type}
        </span>
        <span className="text-gray-100 truncate flex-1 min-w-0" title={title}>{title}</span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onToggleDetails}
            aria-pressed={detailsOpen}
            className={`px-3 py-1 rounded-md text-xs border transition-colors ${
              detailsOpen
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700'
            }`}
          >
            {detailsOpen ? 'Hide details' : 'Details'}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Clear selection"
            title="Clear selection (Esc)"
            className="px-2 py-1 rounded-md text-gray-400 hover:text-white hover:bg-gray-800 text-lg leading-none"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}

type PointCloudProps = {
  points: PointRecord[];
  selectedId: string | null;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
};

function PointCloud({ points, selectedId, hoveredId, onHover }: PointCloudProps) {
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
  to: KnnEntry[];
  positions: Map<string, THREE.Vector3>;
}) {
  const fromPos = positions.get(from);
  if (!fromPos) return null;

  return (
    <>
      {to.map((entry) => {
        const pos = positions.get(entry.id);
        if (!pos) return null;
        const points = [fromPos, pos];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        // Stronger opacity for higher-similarity neighbours.
        const opacity = 0.15 + Math.max(0, entry.score) * 0.6;
        return (
          <primitive
            key={entry.id}
            object={new THREE.Line(
              geometry,
              new THREE.LineBasicMaterial({
                color: '#3B82F6',
                transparent: true,
                opacity,
              }),
            )}
          />
        );
      })}
    </>
  );
}

function HoverTooltip({
  entity,
  cursor,
}: {
  entity: Entity;
  cursor: { x: number; y: number };
}) {
  const title = entityTitle(entity);
  const color = ENTITY_COLORS[entity.type] ?? ENTITY_COLORS['default'] ?? '#9CA3AF';
  const updated = new Date(entity.updated_at).toLocaleDateString();

  return (
    <div
      className="pointer-events-none absolute z-10 bg-gray-900/95 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 shadow-lg max-w-sm"
      style={{
        left: cursor.x + 14,
        top: cursor.y + 14,
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="uppercase tracking-wider text-gray-400 text-[10px]">{entity.type}</span>
        {entity.status && (
          <span className="text-gray-500 text-[10px]">· {entity.status}</span>
        )}
        <span className="ml-auto text-gray-600 text-[10px]">{updated}</span>
      </div>
      <div className="text-sm text-white leading-snug line-clamp-2 break-words">{title}</div>
      {entity.tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {entity.tags.slice(0, 5).map((t) => (
            <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-gray-800 text-gray-400">
              {t}
            </span>
          ))}
          {entity.tags.length > 5 && (
            <span className="text-[10px] text-gray-500">+{entity.tags.length - 5}</span>
          )}
        </div>
      )}
    </div>
  );
}

// Exposes the three.js scene/camera/raycaster to the outer React component so
// it can run a manual raycast on tap (fallback when the hovered id is stale).
function SceneBridge({
  apiRef,
}: {
  apiRef: React.MutableRefObject<{
    raycaster: THREE.Raycaster;
    camera: THREE.Camera;
    scene: THREE.Scene;
  } | null>;
}) {
  const { raycaster, camera, scene } = useThree();
  useEffect(() => {
    apiRef.current = { raycaster, camera, scene };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, raycaster, camera, scene]);
  return null;
}

// Tunes the Points raycaster threshold to the current camera zoom so hovering
// stays responsive whether the user is zoomed in or out.
function RaycasterTuner() {
  const { raycaster, camera } = useThree();
  useFrame(() => {
    const distance = camera.position.length();
    // Empirical: at distance 25 we want ~0.6, scale linearly beyond that.
    const threshold = Math.max(0.25, Math.min(2.5, 0.025 * distance));
    raycaster.params.Points = { threshold };
  });
  return null;
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
  api: ApiClient;
  entity: Entity | null;
  entityId: string;
  position: THREE.Vector3 | null;
  neighbours: KnnEntry[];
  entities: Map<string, Entity>;
  onClose: () => void;
  onNavigate: (id: string) => void;
  onOpenInGraph: () => void;
  onOpenInSearch?: (() => void) | undefined;
  onUpdateEntity: (updated: Entity) => void;
};

function DetailPanel({
  api,
  entity,
  entityId,
  position,
  neighbours,
  entities,
  onClose,
  onNavigate,
  onOpenInGraph,
  onOpenInSearch,
  onUpdateEntity,
}: DetailPanelProps) {
  const [edges, setEdges] = useState<Edge[]>([]);
  const [edgesLoading, setEdgesLoading] = useState(false);
  const [edgesError, setEdgesError] = useState<string | null>(null);

  // Fetch edges for the current selection. We do NOT re-fetch the entity —
  // we trust the cached copy from the initial entity listing, so a failed
  // edges request can never block the viewer from rendering.
  useEffect(() => {
    if (!entityId) return;
    let cancelled = false;
    setEdgesLoading(true);
    setEdgesError(null);
    setEdges([]);
    api
      .listEdges(entityId)
      .then((res) => {
        if (!cancelled) setEdges(res.edges);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setEdgesError(err instanceof Error ? err.message : 'Failed to load edges');
        }
      })
      .finally(() => {
        if (!cancelled) setEdgesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, entityId]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0">
        <span className="text-xs text-gray-500 uppercase tracking-wide">Detail</span>
        <button
          onClick={onClose}
          aria-label="Close details"
          title="Close details"
          className="text-gray-500 hover:text-white text-lg leading-none"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
        {!entity ? (
          <div className="text-gray-500 text-sm">
            Entity {entityId.slice(0, 8)} not in current view.
          </div>
        ) : (
          <>
            <EntityDetail entity={entity} api={api} onUpdate={onUpdateEntity} />

            {position && (
              <div className="rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                  Projected position
                </p>
                <div className="grid grid-cols-3 gap-2 font-mono text-xs text-gray-300">
                  <div>
                    <span className="text-gray-500">x</span> {position.x.toFixed(2)}
                  </div>
                  <div>
                    <span className="text-gray-500">y</span> {position.y.toFixed(2)}
                  </div>
                  <div>
                    <span className="text-gray-500">z</span> {position.z.toFixed(2)}
                  </div>
                </div>
              </div>
            )}

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

            <div className="border-t border-gray-800 pt-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">
                Connections
              </p>
              {edgesLoading ? (
                <p className="text-xs text-gray-500">Loading…</p>
              ) : edgesError ? (
                <p className="text-xs text-red-400">{edgesError}</p>
              ) : (
                <EdgeList
                  edges={edges}
                  entityId={entity.id}
                  onNavigate={onNavigate}
                  getLabel={(id) => {
                    const n = entities.get(id);
                    return n ? entityTitle(n, 40) : id.slice(0, 8);
                  }}
                />
              )}
            </div>

            <div className="border-t border-gray-800 pt-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">
                Nearest in embedding space
              </p>
              {neighbours.length === 0 ? (
                <p className="text-xs text-gray-600 italic">None.</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {neighbours.map((entry) => {
                    const n = entities.get(entry.id);
                    const c = n
                      ? ENTITY_COLORS[n.type] ?? ENTITY_COLORS['default']!
                      : ENTITY_COLORS['default']!;
                    return (
                      <button
                        key={entry.id}
                        onClick={() => onNavigate(entry.id)}
                        className="flex items-center gap-2 text-left px-2 py-1.5 rounded hover:bg-gray-800 transition-colors"
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: c }}
                        />
                        <span className="text-sm text-gray-300 truncate flex-1">
                          {n ? entityTitle(n, 40) : entry.id.slice(0, 8)}
                        </span>
                        <span className="text-[11px] text-gray-500 tabular-nums">
                          {(entry.score * 100).toFixed(1)}%
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

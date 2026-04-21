/// <reference lib="webworker" />
import { UMAP } from 'umap-js';
import { PCA } from 'ml-pca';

export type ProjectionAlgorithm = 'umap' | 'pca';

export type ProjectionRequest = {
  ids: string[];
  embeddings: number[][];
  dim?: 2 | 3;
  algorithm?: ProjectionAlgorithm;
  params?: {
    nNeighbors?: number;
    minDist?: number;
  };
  knn?: number; // if >0, compute k-nearest neighbours in the original embedding space
};

export type ProjectionPosition = {
  id: string;
  coords: number[];
};

export type ProjectionResponse =
  | { type: 'progress'; epoch: number; epochs: number }
  | {
      type: 'result';
      positions: ProjectionPosition[];
      knn?: Record<string, string[]>;
    }
  | { type: 'error'; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function computeKnn(
  ids: string[],
  embeddings: number[][],
  k: number,
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (let i = 0; i < ids.length; i += 1) {
    const ei = embeddings[i];
    const currentId = ids[i];
    if (!ei || !currentId) continue;
    const scored: { id: string; score: number }[] = [];
    for (let j = 0; j < ids.length; j += 1) {
      if (i === j) continue;
      const ej = embeddings[j];
      const otherId = ids[j];
      if (!ej || !otherId) continue;
      scored.push({ id: otherId, score: cosineSimilarity(ei, ej) });
    }
    scored.sort((a, b) => b.score - a.score);
    map[currentId] = scored.slice(0, k).map((s) => s.id);
  }
  return map;
}

function runUmap(
  embeddings: number[][],
  dim: 2 | 3,
  params: ProjectionRequest['params'] = {},
): number[][] {
  const nNeighbors = Math.min(
    params.nNeighbors ?? 15,
    Math.max(2, embeddings.length - 1),
  );
  const umap = new UMAP({
    nComponents: dim,
    nNeighbors,
    minDist: params.minDist ?? 0.1,
  });
  const epochs = umap.initializeFit(embeddings);
  for (let i = 0; i < epochs; i += 1) {
    umap.step();
    if (i % 10 === 0 || i === epochs - 1) {
      const progress: ProjectionResponse = {
        type: 'progress',
        epoch: i + 1,
        epochs,
      };
      ctx.postMessage(progress);
    }
  }
  return umap.getEmbedding();
}

function runPca(embeddings: number[][], dim: 2 | 3): number[][] {
  const pca = new PCA(embeddings);
  const projected = pca.predict(embeddings, { nComponents: dim });
  return projected.to2DArray();
}

ctx.onmessage = (event: MessageEvent<ProjectionRequest>) => {
  const {
    ids,
    embeddings,
    dim = 2,
    algorithm = 'umap',
    params = {},
    knn = 0,
  } = event.data;

  if (ids.length !== embeddings.length) {
    const response: ProjectionResponse = {
      type: 'error',
      message: 'ids and embeddings length mismatch',
    };
    ctx.postMessage(response);
    return;
  }

  if (embeddings.length < 2) {
    const positions = ids.map<ProjectionPosition>((id) => ({
      id,
      coords: new Array(dim).fill(0),
    }));
    const response: ProjectionResponse = { type: 'result', positions };
    ctx.postMessage(response);
    return;
  }

  try {
    const result =
      algorithm === 'pca'
        ? runPca(embeddings, dim)
        : runUmap(embeddings, dim, params);

    const positions: ProjectionPosition[] = ids.map((id, i) => ({
      id,
      coords: result[i] ?? new Array(dim).fill(0),
    }));

    const response: ProjectionResponse = {
      type: 'result',
      positions,
      ...(knn > 0 ? { knn: computeKnn(ids, embeddings, knn) } : {}),
    };
    ctx.postMessage(response);
  } catch (error) {
    const response: ProjectionResponse = {
      type: 'error',
      message: error instanceof Error ? error.message : 'Projection failed',
    };
    ctx.postMessage(response);
  }
};

/// <reference lib="webworker" />
import { UMAP } from 'umap-js';

export type ProjectionRequest = {
  ids: string[];
  embeddings: number[][];
  dim?: 2 | 3;
  algorithm?: 'umap';
  params?: {
    nNeighbors?: number;
    minDist?: number;
  };
};

export type ProjectionPosition = {
  id: string;
  coords: number[];
};

export type ProjectionResponse =
  | { type: 'progress'; epoch: number; epochs: number }
  | { type: 'result'; positions: ProjectionPosition[] }
  | { type: 'error'; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<ProjectionRequest>) => {
  const { ids, embeddings, dim = 2, params = {} } = event.data;

  if (ids.length !== embeddings.length) {
    const response: ProjectionResponse = {
      type: 'error',
      message: 'ids and embeddings length mismatch',
    };
    ctx.postMessage(response);
    return;
  }

  if (embeddings.length < 2) {
    // UMAP requires at least 2 samples; fall back to origin placement.
    const positions = ids.map<ProjectionPosition>((id) => ({
      id,
      coords: new Array(dim).fill(0),
    }));
    const response: ProjectionResponse = { type: 'result', positions };
    ctx.postMessage(response);
    return;
  }

  try {
    // nNeighbors must be < n_samples; clamp to avoid crashes on small sets.
    const nNeighbors = Math.min(
      params.nNeighbors ?? 15,
      Math.max(2, embeddings.length - 1)
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

    const embedding = umap.getEmbedding();
    const positions: ProjectionPosition[] = ids.map((id, i) => ({
      id,
      coords: embedding[i] ?? new Array(dim).fill(0),
    }));

    const response: ProjectionResponse = { type: 'result', positions };
    ctx.postMessage(response);
  } catch (error) {
    const response: ProjectionResponse = {
      type: 'error',
      message: error instanceof Error ? error.message : 'Projection failed',
    };
    ctx.postMessage(response);
  }
};

import { useCallback, useEffect, useRef, useState } from 'react';

type Options = {
  initial: number;
  min: number;
  max: number;
  storageKey?: string;
  /** 'left' = handle is on the left edge (widens when dragged left) — used by right-side panels */
  direction: 'left' | 'right';
};

export function useResizable({ initial, min, max, storageKey, direction }: Options) {
  const [width, setWidth] = useState<number>(() => {
    if (storageKey && typeof window !== 'undefined') {
      const saved = Number(window.localStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved >= min && saved <= max) return saved;
    }
    return initial;
  });
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ x: number; width: number } | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startRef.current = { x: e.clientX, width };
    setDragging(true);
  }, [width]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const start = startRef.current;
      if (!start) return;
      const delta = e.clientX - start.x;
      const next = direction === 'right' ? start.width + delta : start.width - delta;
      const clamped = Math.max(min, Math.min(max, next));
      setWidth(clamped);
    };
    const onUp = () => {
      setDragging(false);
      startRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, direction, min, max]);

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey, String(width));
  }, [storageKey, width]);

  return { width, dragging, onMouseDown };
}

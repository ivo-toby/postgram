import { useEffect, useRef } from 'react';
import type Sigma from 'sigma';
import type Graph from 'graphology';

type Props = {
  sigmaRef: React.RefObject<Sigma | null>;
  graph: Graph;
};

const WIDTH = 160;
const HEIGHT = 120;
const PADDING = 8;

export default function GraphMinimap({ sigmaRef, graph }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;

    function draw() {
      const canvas = canvasRef.current;
      const sigma = sigmaRef.current;
      if (!canvas || !sigma) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, WIDTH, HEIGHT);

      // Background
      ctx.fillStyle = 'rgba(17, 24, 39, 0.88)';
      ctx.roundRect(0, 0, WIDTH, HEIGHT, 6);
      ctx.fill();

      // Compute bounding box of all visible node positions
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      graph.forEachNode((_, attrs) => {
        if (attrs['hidden']) return;
        const x = (attrs['x'] as number) ?? 0;
        const y = (attrs['y'] as number) ?? 0;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      });

      if (minX === Infinity) return; // no visible nodes

      const rangeX = maxX - minX || 1;
      const rangeY = maxY - minY || 1;
      const drawW = WIDTH - PADDING * 2;
      const drawH = HEIGHT - PADDING * 2;

      function toMinimap(x: number, y: number): [number, number] {
        return [
          PADDING + ((x - minX) / rangeX) * drawW,
          PADDING + ((y - minY) / rangeY) * drawH,
        ];
      }

      // Draw nodes
      graph.forEachNode((_, attrs) => {
        if (attrs['hidden']) return;
        const x = (attrs['x'] as number) ?? 0;
        const y = (attrs['y'] as number) ?? 0;
        const color = (attrs['color'] as string) ?? '#6B7280';
        const [mx, my] = toMinimap(x, y);
        ctx.beginPath();
        ctx.arc(mx, my, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      });

      // Draw viewport rectangle
      // Use sigma's viewport-to-graph conversion for the four corners
      const { width, height } = sigma.getDimensions();
      const corners = [
        sigma.viewportToGraph({ x: 0, y: 0 }),
        sigma.viewportToGraph({ x: width, y: 0 }),
        sigma.viewportToGraph({ x: width, y: height }),
        sigma.viewportToGraph({ x: 0, y: height }),
      ];
      const vMinX = Math.min(...corners.map(c => c.x));
      const vMinY = Math.min(...corners.map(c => c.y));
      const vMaxX = Math.max(...corners.map(c => c.x));
      const vMaxY = Math.max(...corners.map(c => c.y));

      const [rx1, ry1] = toMinimap(vMinX, vMinY);
      const [rx2, ry2] = toMinimap(vMaxX, vMaxY);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(rx1, ry1, rx2 - rx1, ry2 - ry1);
    }

    sigma.on('afterRender', draw);
    draw(); // initial draw

    return () => {
      sigma.off('afterRender', draw);
    };
  }, [sigmaRef, graph]);

  // Click/drag to navigate
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let dragging = false;

    function graphCoordsFromMinimap(mx: number, my: number) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      graph.forEachNode((_, attrs) => {
        if (attrs['hidden']) return;
        const x = (attrs['x'] as number) ?? 0;
        const y = (attrs['y'] as number) ?? 0;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      });
      if (minX === Infinity) return null;
      const rangeX = maxX - minX || 1;
      const rangeY = maxY - minY || 1;
      const drawW = WIDTH - PADDING * 2;
      const drawH = HEIGHT - PADDING * 2;
      return {
        x: minX + ((mx - PADDING) / drawW) * rangeX,
        y: minY + ((my - PADDING) / drawH) * rangeY,
      };
    }

    function navigate(e: MouseEvent) {
      const sigma = sigmaRef.current;
      if (!sigma) return;
      const rect = canvas!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const coords = graphCoordsFromMinimap(mx, my);
      if (!coords) return;
      sigma.getCamera().animate(
        { x: coords.x, y: coords.y },
        { duration: 150 }
      );
    }

    const onMouseDown = (e: MouseEvent) => { dragging = true; navigate(e); };
    const onMouseMove = (e: MouseEvent) => { if (dragging) navigate(e); };
    const onMouseUp = () => { dragging = false; };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [sigmaRef, graph]);

  return (
    <canvas
      ref={canvasRef}
      width={WIDTH}
      height={HEIGHT}
      className="absolute bottom-4 left-4 rounded-md cursor-crosshair"
      style={{ width: WIDTH, height: HEIGHT }}
    />
  );
}

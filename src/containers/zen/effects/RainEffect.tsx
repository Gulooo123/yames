import { useEffect, useRef } from "react";
import type { BeatEvent } from "../../../types";
import { getAccentColor, hexToRgb } from "./helpers";

interface RainDrop {
  x: number;
  y: number;
  speed: number;
  length: number;
  opacity: number;
  depth: number;
}

/**
 * Rain zen effect — 80 perspective-depth raindrops fall continuously.
 * Drops with higher depth values fall faster, are longer, and more opaque,
 * creating a parallax depth illusion. Each drop resets to the top once it
 * reaches its depth-proportional ground level, giving an endless rain loop.
 *
 * Purely ambient — no beat reactivity.
 */
export function RainEffect({ currentBeat: _currentBeat, isPlaying: _isPlaying }: { currentBeat: BeatEvent | null; isPlaying: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const dropsRef = useRef<RainDrop[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const initDrops = () => {
      dropsRef.current = Array.from({ length: 80 }, () => {
        const depth = Math.random();
        const ds = 0.3 + depth * 0.7;
        return {
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          speed: (3 + depth * 7) * ds,
          length: (12 + depth * 25) * ds,
          opacity: 0.1 + depth * 0.35,
          depth,
        };
      });
    };

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initDrops();
    };
    resize();
    window.addEventListener("resize", resize);

    const ANGLE = Math.sin(0.04); // subtle wind angle

    const animate = () => {
      const w = canvas.width;
      const h = canvas.height;
      const accent = getAccentColor();
      const { r, g, b } = hexToRgb(accent);
      // Lighten streaks slightly for visibility
      const rr = Math.min(255, r + (255 - r) * 0.3);
      const gg = Math.min(255, g + (255 - g) * 0.3);
      const bb = Math.min(255, b + (255 - b) * 0.3);

      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(0, 0, w, h);

      for (const d of dropsRef.current) {
        d.y += d.speed;
        if (d.y > h * (0.55 + d.depth * 0.4)) {
          d.y = -d.length;
          d.x = Math.random() * w;
        }
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + ANGLE * d.length, d.y - d.length);
        ctx.strokeStyle = `rgba(${rr}, ${gg}, ${bb}, ${d.opacity})`;
        ctx.lineWidth = 0.5 + d.depth * 1.2;
        ctx.stroke();
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" }}
    />
  );
}

import { useEffect, useRef } from "react";
import type { BeatEvent } from "../../../types";
import { getAccentColor, hexToRgb } from "./helpers";

interface Ring {
  r: number;
  a0: number;
  lineWidth: number;
}

/**
 * Pulse zen effect — concentric rings expand from the screen center.
 * An ambient ring spawns every 60 frames for continuous motion.
 * On each beat a heavier ring spawns (downbeats 4px, other beats 3px),
 * visually marking the rhythm while ambient rings fill the gaps.
 */
export function PulseEffect({ currentBeat, isPlaying }: { currentBeat: BeatEvent | null; isPlaying: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const ringsRef = useRef<Ring[]>([]);
  const tickRef = useRef(0);
  const prevBeatRef = useRef(-1);

  // Beat pulse — heavier ring on each beat
  useEffect(() => {
    if (!isPlaying || !currentBeat) return;
    if (currentBeat.beat === prevBeatRef.current) return;
    prevBeatRef.current = currentBeat.beat;
    ringsRef.current.push({
      r: 0,
      a0: currentBeat.isDownbeat ? 1.0 : 0.85,
      lineWidth: currentBeat.isDownbeat ? 4 : 3,
    });
  }, [currentBeat, isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const maxR = Math.hypot(Math.max(cx, canvas.width - cx), Math.max(cy, canvas.height - cy));
      ringsRef.current = Array.from({ length: 5 }, (_, i) => ({
        r: (i / 5) * maxR * 0.75,
        a0: 0.85,
        lineWidth: 1.5,
      }));
    };
    resize();
    window.addEventListener("resize", resize);

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const accent = getAccentColor();
      const { r, g, b } = hexToRgb(accent);

      const maxR = Math.hypot(Math.max(cx, canvas.width - cx), Math.max(cy, canvas.height - cy));

      tickRef.current++;
      if (tickRef.current % 55 === 0) {
        ringsRef.current.push({ r: 0, a0: 0.85, lineWidth: 1.5 });
      }

      const rings = ringsRef.current;
      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i];
        ring.r += 3.0;
        if (ring.r >= maxR) { rings.splice(i, 1); continue; }
        const alpha = ring.a0 * Math.pow(1 - ring.r / maxR, 1.5);
        ctx.beginPath();
        ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.lineWidth = ring.lineWidth;
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

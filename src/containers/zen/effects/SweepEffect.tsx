import { useEffect, useRef } from "react";
import type { BeatEvent } from "../../../types";
import { getAccentColor, hexToRgb } from "./helpers";

interface Dot {
  x: number;
  y: number;
  a: number; // current alpha (0 when unlit, decays after sweep)
}

/**
 * Sweep zen effect — a radar scan line rotates from center out to screen edges.
 * 50 scatter dots are placed randomly; each lights up (alpha 0.85) when the
 * sweep passes through it and then fades out over ~30 frames.
 *
 * Rotation speed scales with live BPM via a sqrt curve clamped to [0.5×, 1.75×]
 * so tempo changes feel responsive without becoming dizzying at high BPM.
 * Live BPM is derived from beat intervals with EMA smoothing.
 */
export function SweepEffect({ currentBeat, isPlaying, activeTab: _activeTab, beatsPerMeasure: _beatsPerMeasure }: { currentBeat: BeatEvent | null; isPlaying: boolean; activeTab: "beat" | "drill"; beatsPerMeasure: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const sweepAngleRef = useRef(0);
  const dotsRef = useRef<Dot[]>([]);
  const prevBeatRef = useRef(-1);
  const lastBeatTimeRef = useRef(0);
  const liveBpmRef = useRef(120);

  // BPM measurement via beat interval
  useEffect(() => {
    if (!isPlaying || !currentBeat) return;
    if (currentBeat.beat === prevBeatRef.current) return;
    prevBeatRef.current = currentBeat.beat;

    const now = performance.now();
    if (lastBeatTimeRef.current > 0) {
      const interval = now - lastBeatTimeRef.current;
      const bpm = 60000 / interval;
      liveBpmRef.current = liveBpmRef.current * 0.75 + bpm * 0.25;
    }
    lastBeatTimeRef.current = now;
  }, [currentBeat, isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const initDots = () => {
      dotsRef.current = Array.from({ length: 50 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        a: 0,
      }));
    };

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initDots();
    };
    resize();
    window.addEventListener("resize", resize);

    const BASE_INCREMENT = 0.018;

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const maxR = Math.sqrt(cx * cx + cy * cy);
      const accent = getAccentColor();
      const { r, g, b } = hexToRgb(accent);

      // sqrt-clamped speed multiplier
      const speedMult = Math.max(0.5, Math.min(1.75, Math.pow(liveBpmRef.current / 120, 0.5)));
      const inc = BASE_INCREMENT * speedMult;
      sweepAngleRef.current += inc;
      const sweepAngle = sweepAngleRef.current;

      // Radar wake — filled wedge fan fading from transparent (trailing edge)
      // to near-opaque (leading edge). 60 thin slices covers ~90 degrees.
      const wakeArc = Math.PI * 0.5; // 90-degree wake
      const slices = 60;
      for (let t = 0; t < slices; t++) {
        const frac = t / slices; // 0 = trailing edge, 1 = leading edge
        const a0 = sweepAngle - wakeArc + frac * wakeArc;
        const a1 = sweepAngle - wakeArc + (frac + 1 / slices) * wakeArc;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, maxR, a0, a1);
        ctx.closePath();
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.0045 * frac * frac})`;
        ctx.fill();
      }

      // Active scan line
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sweepAngle) * maxR, cy + Math.sin(sweepAngle) * maxR);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.55)`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Scatter dots — light up when swept, then fade
      for (const d of dotsRef.current) {
        const diff = ((sweepAngle - Math.atan2(d.y - cy, d.x - cx)) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        if (diff < 0.12) d.a = 0.85;
        d.a *= 0.96;
        if (d.a > 0.02) {
          ctx.beginPath();
          ctx.arc(d.x, d.y, 2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${d.a})`;
          ctx.fill();
        }
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

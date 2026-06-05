import { useEffect, useRef } from "react";
import type { BeatEvent } from "../../../types";
import { getAccentColor, hexToRgb } from "./helpers";

/**
 * Warp zen effect — concentric tilted squares rotate from center outward,
 * creating a spiral tunnel illusion.
 *
 * Rotation speed scales with live BPM via a sqrt curve clamped to [0.5×, 1.75×]
 * so high tempos (180–240 BPM) feel responsive without going dizzying.
 * BPM is derived by measuring the interval between beats with an exponential
 * moving average to smooth over tap-tempo jitter.
 */
export function WarpEffect({ currentBeat, isPlaying }: { currentBeat: BeatEvent | null; isPlaying: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const angleRef = useRef(0);
  const prevBeatRef = useRef(-1);
  const lastBeatTimeRef = useRef(0);
  const liveBpmRef = useRef(120);

  // Measure beat interval → derive live BPM with EMA smoothing
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

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const BASE_SPEED = 0.005;

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const accent = getAccentColor();
      const { r, g, b } = hexToRgb(accent);

      // sqrt-clamped multiplier: 180 BPM → 1.22×, 240 BPM → 1.41×
      const speedMult = Math.max(0.5, Math.min(1.75, Math.pow(liveBpmRef.current / 120, 0.5)));
      angleRef.current += BASE_SPEED * speedMult;

      const maxR = Math.sqrt(cx * cx + cy * cy) + 60;
      for (let rad = 50; rad < maxR; rad += 55) {
        const tilt = angleRef.current + (rad / maxR) * Math.PI * 0.5;
        ctx.beginPath();
        for (let i = 0; i <= 4; i++) {
          const a = (i / 4) * Math.PI * 2 + tilt;
          const x = cx + Math.cos(a) * rad;
          const y = cy + Math.sin(a) * rad;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.05 + 0.18 * (1 - rad / maxR)})`;
        ctx.lineWidth = 0.8;
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

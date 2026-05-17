import { useEffect, useRef } from "react";
import type { BeatEvent } from "../../../types";
import { getAccentColor, hexToRgb } from "./helpers";

/**
 * Clock-sweep zen effect. A radius line rotates around the center, one full
 * revolution per measure. On each beat we update the *target* angle to that
 * beat's position on the clock face and smoothly chase it with exponential
 * easing — this guarantees forward-only motion even across tempo changes.
 *
 * Glow intensity spikes on downbeats and decays each frame so accents look
 * percussive without breaking the smooth-rotation illusion.
 */
export function SweepEffect({ currentBeat, isPlaying, activeTab: _activeTab, beatsPerMeasure }: { currentBeat: BeatEvent | null; isPlaying: boolean; activeTab: "beat" | "drill"; beatsPerMeasure: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const prevBeatRef = useRef(-1);
  const angleRef = useRef(-Math.PI / 2);
  const targetAngleRef = useRef(-Math.PI / 2);
  const glowRef = useRef(0);

  useEffect(() => {
    if (!isPlaying || !currentBeat) return;
    if (currentBeat.beat === prevBeatRef.current) return;
    prevBeatRef.current = currentBeat.beat;

    // Always advance forward — compute the next target as the smallest forward step
    const beatInMeasure = currentBeat.beat % beatsPerMeasure;
    const beatAngle = -Math.PI / 2 + (beatInMeasure / beatsPerMeasure) * Math.PI * 2;

    // Normalize current target to find forward distance
    const currentNorm = targetAngleRef.current % (Math.PI * 2);
    let forwardDiff = beatAngle - currentNorm;
    // Ensure always moves forward (clockwise)
    if (forwardDiff <= 0.01) forwardDiff += Math.PI * 2;
    targetAngleRef.current += forwardDiff;

    glowRef.current = currentBeat.isDownbeat ? 1.0 : 0.5;
  }, [currentBeat, isPlaying, beatsPerMeasure]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const accent = getAccentColor();
      const { r, g, b } = hexToRgb(accent);
      const radius = Math.min(canvas.width, canvas.height) * 0.32;

      // Smooth interpolation — always forward
      angleRef.current += (targetAngleRef.current - angleRef.current) * 0.15;

      const angle = angleRef.current;
      const endX = cx + Math.cos(angle) * radius;
      const endY = cy + Math.sin(angle) * radius;

      // Trail arc
      const trailLength = Math.PI * 0.3;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, angle - trailLength, angle);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.1)`;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Main line
      const lineAlpha = 0.2 + glowRef.current * 0.4;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(endX, endY);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${lineAlpha})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Dot at end
      ctx.beginPath();
      ctx.arc(endX, endY, 3.5 + glowRef.current * 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.4 + glowRef.current * 0.5})`;
      ctx.fill();

      // Glow on accent
      if (glowRef.current > 0.05) {
        ctx.beginPath();
        ctx.arc(endX, endY, 12 + glowRef.current * 10, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${glowRef.current * 0.15})`;
        ctx.fill();
      }

      // Subtle circle outline
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.04)`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Beat markers
      for (let i = 0; i < beatsPerMeasure; i++) {
        const a = -Math.PI / 2 + (i / beatsPerMeasure) * Math.PI * 2;
        const mx = cx + Math.cos(a) * radius;
        const my = cy + Math.sin(a) * radius;
        ctx.beginPath();
        ctx.arc(mx, my, i === 0 ? 3 : 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${i === 0 ? 0.3 : 0.1})`;
        ctx.fill();
      }

      glowRef.current *= 0.92;
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener("resize", resize); };
  }, [beatsPerMeasure]);

  return <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" }} />;
}

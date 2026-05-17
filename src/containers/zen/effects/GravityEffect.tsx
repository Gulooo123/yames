import { useEffect, useRef } from "react";
import type { BeatEvent } from "../../../types";
import { getAccentColor, hexToRgb } from "./helpers";

/**
 * Gravity-drop zen effect. Drops fall from the top of the screen, timed so
 * each one lands exactly on its corresponding beat dot. On every downbeat
 * we (a) splash particles where the previous drop "landed" and (b) pre-spawn
 * the next drop with the right velocity so the next beat catches it mid-fall.
 *
 * Velocity is solved analytically: distance = vy·frames + ½·g·frames², so
 * vy = (distance − ½·g·f²)/f. We compute frames at 60fps based on the most
 * recently observed beat interval — tempo changes settle within one beat.
 */
export function GravityEffect({ currentBeat, isPlaying }: { currentBeat: BeatEvent | null; isPlaying: boolean; activeTab: "beat" | "drill" }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const prevBeatRef = useRef({ beat: -1, sub: -1 });
  const dropsRef = useRef<Array<{ x: number; y: number; vy: number; targetY: number; landed: boolean; isAccent: boolean }>>([]);
  const splashRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; alpha: number; size: number }>>([]);
  const lastBeatTimeRef = useRef(0);
  const beatIntervalRef = useRef(0); // ms between beats
  const firstBeatRef = useRef(true);

  useEffect(() => {
    if (!isPlaying || !currentBeat) return;
    if (currentBeat.beat === prevBeatRef.current.beat && currentBeat.subdivision === prevBeatRef.current.sub) return;
    prevBeatRef.current = { beat: currentBeat.beat, sub: currentBeat.subdivision };

    if (!currentBeat.isDownbeat) return;

    const now = performance.now();
    const dots = document.querySelectorAll(".fs-beat");
    if (!dots.length) return;
    const beatsPerMeasure = dots.length;
    const beatIdx = currentBeat.beat % beatsPerMeasure;

    // Measure beat interval
    if (lastBeatTimeRef.current > 0) {
      beatIntervalRef.current = now - lastBeatTimeRef.current;
    }
    lastBeatTimeRef.current = now;

    // On this beat: spawn immediate splash on current dot (the drop "arrived")
    // Skip splash on very first beat since no drop was pre-spawned
    if (!firstBeatRef.current) {
      const dot = dots[beatIdx] as HTMLElement;
      if (dot) {
        const rect = dot.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const isAccent = beatIdx === 0;
        const strength = isAccent ? 1.0 : 0.6;
        const count = isAccent ? 10 : 7;
        for (let i = 0; i < count; i++) {
          const angle = -Math.PI * (0.1 + Math.random() * 0.8);
          const speed = 2 + Math.random() * 4.5 * strength;
          splashRef.current.push({
            x: cx + (Math.random() - 0.5) * 6,
            y: cy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            alpha: 0.75 + Math.random() * 0.25,
            size: 2.5 + Math.random() * 3 * strength,
          });
        }
      }
    }
    firstBeatRef.current = false;

    // Pre-spawn drop for the NEXT beat — calculate velocity to arrive in one beat interval
    if (beatIntervalRef.current > 0) {
      const nextBeatIdx = (beatIdx + 1) % beatsPerMeasure;
      const nextDot = dots[nextBeatIdx] as HTMLElement;
      if (nextDot) {
        const rect = nextDot.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const targetY = rect.top + rect.height / 2;
        const startY = -20;
        const distance = targetY - startY;

        // Physics: distance = vy * frames + 0.5 * gravity * frames^2
        // Solve for vy: vy = (distance - 0.5 * g * f^2) / f
        const gravity = 0.4; // reduced gravity for longer graceful fall
        const frames = (beatIntervalRef.current / 1000) * 60; // convert ms to frames at 60fps
        const vy = (distance - 0.5 * gravity * frames * frames) / frames;

        dropsRef.current.push({
          x: cx,
          y: startY,
          vy: Math.max(vy, 1), // ensure positive initial velocity
          targetY,
          landed: false,
          isAccent: nextBeatIdx === 0,
        });
      }
    }
  }, [currentBeat, isPlaying]);

  // Reset on stop
  useEffect(() => {
    if (!isPlaying) {
      firstBeatRef.current = true;
      lastBeatTimeRef.current = 0;
      beatIntervalRef.current = 0;
      dropsRef.current = [];
      splashRef.current = [];
    }
  }, [isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);

    const gravity = 0.4; // must match the gravity used in velocity calc

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const accent = getAccentColor();
      const { r, g, b } = hexToRgb(accent);

      // Update and draw drops
      const aliveDrops: typeof dropsRef.current = [];
      for (const drop of dropsRef.current) {
        if (!drop.landed) {
          drop.vy += gravity;
          drop.y += drop.vy;

          if (drop.y >= drop.targetY) {
            drop.y = drop.targetY;
            drop.landed = true;
            // Splash is triggered by the beat event, not here
          } else {
            aliveDrops.push(drop);
          }

          // Draw falling drop
          if (!drop.landed) {
            const radius = drop.isAccent ? 8 : 6;
            ctx.beginPath();
            ctx.arc(drop.x, drop.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.85)`;
            ctx.fill();

            // Trail streak
            const trailLen = Math.min(drop.vy * 1.2, 30);
            const grad = ctx.createLinearGradient(drop.x, drop.y - trailLen, drop.x, drop.y);
            grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
            grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.4)`);
            ctx.beginPath();
            ctx.moveTo(drop.x - radius * 0.4, drop.y);
            ctx.lineTo(drop.x - radius * 0.2, drop.y - trailLen);
            ctx.lineTo(drop.x + radius * 0.2, drop.y - trailLen);
            ctx.lineTo(drop.x + radius * 0.4, drop.y);
            ctx.fillStyle = grad;
            ctx.fill();
          }
        }
      }
      dropsRef.current = aliveDrops;

      // Draw and update splash particles
      const aliveSplash: typeof splashRef.current = [];
      for (const sp of splashRef.current) {
        sp.x += sp.vx;
        sp.y += sp.vy;
        sp.vy += 0.2;
        sp.alpha *= 0.92;
        sp.size *= 0.96;

        if (sp.alpha > 0.02 && sp.size > 0.3) {
          aliveSplash.push(sp);
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${sp.alpha})`;
          ctx.fill();
        }
      }
      splashRef.current = aliveSplash;

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener("resize", resize); };
  }, []);

  return <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" }} />;
}

import { useEffect, useRef } from "react";
import type { BeatEvent } from "../../../types";

/**
 * Cosmos zen effect — a starfield of particles in three accent-derived hues
 * that drift with subtle Brownian motion. On each downbeat we trigger a
 * ripple ring around every particle; the ring fades exponentially over a
 * few frames. Mouse proximity boosts brightness within a 160px radius.
 *
 * Particle density is tied to viewport area (TARGET_DENSITY), so resizing
 * adds/removes particles instead of stretching the field — keeps the look
 * consistent between windowed and fullscreen.
 */
export function CosmosEffect({ currentBeat, isPlaying }: { currentBeat: BeatEvent | null; isPlaying: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -300, y: -300 });
  const particlesRef = useRef<Array<{
    x: number; y: number; vx: number; vy: number;
    size: number; opacity: number; hue: number;
    ripple: number; // 0-1, decays after accent
    depth: number; // 0 = far background, 1 = foreground
  }>>([]);
  const rafRef = useRef(0);
  const prevBeatRef = useRef(-1);

  useEffect(() => {
    if (!isPlaying || !currentBeat) return;
    if (!currentBeat.isDownbeat) return;
    if (currentBeat.beat === prevBeatRef.current) return;
    prevBeatRef.current = currentBeat.beat;
    for (const p of particlesRef.current) {
      p.ripple = 0.3 + Math.random() * 0.25;
    }
  }, [currentBeat, isPlaying]);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => { mouseRef.current = { x: e.clientX, y: e.clientY }; };
    const handleLeave = () => { mouseRef.current = { x: -300, y: -300 }; };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseleave", handleLeave);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseleave", handleLeave);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const getAccentHue = () => {
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      const hex = accent.replace("#", "");
      if (hex.length < 6) return 200;
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h = 0;
      if (max !== min) {
        const d = max - min;
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        else if (max === g) h = ((b - r) / d + 2) * 60;
        else h = ((r - g) / d + 4) * 60;
      }
      return Math.round(h);
    };

    const baseHue = getAccentHue();
    const hues = [baseHue, (baseHue + 30) % 360, (baseHue + 330) % 360];

    const makeParticle = (xRange: [number, number], yRange: [number, number]) => ({
      x: xRange[0] + Math.random() * (xRange[1] - xRange[0]),
      y: yRange[0] + Math.random() * (yRange[1] - yRange[0]),
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      size: Math.random() * 4 + 1.5,
      opacity: Math.random() * 0.45 + 0.1,
      hue: hues[Math.floor(Math.random() * hues.length)],
      ripple: 0,
      depth: Math.random(), // 0 = far background, 1 = foreground
    });

    const TARGET_DENSITY = 65 / (window.innerWidth * window.innerHeight); // particles per px²

    const resize = () => {
      const prevW = canvas.width;
      const prevH = canvas.height;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      const targetCount = Math.round(canvas.width * canvas.height * TARGET_DENSITY);

      if (particlesRef.current.length < targetCount) {
        // Spawn particles in newly exposed area
        const count = targetCount - particlesRef.current.length;
        for (let i = 0; i < count; i++) {
          if (canvas.width > prevW && Math.random() < 0.5) {
            particlesRef.current.push(makeParticle([prevW, canvas.width], [0, canvas.height]));
          } else {
            particlesRef.current.push(makeParticle([0, canvas.width], [prevH, canvas.height]));
          }
        }
      } else if (particlesRef.current.length > targetCount) {
        // Remove excess particles when shrinking (e.g. exiting fullscreen)
        particlesRef.current.length = targetCount;
      }
    };
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    window.addEventListener("resize", resize);

    particlesRef.current = Array.from({ length: 65 }, () =>
      makeParticle([0, canvas.width], [0, canvas.height])
    );

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const { x: mx, y: my } = mouseRef.current;

      // Particles with accent ripples
      for (const p of particlesRef.current) {
        const depthScale = 0.25 + p.depth * 0.75; // 0.25–1.0
        p.x += p.vx * depthScale;
        p.y += p.vy * depthScale;
        if (p.x < -10) p.x = canvas.width + 10;
        if (p.x > canvas.width + 10) p.x = -10;
        if (p.y < -10) p.y = canvas.height + 10;
        if (p.y > canvas.height + 10) p.y = -10;
        p.vx += (Math.random() - 0.5) * 0.008;
        p.vy += (Math.random() - 0.5) * 0.008;
        p.vx = Math.max(-0.35, Math.min(0.35, p.vx));
        p.vy = Math.max(-0.35, Math.min(0.35, p.vy));

        const dx = p.x - mx;
        const dy = p.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const boost = dist < 160 ? (1 - dist / 160) * 0.5 * depthScale : 0;
        const alpha = Math.min(1, (p.opacity * depthScale) + boost);

        // Core particle
        const beatPulse = p.ripple > 0.02 ? p.ripple : 0;
        const beatLight = 65 + beatPulse * 10;
        const alpha2 = Math.min(1, alpha + beatPulse * 0.15);
        const drawSize = (p.size * depthScale) + boost * 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, drawSize, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 80%, ${beatLight}%, ${alpha2})`;
        ctx.fill();

        // Soft glow
        if (alpha2 > 0.25) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, drawSize * 3 + boost * 3, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${p.hue}, 80%, ${beatLight}%, ${alpha2 * 0.12})`;
          ctx.fill();
        }

        // Accent ripple ring around particle
        if (p.ripple > 0.02) {
          const rippleRadius = drawSize + (12 * depthScale * (1 - p.ripple));
          ctx.beginPath();
          ctx.arc(p.x, p.y, rippleRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${p.hue}, 80%, 65%, ${p.ripple * 0.3 * depthScale})`;
          ctx.lineWidth = 0.7 * depthScale;
          ctx.stroke();
          p.ripple *= 0.91;
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
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        mixBlendMode: "screen",
      }}
    />
  );
}

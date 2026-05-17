import { useEffect, useRef } from "react";
import type { BeatEvent } from "../../../types";
import { getAccentColor, hexToRgb } from "./helpers";

interface Portal {
  z: number;
  sides: number; // 3=triangle, 4=square, 5=pentagon, 6=hexagon, 0=circle
  rotation: number;
  offsetX: number;
  offsetY: number;
  hueShift: number;
  size: number;
  isDownbeat: boolean;
}

/**
 * Warp / portal-tunnel zen effect. Each downbeat spawns a polygon "portal"
 * at the current camera-look offset; portals fly toward the viewer with
 * a focal-length perspective projection (screen ∝ focalLength/z) while
 * the camera wanders in slow layered sine waves.
 *
 * `speedRef` pulses up to 2.5× on each beat and eases back to 1.0, which
 * also drives the radial speed-line bursts when motion is fast enough.
 * Portals sort back-to-front each frame so closer ones cover farther ones.
 */
export function WarpEffect({ currentBeat, isPlaying }: { currentBeat: BeatEvent | null; isPlaying: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const portalsRef = useRef<Portal[]>([]);
  const prevBeatRef = useRef(-1);
  const timeRef = useRef(0);
  const speedRef = useRef(1);
  const wanderRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!isPlaying || !currentBeat) return;
    if (currentBeat.beat === prevBeatRef.current && currentBeat.subdivision === (currentBeat as any).prevSub) return;
    prevBeatRef.current = currentBeat.beat;

    if (!currentBeat.isDownbeat) return;

    // Spawn portal on beat
    const shapes = [0, 3, 4, 5, 6, 8]; // circle, triangle, square, pentagon, hexagon, octagon
    const sides = shapes[Math.floor(Math.random() * shapes.length)];
    const wander = wanderRef.current;

    // Portal spawns at current camera look direction + small random offset for variety
    portalsRef.current.push({
      z: 800,
      sides,
      rotation: Math.random() * Math.PI * 2,
      offsetX: wander.x + (Math.random() - 0.5) * 0.15,
      offsetY: wander.y + (Math.random() - 0.5) * 0.1,
      hueShift: Math.random() * 40 - 20,
      size: currentBeat.isDownbeat ? 1.3 : 1.0,
      isDownbeat: true,
    });

    // Speed pulse on beat
    speedRef.current = 2.5;
  }, [currentBeat, isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);

    const focalLength = 300;

    const drawPolygon = (cx: number, cy: number, radius: number, sides: number, rotation: number) => {
      if (sides === 0) {
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        return;
      }
      for (let i = 0; i < sides; i++) {
        const angle = rotation + (Math.PI * 2 * i) / sides - Math.PI / 2;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      timeRef.current++;

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const accent = getAccentColor();
      const { r, g, b } = hexToRgb(accent);

      // Ease speed back to base
      speedRef.current += (1 - speedRef.current) * 0.03;
      const speed = speedRef.current;

      // Continuous winding path — layered sine waves for organic movement
      const t = timeRef.current;
      const wanderX = Math.sin(t * 0.003) * 0.6 + Math.sin(t * 0.0071) * 0.3 + Math.cos(t * 0.0023) * 0.2;
      const wanderY = Math.cos(t * 0.004) * 0.4 + Math.sin(t * 0.0059) * 0.25 + Math.cos(t * 0.0017) * 0.15;
      wanderRef.current = { x: wanderX, y: wanderY };

      // Only animate when playing
      if (!isPlaying) {
        // Clear remaining portals and show empty canvas
        if (portalsRef.current.length > 0) portalsRef.current = [];
        rafRef.current = requestAnimationFrame(animate);
        return;
      }

      // Update and draw portals (back to front for depth order)
      const portals = portalsRef.current;
      portals.sort((a, b) => b.z - a.z);

      for (let i = portals.length - 1; i >= 0; i--) {
        const p = portals[i];
        p.z -= 4 * speed;
        p.rotation += 0.003;

        if (p.z <= 1) {
          portals.splice(i, 1);
          continue;
        }

        const scale = focalLength / p.z;
        // Camera wanders — portal screen position = (portal world offset - current camera offset) * perspective
        const cameraX = wanderX;
        const cameraY = wanderY;
        const screenX = cx + (p.offsetX - cameraX) * focalLength * scale * 1.5;
        const screenY = cy + (p.offsetY - cameraY) * focalLength * scale * 1.5;
        const baseRadius = 180 * p.size;
        const radius = baseRadius * scale;

        // Opacity: faint in distance, bright close, fade out at very close
        let alpha: number;
        if (p.z > 600) {
          alpha = ((800 - p.z) / 200) * 0.4;
        } else if (p.z < 50) {
          alpha = (p.z / 50) * 0.8;
        } else {
          alpha = 0.15 + (1 - p.z / 600) * 0.65;
        }

        // Hue shift based on depth
        const depthHue = p.hueShift + (1 - p.z / 800) * 15;
        const rr = Math.min(255, Math.max(0, r + depthHue));
        const gg = Math.min(255, Math.max(0, g + depthHue * 0.5));
        const bb = Math.min(255, Math.max(0, b - depthHue * 0.3));

        // Outer glow layer
        if (p.z < 400) {
          ctx.beginPath();
          drawPolygon(screenX, screenY, radius * 1.15, p.sides, p.rotation);
          ctx.strokeStyle = `rgba(${rr}, ${gg}, ${bb}, ${alpha * 0.15})`;
          ctx.lineWidth = radius * 0.08;
          ctx.stroke();
        }

        // Main portal ring
        ctx.beginPath();
        drawPolygon(screenX, screenY, radius, p.sides, p.rotation);
        ctx.strokeStyle = `rgba(${rr}, ${gg}, ${bb}, ${alpha})`;
        ctx.lineWidth = Math.max(1, 2.5 * scale * (p.isDownbeat ? 1.5 : 1));
        ctx.stroke();

        // Inner edge highlight
        if (p.z < 300) {
          ctx.beginPath();
          drawPolygon(screenX, screenY, radius * 0.92, p.sides, p.rotation + 0.02);
          ctx.strokeStyle = `rgba(${rr}, ${gg}, ${bb}, ${alpha * 0.3})`;
          ctx.lineWidth = Math.max(0.5, 1 * scale);
          ctx.stroke();
        }
      }

      // Subtle center vanishing point glow
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, 60);
      gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.06)`);
      gradient.addColorStop(1, "transparent");
      ctx.fillStyle = gradient;
      ctx.fillRect(cx - 60, cy - 60, 120, 120);

      // Speed lines near edges when moving fast
      if (speed > 1.3) {
        const lineAlpha = (speed - 1.3) * 0.3;
        const lineCount = 8;
        for (let i = 0; i < lineCount; i++) {
          const angle = (Math.PI * 2 * i) / lineCount + timeRef.current * 0.01;
          const innerR = 150 + Math.random() * 50;
          const outerR = innerR + 80 + (speed - 1) * 100;
          const x1 = cx + Math.cos(angle) * innerR;
          const y1 = cy + Math.sin(angle) * innerR;
          const x2 = cx + Math.cos(angle) * outerR;
          const y2 = cy + Math.sin(angle) * outerR;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${lineAlpha * 0.3})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener("resize", resize); };
  }, [isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}

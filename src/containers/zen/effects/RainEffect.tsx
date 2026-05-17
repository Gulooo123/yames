import { useEffect, useRef } from "react";
import type { BeatEvent } from "../../../types";
import { getAccentColor, hexToRgb } from "./helpers";

interface RainDrop {
  x: number;       // screen x
  y: number;       // current y position
  speed: number;   // fall speed (faster = closer)
  length: number;  // streak length
  opacity: number;
  depth: number;   // 0 = far, 1 = close (controls size, speed, landing y)
}

interface Splash {
  x: number;
  y: number;
  age: number;
  maxAge: number;
  depth: number;   // affects splash size
  rings: number;
}

/**
 * Rain zen effect with perspective ground plane. Drops have a `depth`
 * value in [0,1] (0=far/horizon, 1=close/bottom) that scales their speed,
 * size, opacity, and the y-coordinate at which they "land". On landing
 * a drop spawns a splash with concentric elliptical rings (y-squished for
 * perspective) and on close drops, a few upward droplet particles.
 *
 * On each beat we briefly boost spawn rate (intensityRef) and emit
 * scattered ground splashes — extra count on downbeats.
 */
export function RainEffect({ currentBeat, isPlaying }: { currentBeat: BeatEvent | null; isPlaying: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const dropsRef = useRef<RainDrop[]>([]);
  const splashesRef = useRef<Splash[]>([]);
  const prevBeatRef = useRef(-1);
  const intensityRef = useRef(1);
  const beatSplashRef = useRef(false);

  // Beat pulse — briefly increase rain intensity + trigger ground splashes
  useEffect(() => {
    if (!isPlaying || !currentBeat) return;
    if (currentBeat.beat === prevBeatRef.current) return;
    prevBeatRef.current = currentBeat.beat;
    intensityRef.current = currentBeat.isDownbeat ? 3.5 : 2.0;
    beatSplashRef.current = true; // signal to spawn beat splashes on next frame
  }, [currentBeat, isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);

    // Ground plane: the "floor" is a perspective plane from ~60% to 95% of screen height
    // Far horizon at 60%, close ground at 95%
    const getGroundY = (depth: number, h: number) => {
      // depth 0 = far (horizon), depth 1 = close (bottom)
      return h * (0.55 + depth * 0.4);
    };

    const spawnDrop = (w: number, h: number): RainDrop => {
      const depth = Math.random(); // 0=far, 1=close
      const depthScale = 0.3 + depth * 0.7; // far drops are smaller/slower
      return {
        x: Math.random() * w,
        y: -Math.random() * h * 0.4, // start above screen
        speed: (3 + depth * 8) * depthScale,
        length: (10 + depth * 28) * depthScale,
        opacity: (0.15 + depth * 0.4),
        depth,
      };
    };

    const spawnSplash = (x: number, y: number, depth: number): Splash => ({
      x, y,
      age: 0,
      maxAge: 20 + depth * 15,
      depth,
      rings: depth > 0.6 ? 3 : 2,
    });

    // Pre-populate drops
    for (let i = 0; i < 60; i++) {
      const d = spawnDrop(canvas.width, canvas.height);
      d.y = Math.random() * canvas.height; // scatter initial positions
      dropsRef.current.push(d);
    }

    const animate = () => {
      const w = canvas.width;
      const h = canvas.height;

      // Semi-transparent clear for subtle trail effect
      ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
      ctx.fillRect(0, 0, w, h);

      const accent = getAccentColor();
      const { r, g, b } = hexToRgb(accent);

      // Ease intensity back to baseline
      intensityRef.current += (1 - intensityRef.current) * 0.04;
      const intensity = intensityRef.current;

      // Beat splash — spawn several ground splashes on beat hit
      if (beatSplashRef.current) {
        beatSplashRef.current = false;
        const numSplashes = intensity > 2.5 ? 8 : 5; // more on downbeat
        for (let i = 0; i < numSplashes; i++) {
          const depth = 0.3 + Math.random() * 0.7;
          const x = Math.random() * w;
          const y = getGroundY(depth, h);
          splashesRef.current.push({
            x, y,
            age: 0,
            maxAge: 25 + depth * 20,
            depth,
            rings: 3,
          });
        }
      }

      // Spawn new drops based on intensity
      const spawnRate = Math.floor(1.5 * intensity);
      if (isPlaying) {
        for (let i = 0; i < spawnRate; i++) {
          if (dropsRef.current.length < 120) {
            dropsRef.current.push(spawnDrop(w, h));
          }
        }
      }

      // Update and draw drops
      const drops = dropsRef.current;
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.y += d.speed;

        // Ground level for this drop's depth
        const groundY = getGroundY(d.depth, h);

        // Has it hit the ground?
        if (d.y >= groundY) {
          // Spawn splash at ground level
          splashesRef.current.push(spawnSplash(d.x, groundY, d.depth));

          if (isPlaying) {
            // Reset drop
            d.y = -Math.random() * 50;
            d.x = Math.random() * w;
            const newDepth = Math.random();
            const depthScale = 0.3 + newDepth * 0.7;
            d.depth = newDepth;
            d.speed = (3 + newDepth * 8) * depthScale;
            d.length = (10 + newDepth * 28) * depthScale;
            d.opacity = (0.15 + newDepth * 0.4);
          } else {
            drops.splice(i, 1);
          }
          continue;
        }

        // Draw rain streak — slight angle for realism
        const angle = 0.03 + d.depth * 0.02; // very slight wind
        const x2 = d.x + Math.sin(angle) * d.length;
        const y2 = d.y - d.length;

        // Color: use accent color directly, lighten for visibility
        const whiten = (1 - d.depth) * 0.3; // far drops slightly whiter
        const rr = Math.min(255, r + (255 - r) * (0.3 + whiten));
        const gg = Math.min(255, g + (255 - g) * (0.3 + whiten));
        const bb = Math.min(255, b + (255 - b) * (0.3 + whiten));

        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = `rgba(${rr}, ${gg}, ${bb}, ${d.opacity})`;
        ctx.lineWidth = 0.5 + d.depth * 1.2;
        ctx.stroke();
      }

      // Update and draw splashes
      const splashes = splashesRef.current;
      for (let i = splashes.length - 1; i >= 0; i--) {
        const s = splashes[i];
        s.age++;

        if (s.age > s.maxAge) {
          splashes.splice(i, 1);
          continue;
        }

        const progress = s.age / s.maxAge;
        const fadeAlpha = 1 - progress;
        const scale = 0.4 + s.depth * 0.6; // far splashes are smaller

        // Draw expanding ripple rings
        for (let ring = 0; ring < s.rings; ring++) {
          const ringDelay = ring * 0.2;
          const ringProgress = Math.max(0, progress - ringDelay) / (1 - ringDelay);
          if (ringProgress <= 0 || ringProgress >= 1) continue;

          const maxRadius = (8 + s.depth * 18) * scale;
          const radius = ringProgress * maxRadius;
          const ringAlpha = (1 - ringProgress) * fadeAlpha * 0.6;

          // Elliptical splash — squished vertically for perspective
          const ySquish = 0.3 + (1 - s.depth) * 0.2; // far splashes more squished

          ctx.beginPath();
          ctx.ellipse(s.x, s.y, radius, radius * ySquish, 0, 0, Math.PI * 2);
          const sr = Math.min(255, r + (255 - r) * 0.4);
          const sg = Math.min(255, g + (255 - g) * 0.4);
          const sb = Math.min(255, b + (255 - b) * 0.4);
          ctx.strokeStyle = `rgba(${sr}, ${sg}, ${sb}, ${ringAlpha})`;
          ctx.lineWidth = (1.5 - ringProgress) * scale;
          ctx.stroke();
        }

        // Small upward droplet particles on impact (close drops only)
        if (s.depth > 0.5 && s.age < 6) {
          const numDroplets = 2 + Math.floor(s.depth * 3);
          for (let d = 0; d < numDroplets; d++) {
            const dropAngle = (Math.PI * 2 * d) / numDroplets + s.x * 0.1;
            const dropDist = s.age * (1.5 + s.depth);
            const dropX = s.x + Math.cos(dropAngle) * dropDist * scale;
            const dropY = s.y - Math.abs(Math.sin(dropAngle)) * dropDist * 1.5 * scale + s.age * 0.3; // gravity
            const dropAlpha = (1 - s.age / 6) * 0.5;

            ctx.beginPath();
            ctx.arc(dropX, dropY, 0.8 * scale, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(180, 200, 230, ${dropAlpha})`;
            ctx.fill();
          }
        }
      }

      // Subtle ground mist/reflection near bottom
      const mistGradient = ctx.createLinearGradient(0, h * 0.85, 0, h);
      mistGradient.addColorStop(0, "transparent");
      mistGradient.addColorStop(1, `rgba(${r * 0.3 + 50}, ${g * 0.3 + 60}, ${b * 0.2 + 80}, 0.03)`);
      ctx.fillStyle = mistGradient;
      ctx.fillRect(0, h * 0.85, w, h * 0.15);

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

import { useCallback, useEffect, useRef, useState } from "react";
import { useTapTempo } from "../../../hooks/useTapTempo";
import type { BeatEvent } from "../../../types";

/**
 * Owns the two short visual "pulse" states used by the floating play
 * button and the tap-tempo button in the header:
 *
 *   - `isPulsing` — flashes briefly on every downbeat while playback is
 *                   active and the user has the `buttonFlash` preference
 *                   enabled. Used by `FloatingPlayButton`.
 *   - `tapPulse`  — flashes briefly each time the user presses the tap-
 *                   tempo control. Used by `MainHeader` for visual feedback
 *                   on the tap button.
 *   - `handleTap` — the click handler that the tap-tempo button binds to.
 *                   Triggers the underlying `useTapTempo` callback and the
 *                   pulse animation in one go. The double-flip
 *                   (false → rAF → true) is intentional: it lets the CSS
 *                   transition restart even when taps fire faster than the
 *                   180/300 ms timeout windows.
 *   - `tapCount`  — exposed so the header can show "1 of N" while the user
 *                   is mid-tap (cleared by the tap-tempo hook on timeout).
 *   - `tapActive` — true while the tap-tempo capture window is open.
 *
 * Both timers are cleared on unmount; the downbeat effect intentionally
 * keys on `currentBeat` (not `isDownbeat`) so subsequent downbeats — which
 * share the same `isDownbeat=true` value — still re-trigger the effect.
 */

export interface UseDownbeatPulseArgs {
  buttonFlash: boolean;
  isPlaying: boolean;
  currentBeat: BeatEvent | null;
  onBpmDetected: (bpm: number) => void;
}

export interface DownbeatPulse {
  isPulsing: boolean;
  tapPulse: boolean;
  handleTap: () => void;
  tapCount: number;
  tapActive: boolean;
}

export function useDownbeatPulse({
  buttonFlash,
  isPlaying,
  currentBeat,
  onBpmDetected,
}: UseDownbeatPulseArgs): DownbeatPulse {
  const isDownbeat = currentBeat?.isDownbeat ?? false;

  // Downbeat pulse — auto-triggered by the metronome.
  const [isPulsing, setIsPulsing] = useState(false);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (buttonFlash && isDownbeat && isPlaying) {
      setIsPulsing(true);
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => setIsPulsing(false), 180);
    }
  }, [currentBeat, buttonFlash, isDownbeat, isPlaying]);

  // Tap-tempo pulse — triggered by user input.
  const { tap: tapTempo, tapCount, isActive: tapActive } = useTapTempo(
    onBpmDetected,
  );
  const [tapPulse, setTapPulse] = useState(false);
  const tapPulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTap = useCallback(() => {
    tapTempo();
    setTapPulse(false);
    requestAnimationFrame(() => {
      setTapPulse(true);
      if (tapPulseTimer.current) clearTimeout(tapPulseTimer.current);
      tapPulseTimer.current = setTimeout(() => setTapPulse(false), 300);
    });
  }, [tapTempo]);

  return { isPulsing, tapPulse, handleTap, tapCount, tapActive };
}

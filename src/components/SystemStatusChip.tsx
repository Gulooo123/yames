/** Contextual status chip rendered above the coach chat input.
 *
 * Shows the most relevant system state so the user always knows what
 * the coach is doing without cluttering the feed.  Priority order
 * (highest wins):
 *   1. coachLoading  → "Thinking…"
 *   2. ttsActive     → "Speaking…"
 *   3. isPlaying + noodling  → "Noodling"
 *   4. isPlaying + structured / unknown  → "Detecting 16ths" (or relevant subdivision), fallback "Playing"
 *   5. listening (session active, not playing) → "Listening…"
 *   6. nothing  → renders null
 */
export interface SystemStatusChipProps {
  /** Whether a coach session is currently active. */
  active: boolean;
  /** True while the metronome is running. */
  isPlaying?: boolean;
  /** True while the onset detector is sampling audio. */
  listening?: boolean;
  /** Derived play style from onset_efficiency (Step 5). */
  playMode?: "structured" | "noodling";
  /** True while the LLM response is streaming. */
  coachLoading?: boolean;
  /** True while TTS audio is being played back. */
  ttsActive?: boolean;
  /** Locked rhythm-inference divisor (1/2/3/4/6) from Path B. When set,
   *  the "playing" state shows "Detecting quarters/8ths/triplets/16ths/sextuplets"
   *  instead of the generic "Playing" fallback. Only pass when locked === true. */
  inferredDivisor?: number;
}

type ChipVariant = "listening" | "playing" | "noodling" | "thinking" | "speaking";

function resolveVariant(props: SystemStatusChipProps): ChipVariant | null {
  const { active, isPlaying, listening, playMode, coachLoading, ttsActive } =
    props;
  if (!active) return null;
  if (coachLoading) return "thinking";
  if (ttsActive) return "speaking";
  if (isPlaying) return playMode === "noodling" ? "noodling" : "playing";
  if (listening) return "listening";
  return null;
}

const CHIP_LABEL: Record<ChipVariant, string> = {
  listening: "Listening…",
  playing: "Playing",
  noodling: "Noodling",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

/** Map a locked rhythm-inference divisor to a "Detecting X" label.
 *  Returns null for unrecognised divisors so the caller can fall back
 *  to the generic "Playing" label. */
function playingLabel(divisor?: number): string {
  switch (divisor) {
    case 1: return "Detecting quarters";
    case 2: return "Detecting 8ths";
    case 3: return "Detecting triplets";
    case 4: return "Detecting 16ths";
    case 6: return "Detecting sextuplets";
    default: return CHIP_LABEL.playing;
  }
}

/** Minimal dot indicator that pulses for active states. */
function StatusDot({ variant }: { variant: ChipVariant }) {
  const pulse = variant === "listening" || variant === "thinking" || variant === "speaking";
  return (
    <span
      className={`system-status-chip-dot ${pulse ? "pulse" : ""} ${variant}`}
    />
  );
}

export function SystemStatusChip(props: SystemStatusChipProps) {
  const variant = resolveVariant(props);
  if (!variant) return null;

  const label =
    variant === "playing"
      ? playingLabel(props.inferredDivisor)
      : CHIP_LABEL[variant];

  return (
    <div className={`system-status-chip ${variant}`}>
      <StatusDot variant={variant} />
      <span className="system-status-chip-label">{label}</span>
    </div>
  );
}

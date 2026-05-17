/**
 * Phase 5 — Intervention Catalog
 *
 * Interventions are the coach-emitted twin of chips: instead of the
 * **user** tapping a question, the **coach** proactively suggests a
 * specific change AND offers a one-tap affordance to act on it. The
 * canonical example, taken straight from the plan:
 *
 *   Trigger:    sustained score < 70% for ≥16 beats AND bpm >= 100
 *   Spoken:     "You're at 150 and struggling a bit — want to drop to 140?"
 *   Written:    same text + structured affordance
 *   Affordance: [Drop to 140 BPM]  [Stay at 150]
 *
 * The plan §"Initial 10" lists ten intervention types. Five ship in v1
 * and the rest are deferred until upstream infrastructure lands:
 *
 *   1. BPM drop          ✅ on `accuracy_drop` with sustained low score
 *   2. BPM bump          ✅ on `personal_best_streak` / `tempo_milestone`
 *   3. Subdivision       ⏸  deferred until ACCENT_PATTERN_PLAN lands
 *   4. Click placement   ⏸  needs accent-pattern infrastructure
 *   5. Rest              ✅ on `fatigue` after ≥12 min session
 *   6. Calibration retry ✅ on `low_confidence`
 *   7. Instrument switch ⏸  first-launch only; covered by onboarding modal
 *   8. Section isolation ⏸  needs segment-isolation DSP hook
 *   9. Tempo isolation   ⏸  needs segment-isolation DSP hook
 *  10. Posture reset     ✅ on `fatigue` after ≥25 min, ≥4 segments
 *
 * Intervention design rules (per plan §"Intervention design rules"):
 *
 *   - Grounded in metric, never generic. Trigger MUST reference a measurable.
 *   - Reversible. Every intervention has a one-tap undo (handled in UI).
 *   - Cooldown after declined intervention: ≥90s for the same intervention type.
 *   - Hard cap: max 2 interventions per 5-minute window.
 *   - Always crosses TTS threshold.
 *
 * This module exposes:
 *   - The `Intervention` / `InterventionId` / `InterventionAction` types.
 *   - A catalog of five v1 interventions (see ✅ above).
 *   - `pickIntervention(event, ctx, state) → SelectedIntervention | null`
 *     — pure function that returns an intervention if (a) a matching
 *     entry exists for the gatekeeper event AND (b) the rate cap +
 *     per-id cooldown both pass.
 *   - `recordIntervention(state, id, now) → state` — book-keeping after
 *     an intervention is dispatched. The session hook owns the state.
 *
 * The rate cap state is intentionally in-memory (per-session) — a
 * five-minute window doesn't need persistence and surviving a
 * session-end actively confuses the next session's pacing.
 */

import { fillTemplate } from "./templates";
import type { GatekeeperEvent } from "./gatekeeper";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InterventionId =
  | "bpm-drop"
  | "bpm-bump"
  | "rest"
  | "calibration-retry"
  | "posture-reset";

/**
 * The action the UI dispatches when the user accepts the affordance.
 * Mirrors the chip-affordance shape so a single handler can serve both
 * surfaces in `useSession.ts`.
 */
export type InterventionAction =
  | { kind: "set-bpm"; bpmDelta: number }
  | { kind: "take-break"; durationMs: number }
  | { kind: "clear-calibration" };

export interface Intervention {
  id: InterventionId;
  /**
   * Hard predicate — does this intervention apply at all to this event?
   * Run AFTER the gatekeeper has already decided to emit something; the
   * intervention layer never fabricates a new event, it only attaches
   * an affordance to an existing one.
   */
  qualifies: (event: GatekeeperEvent, ctx: InterventionContext) => boolean;
  /**
   * Template for the spoken/written copy. Filled with the same
   * placeholder dictionary as chips so the same vocabulary works.
   * The intervention sentence REPLACES the gatekeeper's default
   * template only when the intervention fires; otherwise the
   * gatekeeper's template still ships unchanged.
   */
  template: string;
  /** Per-intervention cooldown in ms (declined or accepted; the rate
   *  cap is shared across all interventions). */
  cooldownMs: number;
  /** Resolved into the affordance button by the UI. */
  action: InterventionAction;
  /** Label template for the affordance button. */
  actionLabel: string;
  /** Label for the implicit "Stay at X" dismiss button. The UI renders
   *  this as a secondary affordance. */
  dismissLabel: string;
}

export interface InterventionContext {
  bpm: number;
  /** Most-recent segment score (0–100). */
  score: number;
  /** Average score across this session's segments. Used by `rest`. */
  sessionAvgScore?: number;
  /** Session duration so far in ms. */
  sessionDurationMs: number;
  /** Number of segments completed this session. */
  segmentsCompleted: number;
}

/**
 * Rate-limit state. Track timestamps of interventions in the last 5
 * minutes (hard cap = 2) and per-id last-fired timestamps for cooldowns.
 * Persisted only in-memory inside `useSession.ts`.
 */
export interface InterventionRateState {
  /** Timestamps (ms epoch) of all interventions in the current 5-min window. */
  recentTimestamps: number[];
  /** Last-fired timestamp per intervention id. */
  lastFiredById: Map<InterventionId, number>;
}

export interface SelectedIntervention {
  intervention: Intervention;
  /** Resolved sentence — already filled with placeholders. */
  text: string;
  /** Resolved affordance label — already filled with placeholders. */
  actionLabel: string;
  /** Action to dispatch on accept. */
  action: InterventionAction;
  /** Dismiss button label. */
  dismissLabel: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard cap on interventions per 5-minute window. */
export const INTERVENTION_RATE_CAP = 2;
/** Window size for the rate cap. */
export const INTERVENTION_WINDOW_MS = 5 * 60 * 1000;
/** Minimum BPM at which BPM-drop fires. Below this, dropping further
 *  isn't useful — the user is already at "go slow" territory. */
export const BPM_DROP_MIN_BPM = 100;
/** Maximum BPM at which BPM-bump fires. Above this, we don't push. */
export const BPM_BUMP_MAX_BPM = 180;
/** Sustained-low-score threshold for BPM-drop. */
export const BPM_DROP_SCORE_CEILING = 70;
/** High-score floor for BPM-bump. */
export const BPM_BUMP_SCORE_FLOOR = 90;
/** Session duration (ms) before `rest` qualifies. */
export const REST_MIN_SESSION_MS = 12 * 60 * 1000;
/** Session duration (ms) before `posture-reset` qualifies. Stricter than
 *  `rest` because it's a more intrusive ask (60s vs 30s). */
export const POSTURE_MIN_SESSION_MS = 25 * 60 * 1000;
/** Minimum number of segments completed before `posture-reset` qualifies.
 *  Prevents triggering on a single long warm-up segment. */
export const POSTURE_MIN_SEGMENTS = 4;

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const INTERVENTION_CATALOG: readonly Intervention[] = Object.freeze([
  {
    id: "bpm-drop",
    qualifies: (event, ctx) =>
      event.scenario === "accuracy_drop" &&
      ctx.score < BPM_DROP_SCORE_CEILING &&
      ctx.bpm >= BPM_DROP_MIN_BPM,
    template:
      "You're at {bpm} and struggling a bit — want to drop to {newBpm}?",
    cooldownMs: 90_000,
    action: { kind: "set-bpm", bpmDelta: -10 },
    actionLabel: "Drop to {newBpm} BPM",
    dismissLabel: "Stay at {bpm}",
  },
  {
    id: "bpm-bump",
    qualifies: (event, ctx) =>
      (event.scenario === "personal_best_streak" ||
        event.scenario === "tempo_milestone" ||
        event.scenario === "new_band_locked") &&
      ctx.score >= BPM_BUMP_SCORE_FLOOR &&
      ctx.bpm < BPM_BUMP_MAX_BPM,
    template: "Locked at {bpm} ({score}%). Try {newBpm}?",
    cooldownMs: 90_000,
    action: { kind: "set-bpm", bpmDelta: 10 },
    actionLabel: "Bump to {newBpm} BPM",
    dismissLabel: "Stay at {bpm}",
  },
  {
    // Plan §"Initial 10" #10 — Posture/breath reset on a long session
    // with declining accuracy. Distinct from `rest` (30s pause) in:
    //   - tighter trigger (≥25 min session, ≥4 segments completed)
    //   - longer break (60s vs 30s)
    //   - coachier copy targeted at body/breath rather than fatigue
    // The shared rate cap still limits "one of {rest, posture-reset}
    // per 5 min" — they don't double-fire.
    //
    // Listed BEFORE `rest` in the catalog so the stricter variant wins
    // when both qualify; `rest` falls through to medium-long sessions.
    id: "posture-reset",
    qualifies: (event, ctx) =>
      event.scenario === "fatigue" &&
      ctx.sessionDurationMs >= POSTURE_MIN_SESSION_MS &&
      ctx.segmentsCompleted >= POSTURE_MIN_SEGMENTS,
    template:
      "{minutes} minutes in — stand up, drop your shoulders, breathe for a minute?",
    cooldownMs: 10 * 60_000,
    action: { kind: "take-break", durationMs: 60_000 },
    actionLabel: "Start 60s reset",
    dismissLabel: "Push through",
  },
  {
    id: "rest",
    qualifies: (event, ctx) =>
      event.scenario === "fatigue" &&
      ctx.sessionDurationMs >= REST_MIN_SESSION_MS,
    template: "{minutes} minutes in — pause for 30 seconds?",
    cooldownMs: 5 * 60_000,
    action: { kind: "take-break", durationMs: 30_000 },
    actionLabel: "Start 30s rest",
    dismissLabel: "Keep going",
  },
  {
    // Plan §"Initial 10" #6 — Calibration retry on low confidence.
    // Fires only when the DSP timing analyzer surfaces a sustained
    // low-confidence event (calibration buffer hasn't converged after a
    // reasonable runway). One-tap action clears the per-instrument
    // cache entry; the UI re-seeds the analyzer on the next session
    // start, forcing a fresh learn from real onsets.
    id: "calibration-retry",
    qualifies: (event) => event.scenario === "low_confidence",
    template:
      "Timing data looks unsteady — want me to forget the cached offset and re-learn it from scratch?",
    cooldownMs: 10 * 60_000,
    action: { kind: "clear-calibration" },
    actionLabel: "Recalibrate",
    dismissLabel: "Not now",
  },
]);

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------

/** Initial / empty rate state. */
export function createInterventionState(): InterventionRateState {
  return {
    recentTimestamps: [],
    lastFiredById: new Map(),
  };
}

/**
 * Walk the catalog and return the first intervention that:
 *   1. Qualifies against the (event, ctx) pair, AND
 *   2. Passes the per-id cooldown (last fired ≥ cooldownMs ago), AND
 *   3. Passes the global rate cap (≤2 in the last 5 min).
 *
 * Returns null when no intervention fits. The caller is expected to
 * fall back to the gatekeeper's default rendering in that case (the
 * intervention layer is strictly additive — it never blocks the
 * underlying coach utterance).
 *
 * NOTE: this function does NOT update the rate state. Updating state
 * is `recordIntervention(...)`'s job and the caller decides when to
 * commit — e.g. after the affordance has actually been rendered into
 * the feed (not at decision time, in case the render fails).
 */
export function pickIntervention(
  event: GatekeeperEvent,
  ctx: InterventionContext,
  state: InterventionRateState,
  now: number,
): SelectedIntervention | null {
  // 3. Global rate cap.
  const windowStart = now - INTERVENTION_WINDOW_MS;
  const recent = state.recentTimestamps.filter((t) => t >= windowStart);
  if (recent.length >= INTERVENTION_RATE_CAP) return null;

  for (const intervention of INTERVENTION_CATALOG) {
    if (!intervention.qualifies(event, ctx)) continue;

    // 2. Per-id cooldown.
    const lastFired = state.lastFiredById.get(intervention.id) ?? 0;
    if (now - lastFired < intervention.cooldownMs) continue;

    // 1. Qualified + within cooldown — build the resolved view.
    const placeholders = buildInterventionPlaceholders(intervention, ctx);
    const text = fillTemplate(intervention.template, placeholders);
    const actionLabel = fillTemplate(intervention.actionLabel, placeholders);
    const dismissLabel = fillTemplate(intervention.dismissLabel, placeholders);
    return {
      intervention,
      text,
      actionLabel,
      action: intervention.action,
      dismissLabel,
    };
  }

  return null;
}

/**
 * Commit an intervention to the rate state. Call this immediately
 * AFTER the affordance has been rendered into the feed. The function
 * returns a fresh state (immutable update) — the caller stores it.
 *
 * The trimmed `recentTimestamps` list keeps the array bounded by
 * filtering out anything outside the window before appending. This
 * means the array length is ≤ `INTERVENTION_RATE_CAP + 1` at any time.
 */
export function recordIntervention(
  state: InterventionRateState,
  id: InterventionId,
  now: number,
): InterventionRateState {
  const windowStart = now - INTERVENTION_WINDOW_MS;
  const recentTimestamps = [
    ...state.recentTimestamps.filter((t) => t >= windowStart),
    now,
  ];
  const lastFiredById = new Map(state.lastFiredById);
  lastFiredById.set(id, now);
  return { recentTimestamps, lastFiredById };
}

// ---------------------------------------------------------------------------
// Placeholder construction (kept centralized so adding a new field is
// a single-edit operation, mirroring `buildChipPlaceholders`).
// ---------------------------------------------------------------------------

export function buildInterventionPlaceholders(
  intervention: Intervention,
  ctx: InterventionContext,
): Record<string, string | number> {
  const out: Record<string, string | number> = {
    bpm: ctx.bpm,
    score: ctx.score,
  };

  if (intervention.action.kind === "set-bpm") {
    out.newBpm = Math.max(
      20,
      Math.min(300, ctx.bpm + intervention.action.bpmDelta),
    );
  }

  if (intervention.id === "rest") {
    out.minutes = Math.floor(ctx.sessionDurationMs / 60_000);
  }

  return out;
}

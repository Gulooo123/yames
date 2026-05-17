/**
 * C4 — Smart Coaching Timing (Heuristic Gatekeeper).
 *
 * The "architectural heart" of the coach: a cheap, deterministic
 * state machine that runs every N beats and decides:
 *
 *   1. Is a comment warranted right now?
 *   2. If so, what scenario tag is it?
 *   3. Which channel (spoken or written) gets it?
 *
 * The gatekeeper is the WHEN. C5 templates + LLM paraphrasing
 * decide WHAT.
 *
 * Design constraints from the plan:
 *
 *   - **Pure state.** No React, no Tauri. Immutable state in, new
 *     state out. Trivially unit-testable.
 *   - **Per-channel cooldowns.** Spoken cooldown:
 *     `min(60s, max(20s, sinceStart × 0.1))`. Written cooldown:
 *     `min(10s, max(3s, sinceStart × 0.05))`. Channels are
 *     independent — written can run hot while spoken stays quiet.
 *   - **Always-speak overrides.** Milestones, boundary events
 *     (Signal A / Signal B), and interventions bypass the spoken
 *     cooldown. Streak suppression mid-segment also exempts these.
 *   - **Streak suppression mid-segment only.** While accuracy ≥ 85%
 *     for ≥ 16 beats, suppress *spoken* events (writes still flow)
 *     EXCEPT the always-speak overrides above.
 *   - **Adaptive cooldown floor.** 5 minutes of continuous active
 *     play without a spoken event → low-priority `check_in` event.
 *   - **Drill staleness.** Comments tagged with a BPM are dropped if
 *     the current BPM has moved by > 5 since the comment was generated.
 *   - **User-typed reset.** When the user types in chat, all
 *     cooldowns reset (engagement signal).
 */

import type { BeatFeedback } from "../types";

// ---------------------------------------------------------------------------
// Constants — exposed for tests and tuning.
// ---------------------------------------------------------------------------

/** Hard floor on spoken-channel cooldown. */
export const SPOKEN_COOLDOWN_FLOOR_MS = 20_000;
/** Hard ceiling on spoken-channel cooldown. */
export const SPOKEN_COOLDOWN_CEILING_MS = 60_000;

/** Hard floor on written-channel cooldown. */
export const WRITTEN_COOLDOWN_FLOOR_MS = 3_000;
/** Hard ceiling on written-channel cooldown. */
export const WRITTEN_COOLDOWN_CEILING_MS = 10_000;

/** Adaptive cooldown floor: spoken silence that triggers `check_in`. */
export const CHECK_IN_AFTER_QUIET_MS = 5 * 60 * 1000;

/** Drill staleness: drop tagged comment if BPM moved by more than this. */
export const DRILL_STALENESS_BPM = 5;

/**
 * Streak suppression: when last-N beats hit rate ≥ this and length
 * ≥ STREAK_MIN_LEN, spoken comments are suppressed unless the
 * scenario is an always-speak override.
 */
export const STREAK_SUPPRESSION_HIT_RATE = 0.85;
export const STREAK_SUPPRESSION_MIN_LEN = 16;

/** Accuracy-drop trigger thresholds. */
export const ACCURACY_DROP_DELTA = 0.20;
export const ACCURACY_DROP_WINDOW = 16;
/**
 * Minimum number of attempted (hits + miss) beats required in BOTH
 * the prior and recent windows before `detectAccuracyDrop` will fire.
 *
 * Without this floor a single ticked-but-not-played bar (window full
 * of `skipped` classifications) read as 0% accuracy, which paired
 * with a hot prior window tripped the 20% delta and emitted a
 * "Rough patch at 0% — ease the tempo down…" tip seconds into the
 * session. Half-window is enough to compute a statistically
 * meaningful rate without demanding the player attempts every tick.
 */
export const ACCURACY_DROP_MIN_SCORED = ACCURACY_DROP_WINDOW / 2;

/** Rushing/dragging trend thresholds. */
export const TREND_OFFSET_THRESHOLD_MS = 5;
export const TREND_PRIOR_NEUTRAL_MS = 2;
export const TREND_CONFIRMATION_REQUIRED = 2;

/** Personal-best streak: min beats AND must beat session best. */
export const STREAK_PERSONAL_BEST_MIN = 8;

/** New-band-locked: sustained accuracy ≥ this for at least this long. */
export const NEW_BAND_ACCURACY = 0.85;
export const NEW_BAND_DURATION_MS = 60_000;

/**
 * First-N-beats hard rule from the plan's "Hard gatekeeper rules for
 * TTS": "No TTS during the first 4 beats of any segment (let the
 * player settle in)." Spoken events fired while the segment is fresh
 * are demoted to the written channel so they still land in the feed
 * — just silently.
 *
 * Signal A (user-initiated settings change) is exempt: it's the
 * acknowledgement of the player's own input, suppressing it would
 * undermine the "always has something to say" principle.
 */
export const FIRST_BEATS_TTS_FLOOR = 4;

/**
 * Low-confidence caveat thresholds (one-shot per session, per plan
 * OQ5 + C4 events table): "If D2 mean confidence < 0.5 for 30s,
 * coach mentions unclear signal."
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;
export const LOW_CONFIDENCE_SUSTAIN_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScenarioTag =
  | "accuracy_drop"
  | "personal_best_streak"
  | "rushing_trend"
  | "dragging_trend"
  | "recovery"
  | "fatigue"
  | "tempo_milestone"
  | "new_band_locked"
  | "low_confidence"
  | "check_in"
  | "boundary_signal_a"
  | "boundary_signal_b";

export type Tier = "spoken" | "written";

export type GatekeeperEvent = {
  scenario: ScenarioTag;
  tier: Tier;
  /**
   * Structured context for the content layer (C5 templates +
   * optional LLM paraphrase). The keys are scenario-specific but
   * always JSON-serializable for telemetry.
   */
  context: Record<string, number | string | boolean>;
  /**
   * BPM at the moment the event was generated. Used by
   * `shouldDropForStaleness` so drill-ramp comments don't land
   * stale ("rushing at 130" landing at 145).
   */
  taggedBpm: number;
};

/**
 * Persistent state across evaluation calls. Treat as immutable —
 * every `evaluate(...)` returns a new state. Keep the shape flat
 * to keep React-friendly equality cheap.
 */
export type GatekeeperState = {
  sessionStartMs: number;
  /** Wall-clock ms of last spoken event (any scenario). */
  lastSpokenMs: number;
  /** Wall-clock ms of last written event (any scenario). */
  lastWrittenMs: number;
  /** Per-scenario last-fire times for per-scenario cooldowns. */
  lastEventMs: Partial<Record<ScenarioTag, number>>;
  /**
   * Rolling confirmations of pending trend scenarios. Trends require
   * two consecutive confirmations before escalating to spoken.
   */
  trendConfirmations: { rushing: number; dragging: number };
  /** Best clean-streak the gatekeeper has seen this session. */
  bestStreak: number;
  /** Latest BPM band low ("locked-in" band detection). */
  lockedBpmLow: number | null;
  /** When current band was first observed continuously at ≥ 85%. */
  bandLockedSinceMs: number | null;
  /**
   * Wall-clock ms when mean confidence first dropped below
   * `LOW_CONFIDENCE_THRESHOLD`. Cleared when confidence recovers. The
   * caveat fires once when this has been set for ≥ 30s; subsequent
   * dips don't re-fire (one-shot per session).
   */
  lowConfidenceSinceMs: number | null;
};

export type GatekeeperContext = {
  /** Wall-clock now (ms). */
  now: number;
  /** Current BPM at evaluation time. */
  bpm: number;
  /** Sliding window of recent BeatFeedback. Newest LAST. */
  window: BeatFeedback[];
  /** Whether the user is currently in a streak-suppression state. */
  inStreak?: boolean;
  /**
   * Number of beats elapsed since the current segment started.
   * Resets on Signal A (settings change) and Signal B (activity gap
   * → new segment). Used to enforce the "no TTS in first 4 beats"
   * hard rule from the plan. When omitted, the rule is bypassed —
   * useful for tests and historical compatibility.
   */
  beatsInSegment?: number;
  /**
   * If the caller has a strong reason to FORCE a scenario (boundary
   * events from Signal A / B), pass it here. Forced events bypass
   * the cooldown and streak suppression.
   */
  force?: { scenario: ScenarioTag; context: Record<string, number | string | boolean> };
};

// ---------------------------------------------------------------------------
// Cooldown math
// ---------------------------------------------------------------------------

/**
 * Cooldown duration for the spoken channel, given elapsed session
 * time. Formula:
 *     min(60s, max(20s, sinceStart × 0.1))
 *
 * Short sessions stay at the 20s floor; long sessions climb toward
 * the 60s ceiling so the coach doesn't natter once the user is
 * settled in.
 */
export function spokenCooldownMs(sinceSessionStartMs: number): number {
  const scaled = sinceSessionStartMs * 0.1;
  return Math.min(
    SPOKEN_COOLDOWN_CEILING_MS,
    Math.max(SPOKEN_COOLDOWN_FLOOR_MS, scaled),
  );
}

/**
 * Cooldown duration for the written channel. Same shape, shorter
 * envelope — written notes can run hot.
 */
export function writtenCooldownMs(sinceSessionStartMs: number): number {
  const scaled = sinceSessionStartMs * 0.05;
  return Math.min(
    WRITTEN_COOLDOWN_CEILING_MS,
    Math.max(WRITTEN_COOLDOWN_FLOOR_MS, scaled),
  );
}

/**
 * Drill staleness check. Comments referencing a specific BPM are
 * stale if the current BPM has drifted by more than
 * `DRILL_STALENESS_BPM` since the comment was tagged.
 */
export function shouldDropForStaleness(
  taggedBpm: number | undefined,
  currentBpm: number,
): boolean {
  if (taggedBpm === undefined) return false;
  return Math.abs(currentBpm - taggedBpm) > DRILL_STALENESS_BPM;
}

// ---------------------------------------------------------------------------
// Construction + reset
// ---------------------------------------------------------------------------

export function createGatekeeper(sessionStartMs: number): GatekeeperState {
  return {
    sessionStartMs,
    lastSpokenMs: sessionStartMs,
    lastWrittenMs: sessionStartMs,
    lastEventMs: {},
    trendConfirmations: { rushing: 0, dragging: 0 },
    bestStreak: 0,
    lockedBpmLow: null,
    bandLockedSinceMs: null,
    lowConfidenceSinceMs: null,
  };
}

/**
 * Reset cooldowns. Called when the user types in chat — engagement
 * signal that says "keep talking, I'm listening." Trend confirmations
 * and best-streak knowledge stick around.
 */
export function resetCooldowns(
  state: GatekeeperState,
  now: number,
): GatekeeperState {
  return {
    ...state,
    lastSpokenMs: now - SPOKEN_COOLDOWN_FLOOR_MS,
    lastWrittenMs: now - WRITTEN_COOLDOWN_FLOOR_MS,
  };
}

// ---------------------------------------------------------------------------
// Always-speak override matrix
// ---------------------------------------------------------------------------

const ALWAYS_SPOKEN: ReadonlySet<ScenarioTag> = new Set([
  "personal_best_streak",
  "boundary_signal_a",
  "boundary_signal_b",
  "tempo_milestone",
  "recovery",
  "fatigue",
  "new_band_locked",
]);

export function isAlwaysSpoken(scenario: ScenarioTag): boolean {
  return ALWAYS_SPOKEN.has(scenario);
}

/**
 * Scenarios exempt from the first-4-beats hard rule. Signal A is the
 * only exemption: a settings-change boundary IS the player's own
 * action being acknowledged, so suppressing it would feel broken
 * ("I changed BPM and the coach said nothing").
 */
const FIRST_BEATS_RULE_EXEMPT: ReadonlySet<ScenarioTag> = new Set([
  "boundary_signal_a",
]);

export function isFirstBeatsExempt(scenario: ScenarioTag): boolean {
  return FIRST_BEATS_RULE_EXEMPT.has(scenario);
}

// ---------------------------------------------------------------------------
// Cooldown gates
// ---------------------------------------------------------------------------

function passesSpokenCooldown(
  state: GatekeeperState,
  scenario: ScenarioTag,
  now: number,
): boolean {
  if (isAlwaysSpoken(scenario)) return true;
  const elapsed = now - state.sessionStartMs;
  const required = spokenCooldownMs(elapsed);
  return now - state.lastSpokenMs >= required;
}

function passesWrittenCooldown(state: GatekeeperState, now: number): boolean {
  const elapsed = now - state.sessionStartMs;
  const required = writtenCooldownMs(elapsed);
  return now - state.lastWrittenMs >= required;
}

// ---------------------------------------------------------------------------
// Scenario detectors
// ---------------------------------------------------------------------------

type Detection = {
  scenario: ScenarioTag;
  tier: Tier;
  context: Record<string, number | string | boolean>;
  /**
   * If true, the detector also wants to update gatekeeper state in a
   * scenario-specific way (e.g. trend confirmations). Returned via
   * `partialState` so the public `evaluate` stays the single
   * write-point.
   */
  partialState?: Partial<GatekeeperState>;
};

function detectAccuracyDrop(
  window: BeatFeedback[],
): Detection | null {
  if (window.length < ACCURACY_DROP_WINDOW * 2) return null;
  const recent = window.slice(-ACCURACY_DROP_WINDOW);
  const prior = window.slice(-ACCURACY_DROP_WINDOW * 2, -ACCURACY_DROP_WINDOW);
  // Require a minimum number of ATTEMPTED beats in both halves before
  // we trust the rate comparison. Otherwise a quiet pause (window full
  // of `skipped`) reads as a 0% recent rate and the detector fires a
  // bogus accuracy-drop tip — see ACCURACY_DROP_MIN_SCORED docstring.
  if (scoredCount(recent) < ACCURACY_DROP_MIN_SCORED) return null;
  if (scoredCount(prior) < ACCURACY_DROP_MIN_SCORED) return null;
  const recentRate = hitRate(recent);
  const priorRate = hitRate(prior);
  if (priorRate - recentRate < ACCURACY_DROP_DELTA) return null;
  return {
    scenario: "accuracy_drop",
    tier: "spoken",
    context: {
      priorAccuracyPct: Math.round(priorRate * 100),
      recentAccuracyPct: Math.round(recentRate * 100),
      windowBeats: ACCURACY_DROP_WINDOW,
    },
  };
}

function detectPersonalBestStreak(
  state: GatekeeperState,
  window: BeatFeedback[],
): Detection | null {
  const streak = trailingCleanStreak(window);
  if (streak < STREAK_PERSONAL_BEST_MIN) return null;
  if (streak <= state.bestStreak) return null;
  return {
    scenario: "personal_best_streak",
    tier: "spoken",
    context: {
      streak,
      previousBest: state.bestStreak,
    },
    partialState: { bestStreak: streak },
  };
}

function detectTrend(
  state: GatekeeperState,
  window: BeatFeedback[],
): Detection | null {
  if (window.length < ACCURACY_DROP_WINDOW * 2) return null;
  const recent = window.slice(-ACCURACY_DROP_WINDOW);
  const prior = window.slice(-ACCURACY_DROP_WINDOW * 2, -ACCURACY_DROP_WINDOW);
  const recentMean = meanOffset(recent);
  const priorMean = meanOffset(prior);

  // Rushing: recent mean < -threshold, prior near-neutral.
  if (
    recentMean < -TREND_OFFSET_THRESHOLD_MS &&
    priorMean >= -TREND_PRIOR_NEUTRAL_MS
  ) {
    const confirmations = state.trendConfirmations.rushing + 1;
    const tier: Tier =
      confirmations >= TREND_CONFIRMATION_REQUIRED ? "spoken" : "written";
    return {
      scenario: "rushing_trend",
      tier,
      context: {
        offsetMs: Number(recentMean.toFixed(1)),
        priorOffsetMs: Number(priorMean.toFixed(1)),
        confirmations,
        // Templates 64/70 + 81/87 reference `{windowBeats}` directly.
        // `detectTrend` slices `window.slice(-ACCURACY_DROP_WINDOW)`
        // when computing recentMean, so the trend statement is over
        // exactly that many beats. Without this key the `fillTemplate`
        // helper passes `{windowBeats}` through verbatim and the user
        // sees raw `{windowBeats}` in the rendered tip (v0.9 bug).
        windowBeats: ACCURACY_DROP_WINDOW,
      },
      partialState: {
        trendConfirmations: {
          rushing: confirmations,
          dragging: 0,
        },
      },
    };
  }

  // Dragging: mirror.
  if (
    recentMean > TREND_OFFSET_THRESHOLD_MS &&
    priorMean <= TREND_PRIOR_NEUTRAL_MS
  ) {
    const confirmations = state.trendConfirmations.dragging + 1;
    const tier: Tier =
      confirmations >= TREND_CONFIRMATION_REQUIRED ? "spoken" : "written";
    return {
      scenario: "dragging_trend",
      tier,
      context: {
        offsetMs: Number(recentMean.toFixed(1)),
        priorOffsetMs: Number(priorMean.toFixed(1)),
        confirmations,
        // See `rushing_trend` above — templates 81/87 reference
        // `{windowBeats}` and need this key populated or the
        // placeholder leaks through to the rendered tip.
        windowBeats: ACCURACY_DROP_WINDOW,
      },
      partialState: {
        trendConfirmations: {
          rushing: 0,
          dragging: confirmations,
        },
      },
    };
  }

  // Neither — decay confirmations so a single noisy beat doesn't
  // permanently latch the next escalation.
  if (
    state.trendConfirmations.rushing > 0 ||
    state.trendConfirmations.dragging > 0
  ) {
    return {
      scenario: "accuracy_drop", // sentinel; caller discards by `null`
      tier: "written",
      context: {},
      partialState: { trendConfirmations: { rushing: 0, dragging: 0 } },
    };
  }
  return null;
}

function detectNewBandLocked(
  state: GatekeeperState,
  ctx: GatekeeperContext,
): { detection: Detection | null; partialState?: Partial<GatekeeperState> } {
  const recent = ctx.window.slice(-STREAK_SUPPRESSION_MIN_LEN);
  if (recent.length < STREAK_SUPPRESSION_MIN_LEN) {
    return { detection: null };
  }
  const rate = hitRate(recent);
  const bandLow = Math.floor(ctx.bpm / 10) * 10;
  const sustained = rate >= NEW_BAND_ACCURACY;

  if (!sustained) {
    if (state.lockedBpmLow !== null) {
      return {
        detection: null,
        partialState: { lockedBpmLow: null, bandLockedSinceMs: null },
      };
    }
    return { detection: null };
  }

  // Sustained — either we just entered this band or we've been here.
  if (state.lockedBpmLow !== bandLow || state.bandLockedSinceMs === null) {
    return {
      detection: null,
      partialState: {
        lockedBpmLow: bandLow,
        bandLockedSinceMs: ctx.now,
      },
    };
  }

  if (ctx.now - state.bandLockedSinceMs < NEW_BAND_DURATION_MS) {
    return { detection: null };
  }

  // We've been locked for ≥ NEW_BAND_DURATION_MS. Emit once per band:
  // clear bandLockedSinceMs so we don't re-emit unless we leave and
  // come back.
  return {
    detection: {
      scenario: "new_band_locked",
      tier: "spoken",
      context: {
        bpmLow: bandLow,
        bpmHigh: bandLow + 9,
        accuracyPct: Math.round(rate * 100),
      },
    },
    partialState: { bandLockedSinceMs: null },
  };
}

function detectCheckIn(
  state: GatekeeperState,
  now: number,
): Detection | null {
  if (now - state.lastSpokenMs < CHECK_IN_AFTER_QUIET_MS) return null;
  return {
    scenario: "check_in",
    tier: "spoken",
    context: {
      quietMs: now - state.lastSpokenMs,
    },
  };
}

/**
 * Low-confidence caveat detector. Per plan OQ5: when the mean
 * calibration confidence drops below 0.5 and stays there for ≥ 30s,
 * fire a one-shot `low_confidence` event. The detector itself is
 * stateful: it tracks when the dip started so we can require a
 * sustained duration rather than reacting to a single noisy beat.
 *
 * Returns a `partialState` whenever the rolling state needs to be
 * updated (start/clear the dip timer), so the caller commits state
 * changes whether or not an event fires.
 */
function detectLowConfidence(
  state: GatekeeperState,
  ctx: GatekeeperContext,
): { detection: Detection | null; partialState?: Partial<GatekeeperState> } {
  // One-shot per session — already fired, don't fire again.
  if (state.lastEventMs.low_confidence != null) {
    return { detection: null };
  }

  // Need a meaningful sample size to compute a reliable mean.
  const window = ctx.window;
  const scored = window.filter((b) => b.classification !== "skipped");
  if (scored.length < 8) return { detection: null };

  const mean =
    scored.reduce((a, b) => a + b.calibrationConfidence, 0) / scored.length;

  // Recovery — clear the dip timer if we're back above threshold.
  if (mean >= LOW_CONFIDENCE_THRESHOLD) {
    if (state.lowConfidenceSinceMs !== null) {
      return {
        detection: null,
        partialState: { lowConfidenceSinceMs: null },
      };
    }
    return { detection: null };
  }

  // Below threshold — open the timer if this is the first dip.
  if (state.lowConfidenceSinceMs === null) {
    return {
      detection: null,
      partialState: { lowConfidenceSinceMs: ctx.now },
    };
  }

  // Sustained long enough? If yes, fire the one-shot caveat.
  if (ctx.now - state.lowConfidenceSinceMs < LOW_CONFIDENCE_SUSTAIN_MS) {
    return { detection: null };
  }

  return {
    detection: {
      scenario: "low_confidence",
      tier: "spoken",
      context: {
        meanConfidence: Number(mean.toFixed(2)),
        sustainedSecs: Math.round(
          (ctx.now - state.lowConfidenceSinceMs) / 1000,
        ),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Public `evaluate`
// ---------------------------------------------------------------------------

/**
 * Run all detectors against the current state + context and decide
 * whether to emit an event. Returns the (possibly unchanged) state
 * AND the chosen event (or `null` if nothing fired or everything was
 * gated by cooldowns).
 *
 * Priority order:
 *   1. Forced event (always wins, subject to first-beats demotion).
 *   2. Accuracy drop (intervention).
 *   3. Personal best streak.
 *   4. New-band-locked.
 *   5. Trend (rushing/dragging).
 *   6. Low-confidence caveat (one-shot per session).
 *   7. Check-in (adaptive floor).
 *
 * Cross-cutting post-detection rules:
 *   - First-4-beats hard rule: spoken events are demoted to written
 *     during the first `FIRST_BEATS_TTS_FLOOR` beats of a segment,
 *     except for `boundary_signal_a` (user-initiated, must speak).
 */
export function evaluate(
  state: GatekeeperState,
  ctx: GatekeeperContext,
): { state: GatekeeperState; event: GatekeeperEvent | null } {
  // 1. Forced events bypass everything except the first-beats rule.
  if (ctx.force) {
    const forced: GatekeeperEvent = {
      scenario: ctx.force.scenario,
      tier: "spoken",
      context: ctx.force.context,
      taggedBpm: ctx.bpm,
    };
    return commit(state, ctx.now, applyFirstBeatsRule(forced, ctx));
  }

  let working = state;

  // 2. Accuracy drop (intervention). Always escalates to spoken,
  // bypasses streak suppression.
  const drop = detectAccuracyDrop(ctx.window);
  if (drop && passesSpokenCooldown(working, drop.scenario, ctx.now)) {
    return commit(
      working,
      ctx.now,
      applyFirstBeatsRule(toEvent(drop, ctx.bpm), ctx),
    );
  }

  // 3. Personal best streak — always speakable.
  const pb = detectPersonalBestStreak(working, ctx.window);
  if (pb) {
    if (pb.partialState) working = { ...working, ...pb.partialState };
    if (passesSpokenCooldown(working, pb.scenario, ctx.now)) {
      return commit(
        working,
        ctx.now,
        applyFirstBeatsRule(toEvent(pb, ctx.bpm), ctx),
      );
    }
  }

  // 4. New-band-locked — always speakable, but only emits once per
  // band entry.
  const band = detectNewBandLocked(working, ctx);
  if (band.partialState) working = { ...working, ...band.partialState };
  if (band.detection && passesSpokenCooldown(working, band.detection.scenario, ctx.now)) {
    return commit(
      working,
      ctx.now,
      applyFirstBeatsRule(toEvent(band.detection, ctx.bpm), ctx),
    );
  }

  // 5. Trends — written initially, spoken on confirmation.
  const trend = detectTrend(working, ctx.window);
  if (trend && trend.partialState) {
    working = { ...working, ...trend.partialState };
  }
  // The "neither" sentinel reuses `accuracy_drop` as a placeholder;
  // discard if the actual scenario is the sentinel.
  if (
    trend &&
    (trend.scenario === "rushing_trend" ||
      trend.scenario === "dragging_trend")
  ) {
    const inStreak = ctx.inStreak ?? streakActive(ctx.window);
    const suppressSpoken =
      inStreak && !isAlwaysSpoken(trend.scenario) && trend.tier === "spoken";
    const tier: Tier = suppressSpoken ? "written" : trend.tier;
    const passes =
      tier === "spoken"
        ? passesSpokenCooldown(working, trend.scenario, ctx.now)
        : passesWrittenCooldown(working, ctx.now);
    if (passes) {
      return commit(
        working,
        ctx.now,
        applyFirstBeatsRule(toEvent({ ...trend, tier }, ctx.bpm), ctx),
      );
    }
  }

  // 6. Low-confidence caveat — one-shot per session.
  const lowConf = detectLowConfidence(working, ctx);
  if (lowConf.partialState) working = { ...working, ...lowConf.partialState };
  if (lowConf.detection && passesSpokenCooldown(working, lowConf.detection.scenario, ctx.now)) {
    return commit(
      working,
      ctx.now,
      applyFirstBeatsRule(toEvent(lowConf.detection, ctx.bpm), ctx),
    );
  }

  // 7. Adaptive cooldown floor — emits at most once per quiet window
  // because committing updates `lastSpokenMs`.
  const checkIn = detectCheckIn(working, ctx.now);
  if (checkIn) {
    return commit(
      working,
      ctx.now,
      applyFirstBeatsRule(toEvent(checkIn, ctx.bpm), ctx),
    );
  }

  return { state: working, event: null };
}

/**
 * Apply the first-4-beats hard rule. Demotes spoken events to
 * written when the segment is too fresh, unless the scenario is
 * exempt (Signal A). Returns the event unchanged when the rule
 * doesn't apply or `beatsInSegment` wasn't supplied.
 */
function applyFirstBeatsRule(
  event: GatekeeperEvent,
  ctx: GatekeeperContext,
): GatekeeperEvent {
  if (event.tier !== "spoken") return event;
  if (ctx.beatsInSegment === undefined) return event;
  if (ctx.beatsInSegment >= FIRST_BEATS_TTS_FLOOR) return event;
  if (isFirstBeatsExempt(event.scenario)) return event;
  return { ...event, tier: "written" };
}

// ---------------------------------------------------------------------------
// Internal: commit and event-builder helpers
// ---------------------------------------------------------------------------

function commit(
  state: GatekeeperState,
  now: number,
  event: GatekeeperEvent,
): { state: GatekeeperState; event: GatekeeperEvent } {
  const lastEventMs = { ...state.lastEventMs, [event.scenario]: now };
  const next: GatekeeperState =
    event.tier === "spoken"
      ? { ...state, lastSpokenMs: now, lastWrittenMs: now, lastEventMs }
      : { ...state, lastWrittenMs: now, lastEventMs };
  return { state: next, event };
}

function toEvent(detection: Detection, bpm: number): GatekeeperEvent {
  return {
    scenario: detection.scenario,
    tier: detection.tier,
    context: detection.context,
    taggedBpm: bpm,
  };
}

// ---------------------------------------------------------------------------
// Tiny stats helpers (window-aware, no allocations)
// ---------------------------------------------------------------------------

/**
 * Hit rate computed over ATTEMPTED beats only — `hits / (hits + miss)`.
 *
 * Skipped beats (no detected onset, i.e. the player wasn't playing on
 * that tick) are excluded from BOTH numerator and denominator. A
 * player who stops between exercises shouldn't be scored as missing
 * those ticks — that's the same convention the segment score and
 * `src/coach/reportStats.ts` use, and the gatekeeper now matches.
 *
 * Returns 1 when the window has no attempted beats. "No data" reads
 * as "fine" so detectors like `detectAccuracyDrop` don't fire on
 * all-skipped windows (the v0.9 "Rough patch at 0%" bug came from
 * the old `hits / window.length` denominator turning a quiet pause
 * into a 0% accuracy event). Callers that need a minimum-attempted
 * floor should gate on `scoredCount(window)` separately before
 * consulting the rate.
 */
function hitRate(window: BeatFeedback[]): number {
  let hits = 0;
  let scored = 0;
  for (const b of window) {
    if (b.classification === "skipped") continue;
    scored++;
    if (b.classification !== "miss") hits++;
  }
  return scored === 0 ? 1 : hits / scored;
}

/** Count of attempted beats (hits + misses) in the window. Used to
 *  gate detectors that need a meaningful sample size before firing —
 *  see `detectAccuracyDrop`. */
function scoredCount(window: BeatFeedback[]): number {
  let n = 0;
  for (const b of window) if (b.classification !== "skipped") n++;
  return n;
}

function meanOffset(window: BeatFeedback[]): number {
  const hits = window.filter(
    (b) => b.classification !== "miss" && b.classification !== "skipped",
  );
  if (hits.length === 0) return 0;
  return hits.reduce((a, b) => a + b.deviationMs, 0) / hits.length;
}

function trailingCleanStreak(window: BeatFeedback[]): number {
  let streak = 0;
  for (let i = window.length - 1; i >= 0; i--) {
    if (window[i].classification === "miss") break;
    if (window[i].classification !== "skipped") streak++;
  }
  return streak;
}

function streakActive(window: BeatFeedback[]): boolean {
  if (window.length < STREAK_SUPPRESSION_MIN_LEN) return false;
  const recent = window.slice(-STREAK_SUPPRESSION_MIN_LEN);
  return hitRate(recent) >= STREAK_SUPPRESSION_HIT_RATE;
}

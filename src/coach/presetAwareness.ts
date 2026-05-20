/**
 * C3 — Preset Awareness.
 *
 * Roll up session history for a specific preset into structured
 * summaries the coach can use to ground feedback ("you're at the
 * 130 BPM ceiling again", "you tend to rush this exercise", etc.).
 *
 * Two layers:
 *
 *  1. `summarizePreset()` — pure stats. Cheap, always safe to run.
 *     Session count, median score, BPM range, per-band bests, mean
 *     timing offset.
 *
 *  2. `detectRecurringIssues()` — pattern detection. Gated by minimum
 *     data thresholds so we don't claim "patterns" from a single noisy
 *     run. Returns `null` for any pattern whose data gate isn't met.
 *
 * The minimum-data gates (per plan):
 *   - Recurring patterns:  ≥ 3 sessions at this preset.
 *   - Stamina patterns:    ≥ 5 sessions OR ≥ 30 cumulative minutes
 *                          (stamina is noisier).
 *
 * Stamina **must control for tempo**: "score dropped at the same BPM
 * late in the session vs. early in the session". Adaptive drills that
 * ramp into harder tempos don't count as stamina degradation — they're
 * the user climbing the difficulty curve, not tiring.
 */

import type { SavedSession } from "../types";

// ---------------------------------------------------------------------------
// Constants — single source of truth, exported for testing.
// ---------------------------------------------------------------------------

/** BPM-band bucket width. 10 BPM bands keep the table compact. */
export const BPM_BAND_WIDTH = 10;

/** Below-threshold band median score that flags a "ceiling". */
export const CEILING_MEDIAN_SCORE = 70;

/** Min sessions in a BPM band before its median can flag a ceiling. */
export const CEILING_MIN_BAND_SESSIONS = 3;

/** Min |mean signed deviation| for a timing tendency to count. */
export const TIMING_TENDENCY_THRESHOLD_MS = 8;

/** Min sessions across the preset before any recurring pattern surfaces. */
export const RECURRING_MIN_SESSIONS = 3;

/** Min sessions for stamina pattern surfacing. */
export const STAMINA_MIN_SESSIONS = 5;

/** Min cumulative minutes for stamina pattern surfacing (alt gate). */
export const STAMINA_MIN_CUMULATIVE_MINUTES = 30;

/** Stamina deltaScore (early - late) threshold. */
export const STAMINA_SCORE_DROP_THRESHOLD = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BpmBandStat = {
  /** Lower BPM edge of the band (inclusive). Band covers [low, low+10). */
  bpmLow: number;
  /** Number of sessions whose BPM fell in this band. */
  sessions: number;
  /** Best (max) score recorded in this band. */
  bestScore: number;
  /** Median score across sessions in this band. */
  medianScore: number;
};

export type PresetSummary = {
  presetId: string;
  presetName?: string;
  sessionCount: number;
  /** Approximate cumulative practice minutes for this preset. */
  cumulativeMinutes: number;
  /** Median score across all sessions at this preset. */
  medianScore: number;
  /** Best single-session score. */
  bestScore: number;
  /** Lowest and highest BPM played at this preset. */
  bpmRange: { min: number; max: number };
  /** Per-10-BPM-band breakdown, sorted ascending by `bpmLow`. */
  bpmBands: BpmBandStat[];
  /** Mean of signed timing deviations across sessions (ms). */
  meanTimingOffsetMs: number;
  /** Most recent session timestamp (Unix ms), or 0 if none. */
  lastSessionAt: number;
};

/**
 * The patterns the coach is allowed to claim. `null` for any pattern
 * whose minimum-data gate isn't satisfied — callers should treat
 * `null` as "no signal, stay silent" rather than "no problem."
 */
export type RecurringIssues = {
  /**
   * The lowest BPM band where the player consistently struggles.
   * Surfaces only when the band has ≥ CEILING_MIN_BAND_SESSIONS
   * sessions AND median band score < CEILING_MEDIAN_SCORE.
   */
  bpmCeiling: BpmCeiling | null;

  /**
   * Whether the player tends to rush or drag this preset (or neither).
   * Requires |mean signed deviation| > TIMING_TENDENCY_THRESHOLD_MS.
   */
  timingTendency: TimingTendency | null;

  /**
   * Whether late-session score drops below early-session score at the
   * SAME BPM band (controls for adaptive ramps). Requires the stamina
   * data gate to be met.
   */
  stamina: StaminaPattern | null;
};

export type BpmCeiling = {
  bpmLow: number;
  bpmHigh: number;
  medianScore: number;
  sessions: number;
};

export type TimingTendency = {
  direction: "rushing" | "dragging";
  meanOffsetMs: number;
};

export type StaminaPattern = {
  /** BPM band where the early-vs-late comparison fired. */
  bpmLow: number;
  bpmHigh: number;
  /** Mean score in the first third of each qualifying session. */
  earlyMeanScore: number;
  /** Mean score in the last third of each qualifying session. */
  lateMeanScore: number;
  /** earlyMeanScore - lateMeanScore. */
  scoreDrop: number;
  /** Sessions that contributed (≥1 segment in early + ≥1 in late). */
  sessionsCounted: number;
  /**
   * Approximate session duration (minutes) at which stamina degradation
   * tends to appear. Derived from the average estimated practice length
   * of sessions in the qualifying BPM band. Used to fill the
   * `{staminaMinutes}` template placeholder.
   */
  staminaMinutes: number;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Roll up a preset's history into structured stats. Pure function over
 * the SavedSession[] — no IO, no clock, fully deterministic.
 */
export function summarizePreset(
  presetId: string,
  presetName: string | undefined,
  sessions: SavedSession[],
): PresetSummary {
  const matched = sessions.filter((s) => s.presetId === presetId);

  if (matched.length === 0) {
    return {
      presetId,
      presetName,
      sessionCount: 0,
      cumulativeMinutes: 0,
      medianScore: 0,
      bestScore: 0,
      bpmRange: { min: 0, max: 0 },
      bpmBands: [],
      meanTimingOffsetMs: 0,
      lastSessionAt: 0,
    };
  }

  const scores = matched.map((s) => s.report.score);
  const bpms = matched.map((s) => s.bpm);
  const devs = matched.map((s) => s.report.meanDeviationMs);

  // Aggregate per BPM band.
  const bandMap = new Map<number, number[]>();
  for (const s of matched) {
    const band = bpmBandLowFor(s.bpm);
    const arr = bandMap.get(band);
    if (arr) arr.push(s.report.score);
    else bandMap.set(band, [s.report.score]);
  }
  const bpmBands: BpmBandStat[] = [...bandMap.entries()]
    .map(([bpmLow, bandScores]) => ({
      bpmLow,
      sessions: bandScores.length,
      bestScore: Math.max(...bandScores),
      medianScore: median(bandScores),
    }))
    .sort((a, b) => a.bpmLow - b.bpmLow);

  return {
    presetId,
    presetName,
    sessionCount: matched.length,
    cumulativeMinutes: estimateCumulativeMinutes(matched),
    medianScore: median(scores),
    bestScore: Math.max(...scores),
    bpmRange: { min: Math.min(...bpms), max: Math.max(...bpms) },
    bpmBands,
    meanTimingOffsetMs: mean(devs),
    lastSessionAt: Math.max(...matched.map((s) => s.timestamp)),
  };
}

/**
 * Detect recurring issues across the preset's sessions. Gated by
 * minimum-data thresholds — returns `null` for any pattern whose gate
 * isn't met. The coach should treat `null` as "stay silent, no signal"
 * rather than "no problem."
 */
export function detectRecurringIssues(
  summary: PresetSummary,
): RecurringIssues {
  if (summary.sessionCount < RECURRING_MIN_SESSIONS) {
    return { bpmCeiling: null, timingTendency: null, stamina: null };
  }

  return {
    bpmCeiling: detectBpmCeiling(summary),
    timingTendency: detectTimingTendency(summary),
    // Stamina requires sessions, not just the summary — caller wires it
    // separately because session-level segment data isn't on the
    // summary. Always null at the summary-only level.
    stamina: null,
  };
}

/**
 * Detect stamina pattern. This needs per-session segment timestamps,
 * so it takes the raw sessions list directly. Controls for tempo by
 * comparing early-vs-late within the *same BPM band*.
 *
 * Returns `null` when the stamina data gate isn't met or when no band
 * shows a meaningful drop.
 */
export function detectStaminaPattern(
  sessions: SavedSession[],
  presetId: string,
): StaminaPattern | null {
  const matched = sessions.filter((s) => s.presetId === presetId);
  if (matched.length < STAMINA_MIN_SESSIONS) {
    const minutes = estimateCumulativeMinutes(matched);
    if (minutes < STAMINA_MIN_CUMULATIVE_MINUTES) {
      return null;
    }
  }

  // Group sessions by BPM band, then within each band compare early
  // third score vs late third score. We approximate "third" by
  // splitting the session timestamps within the matched set — the
  // SavedSession type doesn't carry per-segment offsets, so we use
  // session-level scores across time ordering as the proxy.
  //
  // This is a coarser signal than the "within-session segments"
  // version the plan ideally wants, but it's the most we can do with
  // the data shape we have. A future enhancement could plumb
  // segment-level scores out of SessionLog.
  const bandToSessions = new Map<number, SavedSession[]>();
  for (const s of matched) {
    const low = bpmBandLowFor(s.bpm);
    const arr = bandToSessions.get(low);
    if (arr) arr.push(s);
    else bandToSessions.set(low, [s]);
  }

  let best: StaminaPattern | null = null;
  for (const [low, bandSessions] of bandToSessions.entries()) {
    if (bandSessions.length < 4) continue; // can't split a tiny band
    const sorted = [...bandSessions].sort((a, b) => a.timestamp - b.timestamp);
    const third = Math.max(1, Math.floor(sorted.length / 3));
    const early = sorted.slice(0, third);
    const late = sorted.slice(-third);
    const earlyMean = mean(early.map((s) => s.report.score));
    const lateMean = mean(late.map((s) => s.report.score));
    const drop = earlyMean - lateMean;
    if (drop < STAMINA_SCORE_DROP_THRESHOLD) continue;
    // Estimate the session duration at which fatigue typically surfaces —
    // average practice length across all sessions in this band, rounded to
    // the nearest whole minute (minimum 1). This fills {staminaMinutes}.
    const avgMinutes = Math.max(
      1,
      Math.round(estimateCumulativeMinutes(bandSessions) / bandSessions.length),
    );
    const candidate: StaminaPattern = {
      bpmLow: low,
      bpmHigh: low + BPM_BAND_WIDTH,
      earlyMeanScore: earlyMean,
      lateMeanScore: lateMean,
      scoreDrop: drop,
      sessionsCounted: early.length + late.length,
      staminaMinutes: avgMinutes,
    };
    if (!best || candidate.scoreDrop > best.scoreDrop) best = candidate;
  }
  return best;
}

/**
 * Format a preset summary as a compact LLM-context block. Smaller
 * than `compactPresetSummary` and structured so the model sees the
 * key facts without scrolling.
 */
export function formatPresetSummaryForLLM(
  summary: PresetSummary,
  issues?: RecurringIssues,
): string {
  if (summary.sessionCount === 0) {
    return `Preset: ${summary.presetName ?? "(unnamed)"} — no prior sessions.`;
  }
  const lines: string[] = [];
  lines.push(
    `Preset: ${summary.presetName ?? "(unnamed)"} (${summary.sessionCount} session${summary.sessionCount === 1 ? "" : "s"})`,
  );
  lines.push(
    `Best: ${summary.bestScore} | Median: ${summary.medianScore} | BPM range: ${summary.bpmRange.min}–${summary.bpmRange.max}`,
  );
  const tendency = summary.meanTimingOffsetMs;
  if (Math.abs(tendency) > TIMING_TENDENCY_THRESHOLD_MS) {
    const dir = tendency < 0 ? "rushing" : "dragging";
    lines.push(`Tendency: ${dir} avg ${tendency.toFixed(1)}ms`);
  }
  if (summary.bpmBands.length > 0) {
    const bands = summary.bpmBands
      .map((b) => `${b.bpmLow}-${b.bpmLow + BPM_BAND_WIDTH - 1}:${b.bestScore}`)
      .join(", ");
    lines.push(`Bests by BPM: ${bands}`);
  }
  if (issues?.bpmCeiling) {
    lines.push(
      `Ceiling: ${issues.bpmCeiling.bpmLow}-${issues.bpmCeiling.bpmHigh - 1} BPM (median ${Math.round(issues.bpmCeiling.medianScore)})`,
    );
  }
  if (issues?.stamina) {
    lines.push(
      `Stamina: at ${issues.stamina.bpmLow}-${issues.stamina.bpmHigh - 1} BPM, score drops ${issues.stamina.scoreDrop.toFixed(0)} from early-to-late`,
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Lower edge of the 10-BPM band containing `bpm`. */
export function bpmBandLowFor(bpm: number): number {
  return Math.floor(bpm / BPM_BAND_WIDTH) * BPM_BAND_WIDTH;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Estimate cumulative practice minutes for a set of sessions. Uses
 * `report.totalBeats / bpm` as the duration proxy — SavedSession
 * doesn't carry an explicit duration field, but at a given BPM the
 * beat count translates directly to minutes.
 */
function estimateCumulativeMinutes(sessions: SavedSession[]): number {
  let totalMinutes = 0;
  for (const s of sessions) {
    if (s.bpm <= 0) continue;
    totalMinutes += s.report.totalBeats / s.bpm;
  }
  return totalMinutes;
}

function detectBpmCeiling(summary: PresetSummary): BpmCeiling | null {
  // Walk bands ascending. The FIRST band that has enough sessions AND
  // median < threshold is the ceiling — once playing falls apart at
  // some tempo, harder bands are uninformative.
  for (const band of summary.bpmBands) {
    if (band.sessions < CEILING_MIN_BAND_SESSIONS) continue;
    if (band.medianScore >= CEILING_MEDIAN_SCORE) continue;
    return {
      bpmLow: band.bpmLow,
      bpmHigh: band.bpmLow + BPM_BAND_WIDTH,
      medianScore: band.medianScore,
      sessions: band.sessions,
    };
  }
  return null;
}

function detectTimingTendency(summary: PresetSummary): TimingTendency | null {
  const off = summary.meanTimingOffsetMs;
  if (Math.abs(off) <= TIMING_TENDENCY_THRESHOLD_MS) return null;
  return {
    direction: off < 0 ? "rushing" : "dragging",
    meanOffsetMs: off,
  };
}

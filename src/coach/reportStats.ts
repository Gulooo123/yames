/**
 * Tiny shared helpers for `SessionReport`-derived stats.
 *
 * The accuracy denominator is the #1 source of "subtle correctness"
 * bugs across this codebase: it MUST be `hits + miss` (i.e. scored
 * beats) and NOT `totalBeats`. The two diverge whenever the player
 * hasn't started yet, plays below the noise floor, or rests during
 * a long passage — `totalBeats` keeps ticking on the metronome but
 * `hits + miss` only counts beats the player attempted. The Rust
 * score (`session.rs::report()`) uses the scored-beat denominator,
 * so every JS-side display has to match or the displayed accuracy
 * disagrees with the displayed score.
 *
 * The bug was already shipped twice — once in `EndReportSummary`,
 * once in `SegmentTimeline` — before being fixed during the Step-3
 * coordination review. Concentrating the math here means the next
 * place that needs an accuracy percentage gets it right by default.
 */

interface ScoredFields {
  hitsCount: number;
  missCount: number;
}

/**
 * Number of beats the player ATTEMPTED. Synonym for `hits + miss`
 * but named to keep call sites readable ("of N scored beats…").
 */
export function scoredBeats(report: ScoredFields): number {
  return report.hitsCount + report.missCount;
}

/**
 * Accuracy as a fraction in [0, 1], defined as
 *   hits / (hits + miss).
 *
 * Returns 0 when no beats were attempted — same NaN-avoidance
 * rationale as `accuracyPct`. Use this when the caller is comparing
 * against a threshold (MIN_SEGMENT_HIT_RATE_FOR_REPORT, etc.) rather
 * than rendering a percentage to the user.
 */
export function accuracyRatio(report: ScoredFields): number {
  const denom = scoredBeats(report);
  return denom > 0 ? report.hitsCount / denom : 0;
}

/**
 * Accuracy as a rounded integer percentage, defined as
 *   hits / (hits + miss).
 *
 * Returns 0 when no beats were attempted — surfacing "0%" rather
 * than `NaN` keeps downstream string templates safe even when the
 * report is empty (e.g. a session that ended before any onsets
 * crossed the gate).
 */
export function accuracyPct(report: ScoredFields): number {
  return Math.round(accuracyRatio(report) * 100);
}

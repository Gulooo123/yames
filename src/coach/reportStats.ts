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
 * Fields needed to recompute a session score from accuracy components.
 * Strict subset of `SessionReport` so it can be applied to any shape
 * that carries hits/misses + per-classification counts + stddev.
 */
interface RescorableFields {
  hitsCount: number;
  missCount: number;
  perfectCount: number;
  goodCount: number;
  okCount: number;
  stdDeviationMs: number;
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

/**
 * The session-score formula, ported verbatim from Rust's "legacy" path
 * (`session.rs::report` — the branch taken when no `PracticeSegment`s
 * are recorded).  Lives here on the JS side because we want to use the
 * SAME formula for displayed scores regardless of whether the backend
 * happened to take the segment-aware branch.
 *
 *   score = (0.30·hitRate + 0.50·accuracyScore + 0.20·consistencyScore) · 100
 *
 *   hitRate          = hits / (hits + miss)
 *   accuracyScore    = (perfect·10 + good·7 + ok·3) / (hits·10)
 *   consistencyScore = max(0, 1 - min(1, stdDeviationMs / 50))
 *
 * Why override the backend's segment-aware score?  The segment path
 * mixes in DSP-dependent components (`hit_completeness` punishes idle
 * stretches inside an open segment; `onset_efficiency` punishes spurious
 * onsets from the doubling/density bug).  When the DSP misbehaves —
 * which it does today on dense subdivisions — a session with great
 * accuracy can get a wildly low segment-weighted score even though the
 * player did well by every visible metric.  See `c847c91b` vs
 * `6c920ad0` in the user's 80 BPM 16ths history: 75% acc / streak 30 /
 * stddev 23.6ms → segment-path 27 ("F", demotivating) where the legacy
 * formula returns 74 ("B") next to a 69% acc / streak 23 / stddev 22ms
 * run that already scored 72.
 *
 * This formula depends ONLY on what the player did (counts of hits per
 * quality bucket, stddev of deviations), so it's robust to DSP segment
 * quirks.  The plan-pinned segment scoring tests still cover the Rust
 * side; we just don't surface that score to the user until the
 * underlying DSP bugs are resolved.
 */
export function computeLegacyScore(report: RescorableFields): number {
  const scored = report.hitsCount + report.missCount;
  const hitRate = scored > 0 ? report.hitsCount / scored : 0;
  const points =
    report.perfectCount * 10 + report.goodCount * 7 + report.okCount * 3;
  const maxPoints = report.hitsCount * 10;
  const accuracyScore = maxPoints > 0 ? points / maxPoints : 0;
  const consistencyScore = Math.max(
    0,
    1 - Math.min(1, report.stdDeviationMs / 50),
  );
  const raw =
    (hitRate * 0.3 + accuracyScore * 0.5 + consistencyScore * 0.2) * 100;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * Convert a numeric score to the same letter grade the Rust report uses
 * (`session.rs::report`).  Kept next to `computeLegacyScore` so any time
 * we override `score` we can override `grade` in lockstep without
 * duplicating the band boundaries.
 */
export function gradeForScore(score: number): string {
  if (score >= 95) return "S";
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

/**
 * Re-score a `SessionReport`-shaped object using `computeLegacyScore`
 * and the matching grade. Used at every UI/coach boundary so the
 * displayed score is always derived from the same formula regardless of
 * which Rust branch produced the input. Pure — never mutates input.
 *
 * Generic over the report shape so this can be reused for:
 *   - Live mini-reports (`getSessionReport()` → `SessionReport`)
 *   - Saved history (`SavedSession.report`)
 *   - Anywhere else a report is rendered.
 */
export function rescoreReport<T extends RescorableFields & { grade: string; score: number }>(report: T): T {
  const score = computeLegacyScore(report);
  const grade = gradeForScore(score);
  if (score === report.score && grade === report.grade) {
    return report;
  }
  return { ...report, score, grade };
}

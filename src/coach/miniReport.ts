/**
 * Mini-report helpers.
 *
 * Extracted from `useSession.ts` so `useSegmentCoach.ts` can import them
 * without creating a circular dependency through the hook file.
 *
 * All functions here are pure / side-effect-free and have no dependency on
 * React state or hook closures.
 */

import type { FeedChip, SessionReport, SessionSegment } from "../types";
import {
  accuracyPct,
  accuracyRatio,
  scoredBeats,
} from "./reportStats";
import {
  answerChip,
  loadRecentChipIds,
  renderAffordanceLabel,
  saveRecentChipIds,
  selectChips,
  type ChipContext,
  type RecencyStorage,
} from "./chips";

// ─── Mini-report eligibility thresholds ──────────────────────────────────────
// A segment must have at least this many beats elapsed before the coach
// generates feedback. Below this we're still inside the "settle-in"
// window and any commentary would be premature.
export const MIN_SEGMENT_BEATS_FOR_REPORT = 8;
// A segment must also have at least this many real hits. A single
// stray onset isn't enough evidence that the user was actually playing
// — it could be a tap on the desk, a chair scrape, or a mic burst.
export const MIN_SEGMENT_HITS_FOR_REPORT = 3;
// And the hit RATE must meet a floor. A segment of "1 hit in 200
// missed beats" passes both thresholds above but is effectively noise
// — the user wasn't really tracking the metronome. Letting it through
// produces the worst coach moment possible: "0% accuracy this round.
// Slow it down a few BPM and focus on clean hits before pushing
// tempo." — which fires at session start when the metronome is ticking
// but the user is just settling in. Below this rate, suppress entirely.
export const MIN_SEGMENT_HIT_RATE_FOR_REPORT = 0.2;

/**
 * Returns true when a segment report has enough data to be worth showing.
 * Gates both mini-reports (mid-session) and the final segment in endSession.
 *    - enough scored beats (not counting the first few warmup ticks)
 *    - enough real hits (not a single stray onset)
 *    - acceptable hit rate (user was really tracking, not just noise)
 */
export function isSegmentReportable(report: SessionReport): boolean {
  if (scoredBeats(report) < MIN_SEGMENT_BEATS_FOR_REPORT) return false;
  if (report.hitsCount < MIN_SEGMENT_HITS_FOR_REPORT) return false;
  if (accuracyRatio(report) < MIN_SEGMENT_HIT_RATE_FOR_REPORT) return false;
  return true;
}

export function buildChipsForMiniReport(args: {
  report: SessionReport;
  bpm: number;
  timeSignature: number;
  segments: SessionSegment[];
  previousSessionScore?: number;
}): FeedChip[] {
  const storage: RecencyStorage =
    typeof window !== "undefined" && window.localStorage
      ? window.localStorage
      : { getItem: () => null, setItem: () => {} };

  const recentIds = loadRecentChipIds(storage);

  // Sustained-rushing / -dragging flags look at the most recent ≤3
  // segments. We don't bother with a more sophisticated trend test here
  // — the chip selector's contextBonus uses these as hints, not hard
  // gates, and the gatekeeper already has the rigorous logic.
  const recent = args.segments.slice(-3);
  const allRushing = recent.length > 0 && recent.every((s) => s.report.meanDeviationMs < -5);
  const allDragging = recent.length > 0 && recent.every((s) => s.report.meanDeviationMs > 5);

  const ctx: ChipContext = {
    report: args.report,
    bpm: args.bpm,
    timeSignature: args.timeSignature,
    previousSessionScore: args.previousSessionScore,
    segmentsCompleted: args.segments.length,
    sustainedRushing: allRushing,
    sustainedDragging: allDragging,
    recentChipIds: recentIds,
    segments: args.segments,
  };

  const selected = selectChips(ctx);

  // Persist the new recency set BEFORE building the UI shape so a
  // mid-render crash doesn't desync localStorage.
  saveRecentChipIds(storage, selected.map((s) => s.chip.id));

  return selected.map((sel) => {
    const chip = sel.chip;
    const answer = answerChip(chip, ctx);
    const affordanceLabel = renderAffordanceLabel(chip, ctx);
    return {
      id: chip.id,
      label: chip.label,
      answer,
      affordance: chip.followUp
        ? {
            label: affordanceLabel ?? chip.followUp.label,
            action: chip.followUp.action,
            bpmDelta: chip.followUp.bpmDelta,
          }
        : undefined,
    };
  });
}

export function formatMiniReport(report: SessionReport): string {
  // Accuracy uses scored beats (hits + misses), NOT totalBeats — see
  // `src/coach/reportStats.ts` for the rationale. Keeping this string
  // in sync with the Rust score depends on that denominator.
  //
  // Uses meanAbsDeviationMs (average magnitude) NOT Math.abs(meanDeviationMs)
  // (absolute value of the signed mean). Symmetric early/late errors cancel
  // the signed mean to ~0 and make timing look perfect; the abs mean is the
  // honest per-hit spread.
  const accuracy = accuracyPct(report);
  return `Score ${report.score} · ${accuracy}% hits · avg ±${report.meanAbsDeviationMs.toFixed(1)}ms`;
}

/** Format context for the coach to generate a mini-report comment. */
export function formatMiniReportContext(
  bpm: number,
  timeSignature: number,
  accuracy: number,
  report: SessionReport,
  instrumentLabel: string,
  narrativeBlock?: string,
  playMode?: "structured" | "noodling",
  coachMode: "default" | "pro" = "default",
): string {
  const pocket = report.meanDeviationMs < -5 ? "ahead of the beat (rushing)"
    : report.meanDeviationMs > 5 ? "behind the beat (dragging)"
    : "right on the beat";
  const style = report.gridCorrelation > 0.8 ? "structured exercise (high grid correlation)"
    : report.gridCorrelation > 0.3 ? "semi-structured playing (medium grid correlation)"
    : "free/improvisational playing (low grid correlation)";
  const narrative = narrativeBlock ? `\n\n${narrativeBlock}` : "";

  // Surface skipped-beat presence explicitly. If most metronome ticks
  // had no detected onset, the player wasn't really "trying and
  // missing" — they were warming up, talking, or playing too quietly
  // to be heard. Without this hint, the LLM defaults to "rough patch"
  // / "ease the tempo down" which feels accusatory and wrong.
  const scored = scoredBeats(report);
  const skipped = report.skippedBeats ?? Math.max(0, report.totalBeats - scored);
  const presencePct = report.totalBeats > 0
    ? Math.round((scored / report.totalBeats) * 100)
    : 0;
  // Threshold: if fewer than 60% of beats had any onset, frame the
  // comment around "I'm only hearing some of your playing" not
  // "rough patch."
  const lowSignalHint = report.totalBeats > 8 && presencePct < 60
    ? `\nIMPORTANT: only ${presencePct}% of beats had a detected onset (${skipped} skipped of ${report.totalBeats}). The player may have been warming up, not playing yet, or the input level may be too low — DO NOT say "rough patch" or "ease the tempo down." Acknowledge that you're not hearing many beats and ask them gently to check their input level or play a touch louder.`
    : "";

  // `Score:` MUST stay on its own line and lead the metric block —
  // the Rust template-fallback parser (`coach.rs::extract_int`) keys
  // off this exact prefix to surface the composite four-component
  // score as the headline number in the no-LLM branch. Without it the
  // template falls back to accuracy and the card reads "Rough patch at
  // 50%" beside a score-65 badge (v0.9 bug). Keep this line stable
  // unless you also update `format_mini_report` + its extractor.
  //
  // Plain integer (no `/100` suffix): `extract_int` greedily parses
  // the first whitespace-separated token after the prefix and fails
  // on `75/100`, which silently turned the score back into 0 in the
  // wild. Keeping the value bare gives the parser something it can
  // actually consume.
  const modeInstruction = coachMode === "default"
    ? `CoachMode: default\nINSTRUCTION: Respond in plain musical language. Do not use any of these terms: IC, GA, grid alignment, onset efficiency, hit completeness, mean deviation, interval consistency. Say: beat, note, tempo, spacing, timing, feel, groove, rushing, dragging, subdivision, pocket, locked in.\n`
    : `CoachMode: pro\nINSTRUCTION: Use musical vocabulary. You may include specific numbers in plain language (e.g. 'about 15ms early', 'only 40% of beats hit'). Do not use raw metric names as terms (IC, GA, HC).\n`;

  // Step 6 — noodling context: prepend framing so the LLM switches
  // register. Must come BEFORE the metric block so the model picks it
  // up as a system instruction. Score/Accuracy lines MUST stay intact
  // below — the Rust no-LLM fallback parser keys off those prefixes.
  const noodlingHint =
    playMode === "noodling"
      ? "CONTEXT: The player is free-playing/noodling (onset efficiency below the structured-practice threshold — their onsets are NOT aligning to the beat grid). This is exploratory practice, not a structured drill. Acknowledge the musical exploration positively. DO NOT criticise for missed beats or off-grid playing — they weren't trying to lock in. Comment on feel, energy, musical ideas, or what direction to explore next.\n"
      : "";

  // Beat coverage from hitCompleteness — tells the LLM how many of the
  // expected subdivision positions were actually played. Critical for
  // explaining the gap between "timing looks fine" and "score is low":
  // a player hitting every 16th note with ±2ms precision but only landing
  // 25% of the expected positions scores ~55 even though their individual
  // hits are excellent. Without this the LLM sees good timing + low score
  // and produces contradictory advice ("right in the pocket — ease the tempo
  // down"). Surface it explicitly so the model can name the real issue.
  const coverageNote =
    report.hitCompleteness !== undefined
      ? `\nBeat coverage: ${Math.round(report.hitCompleteness * 100)}% of expected subdivision positions played (hitCompleteness ${report.hitCompleteness.toFixed(2)})`
      : "";

  // Low coverage instruction: if coverage is below 50%, steer the LLM
  // away from generic "rough patch" / "ease the tempo down" advice and
  // toward the actual issue (missing subdivision positions, not bad timing).
  const lowCoverageHint =
    report.hitCompleteness !== undefined && report.hitCompleteness < 0.50
      ? `\nIMPORTANT: Beat coverage is only ${Math.round(report.hitCompleteness * 100)}%. The player's individual hits may be well-timed but they are missing many expected beats/subdivisions. DO NOT say "right in the pocket" — focus on coverage and filling out the rhythm, not timing accuracy.`
      : "";

  // IC and GA component scores — tell the Rust template parser what the
  // per-component values were so it can produce specific burst-mode advice.
  // Only emitted when the fields are present (they require DSP segment data).
  const icGaLines =
    report.intervalConsistency !== undefined && report.gridAlignment !== undefined
      ? `\nIC: ${report.intervalConsistency.toFixed(2)}\nGA: ${report.gridAlignment.toFixed(2)}`
      : "";

  const timingPattern =
    (report.stdDeviationMs ?? 0) > 20
      ? "oscillating"
      : (report.meanDeviationMs ?? 0) < -5
      ? "rushing"
      : (report.meanDeviationMs ?? 0) > 5
      ? "dragging"
      : "solid";

  return `${modeInstruction}${noodlingHint}The player (${instrumentLabel}) just finished a passage. Generate a brief coaching comment.
BPM: ${bpm}, Time signature: ${timeSignature}/4
Score: ${report.score} out of 100
SignedDev: ${report.meanDeviationMs.toFixed(1)}
HitCompleteness: ${(report.hitCompleteness ?? 1).toFixed(2)}
TimingPattern: ${timingPattern}
Playing style: ${style}
Accuracy: ${accuracy}% of attempted beats (${report.perfectCount} perfect, ${report.goodCount} good, ${report.okCount} ok, ${report.missCount} miss out of ${scored} attempted)
Beats with detected onset: ${presencePct}% (${scored} of ${report.totalBeats} total ticks)${coverageNote}
Timing tendency: ${pocket} (signed avg ${report.meanDeviationMs.toFixed(1)}ms — may be near zero if early/late cancel)
Timing spread: avg ±${report.meanAbsDeviationMs.toFixed(1)}ms per hit, consistency ±${report.stdDeviationMs.toFixed(1)}ms
Longest clean streak: ${report.longestStreak} beats${icGaLines}${lowSignalHint}${lowCoverageHint}${narrative}`;
}

export function shortPocketNote(report: SessionReport): string | undefined {
  const dev = report.meanDeviationMs;
  if (dev < -10) return "rushed";
  if (dev > 10) return "dragged";
  if (Math.abs(dev) <= 5 && report.longestStreak >= 16) return "solid pocket";
  return undefined;
}

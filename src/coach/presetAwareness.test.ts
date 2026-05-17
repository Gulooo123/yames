/**
 * Tests for C3 — Preset Awareness.
 *
 * Cover: stat rollups, BPM-band bucketing, the four minimum-data
 * gates, the three recurring-pattern detectors (BPM ceiling, timing
 * tendency, stamina), and the LLM context format.
 */

import { describe, it, expect } from "vitest";
import type { SavedSession, SessionReport } from "../types";
import {
  BPM_BAND_WIDTH,
  CEILING_MEDIAN_SCORE,
  CEILING_MIN_BAND_SESSIONS,
  RECURRING_MIN_SESSIONS,
  STAMINA_MIN_SESSIONS,
  STAMINA_SCORE_DROP_THRESHOLD,
  TIMING_TENDENCY_THRESHOLD_MS,
  bpmBandLowFor,
  detectRecurringIssues,
  detectStaminaPattern,
  formatPresetSummaryForLLM,
  summarizePreset,
} from "./presetAwareness";

const T0 = 1_715_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function makeReport(
  score: number,
  overrides: Partial<SessionReport> = {},
): SessionReport {
  return {
    totalBeats: 240, // 1 min @ 240 BPM, 2 min @ 120 BPM — varies by bpm
    hitsCount: Math.round(240 * 0.9),
    missCount: 24,
    skippedBeats: 0,
    perfectCount: 200,
    goodCount: 16,
    okCount: 0,
    meanDeviationMs: 0,
    stdDeviationMs: 5,
    meanAbsDeviationMs: 4,
    meanIntervalErrorMs: 3,
    grade: "A",
    score,
    deviations: [],
    dynamicsStd: 0.1,
    meanAmplitude: 0.5,
    tempoStabilityMs: 3,
    longestStreak: 16,
    comment: "",
    insights: [],
    gridCorrelation: 0.9,
    ...overrides,
  };
}

function makeSession(
  daysAgo: number,
  score: number,
  bpm: number,
  presetId?: string,
  options: { meanDeviationMs?: number; totalBeats?: number } = {},
): SavedSession {
  return {
    id: `s-${daysAgo}-${score}-${bpm}`,
    timestamp: T0 - daysAgo * DAY,
    bpm,
    timeSignature: 4,
    report: makeReport(score, {
      meanDeviationMs: options.meanDeviationMs ?? 0,
      totalBeats: options.totalBeats ?? 240,
    }),
    presetId,
  };
}

// ---------------------------------------------------------------------------
// Bucketing
// ---------------------------------------------------------------------------

describe("bpmBandLowFor", () => {
  it("buckets BPMs into 10-BPM bands by floor", () => {
    expect(bpmBandLowFor(100)).toBe(100);
    expect(bpmBandLowFor(109)).toBe(100);
    expect(bpmBandLowFor(110)).toBe(110);
    expect(bpmBandLowFor(135)).toBe(130);
    expect(bpmBandLowFor(60)).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// summarizePreset
// ---------------------------------------------------------------------------

describe("summarizePreset", () => {
  it("returns a zero-summary when no sessions match the preset id", () => {
    const out = summarizePreset("p1", "Warm Up", [
      makeSession(1, 80, 120, "p2"),
    ]);
    expect(out.sessionCount).toBe(0);
    expect(out.medianScore).toBe(0);
    expect(out.bpmBands).toEqual([]);
  });

  it("rolls up scores, BPM range, and bands for matched sessions", () => {
    const sessions = [
      makeSession(1, 70, 122, "p1"),
      makeSession(2, 90, 128, "p1"),
      makeSession(3, 80, 134, "p1"),
      makeSession(4, 60, 999, "other"), // filtered out
    ];
    const out = summarizePreset("p1", "Spider", sessions);
    expect(out.sessionCount).toBe(3);
    expect(out.medianScore).toBe(80);
    expect(out.bestScore).toBe(90);
    expect(out.bpmRange).toEqual({ min: 122, max: 134 });
    expect(out.bpmBands).toEqual([
      { bpmLow: 120, sessions: 2, bestScore: 90, medianScore: 80 },
      { bpmLow: 130, sessions: 1, bestScore: 80, medianScore: 80 },
    ]);
  });

  it("computes mean signed timing offset across sessions", () => {
    const sessions = [
      makeSession(1, 80, 120, "p1", { meanDeviationMs: -12 }),
      makeSession(2, 80, 120, "p1", { meanDeviationMs: -6 }),
      makeSession(3, 80, 120, "p1", { meanDeviationMs: -9 }),
    ];
    const out = summarizePreset("p1", "Run", sessions);
    expect(out.meanTimingOffsetMs).toBeCloseTo(-9, 5);
  });

  it("tracks the most recent session timestamp", () => {
    const sessions = [
      makeSession(5, 70, 120, "p1"),
      makeSession(1, 80, 120, "p1"),
      makeSession(3, 75, 120, "p1"),
    ];
    const out = summarizePreset("p1", "x", sessions);
    expect(out.lastSessionAt).toBe(T0 - 1 * DAY);
  });
});

// ---------------------------------------------------------------------------
// detectRecurringIssues — gates
// ---------------------------------------------------------------------------

describe("detectRecurringIssues — minimum-data gate", () => {
  it("returns all-null when below the recurring threshold", () => {
    const sessions = Array.from({ length: RECURRING_MIN_SESSIONS - 1 }, (_, i) =>
      makeSession(i, 50, 130, "p1", { meanDeviationMs: 15 }),
    );
    const summary = summarizePreset("p1", "x", sessions);
    const issues = detectRecurringIssues(summary);
    expect(issues.bpmCeiling).toBeNull();
    expect(issues.timingTendency).toBeNull();
    expect(issues.stamina).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BPM ceiling detection
// ---------------------------------------------------------------------------

describe("detectRecurringIssues — BPM ceiling", () => {
  it("flags the lowest band where median < threshold with enough sessions", () => {
    const sessions = [
      // 120 band: 3 sessions, median 80 → fine
      makeSession(1, 85, 120, "p1"),
      makeSession(2, 80, 122, "p1"),
      makeSession(3, 78, 128, "p1"),
      // 140 band: 3 sessions, median 60 → ceiling
      makeSession(4, 55, 140, "p1"),
      makeSession(5, 60, 142, "p1"),
      makeSession(6, 65, 148, "p1"),
    ];
    const summary = summarizePreset("p1", "x", sessions);
    const issues = detectRecurringIssues(summary);
    expect(issues.bpmCeiling).not.toBeNull();
    expect(issues.bpmCeiling!.bpmLow).toBe(140);
    expect(issues.bpmCeiling!.bpmHigh).toBe(150);
    expect(issues.bpmCeiling!.medianScore).toBe(60);
    expect(issues.bpmCeiling!.sessions).toBe(3);
  });

  it("ignores a band with fewer than CEILING_MIN_BAND_SESSIONS", () => {
    const sessions = [
      makeSession(1, 85, 120, "p1"),
      makeSession(2, 88, 122, "p1"),
      makeSession(3, 82, 124, "p1"),
      // Single rough session at 150 — not enough data to claim a ceiling
      makeSession(4, 50, 150, "p1"),
    ];
    const summary = summarizePreset("p1", "x", sessions);
    const issues = detectRecurringIssues(summary);
    expect(issues.bpmCeiling).toBeNull();
  });

  it("returns null when no band meets the ceiling criteria", () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      makeSession(i + 1, 88, 120, "p1"),
    );
    const summary = summarizePreset("p1", "x", sessions);
    expect(detectRecurringIssues(summary).bpmCeiling).toBeNull();
  });

  it("picks the lowest qualifying band (not the worst)", () => {
    const sessions = [
      // 120 band: median 60 (3 sessions) — ceiling here
      makeSession(1, 55, 120, "p1"),
      makeSession(2, 60, 122, "p1"),
      makeSession(3, 65, 128, "p1"),
      // 140 band: median 40 (3 sessions) — also bad, but not first
      makeSession(4, 35, 140, "p1"),
      makeSession(5, 40, 142, "p1"),
      makeSession(6, 45, 148, "p1"),
    ];
    const summary = summarizePreset("p1", "x", sessions);
    const issues = detectRecurringIssues(summary);
    expect(issues.bpmCeiling!.bpmLow).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// Timing tendency detection
// ---------------------------------------------------------------------------

describe("detectRecurringIssues — timing tendency", () => {
  it("returns 'rushing' when mean deviation is more negative than threshold", () => {
    const sessions = Array.from({ length: 4 }, (_, i) =>
      makeSession(i + 1, 85, 120, "p1", { meanDeviationMs: -12 }),
    );
    const summary = summarizePreset("p1", "x", sessions);
    const issues = detectRecurringIssues(summary);
    expect(issues.timingTendency).toEqual({
      direction: "rushing",
      meanOffsetMs: -12,
    });
  });

  it("returns 'dragging' when mean deviation is more positive than threshold", () => {
    const sessions = Array.from({ length: 4 }, (_, i) =>
      makeSession(i + 1, 85, 120, "p1", { meanDeviationMs: 10 }),
    );
    const summary = summarizePreset("p1", "x", sessions);
    const issues = detectRecurringIssues(summary);
    expect(issues.timingTendency?.direction).toBe("dragging");
  });

  it("returns null when within the ±threshold envelope", () => {
    const sessions = Array.from({ length: 4 }, (_, i) =>
      makeSession(i + 1, 85, 120, "p1", { meanDeviationMs: 3 }),
    );
    const summary = summarizePreset("p1", "x", sessions);
    expect(detectRecurringIssues(summary).timingTendency).toBeNull();
  });

  it("uses the strict threshold (equal to threshold ≠ tendency)", () => {
    const sessions = Array.from({ length: 4 }, (_, i) =>
      makeSession(i + 1, 85, 120, "p1", {
        meanDeviationMs: TIMING_TENDENCY_THRESHOLD_MS,
      }),
    );
    const summary = summarizePreset("p1", "x", sessions);
    expect(detectRecurringIssues(summary).timingTendency).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Stamina detection
// ---------------------------------------------------------------------------

describe("detectStaminaPattern", () => {
  it("returns null below the data gate (no sessions and no minutes)", () => {
    const sessions = Array.from({ length: STAMINA_MIN_SESSIONS - 1 }, (_, i) =>
      makeSession(i + 1, 90, 120, "p1", { totalBeats: 60 }),
    );
    expect(detectStaminaPattern(sessions, "p1")).toBeNull();
  });

  it("returns null when no band shows a meaningful drop", () => {
    const sessions = Array.from({ length: 6 }, (_, i) =>
      makeSession(i + 1, 85, 120, "p1"),
    );
    expect(detectStaminaPattern(sessions, "p1")).toBeNull();
  });

  it("flags stamina drop when early-third mean exceeds late-third by ≥ threshold", () => {
    // 6 sessions at 120 BPM band, oldest scores ~90, newest scores ~70.
    // sorted asc by timestamp: oldest first.
    const sessions = [
      makeSession(20, 92, 120, "p1"),
      makeSession(18, 90, 120, "p1"),
      makeSession(15, 88, 120, "p1"),
      makeSession(10, 72, 120, "p1"),
      makeSession(5, 70, 120, "p1"),
      makeSession(1, 68, 120, "p1"),
    ];
    const out = detectStaminaPattern(sessions, "p1");
    expect(out).not.toBeNull();
    expect(out!.bpmLow).toBe(120);
    expect(out!.scoreDrop).toBeGreaterThanOrEqual(STAMINA_SCORE_DROP_THRESHOLD);
    expect(out!.earlyMeanScore).toBeGreaterThan(out!.lateMeanScore);
  });

  it("controls for tempo (different BPM bands don't get conflated)", () => {
    // Sessions go from easy slow (high score) to hard fast (low score)
    // because of adaptive ramping — NOT stamina. With one session per
    // band, no band has enough data to fire and stamina returns null.
    const sessions = [
      makeSession(10, 95, 100, "p1"),
      makeSession(9, 92, 110, "p1"),
      makeSession(8, 88, 120, "p1"),
      makeSession(7, 82, 130, "p1"),
      makeSession(6, 70, 140, "p1"),
      makeSession(5, 60, 150, "p1"),
    ];
    expect(detectStaminaPattern(sessions, "p1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LLM context formatting
// ---------------------------------------------------------------------------

describe("formatPresetSummaryForLLM", () => {
  it("returns a 'no prior sessions' line when sessionCount is 0", () => {
    const summary = summarizePreset("p1", "Empty", []);
    const out = formatPresetSummaryForLLM(summary);
    expect(out).toContain("Empty");
    expect(out).toContain("no prior sessions");
  });

  it("renders compact preset stats with best, median, BPM range", () => {
    const sessions = [
      makeSession(1, 75, 120, "p1"),
      makeSession(2, 88, 130, "p1"),
      makeSession(3, 82, 135, "p1"),
    ];
    const summary = summarizePreset("p1", "Spider", sessions);
    const out = formatPresetSummaryForLLM(summary);
    expect(out).toContain("Spider");
    expect(out).toContain("3 sessions");
    expect(out).toContain("Best: 88");
    expect(out).toContain("BPM range: 120–135");
  });

  it("omits the tendency line when within the threshold envelope", () => {
    const sessions = Array.from({ length: 4 }, (_, i) =>
      makeSession(i + 1, 80, 120, "p1", { meanDeviationMs: 2 }),
    );
    const summary = summarizePreset("p1", "x", sessions);
    const out = formatPresetSummaryForLLM(summary);
    expect(out.toLowerCase()).not.toContain("rushing");
    expect(out.toLowerCase()).not.toContain("dragging");
  });

  it("surfaces the ceiling line when issues include one", () => {
    const sessions = [
      makeSession(1, 85, 120, "p1"),
      makeSession(2, 80, 122, "p1"),
      makeSession(3, 82, 128, "p1"),
      makeSession(4, 50, 140, "p1"),
      makeSession(5, 55, 142, "p1"),
      makeSession(6, 60, 148, "p1"),
    ];
    const summary = summarizePreset("p1", "x", sessions);
    const issues = detectRecurringIssues(summary);
    const out = formatPresetSummaryForLLM(summary, issues);
    expect(out).toContain("Ceiling: 140-149");
  });
});

// ---------------------------------------------------------------------------
// Constants sanity
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("BPM_BAND_WIDTH is 10 per plan", () => {
    expect(BPM_BAND_WIDTH).toBe(10);
  });

  it("CEILING_MEDIAN_SCORE is 70 per plan", () => {
    expect(CEILING_MEDIAN_SCORE).toBe(70);
  });

  it("CEILING_MIN_BAND_SESSIONS is 3 per plan", () => {
    expect(CEILING_MIN_BAND_SESSIONS).toBe(3);
  });
});

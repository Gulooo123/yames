import { describe, expect, it } from "vitest";

import { accuracyPct, accuracyRatio, scoredBeats } from "./reportStats";

/**
 * The accuracy denominator is the #1 source of "subtle correctness"
 * bugs in this codebase: it MUST be `hits + miss`, NOT `totalBeats`.
 * These tests pin both helpers' semantics so the call sites that
 * delegate to them inherit correctness for free.
 */
describe("scoredBeats", () => {
  it("returns hits + miss", () => {
    expect(scoredBeats({ hitsCount: 7, missCount: 3 })).toBe(10);
  });

  it("returns 0 when nothing was scored", () => {
    expect(scoredBeats({ hitsCount: 0, missCount: 0 })).toBe(0);
  });

  it("ignores other fields on the report-like object", () => {
    // The helper accepts anything structurally compatible with
    // ScoredFields; the real SessionReport carries dozens of fields.
    // This pins the shape to just the two we care about.
    const reportish = {
      hitsCount: 4,
      missCount: 1,
      totalBeats: 999, // must be ignored
      foo: "bar",
    };
    expect(scoredBeats(reportish)).toBe(5);
  });
});

describe("accuracyPct", () => {
  it("returns hits / (hits + miss) as a rounded integer percentage", () => {
    // 7 / 10 = 70%
    expect(accuracyPct({ hitsCount: 7, missCount: 3 })).toBe(70);
  });

  it("returns 100 when every scored beat was a hit", () => {
    expect(accuracyPct({ hitsCount: 5, missCount: 0 })).toBe(100);
  });

  it("returns 0 when every scored beat was a miss", () => {
    expect(accuracyPct({ hitsCount: 0, missCount: 5 })).toBe(0);
  });

  it("returns 0 (not NaN) when no beats were attempted", () => {
    // The bug we're guarding against: division by zero leaking into
    // string templates as "NaN%". This was specifically the failure
    // mode on sessions that ended before any onsets crossed the gate.
    expect(accuracyPct({ hitsCount: 0, missCount: 0 })).toBe(0);
  });

  it("rounds (does not truncate) to the nearest integer percent", () => {
    // 2 / 3 = 66.666...% → 67 (Math.round, NOT Math.floor)
    expect(accuracyPct({ hitsCount: 2, missCount: 1 })).toBe(67);
  });

  it("does NOT use totalBeats as the denominator (regression)", () => {
    // The previously-shipped bug: dividing by totalBeats instead of
    // (hits + miss) shows artificially low accuracy whenever the
    // player rested or played below the noise floor. The helper
    // must IGNORE totalBeats entirely.
    const report = {
      hitsCount: 10,
      missCount: 0,
      totalBeats: 100, // would yield 10% if used as denom
    };
    expect(accuracyPct(report)).toBe(100);
  });
});

describe("accuracyRatio", () => {
  // accuracyRatio returns a fraction in [0, 1] for callers that need
  // to compare against thresholds (e.g. MIN_SEGMENT_HIT_RATE_FOR_REPORT)
  // rather than render a percentage. accuracyPct is a thin wrapper.
  it("returns hits / (hits + miss) as a fraction", () => {
    expect(accuracyRatio({ hitsCount: 7, missCount: 3 })).toBe(0.7);
  });

  it("returns 1 when every scored beat was a hit", () => {
    expect(accuracyRatio({ hitsCount: 5, missCount: 0 })).toBe(1);
  });

  it("returns 0 (not NaN) when no beats were attempted", () => {
    // Same denominator-of-zero guard as accuracyPct — but here the
    // 0 floor matters because thresholding `NaN >= 0.4` would always
    // be false, silently hiding "no beats yet" sessions instead of
    // letting them fall to the explicit zero floor.
    expect(accuracyRatio({ hitsCount: 0, missCount: 0 })).toBe(0);
  });

  it("ignores totalBeats just like accuracyPct (regression)", () => {
    const report = {
      hitsCount: 10,
      missCount: 0,
      totalBeats: 100,
    };
    expect(accuracyRatio(report)).toBe(1);
  });

  it("accuracyPct is consistent with Math.round(accuracyRatio * 100)", () => {
    // 2 / 3 = 0.6666... → accuracyPct rounds to 67
    const r = { hitsCount: 2, missCount: 1 };
    expect(accuracyPct(r)).toBe(Math.round(accuracyRatio(r) * 100));
  });
});

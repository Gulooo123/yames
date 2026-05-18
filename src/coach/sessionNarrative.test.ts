import { describe, expect, it } from "vitest";

import { buildSessionNarrative } from "./sessionNarrative";
import type { SessionReport } from "../types";

/**
 * Tests for `buildSessionNarrative`.
 *
 * The narrative is the prose layer on top of the rule-based insights
 * the Rust side already emits — it has to stay deterministic so QA
 * can pin "this score under this shape should read this way". Each
 * test mints a `SessionReport`-shaped object with the *minimal* fields
 * needed for the branch under test, defaulting the rest to neutral
 * values via `report(...)`. Branch coverage is more important than
 * exact-string assertions — most tests look for distinctive phrases
 * ("rock solid", "Focus next:", "dragging") rather than verbatim
 * sentences so refactors of the copy don't false-flag the suite.
 */

/**
 * Builds a `SessionReport` with neutral defaults, then applies the
 * caller's overrides. The defaults are tuned so every branch starts
 * from a "boring middle" state: enough scored beats to pass the
 * MIN_RELIABLE_SCORED_BEATS gate, no quiet-input caveat, no streak,
 * no extreme std/tempo/bias. Overriding individual fields lets each
 * test isolate one shape dimension at a time.
 */
function report(overrides: Partial<SessionReport>): SessionReport {
  return {
    totalBeats: 100,
    hitsCount: 60,
    missCount: 20,
    skippedBeats: 0,
    perfectCount: 20,
    goodCount: 20,
    okCount: 20,
    meanDeviationMs: 0,
    stdDeviationMs: 18,
    meanAbsDeviationMs: 18,
    meanIntervalErrorMs: 18,
    grade: "C",
    score: 65,
    deviations: [],
    dynamicsStd: 0,
    meanAmplitude: 0.1, // well above QUIET_INPUT_AMPLITUDE
    tempoStabilityMs: 15,
    longestStreak: 5,
    comment: "",
    insights: [],
    gridCorrelation: 0,
    ...overrides,
  };
}

describe("buildSessionNarrative — data-quality gates", () => {
  it("returns a 'not enough data' headline when scored beats < threshold", () => {
    const r = report({ hitsCount: 3, missCount: 2 }); // 5 scored < 8
    const n = buildSessionNarrative(r);
    expect(n.headline).toMatch(/Not enough scored beats/i);
    expect(n.praise).toBeUndefined();
    expect(n.focus).toBeUndefined();
  });

  it("adds the quiet-input caveat when amplitude is below threshold", () => {
    const r = report({ meanAmplitude: 0.01 });
    const n = buildSessionNarrative(r);
    expect(n.caveat).toMatch(/very quiet/i);
    // Caveat must remain even on a strong session — quiet input is
    // *always* worth surfacing.
    const strong = buildSessionNarrative(report({ meanAmplitude: 0.01, score: 90 }));
    expect(strong.caveat).toMatch(/very quiet/i);
  });

  it("attaches the quiet-input caveat to the not-enough-data branch too", () => {
    const r = report({ hitsCount: 2, missCount: 1, meanAmplitude: 0.01 });
    const n = buildSessionNarrative(r);
    expect(n.headline).toMatch(/Not enough/i);
    expect(n.caveat).toMatch(/very quiet/i);
  });
});

describe("buildSessionNarrative — score-band headlines", () => {
  it("score >= 95 → near-perfect headline", () => {
    const n = buildSessionNarrative(report({ score: 96 }));
    expect(n.headline).toMatch(/Near-perfect/i);
  });

  it("score >= 85 → strong session headline", () => {
    const n = buildSessionNarrative(report({ score: 88 }));
    expect(n.headline).toMatch(/Strong session/i);
  });

  it("score 70..84 with tight std → 'closer to an A' framing", () => {
    const n = buildSessionNarrative(report({ score: 72, stdDeviationMs: 10 }));
    expect(n.headline).toMatch(/closer to an A/i);
  });

  it("score 70..84 with loose std → 'real foundation' framing", () => {
    const n = buildSessionNarrative(report({ score: 72, stdDeviationMs: 22 }));
    expect(n.headline).toMatch(/real foundation/i);
  });

  it("score 55..69 with tight std → 'spacing is actually very tight' framing", () => {
    // This is the user's primary complaint case: a middling score
    // that hides a tight, consistent performance. The narrative MUST
    // call this out explicitly.
    const n = buildSessionNarrative(report({ score: 65, stdDeviationMs: 10 }));
    expect(n.headline).toMatch(/very tight/i);
    expect(n.headline).toMatch(/jumps to 80\+/);
  });

  it("score 55..69 with high hit rate but loose std → 'accuracy problem' framing", () => {
    const n = buildSessionNarrative(
      report({
        score: 60,
        stdDeviationMs: 22,
        hitsCount: 90,
        missCount: 8, // 90/(90+8) ≈ 92% > HIGH_HIT_RATE
      }),
    );
    expect(n.headline).toMatch(/accuracy problem/i);
  });

  it("score 55..69 with neither tight std nor high hit rate → generic 'foundation' line", () => {
    const n = buildSessionNarrative(
      report({ score: 60, stdDeviationMs: 22, hitsCount: 50, missCount: 50 }),
    );
    expect(n.headline).toMatch(/foundation is there/i);
  });

  it("score 40..54 → work-in-progress headline", () => {
    const n = buildSessionNarrative(report({ score: 45 }));
    expect(n.headline).toMatch(/work in progress/i);
  });

  it("score < 40 → early-days headline", () => {
    const n = buildSessionNarrative(report({ score: 30 }));
    expect(n.headline).toMatch(/early days/i);
  });
});

describe("buildSessionNarrative — praise picker", () => {
  it("surfaces a strong streak above all other positives", () => {
    const n = buildSessionNarrative(report({ longestStreak: 24 }));
    expect(n.praise).toMatch(/24 beats in a row/);
  });

  it("praises rock-solid clock when both std and tempo are tight", () => {
    const n = buildSessionNarrative(
      report({ stdDeviationMs: 8, tempoStabilityMs: 5, longestStreak: 0 }),
    );
    expect(n.praise).toMatch(/rock solid/i);
  });

  it("praises tight consistency when only std is tight", () => {
    const n = buildSessionNarrative(
      report({ stdDeviationMs: 8, tempoStabilityMs: 20, longestStreak: 0 }),
    );
    expect(n.praise).toMatch(/consistency is tight/i);
  });

  it("praises perfect ratio when most hits were perfect", () => {
    const n = buildSessionNarrative(
      report({
        hitsCount: 20,
        perfectCount: 15, // 75% > 60%
        stdDeviationMs: 18, // ensure consistency-praise branches don't fire
        longestStreak: 0,
      }),
    );
    expect(n.praise).toMatch(/perfect/i);
    expect(n.praise).toMatch(/75%/);
  });

  it("praises centered timing when bias is small but hit count is meaningful", () => {
    const n = buildSessionNarrative(
      report({
        meanDeviationMs: 1,
        hitsCount: 20,
        perfectCount: 5, // suppress perfect-ratio branch
        stdDeviationMs: 18,
        longestStreak: 0,
      }),
    );
    expect(n.praise).toMatch(/centered/i);
  });

  it("does not invent praise when nothing is notable", () => {
    const n = buildSessionNarrative(
      report({
        stdDeviationMs: 30,
        tempoStabilityMs: 30,
        meanDeviationMs: 20,
        perfectCount: 5,
        hitsCount: 20,
        longestStreak: 0,
      }),
    );
    expect(n.praise).toBeUndefined();
  });
});

describe("buildSessionNarrative — focus picker", () => {
  it("flags scatter first when std is loose", () => {
    const n = buildSessionNarrative(report({ stdDeviationMs: 30 }));
    expect(n.focus).toMatch(/evenness/i);
  });

  it("flags spacing when std is OK but tempo stability is loose", () => {
    const n = buildSessionNarrative(
      report({ stdDeviationMs: 18, tempoStabilityMs: 35 }),
    );
    expect(n.focus).toMatch(/spacing/i);
  });

  it("flags dragging when bias is large positive", () => {
    const n = buildSessionNarrative(
      report({
        stdDeviationMs: 18,
        tempoStabilityMs: 20,
        meanDeviationMs: 15,
      }),
    );
    expect(n.focus).toMatch(/dragging/i);
    expect(n.focus).toMatch(/15 ms behind/);
  });

  it("flags rushing when bias is large negative", () => {
    const n = buildSessionNarrative(
      report({
        stdDeviationMs: 18,
        tempoStabilityMs: 20,
        meanDeviationMs: -15,
      }),
    );
    expect(n.focus).toMatch(/rushing/i);
  });

  it("flags low hit rate when timing components are OK but hits are sparse", () => {
    const n = buildSessionNarrative(
      report({
        stdDeviationMs: 18,
        tempoStabilityMs: 20,
        meanDeviationMs: 2,
        hitsCount: 20,
        missCount: 30, // 40% < LOW_HIT_RATE
      }),
    );
    expect(n.focus).toMatch(/weren't registering as hits/i);
  });

  it("does not invent focus when everything reads clean", () => {
    const n = buildSessionNarrative(
      report({
        score: 90,
        stdDeviationMs: 8,
        tempoStabilityMs: 5,
        meanDeviationMs: 1,
        meanAbsDeviationMs: 6,
        hitsCount: 90,
        missCount: 2,
      }),
    );
    expect(n.focus).toBeUndefined();
  });
});

describe("buildSessionNarrative — skip note vs caveat priority", () => {
  it("emits a skip note when a meaningful fraction of beats had no sound", () => {
    const n = buildSessionNarrative(
      report({ totalBeats: 100, skippedBeats: 25, meanAmplitude: 0.1 }),
    );
    expect(n.caveat).toMatch(/no detected sound/i);
  });

  it("prefers the quiet-input caveat over the skip note when both fire", () => {
    // Quiet input is a more actionable warning (user can fix the
    // sensitivity slider) so it MUST win over the skipped-beats note.
    const n = buildSessionNarrative(
      report({ totalBeats: 100, skippedBeats: 25, meanAmplitude: 0.01 }),
    );
    expect(n.caveat).toMatch(/very quiet/i);
  });

  it("does not emit a skip note for a handful of natural rests", () => {
    const n = buildSessionNarrative(
      report({ totalBeats: 100, skippedBeats: 5 }),
    );
    expect(n.caveat).toBeUndefined();
  });
});

/**
 * Tests for C4 — Smart Coaching Timing (Gatekeeper).
 *
 * Cover: cooldown math, channel independence, always-speak overrides,
 * streak suppression, scenario detectors (accuracy drop, personal
 * best, rushing/dragging trends with confirmation rule, new-band
 * locked, check-in floor), forced events, drill staleness, and
 * chat-reset behaviour.
 */

import { describe, it, expect } from "vitest";
import type { BeatFeedback } from "../types";
import {
  ACCURACY_DROP_WINDOW,
  CHECK_IN_AFTER_QUIET_MS,
  DRILL_STALENESS_BPM,
  FIRST_BEATS_TTS_FLOOR,
  LOW_CONFIDENCE_SUSTAIN_MS,
  NEW_BAND_DURATION_MS,
  SPOKEN_COOLDOWN_CEILING_MS,
  SPOKEN_COOLDOWN_FLOOR_MS,
  STREAK_PERSONAL_BEST_MIN,
  TREND_CONFIRMATION_REQUIRED,
  WRITTEN_COOLDOWN_CEILING_MS,
  WRITTEN_COOLDOWN_FLOOR_MS,
  createGatekeeper,
  evaluate,
  isAlwaysSpoken,
  isFirstBeatsExempt,
  resetCooldowns,
  shouldDropForStaleness,
  spokenCooldownMs,
  writtenCooldownMs,
} from "./gatekeeper";

const T0 = 1_715_000_000_000;

function fb(
  classification: BeatFeedback["classification"],
  deviationMs = 0,
): BeatFeedback {
  return {
    beatIndex: 0,
    deviationMs,
    intervalErrorMs: 0,
    classification,
    amplitude: 0.5,
    calibrationOffsetMs: 0,
    calibrationConfidence: 0.8,
    gridCorrelation: 0.9,
  };
}

function manyHits(n: number, dev = 0): BeatFeedback[] {
  return Array.from({ length: n }, () => fb("perfect", dev));
}

function manyMisses(n: number): BeatFeedback[] {
  return Array.from({ length: n }, () => fb("miss"));
}

function manySkipped(n: number): BeatFeedback[] {
  return Array.from({ length: n }, () => fb("skipped"));
}

/**
 * Seed bestStreak to a value higher than any window length used in
 * the test so the personal-best-streak detector doesn't hijack the
 * scenario under test. Real usage seeds bestStreak from the segment
 * record; we keep tests focused by pre-seeding here.
 */
const HIGH_PB = 10_000;

// ---------------------------------------------------------------------------
// Cooldown math
// ---------------------------------------------------------------------------

describe("spokenCooldownMs", () => {
  it("clamps to the 20s floor for short sessions", () => {
    expect(spokenCooldownMs(0)).toBe(SPOKEN_COOLDOWN_FLOOR_MS);
    expect(spokenCooldownMs(60_000)).toBe(SPOKEN_COOLDOWN_FLOOR_MS);
  });

  it("scales linearly between floor and ceiling", () => {
    // 5 minute mark → 30s, halfway between 20s and 60s.
    expect(spokenCooldownMs(300_000)).toBe(30_000);
  });

  it("clamps to the 60s ceiling for long sessions", () => {
    expect(spokenCooldownMs(20 * 60 * 1000)).toBe(SPOKEN_COOLDOWN_CEILING_MS);
  });
});

describe("writtenCooldownMs", () => {
  it("clamps to the 3s floor and 10s ceiling", () => {
    expect(writtenCooldownMs(0)).toBe(WRITTEN_COOLDOWN_FLOOR_MS);
    expect(writtenCooldownMs(60_000)).toBe(WRITTEN_COOLDOWN_FLOOR_MS); // 3s at 1 min
    expect(writtenCooldownMs(5 * 60 * 1000)).toBe(15_000 > WRITTEN_COOLDOWN_CEILING_MS
      ? WRITTEN_COOLDOWN_CEILING_MS
      : 15_000);
    expect(writtenCooldownMs(60 * 60 * 1000)).toBe(WRITTEN_COOLDOWN_CEILING_MS);
  });
});

describe("shouldDropForStaleness", () => {
  it("returns false when no BPM tag attached to the comment", () => {
    expect(shouldDropForStaleness(undefined, 120)).toBe(false);
  });

  it("returns false when BPM moved by the threshold or less", () => {
    expect(shouldDropForStaleness(120, 125)).toBe(false);
    expect(shouldDropForStaleness(120, 115)).toBe(false);
  });

  it("returns true when BPM moved by more than DRILL_STALENESS_BPM", () => {
    expect(shouldDropForStaleness(120, 120 + DRILL_STALENESS_BPM + 1)).toBe(true);
    expect(shouldDropForStaleness(120, 120 - DRILL_STALENESS_BPM - 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Always-speak overrides
// ---------------------------------------------------------------------------

describe("isAlwaysSpoken", () => {
  it("flags milestones, boundary events, and key interventions", () => {
    expect(isAlwaysSpoken("personal_best_streak")).toBe(true);
    expect(isAlwaysSpoken("boundary_signal_a")).toBe(true);
    expect(isAlwaysSpoken("boundary_signal_b")).toBe(true);
    expect(isAlwaysSpoken("tempo_milestone")).toBe(true);
    expect(isAlwaysSpoken("recovery")).toBe(true);
    expect(isAlwaysSpoken("fatigue")).toBe(true);
    expect(isAlwaysSpoken("new_band_locked")).toBe(true);
  });

  it("does NOT flag everyday observations", () => {
    expect(isAlwaysSpoken("accuracy_drop")).toBe(false);
    expect(isAlwaysSpoken("rushing_trend")).toBe(false);
    expect(isAlwaysSpoken("dragging_trend")).toBe(false);
    expect(isAlwaysSpoken("low_confidence")).toBe(false);
    expect(isAlwaysSpoken("check_in")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Detectors — accuracy drop
// ---------------------------------------------------------------------------

describe("evaluate — accuracy_drop", () => {
  it("fires when recent hit rate drops by ≥20% vs prior window", () => {
    const state = { ...createGatekeeper(T0), bestStreak: HIGH_PB };
    const window = [
      ...manyHits(ACCURACY_DROP_WINDOW), // prior: 100%
      ...manyMisses(10), // recent: 10 misses + 6 hits = ~37%
      ...manyHits(ACCURACY_DROP_WINDOW - 10),
    ];
    expect(window.length).toBe(ACCURACY_DROP_WINDOW * 2);
    // Allow enough session time to pass spoken cooldown.
    const { event } = evaluate(state, {
      now: T0 + 30_000,
      bpm: 120,
      window,
    });
    expect(event).not.toBeNull();
    expect(event!.scenario).toBe("accuracy_drop");
    expect(event!.tier).toBe("spoken");
  });

  it("does NOT fire when accuracy is steady", () => {
    const state = { ...createGatekeeper(T0), bestStreak: HIGH_PB };
    const window = manyHits(ACCURACY_DROP_WINDOW * 2);
    const { event } = evaluate(state, {
      now: T0 + 30_000,
      bpm: 120,
      window,
    });
    expect(event).toBeNull();
  });

  it("does NOT fire while inside the spoken cooldown window", () => {
    const state = {
      ...createGatekeeper(T0),
      lastSpokenMs: T0 + 25_000, // just spoke 5s ago at the 30s mark
    };
    const window = [
      ...manyHits(ACCURACY_DROP_WINDOW),
      ...manyMisses(ACCURACY_DROP_WINDOW),
    ];
    const { event } = evaluate(state, {
      now: T0 + 30_000,
      bpm: 120,
      window,
    });
    expect(event).toBeNull();
  });

  // Regression — v0.9: the gatekeeper was firing
  // "Rough patch at 0% — ease the tempo down…" the moment the player
  // paused between exercises because the all-skipped recent window
  // counted every silent tick as a missed beat. Recent + prior both
  // need a minimum number of ATTEMPTED beats before we trust the
  // accuracy delta. See ACCURACY_DROP_MIN_SCORED.
  it("does NOT fire when the recent window is entirely skipped (player paused)", () => {
    const state = { ...createGatekeeper(T0), bestStreak: HIGH_PB };
    const window = [
      ...manyHits(ACCURACY_DROP_WINDOW), // prior: 100% hits
      ...manySkipped(ACCURACY_DROP_WINDOW), // recent: nobody home
    ];
    const { event } = evaluate(state, {
      now: T0 + 30_000,
      bpm: 120,
      window,
    });
    expect(event).toBeNull();
  });

  it("does NOT fire when the recent window has too few attempts to be meaningful", () => {
    const state = { ...createGatekeeper(T0), bestStreak: HIGH_PB };
    // Recent half is mostly skipped with a couple of misses — under the
    // ACCURACY_DROP_MIN_SCORED floor, no detector should claim to know
    // what the player's "accuracy" is.
    const recent: BeatFeedback[] = [
      ...manySkipped(ACCURACY_DROP_WINDOW - 2),
      ...manyMisses(2),
    ];
    const window = [
      ...manyHits(ACCURACY_DROP_WINDOW),
      ...recent,
    ];
    const { event } = evaluate(state, {
      now: T0 + 30_000,
      bpm: 120,
      window,
    });
    expect(event).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Detectors — personal_best_streak
// ---------------------------------------------------------------------------

describe("evaluate — personal_best_streak", () => {
  it("fires once when the trailing clean streak exceeds the prior best", () => {
    const state = {
      ...createGatekeeper(T0),
      bestStreak: 8,
    };
    const window = manyHits(STREAK_PERSONAL_BEST_MIN + 10);
    const { state: s2, event } = evaluate(state, {
      now: T0 + 30_000,
      bpm: 120,
      window,
    });
    expect(event?.scenario).toBe("personal_best_streak");
    expect(event?.tier).toBe("spoken");
    expect(s2.bestStreak).toBe(window.length);
  });

  it("does not fire when the streak does not improve the best", () => {
    const state = {
      ...createGatekeeper(T0),
      bestStreak: 100,
    };
    const { event } = evaluate(state, {
      now: T0 + 30_000,
      bpm: 120,
      window: manyHits(STREAK_PERSONAL_BEST_MIN + 5),
    });
    expect(event).toBeNull();
  });

  it("bypasses cooldown because it's an always-speak event", () => {
    const state = {
      ...createGatekeeper(T0),
      lastSpokenMs: T0 + 29_000, // 1s ago — would gate everyday events
      bestStreak: 8,
    };
    const { event } = evaluate(state, {
      now: T0 + 30_000,
      bpm: 120,
      window: manyHits(20),
    });
    expect(event?.scenario).toBe("personal_best_streak");
  });
});

// ---------------------------------------------------------------------------
// Detectors — rushing / dragging trends + confirmation rule
// ---------------------------------------------------------------------------

describe("evaluate — rushing_trend confirmation rule", () => {
  it("first detection emits WRITTEN; second consecutive emits SPOKEN", () => {
    let state = { ...createGatekeeper(T0), bestStreak: HIGH_PB };
    const window = [
      ...manyHits(ACCURACY_DROP_WINDOW, 0), // prior: ~0ms
      ...manyHits(ACCURACY_DROP_WINDOW, -10), // recent: -10ms
    ];

    // Pass inStreak: false explicitly — in real usage a 100%-hit-rate
    // window would also trigger streak suppression and downgrade
    // spoken to written. This test isolates the confirmation rule.
    const r1 = evaluate(state, {
      now: T0 + 30_000,
      bpm: 120,
      window,
      inStreak: false,
    });
    expect(r1.event?.scenario).toBe("rushing_trend");
    expect(r1.event?.tier).toBe("written");
    state = r1.state;

    const r2 = evaluate(state, {
      now: T0 + 60_000,
      bpm: 120,
      window,
      inStreak: false,
    });
    expect(r2.event?.scenario).toBe("rushing_trend");
    expect(r2.event?.tier).toBe("spoken");
  });

  it("dragging trend mirrors rushing", () => {
    let state = { ...createGatekeeper(T0), bestStreak: HIGH_PB };
    const window = [
      ...manyHits(ACCURACY_DROP_WINDOW, 0),
      ...manyHits(ACCURACY_DROP_WINDOW, 10),
    ];
    const r1 = evaluate(state, {
      now: T0 + 30_000,
      bpm: 120,
      window,
      inStreak: false,
    });
    expect(r1.event?.scenario).toBe("dragging_trend");
    state = r1.state;
    const r2 = evaluate(state, {
      now: T0 + 60_000,
      bpm: 120,
      window,
      inStreak: false,
    });
    expect(r2.event?.scenario).toBe("dragging_trend");
    expect(r2.event?.tier).toBe("spoken");
  });

  it("resets confirmation counter when trend dies (no flap)", () => {
    let state = { ...createGatekeeper(T0), bestStreak: HIGH_PB };
    const rushWindow = [
      ...manyHits(ACCURACY_DROP_WINDOW, 0),
      ...manyHits(ACCURACY_DROP_WINDOW, -10),
    ];
    state = evaluate(state, { now: T0 + 30_000, bpm: 120, window: rushWindow }).state;
    expect(state.trendConfirmations.rushing).toBe(1);

    // Stable window — should zero confirmations.
    const steadyWindow = manyHits(ACCURACY_DROP_WINDOW * 2, 0);
    state = evaluate(state, { now: T0 + 60_000, bpm: 120, window: steadyWindow }).state;
    expect(state.trendConfirmations.rushing).toBe(0);
  });

  it("requires TREND_CONFIRMATION_REQUIRED detections before spoken", () => {
    expect(TREND_CONFIRMATION_REQUIRED).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Streak suppression
// ---------------------------------------------------------------------------

describe("evaluate — streak suppression mid-segment", () => {
  it("downgrades spoken trend to written when accuracy stays high", () => {
    // Build state with confirmations already at 1 so the next call
    // would naturally escalate to spoken — except for streak suppression.
    let state = createGatekeeper(T0);
    const window = [
      ...manyHits(ACCURACY_DROP_WINDOW, 0),
      ...manyHits(ACCURACY_DROP_WINDOW, -10),
    ];
    state = evaluate(state, { now: T0 + 30_000, bpm: 120, window }).state;
    // Force in-streak.
    const { event } = evaluate(state, {
      now: T0 + 60_000,
      bpm: 120,
      window,
      inStreak: true,
    });
    expect(event?.tier).toBe("written");
  });

  it("does NOT downgrade always-spoken scenarios", () => {
    const state = { ...createGatekeeper(T0), bestStreak: 8 };
    const { event } = evaluate(state, {
      now: T0 + 30_000,
      bpm: 120,
      window: manyHits(20),
      inStreak: true,
    });
    expect(event?.scenario).toBe("personal_best_streak");
    expect(event?.tier).toBe("spoken");
  });
});

// ---------------------------------------------------------------------------
// New-band-locked
// ---------------------------------------------------------------------------

describe("evaluate — new_band_locked", () => {
  it("waits NEW_BAND_DURATION_MS at the same band before firing", () => {
    let state = { ...createGatekeeper(T0), bestStreak: HIGH_PB };
    const window = manyHits(20);

    // First evaluation seeds the lock timestamp.
    let r = evaluate(state, { now: T0 + 30_000, bpm: 130, window });
    expect(r.event).toBeNull();
    expect(r.state.lockedBpmLow).toBe(130);
    state = r.state;

    // Still inside the duration window — no fire.
    r = evaluate(state, {
      now: T0 + 30_000 + NEW_BAND_DURATION_MS - 1,
      bpm: 130,
      window,
    });
    expect(r.event).toBeNull();
    state = r.state;

    // Crossed the duration — fires once.
    r = evaluate(state, {
      now: T0 + 30_000 + NEW_BAND_DURATION_MS + 1,
      bpm: 130,
      window,
    });
    expect(r.event?.scenario).toBe("new_band_locked");
    expect(r.event?.tier).toBe("spoken");
    // After firing, lock-since clears so we don't re-emit until
    // the user leaves and re-enters the band.
    expect(r.state.bandLockedSinceMs).toBeNull();
  });

  it("resets the lock when accuracy drops below 85%", () => {
    let state = { ...createGatekeeper(T0), bestStreak: HIGH_PB };
    state = evaluate(state, {
      now: T0 + 30_000,
      bpm: 130,
      window: manyHits(20),
    }).state;
    expect(state.lockedBpmLow).toBe(130);

    state = evaluate(state, {
      now: T0 + 35_000,
      bpm: 130,
      window: [...manyHits(10), ...manyMisses(10)], // 50% hit rate
    }).state;
    expect(state.lockedBpmLow).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Check-in adaptive floor
// ---------------------------------------------------------------------------

describe("evaluate — check_in adaptive floor", () => {
  it("fires after 5+ minutes of silence on the spoken channel", () => {
    const state = { ...createGatekeeper(T0), bestStreak: HIGH_PB };
    const { event } = evaluate(state, {
      now: T0 + CHECK_IN_AFTER_QUIET_MS + 1,
      bpm: 120,
      window: manyHits(8), // not enough for trend detectors
    });
    expect(event?.scenario).toBe("check_in");
    expect(event?.tier).toBe("spoken");
  });

  it("does NOT fire if a spoken event happened recently", () => {
    const state = {
      ...createGatekeeper(T0),
      bestStreak: HIGH_PB,
      lastSpokenMs: T0 + CHECK_IN_AFTER_QUIET_MS - 60_000,
    };
    const { event } = evaluate(state, {
      now: T0 + CHECK_IN_AFTER_QUIET_MS,
      bpm: 120,
      window: manyHits(8),
    });
    expect(event).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Forced events
// ---------------------------------------------------------------------------

describe("evaluate — forced events", () => {
  it("forced scenario always wins, bypassing cooldown", () => {
    const state = {
      ...createGatekeeper(T0),
      lastSpokenMs: T0 + 29_000, // 1s ago — would gate everyday events
    };
    const { event } = evaluate(state, {
      now: T0 + 30_000,
      bpm: 120,
      window: manyHits(8),
      force: {
        scenario: "boundary_signal_b",
        context: { score: 91, bpm: 120 },
      },
    });
    expect(event?.scenario).toBe("boundary_signal_b");
    expect(event?.tier).toBe("spoken");
    expect(event?.context.score).toBe(91);
  });

  it("forced event commits lastSpokenMs so subsequent calls cool down", () => {
    const state = createGatekeeper(T0);
    const r = evaluate(state, {
      now: T0 + 1_000,
      bpm: 120,
      window: [],
      force: { scenario: "boundary_signal_a", context: {} },
    });
    expect(r.state.lastSpokenMs).toBe(T0 + 1_000);
  });
});

// ---------------------------------------------------------------------------
// resetCooldowns (chat engagement)
// ---------------------------------------------------------------------------

describe("resetCooldowns", () => {
  it("pulls last*Ms back so the next event fires after the floor only", () => {
    const state = {
      ...createGatekeeper(T0),
      lastSpokenMs: T0 + 60_000,
      lastWrittenMs: T0 + 60_000,
    };
    const reset = resetCooldowns(state, T0 + 90_000);
    expect(T0 + 90_000 - reset.lastSpokenMs).toBe(SPOKEN_COOLDOWN_FLOOR_MS);
    expect(T0 + 90_000 - reset.lastWrittenMs).toBe(WRITTEN_COOLDOWN_FLOOR_MS);
  });

  it("preserves trend confirmations and best-streak knowledge", () => {
    const state = {
      ...createGatekeeper(T0),
      bestStreak: 24,
      trendConfirmations: { rushing: 1, dragging: 0 },
    };
    const reset = resetCooldowns(state, T0 + 60_000);
    expect(reset.bestStreak).toBe(24);
    expect(reset.trendConfirmations).toEqual({ rushing: 1, dragging: 0 });
  });
});

// ---------------------------------------------------------------------------
// First-4-beats hard rule (TTS suppression)
// ---------------------------------------------------------------------------

describe("isFirstBeatsExempt", () => {
  it("exempts boundary_signal_a so user-initiated changes still speak", () => {
    expect(isFirstBeatsExempt("boundary_signal_a")).toBe(true);
  });

  it("does NOT exempt boundary_signal_b (post-activity-gap can wait 4 beats)", () => {
    expect(isFirstBeatsExempt("boundary_signal_b")).toBe(false);
  });

  it("does NOT exempt observational scenarios", () => {
    expect(isFirstBeatsExempt("accuracy_drop")).toBe(false);
    expect(isFirstBeatsExempt("rushing_trend")).toBe(false);
    expect(isFirstBeatsExempt("personal_best_streak")).toBe(false);
    expect(isFirstBeatsExempt("check_in")).toBe(false);
  });
});

describe("evaluate — first-4-beats TTS hard rule", () => {
  it("demotes spoken accuracy_drop to written during first 4 beats", () => {
    const state = { ...createGatekeeper(T0), bestStreak: HIGH_PB };
    const window = [
      ...manyHits(ACCURACY_DROP_WINDOW),
      ...manyMisses(ACCURACY_DROP_WINDOW),
    ];
    const { event } = evaluate(state, {
      now: T0 + 30_000,
      bpm: 120,
      window,
      beatsInSegment: 2,
    });
    expect(event?.scenario).toBe("accuracy_drop");
    expect(event?.tier).toBe("written");
  });

  it("speaks once the segment has crossed the FIRST_BEATS_TTS_FLOOR", () => {
    const state = { ...createGatekeeper(T0), bestStreak: HIGH_PB };
    const window = [
      ...manyHits(ACCURACY_DROP_WINDOW),
      ...manyMisses(ACCURACY_DROP_WINDOW),
    ];
    const { event } = evaluate(state, {
      now: T0 + 30_000,
      bpm: 120,
      window,
      beatsInSegment: FIRST_BEATS_TTS_FLOOR,
    });
    expect(event?.scenario).toBe("accuracy_drop");
    expect(event?.tier).toBe("spoken");
  });

  it("Signal A always speaks even at beat 0 (user-initiated boundary)", () => {
    const state = createGatekeeper(T0);
    const { event } = evaluate(state, {
      now: T0 + 1_000,
      bpm: 130,
      window: manyHits(8),
      beatsInSegment: 0,
      force: {
        scenario: "boundary_signal_a",
        context: { change: "tempo up to 130 BPM" },
      },
    });
    expect(event?.scenario).toBe("boundary_signal_a");
    expect(event?.tier).toBe("spoken");
  });

  it("Signal B is demoted during the first 4 beats of its new segment", () => {
    const state = createGatekeeper(T0);
    const { event } = evaluate(state, {
      now: T0 + 1_000,
      bpm: 130,
      window: manyHits(8),
      beatsInSegment: 1,
      force: {
        scenario: "boundary_signal_b",
        context: { score: 88 },
      },
    });
    expect(event?.scenario).toBe("boundary_signal_b");
    expect(event?.tier).toBe("written");
  });

  it("rule is bypassed when beatsInSegment is omitted (legacy callers)", () => {
    const state = { ...createGatekeeper(T0), bestStreak: HIGH_PB };
    const window = [
      ...manyHits(ACCURACY_DROP_WINDOW),
      ...manyMisses(ACCURACY_DROP_WINDOW),
    ];
    const { event } = evaluate(state, {
      now: T0 + 30_000,
      bpm: 120,
      window,
    });
    expect(event?.tier).toBe("spoken");
  });
});

// ---------------------------------------------------------------------------
// Low-confidence caveat (one-shot per session)
// ---------------------------------------------------------------------------

function fbWithConfidence(
  classification: BeatFeedback["classification"],
  calibrationConfidence: number,
): BeatFeedback {
  return {
    beatIndex: 0,
    deviationMs: 0,
    intervalErrorMs: 0,
    classification,
    amplitude: 0.5,
    calibrationOffsetMs: 0,
    calibrationConfidence,
    gridCorrelation: 0.9,
  };
}

function lowConfWindow(n: number, conf: number): BeatFeedback[] {
  return Array.from({ length: n }, () => fbWithConfidence("good", conf));
}

describe("evaluate — low_confidence caveat", () => {
  it("does NOT fire on the first dip below 0.5 (needs to sustain)", () => {
    const state = { ...createGatekeeper(T0), bestStreak: HIGH_PB };
    const r = evaluate(state, {
      now: T0 + 30_000,
      bpm: 120,
      window: lowConfWindow(16, 0.3),
    });
    expect(r.event).toBeNull();
    // But the dip timer should be seeded.
    expect(r.state.lowConfidenceSinceMs).toBe(T0 + 30_000);
  });

  it("fires once after LOW_CONFIDENCE_SUSTAIN_MS of sustained low confidence", () => {
    let state = { ...createGatekeeper(T0), bestStreak: HIGH_PB };
    // Open the dip timer.
    state = evaluate(state, {
      now: T0 + 30_000,
      bpm: 120,
      window: lowConfWindow(16, 0.3),
    }).state;
    // Cross the sustain threshold.
    const r = evaluate(state, {
      now: T0 + 30_000 + LOW_CONFIDENCE_SUSTAIN_MS + 1,
      bpm: 120,
      window: lowConfWindow(16, 0.3),
    });
    expect(r.event?.scenario).toBe("low_confidence");
    expect(r.event?.tier).toBe("spoken");
  });

  it("is one-shot — does NOT fire again once it has fired this session", () => {
    let state = { ...createGatekeeper(T0), bestStreak: HIGH_PB };
    state = evaluate(state, {
      now: T0 + 30_000,
      bpm: 120,
      window: lowConfWindow(16, 0.3),
    }).state;
    state = evaluate(state, {
      now: T0 + 30_000 + LOW_CONFIDENCE_SUSTAIN_MS + 1,
      bpm: 120,
      window: lowConfWindow(16, 0.3),
    }).state;
    // Second sustained dip after a "recovery" gap.
    state = { ...state, lowConfidenceSinceMs: null };
    const r = evaluate(state, {
      now: T0 + 5 * LOW_CONFIDENCE_SUSTAIN_MS,
      bpm: 120,
      window: lowConfWindow(16, 0.2),
    });
    // No new low_confidence event — and the dip timer should be re-seeded
    // for telemetry but not act on it.
    expect(r.event?.scenario).not.toBe("low_confidence");
  });

  it("clears the dip timer when confidence recovers above 0.5", () => {
    let state = { ...createGatekeeper(T0), bestStreak: HIGH_PB };
    state = evaluate(state, {
      now: T0 + 30_000,
      bpm: 120,
      window: lowConfWindow(16, 0.3),
    }).state;
    expect(state.lowConfidenceSinceMs).not.toBeNull();
    state = evaluate(state, {
      now: T0 + 45_000,
      bpm: 120,
      window: lowConfWindow(16, 0.8), // recovered
    }).state;
    expect(state.lowConfidenceSinceMs).toBeNull();
  });

  it("does NOT fire when confidence is high", () => {
    const state = { ...createGatekeeper(T0), bestStreak: HIGH_PB };
    const r = evaluate(state, {
      now: T0 + 30_000,
      bpm: 120,
      window: lowConfWindow(16, 0.9),
    });
    expect(r.event).toBeNull();
    expect(r.state.lowConfidenceSinceMs).toBeNull();
  });
});

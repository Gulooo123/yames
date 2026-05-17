import { describe, expect, it } from "vitest";

import {
  BPM_BUMP_MAX_BPM,
  BPM_BUMP_SCORE_FLOOR,
  BPM_DROP_MIN_BPM,
  BPM_DROP_SCORE_CEILING,
  INTERVENTION_CATALOG,
  INTERVENTION_RATE_CAP,
  INTERVENTION_WINDOW_MS,
  REST_MIN_SESSION_MS,
  buildInterventionPlaceholders,
  createInterventionState,
  pickIntervention,
  recordIntervention,
  type Intervention,
  type InterventionContext,
} from "./interventions";
import type { GatekeeperEvent } from "./gatekeeper";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ev(
  scenario: GatekeeperEvent["scenario"],
  overrides: Partial<GatekeeperEvent> = {},
): GatekeeperEvent {
  return {
    scenario,
    tier: "written",
    context: {},
    taggedBpm: 120,
    ...overrides,
  };
}

function ctx(overrides: Partial<InterventionContext> = {}): InterventionContext {
  return {
    bpm: 150,
    score: 60,
    sessionDurationMs: 60_000,
    segmentsCompleted: 2,
    ...overrides,
  };
}

function findById(id: Intervention["id"]): Intervention {
  const found = INTERVENTION_CATALOG.find((c) => c.id === id);
  if (!found) throw new Error(`missing intervention ${id} in catalog`);
  return found;
}

// ---------------------------------------------------------------------------
// Catalog sanity
// ---------------------------------------------------------------------------

describe("INTERVENTION_CATALOG", () => {
  it("contains the five v1 interventions", () => {
    const ids = INTERVENTION_CATALOG.map((c) => c.id).sort();
    expect(ids).toEqual([
      "bpm-bump",
      "bpm-drop",
      "calibration-retry",
      "posture-reset",
      "rest",
    ]);
  });

  it("each intervention has non-empty template + actionLabel + dismissLabel", () => {
    for (const c of INTERVENTION_CATALOG) {
      expect(c.template.length).toBeGreaterThan(0);
      expect(c.actionLabel.length).toBeGreaterThan(0);
      expect(c.dismissLabel.length).toBeGreaterThan(0);
    }
  });

  it("catalog is frozen — runtime mutation throws", () => {
    expect(() => {
      // @ts-expect-error — intentional mutation attempt
      INTERVENTION_CATALOG.push({} as Intervention);
    }).toThrow();
  });

  it("every intervention declares a positive cooldown", () => {
    for (const c of INTERVENTION_CATALOG) {
      expect(c.cooldownMs).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// pickIntervention — qualification gates
// ---------------------------------------------------------------------------

describe("pickIntervention — qualification gates", () => {
  it("bpm-drop fires on accuracy_drop + low score + bpm above floor", () => {
    const event = ev("accuracy_drop");
    const result = pickIntervention(
      event,
      ctx({ score: 55, bpm: 150 }),
      createInterventionState(),
      Date.now(),
    );
    expect(result?.intervention.id).toBe("bpm-drop");
  });

  it("bpm-drop does NOT fire when score is at or above the ceiling", () => {
    const event = ev("accuracy_drop");
    const result = pickIntervention(
      event,
      ctx({ score: BPM_DROP_SCORE_CEILING, bpm: 150 }),
      createInterventionState(),
      Date.now(),
    );
    expect(result).toBeNull();
  });

  it("bpm-drop does NOT fire below the BPM floor (no point dropping further)", () => {
    const event = ev("accuracy_drop");
    const result = pickIntervention(
      event,
      ctx({ score: 50, bpm: BPM_DROP_MIN_BPM - 1 }),
      createInterventionState(),
      Date.now(),
    );
    expect(result).toBeNull();
  });

  it("bpm-bump fires on personal_best_streak with high score below ceiling", () => {
    const event = ev("personal_best_streak");
    const result = pickIntervention(
      event,
      ctx({ score: 95, bpm: 130 }),
      createInterventionState(),
      Date.now(),
    );
    expect(result?.intervention.id).toBe("bpm-bump");
  });

  it("bpm-bump fires on tempo_milestone too", () => {
    const event = ev("tempo_milestone");
    const result = pickIntervention(
      event,
      ctx({ score: BPM_BUMP_SCORE_FLOOR, bpm: 130 }),
      createInterventionState(),
      Date.now(),
    );
    expect(result?.intervention.id).toBe("bpm-bump");
  });

  it("bpm-bump does NOT fire above the BPM ceiling", () => {
    const event = ev("personal_best_streak");
    const result = pickIntervention(
      event,
      ctx({ score: 95, bpm: BPM_BUMP_MAX_BPM }),
      createInterventionState(),
      Date.now(),
    );
    expect(result).toBeNull();
  });

  it("rest fires on fatigue after the minimum session duration", () => {
    const event = ev("fatigue");
    const result = pickIntervention(
      event,
      ctx({ sessionDurationMs: REST_MIN_SESSION_MS + 1_000 }),
      createInterventionState(),
      Date.now(),
    );
    expect(result?.intervention.id).toBe("rest");
  });

  it("rest does NOT fire before the minimum session duration", () => {
    const event = ev("fatigue");
    const result = pickIntervention(
      event,
      ctx({ sessionDurationMs: REST_MIN_SESSION_MS - 1_000 }),
      createInterventionState(),
      Date.now(),
    );
    expect(result).toBeNull();
  });

  it("returns null when the gatekeeper event doesn't map to any intervention", () => {
    // `check_in` is a scenario the catalog deliberately ignores — it's
    // a sentinel/inline note, never an intervention surface.
    const event = ev("check_in");
    const result = pickIntervention(
      event,
      ctx(),
      createInterventionState(),
      Date.now(),
    );
    expect(result).toBeNull();
  });

  // ---- calibration-retry ----

  it("calibration-retry fires on low_confidence", () => {
    const event = ev("low_confidence");
    const result = pickIntervention(
      event,
      ctx(),
      createInterventionState(),
      Date.now(),
    );
    expect(result?.intervention.id).toBe("calibration-retry");
    expect(result?.action).toEqual({ kind: "clear-calibration" });
  });

  it("calibration-retry does NOT fire on unrelated scenarios", () => {
    const event = ev("personal_best_streak");
    const result = pickIntervention(
      event,
      ctx({ score: 95, bpm: 200 }), // bpm-bump ceiling — no other match
      createInterventionState(),
      Date.now(),
    );
    expect(result).toBeNull();
  });

  // ---- posture-reset vs rest priority ----

  it("posture-reset wins over rest on long sessions with enough segments", () => {
    const event = ev("fatigue");
    const result = pickIntervention(
      event,
      ctx({ sessionDurationMs: 26 * 60_000, segmentsCompleted: 5 }),
      createInterventionState(),
      Date.now(),
    );
    expect(result?.intervention.id).toBe("posture-reset");
  });

  it("rest falls through when posture-reset's stricter gate isn't met", () => {
    const event = ev("fatigue");
    // Long enough for rest but not posture (fewer segments)
    const result = pickIntervention(
      event,
      ctx({ sessionDurationMs: 26 * 60_000, segmentsCompleted: 2 }),
      createInterventionState(),
      Date.now(),
    );
    expect(result?.intervention.id).toBe("rest");
  });

  it("posture-reset action is a 60-second take-break", () => {
    const event = ev("fatigue");
    const result = pickIntervention(
      event,
      ctx({ sessionDurationMs: 30 * 60_000, segmentsCompleted: 5 }),
      createInterventionState(),
      Date.now(),
    );
    expect(result?.action).toEqual({ kind: "take-break", durationMs: 60_000 });
  });
});

// ---------------------------------------------------------------------------
// pickIntervention — rate limiting
// ---------------------------------------------------------------------------

describe("pickIntervention — rate limiting", () => {
  it("respects per-id cooldown after firing", () => {
    const now = 1_000_000;
    let state = createInterventionState();
    const bpmDrop = findById("bpm-drop");
    state = recordIntervention(state, "bpm-drop", now);
    const event = ev("accuracy_drop");
    // Same intervention, still inside cooldown → suppressed
    const halfWay = pickIntervention(
      event,
      ctx({ score: 50, bpm: 150 }),
      state,
      now + bpmDrop.cooldownMs - 1,
    );
    expect(halfWay).toBeNull();
    // Same intervention, just past cooldown → allowed again
    const after = pickIntervention(
      event,
      ctx({ score: 50, bpm: 150 }),
      state,
      now + bpmDrop.cooldownMs + 1,
    );
    expect(after?.intervention.id).toBe("bpm-drop");
  });

  it("blocks all interventions once the rate cap is hit", () => {
    const now = 1_000_000;
    let state = createInterventionState();
    state = recordIntervention(state, "bpm-drop", now);
    state = recordIntervention(state, "bpm-bump", now + 1);
    // Two interventions already in the 5-min window → cap hit
    const blocked = pickIntervention(
      ev("fatigue"),
      ctx({ sessionDurationMs: REST_MIN_SESSION_MS + 1_000 }),
      state,
      now + 2,
    );
    expect(blocked).toBeNull();
  });

  it("rate cap resets after the window slides past the old timestamps", () => {
    const now = 1_000_000;
    let state = createInterventionState();
    state = recordIntervention(state, "bpm-drop", now);
    state = recordIntervention(state, "bpm-bump", now + 1_000);
    // Wait the full window — both records should be expired
    const future = now + INTERVENTION_WINDOW_MS + 1_000;
    const result = pickIntervention(
      ev("fatigue"),
      ctx({ sessionDurationMs: REST_MIN_SESSION_MS + 1_000 }),
      state,
      future,
    );
    expect(result?.intervention.id).toBe("rest");
  });

  it("cap is per window — not lifetime", () => {
    const now = 1_000_000;
    let state = createInterventionState();
    // Fire two in early window
    state = recordIntervention(state, "bpm-drop", now - INTERVENTION_WINDOW_MS - 10);
    state = recordIntervention(state, "bpm-bump", now - INTERVENTION_WINDOW_MS - 5);
    // Both are outside the window now; we should be allowed to fire again
    const result = pickIntervention(
      ev("accuracy_drop"),
      ctx({ score: 50, bpm: 150 }),
      state,
      now,
    );
    expect(result?.intervention.id).toBe("bpm-drop");
  });

  it("recordIntervention purges expired timestamps", () => {
    const now = 1_000_000;
    let state = createInterventionState();
    state = recordIntervention(state, "bpm-drop", now - INTERVENTION_WINDOW_MS - 1);
    state = recordIntervention(state, "bpm-bump", now);
    // First timestamp should have been purged on the second record
    expect(state.recentTimestamps.length).toBe(1);
    expect(state.recentTimestamps[0]).toBe(now);
  });

  it("INTERVENTION_RATE_CAP is exposed for downstream callers to inspect", () => {
    expect(INTERVENTION_RATE_CAP).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Placeholder rendering
// ---------------------------------------------------------------------------

describe("buildInterventionPlaceholders", () => {
  it("includes bpm + score for every intervention", () => {
    const drop = findById("bpm-drop");
    const ph = buildInterventionPlaceholders(drop, ctx({ bpm: 150, score: 65 }));
    expect(ph.bpm).toBe(150);
    expect(ph.score).toBe(65);
  });

  it("computes newBpm from the bpmDelta of a set-bpm action", () => {
    const drop = findById("bpm-drop");
    const ph = buildInterventionPlaceholders(drop, ctx({ bpm: 150 }));
    expect(ph.newBpm).toBe(140); // -10 delta
  });

  it("clamps newBpm to [20, 300]", () => {
    const drop = findById("bpm-drop");
    const phLow = buildInterventionPlaceholders(drop, ctx({ bpm: 25 }));
    expect(phLow.newBpm).toBe(20);
    const bump = findById("bpm-bump");
    const phHigh = buildInterventionPlaceholders(bump, ctx({ bpm: 295 }));
    expect(phHigh.newBpm).toBe(300);
  });

  it("adds minutes for the rest intervention", () => {
    const rest = findById("rest");
    const ph = buildInterventionPlaceholders(
      rest,
      ctx({ sessionDurationMs: REST_MIN_SESSION_MS + 65_000 }),
    );
    // 12 minutes + ~1.08 minutes → 13 floor'd
    expect(ph.minutes).toBe(13);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: pickIntervention output
// ---------------------------------------------------------------------------

describe("pickIntervention — end-to-end output shape", () => {
  it("returns resolved text, actionLabel, dismissLabel with placeholders filled", () => {
    const result = pickIntervention(
      ev("accuracy_drop"),
      ctx({ score: 55, bpm: 150 }),
      createInterventionState(),
      Date.now(),
    );
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.text).toBe(
      "You're at 150 and struggling a bit — want to drop to 140?",
    );
    expect(result.actionLabel).toBe("Drop to 140 BPM");
    expect(result.dismissLabel).toBe("Stay at 150");
    expect(result.action).toEqual({ kind: "set-bpm", bpmDelta: -10 });
  });

  it("rest intervention renders the minute count and break action", () => {
    const result = pickIntervention(
      ev("fatigue"),
      ctx({ sessionDurationMs: REST_MIN_SESSION_MS + 30_000 }),
      createInterventionState(),
      Date.now(),
    );
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.text).toContain("12 minutes in");
    expect(result.action).toEqual({ kind: "take-break", durationMs: 30_000 });
    expect(result.actionLabel).toBe("Start 30s rest");
  });
});

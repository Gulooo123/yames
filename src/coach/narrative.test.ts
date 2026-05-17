/**
 * Tests for C1 — Session Narrative.
 *
 * Cover: construction, immutability of append, formatting for LLM,
 * coach-utterance prefix handling, and the 2KB middle-truncation
 * algorithm with its five preserved anchor lines.
 */

import { describe, it, expect } from "vitest";
import {
  COACH_PREFIX,
  NARRATIVE_BYTE_CAP,
  TRUNCATE_PRESERVE_LAST_SEGMENTS,
  appendActivityTransition,
  appendCoachUtterance,
  appendDrillMilestone,
  appendInstrumentChange,
  appendLine,
  appendPresetChange,
  appendSegmentEnd,
  appendUserAction,
  createNarrative,
  enforceByteCap,
  formatForLLM,
} from "./narrative";

const T0 = 1_715_000_000_000;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe("createNarrative", () => {
  it("seeds the narrative with a single session-start line", () => {
    const n = createNarrative({ bpm: 120, presetName: "Warm Up", now: T0 });
    expect(n.startedAtMs).toBe(T0);
    expect(n.lines).toHaveLength(1);
    expect(n.lines[0].kind).toBe("session-start");
    expect(n.lines[0].sessionElapsedSec).toBe(0);
    expect(n.lines[0].text).toContain("120 BPM");
    expect(n.lines[0].text).toContain("Warm Up");
  });

  it("works without optional fields", () => {
    const n = createNarrative({ bpm: 100, now: T0 });
    expect(n.lines).toHaveLength(1);
    expect(n.lines[0].text).toContain("100 BPM");
  });

  it("embeds prior session summary when provided", () => {
    const n = createNarrative({
      bpm: 135,
      priorSummary: "last session: 88% at 135 BPM",
      now: T0,
    });
    expect(n.lines[0].text).toContain("last session: 88% at 135 BPM");
  });
});

// ---------------------------------------------------------------------------
// Append: immutability + elapsed time
// ---------------------------------------------------------------------------

describe("appendLine", () => {
  it("returns a NEW narrative without mutating the input", () => {
    const a = createNarrative({ bpm: 120, now: T0 });
    const b = appendLine(a, {
      kind: "user-action",
      text: "User pressed start",
      now: T0 + 5_000,
    });
    expect(a.lines).toHaveLength(1);
    expect(b.lines).toHaveLength(2);
    expect(a).not.toBe(b);
    expect(b.lines[1].sessionElapsedSec).toBe(5);
  });

  it("clamps negative elapsed seconds to 0 (clock skew defense)", () => {
    const a = createNarrative({ bpm: 120, now: T0 });
    const b = appendLine(a, {
      kind: "user-action",
      text: "weird",
      now: T0 - 10_000,
    });
    expect(b.lines[1].sessionElapsedSec).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Convenience appenders
// ---------------------------------------------------------------------------

describe("convenience appenders", () => {
  it("appendSegmentEnd numbers segments starting at 1 and rounds score", () => {
    let n = createNarrative({ bpm: 120, now: T0 });
    n = appendSegmentEnd(n, { score: 91.4, bpm: 120 }, T0 + 150_000);
    n = appendSegmentEnd(
      n,
      { score: 84.6, bpm: 122, note: "tempo wobble" },
      T0 + 300_000,
    );
    expect(n.lines[1].text).toBe("Segment 1 ended: 91% at 120 BPM");
    expect(n.lines[2].text).toBe(
      "Segment 2 ended: 85% at 122 BPM, tempo wobble",
    );
  });

  it("appendCoachUtterance adds [Coach said]: prefix and quotes the text", () => {
    let n = createNarrative({ bpm: 120, now: T0 });
    n = appendCoachUtterance(n, "Nice — let's go up 2 BPM", T0 + 10_000);
    expect(n.lines[1].text).toBe(`${COACH_PREFIX} "Nice — let's go up 2 BPM"`);
    expect(n.lines[1].kind).toBe("coach-utterance");
  });

  it("appendCoachUtterance strips a pre-existing prefix to avoid double-wrap", () => {
    let n = createNarrative({ bpm: 120, now: T0 });
    n = appendCoachUtterance(n, `${COACH_PREFIX} Tighten the 16ths`, T0);
    // Should NOT contain the prefix twice.
    const matches = n.lines[1].text.match(/\[Coach said\]:/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(n.lines[1].text).toBe(`${COACH_PREFIX} "Tighten the 16ths"`);
  });

  it("appendDrillMilestone formats with note + BPM", () => {
    let n = createNarrative({ bpm: 120, now: T0 });
    n = appendDrillMilestone(n, 130, "new personal best", T0 + 60_000);
    expect(n.lines[1].text).toBe(
      "Drill milestone: new personal best at 130 BPM",
    );
  });

  it("appendUserAction and appendActivityTransition and appendPresetChange render expected text", () => {
    let n = createNarrative({ bpm: 120, now: T0 });
    n = appendUserAction(n, "User toggled metronome", T0);
    n = appendActivityTransition(n, "Idle -> Active", T0);
    n = appendPresetChange(n, "Spider Exercise", T0);
    expect(n.lines[1].text).toBe("User toggled metronome");
    expect(n.lines[2].text).toBe("Activity: Idle -> Active");
    expect(n.lines[3].text).toBe("[Preset changed: Spider Exercise]");
  });

  it("appendInstrumentChange renders bracketed text the LLM treats as context", () => {
    let n = createNarrative({ bpm: 120, now: T0 });
    n = appendInstrumentChange(n, "piano", T0 + 30_000);
    expect(n.lines[1].kind).toBe("instrument-change");
    expect(n.lines[1].text).toBe("[Instrument switched: piano]");
  });
});

// ---------------------------------------------------------------------------
// formatForLLM
// ---------------------------------------------------------------------------

describe("formatForLLM", () => {
  it("renders 'Session timeline:' header and m:ss prefixed lines", () => {
    let n = createNarrative({ bpm: 120, now: T0 });
    n = appendSegmentEnd(n, { score: 91, bpm: 120 }, T0 + 150_000); // 2:30
    n = appendCoachUtterance(n, "Solid pocket", T0 + 155_000); // 2:35
    const out = formatForLLM(n);
    const lines = out.split("\n");
    expect(lines[0]).toBe("Session timeline:");
    expect(lines[1]).toMatch(/^0:00 — Started at 120 BPM/);
    expect(lines[2]).toBe("2:30 — Segment 1 ended: 91% at 120 BPM");
    expect(lines[3]).toBe(`2:35 — ${COACH_PREFIX} "Solid pocket"`);
  });

  it("pads seconds to two digits", () => {
    let n = createNarrative({ bpm: 120, now: T0 });
    n = appendUserAction(n, "x", T0 + 7_000); // 0:07 — not 0:7
    const out = formatForLLM(n);
    expect(out).toContain("0:07 — x");
  });
});

// ---------------------------------------------------------------------------
// Byte cap + truncation
// ---------------------------------------------------------------------------

function buildLargeNarrative(): {
  narrative: ReturnType<typeof createNarrative>;
  segmentCount: number;
} {
  let n = createNarrative({ bpm: 120, presetName: "Stress Test", now: T0 });
  // Add many segments + coach utterances to blow past the 2KB cap.
  // Each segment + coach line is ~70 bytes; we need ~30+ to exceed 2KB.
  const COUNT = 60;
  for (let i = 0; i < COUNT; i++) {
    n = appendSegmentEnd(
      n,
      { score: 70 + (i % 25), bpm: 120, note: "padding padding padding" },
      T0 + (i + 1) * 60_000,
    );
    n = appendCoachUtterance(
      n,
      `coach line ${i} with some filler so it's not too short`,
      T0 + (i + 1) * 60_000 + 1_000,
    );
  }
  return { narrative: n, segmentCount: COUNT };
}

describe("enforceByteCap", () => {
  it("returns narrative untouched when already under cap", () => {
    let n = createNarrative({ bpm: 120, now: T0 });
    n = appendSegmentEnd(n, { score: 90, bpm: 120 }, T0 + 1000);
    expect(formatForLLM(n).length).toBeLessThan(NARRATIVE_BYTE_CAP);
    const out = enforceByteCap(n);
    // Same reference — no copy when within budget.
    expect(out).toBe(n);
  });

  it("brings an oversize narrative back under the cap", () => {
    const { narrative } = buildLargeNarrative();
    // Cap is enforced on every append; the post-build narrative should
    // already be under cap.
    const size = new TextEncoder().encode(formatForLLM(narrative)).length;
    expect(size).toBeLessThanOrEqual(NARRATIVE_BYTE_CAP);
  });

  it("preserves the session-start line after truncation", () => {
    const { narrative } = buildLargeNarrative();
    expect(narrative.lines[0].kind).toBe("session-start");
    expect(narrative.lines[0].text).toContain("120 BPM");
  });

  it("preserves the first segment-end line after truncation", () => {
    const { narrative } = buildLargeNarrative();
    const segEnds = narrative.lines.filter((l) => l.kind === "segment-end");
    expect(segEnds.length).toBeGreaterThan(0);
    expect(segEnds[0].text).toBe(
      "Segment 1 ended: 70% at 120 BPM, padding padding padding",
    );
  });

  it("preserves the last K segment-end lines after truncation", () => {
    const { narrative, segmentCount } = buildLargeNarrative();
    const segEnds = narrative.lines.filter((l) => l.kind === "segment-end");
    // The last few segment-ends should correspond to segments near the end.
    const lastFew = segEnds.slice(-TRUNCATE_PRESERVE_LAST_SEGMENTS);
    expect(lastFew.length).toBe(TRUNCATE_PRESERVE_LAST_SEGMENTS);
    for (let i = 0; i < lastFew.length; i++) {
      // Segments are numbered 1..N at append time; truncation never
      // renumbers them.
      const seg = segmentCount - (TRUNCATE_PRESERVE_LAST_SEGMENTS - 1 - i);
      expect(lastFew[i].text).toMatch(new RegExp(`Segment ${seg} ended`));
    }
  });

  it("preserves the most recent coach utterance after truncation", () => {
    const { narrative, segmentCount } = buildLargeNarrative();
    const coachLines = narrative.lines.filter(
      (l) => l.kind === "coach-utterance",
    );
    expect(coachLines.length).toBeGreaterThan(0);
    // The most recent coach line is the last one appended in the loop.
    const last = coachLines[coachLines.length - 1];
    expect(last.text).toContain(`coach line ${segmentCount - 1}`);
  });

  it("emits a '[N earlier line(s) hidden]' filler in place of dropped middle", () => {
    const { narrative } = buildLargeNarrative();
    const filler = narrative.lines.find((l) =>
      /\[\d+ earlier lines? hidden\]/.test(l.text),
    );
    expect(filler).toBeDefined();
    expect(filler?.kind).toBe("user-action");
  });

  it("returns narrative as-is when there are too few lines to truncate", () => {
    // 3 lines or fewer — short-circuit branch.
    let n = createNarrative({ bpm: 120, now: T0 });
    n = appendSegmentEnd(n, { score: 90, bpm: 120 }, T0 + 1000);
    n = appendSegmentEnd(n, { score: 91, bpm: 121 }, T0 + 2000);
    expect(enforceByteCap(n).lines).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Integration: realistic small session
// ---------------------------------------------------------------------------

describe("integration — small session timeline", () => {
  it("produces a recognizable, parseable timeline", () => {
    let n = createNarrative({
      bpm: 120,
      presetName: "Warm Up",
      priorSummary: "last session: 88% at 120 BPM",
      now: T0,
    });
    n = appendSegmentEnd(
      n,
      { score: 91, bpm: 120, note: "solid pocket" },
      T0 + 150_000,
    );
    n = appendCoachUtterance(n, "Nice — let's go up 2 BPM", T0 + 152_000);
    n = appendUserAction(n, "User accepted suggestion", T0 + 153_000);
    n = appendSegmentEnd(
      n,
      { score: 86, bpm: 122 },
      T0 + 300_000,
    );

    const out = formatForLLM(n);
    expect(out).toContain("Session timeline:");
    expect(out).toContain("0:00 — Started at 120 BPM");
    expect(out).toContain("2:30 — Segment 1 ended: 91% at 120 BPM, solid pocket");
    expect(out).toContain(`2:32 — ${COACH_PREFIX} "Nice — let's go up 2 BPM"`);
    expect(out).toContain("2:33 — User accepted suggestion");
    expect(out).toContain("5:00 — Segment 2 ended: 86% at 122 BPM");
  });
});

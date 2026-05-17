/**
 * C1 — Session Narrative.
 *
 * A compact running text log maintained on the JS side that gets
 * included in every LLM query the coach makes. The narrative captures
 * the *arc* of a practice session — what was attempted, how segments
 * went, what the coach has already said — so the model has structured
 * memory across utterances without unbounded growth.
 *
 * Design constraints (from the plan):
 *   * Hard cap **2 KB**. Truncate from the middle when approaching cap.
 *   * Always preserve session-start line, first segment summary, last
 *     three segment summaries, most recent coach utterance.
 *   * Coach utterances prefixed with `[Coach said]:` so the LLM never
 *     echoes its own prior lines back as if newly spoken.
 *
 * The module is intentionally framework-free — no React, no Tauri.
 * Pure data in, pure strings out, fully unit-testable.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard cap on the rendered narrative size, bytes (UTF-8). */
export const NARRATIVE_BYTE_CAP = 2048;

/** Always-preserved last N segment summaries when truncating. */
export const TRUNCATE_PRESERVE_LAST_SEGMENTS = 3;

/** Coach-line prefix used to suppress LLM self-echo loops. */
export const COACH_PREFIX = "[Coach said]:";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NarrativeLineKind =
  | "session-start"
  | "segment-end"
  | "drill-milestone"
  | "coach-utterance"
  | "user-action"
  | "activity-transition"
  | "preset-change"
  | "instrument-change";

export type NarrativeLine = {
  /** Wall-clock ms (Unix epoch). */
  timestampMs: number;
  /** Seconds since session start (used for `m:ss` rendering). */
  sessionElapsedSec: number;
  kind: NarrativeLineKind;
  text: string;
};

export type Narrative = {
  /** Wall-clock ms (Unix epoch) of the session-start line. */
  startedAtMs: number;
  /**
   * Monotonic counter of segments appended over the session lifetime.
   * Survives truncation so segment numbers stay stable in the rendered
   * timeline even after middle lines are dropped.
   */
  segmentCount: number;
  lines: NarrativeLine[];
};

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export type SessionStartContext = {
  bpm: number;
  presetName?: string;
  presetId?: string;
  /** Brief prior-session summary, e.g. `"last session: 88% at 135 BPM"`. */
  priorSummary?: string;
  instrument?: string;
  /** Override for testing — defaults to `Date.now()`. */
  now?: number;
};

/**
 * Create a new narrative seeded with the session-start line.
 *
 * The session-start line is always preserved by the truncation logic,
 * even when the narrative grows past `NARRATIVE_BYTE_CAP`.
 */
export function createNarrative(ctx: SessionStartContext): Narrative {
  const startedAtMs = ctx.now ?? Date.now();
  const bits = [`Started at ${ctx.bpm} BPM`];
  if (ctx.presetName) {
    bits.push(`preset: ${ctx.presetName}`);
  }
  if (ctx.priorSummary) {
    bits.push(ctx.priorSummary);
  }
  if (ctx.instrument) {
    bits.push(ctx.instrument);
  }
  const text = `${bits.shift()} (${bits.join(", ")})`;
  return {
    startedAtMs,
    segmentCount: 0,
    lines: [
      {
        timestampMs: startedAtMs,
        sessionElapsedSec: 0,
        kind: "session-start",
        text,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Appending
// ---------------------------------------------------------------------------

type AppendArgs = {
  kind: NarrativeLineKind;
  text: string;
  /** Wall-clock ms; defaults to `Date.now()`. */
  now?: number;
};

/**
 * Append a line. Returns a NEW narrative (no mutation) so React state
 * updates stay predictable. The 2KB cap is enforced *here* — if the
 * post-append size would exceed the budget, the middle gets truncated.
 *
 * The session-start line, the first segment-end line, the last
 * `TRUNCATE_PRESERVE_LAST_SEGMENTS` segment-end lines, and the most
 * recent coach-utterance line are always preserved per the plan.
 */
export function appendLine(narrative: Narrative, args: AppendArgs): Narrative {
  const now = args.now ?? Date.now();
  const sessionElapsedSec = Math.max(
    0,
    Math.floor((now - narrative.startedAtMs) / 1000),
  );
  const next: Narrative = {
    startedAtMs: narrative.startedAtMs,
    segmentCount:
      narrative.segmentCount + (args.kind === "segment-end" ? 1 : 0),
    lines: [
      ...narrative.lines,
      {
        timestampMs: now,
        sessionElapsedSec,
        kind: args.kind,
        text: args.text,
      },
    ],
  };
  return enforceByteCap(next);
}

// ---------------------------------------------------------------------------
// Convenience append helpers — one per event source
// ---------------------------------------------------------------------------

export function appendSegmentEnd(
  narrative: Narrative,
  summary: { score: number; bpm: number; note?: string },
  now?: number,
): Narrative {
  // Use the monotonic counter on the narrative — `countSegments(...)`
  // would drift downward as truncation drops middle segments, leaving
  // the user staring at "Segment 5 ended" for their 16th actual
  // segment. The counter survives truncation.
  const segIndex = narrative.segmentCount + 1;
  const scorePct = Math.round(summary.score);
  const note = summary.note ? `, ${summary.note}` : "";
  return appendLine(narrative, {
    kind: "segment-end",
    text: `Segment ${segIndex} ended: ${scorePct}% at ${summary.bpm} BPM${note}`,
    now,
  });
}

export function appendCoachUtterance(
  narrative: Narrative,
  utterance: string,
  now?: number,
): Narrative {
  // Strip any pre-existing prefix to keep the wire clean.
  const cleaned = utterance.replace(/^\[Coach said\]:\s*/, "").trim();
  return appendLine(narrative, {
    kind: "coach-utterance",
    text: `${COACH_PREFIX} "${cleaned}"`,
    now,
  });
}

export function appendDrillMilestone(
  narrative: Narrative,
  bpm: number,
  note: string,
  now?: number,
): Narrative {
  return appendLine(narrative, {
    kind: "drill-milestone",
    text: `Drill milestone: ${note} at ${bpm} BPM`,
    now,
  });
}

export function appendUserAction(
  narrative: Narrative,
  action: string,
  now?: number,
): Narrative {
  return appendLine(narrative, {
    kind: "user-action",
    text: action,
    now,
  });
}

export function appendPresetChange(
  narrative: Narrative,
  presetName: string,
  now?: number,
): Narrative {
  return appendLine(narrative, {
    kind: "preset-change",
    text: `[Preset changed: ${presetName}]`,
    now,
  });
}

export function appendInstrumentChange(
  narrative: Narrative,
  instrumentLabel: string,
  now?: number,
): Narrative {
  return appendLine(narrative, {
    kind: "instrument-change",
    text: `[Instrument switched: ${instrumentLabel}]`,
    now,
  });
}

export function appendActivityTransition(
  narrative: Narrative,
  transition: string,
  now?: number,
): Narrative {
  return appendLine(narrative, {
    kind: "activity-transition",
    text: `Activity: ${transition}`,
    now,
  });
}

// ---------------------------------------------------------------------------
// Rendering for the LLM
// ---------------------------------------------------------------------------

/**
 * Render the narrative as the multi-line text block passed to the
 * coach LLM. Format:
 *
 *     Session timeline:
 *     0:00 — Started at 120 BPM (...)
 *     2:30 — Segment 1 ended: 91% at 120 BPM, solid pocket
 *     ...
 *
 * Coach utterances keep their `[Coach said]:` prefix so the model
 * doesn't claim them as its own.
 */
export function formatForLLM(narrative: Narrative): string {
  const lines = narrative.lines.map(
    (line) => `${formatElapsed(line.sessionElapsedSec)} — ${line.text}`,
  );
  return ["Session timeline:", ...lines].join("\n");
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Approximate UTF-8 byte length without allocating a full encoder. */
function approxUtf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i += 1; // skip low surrogate
    } else n += 3;
  }
  return n;
}

/**
 * Enforce the 2KB byte cap. If under cap, return as-is. Otherwise drop
 * lines from the *middle*, preserving:
 *   * The first line (always — it's the session-start).
 *   * The first segment-end summary (the "where we started" anchor).
 *   * The last `TRUNCATE_PRESERVE_LAST_SEGMENTS` segment-end summaries.
 *   * The most recent coach-utterance line.
 *
 * A `[N earlier lines hidden]` filler replaces the dropped middle so
 * the LLM knows there's history it's not seeing.
 */
export function enforceByteCap(narrative: Narrative): Narrative {
  const renderedSize = approxUtf8Bytes(formatForLLM(narrative));
  if (renderedSize <= NARRATIVE_BYTE_CAP) {
    return narrative;
  }

  const lines = narrative.lines;
  if (lines.length <= 3) {
    // Nothing meaningful to truncate — return as-is and let the LLM
    // deal with the (still small) overflow. Defensive only; in
    // practice every line is ≤ 200 bytes so this branch is dead.
    return narrative;
  }

  // Indices that must survive truncation.
  const keep = new Set<number>();
  keep.add(0); // session-start

  // First segment-end
  const segEnds = lines
    .map((l, i) => (l.kind === "segment-end" ? i : -1))
    .filter((i) => i >= 0);
  if (segEnds.length > 0) keep.add(segEnds[0]);

  // Last K segment-ends
  for (
    let k = Math.max(0, segEnds.length - TRUNCATE_PRESERVE_LAST_SEGMENTS);
    k < segEnds.length;
    k++
  ) {
    keep.add(segEnds[k]);
  }

  // Most recent coach utterance
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].kind === "coach-utterance") {
      keep.add(i);
      break;
    }
  }

  // Most recent line always — gives the model the freshest context.
  keep.add(lines.length - 1);

  // Iteratively drop "dispensable" lines (those not in `keep`) from
  // the middle until we fit. We drop from the middle outward — the
  // older middle goes first.
  const droppedSet = new Set<number>();
  const dispensable = lines
    .map((_, i) => i)
    .filter((i) => !keep.has(i));

  // Sort dispensable by distance from the middle, ascending — so we
  // drop the middle-most first.
  const mid = lines.length / 2;
  dispensable.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));

  for (const idx of dispensable) {
    droppedSet.add(idx);
    const candidate = buildTruncated(narrative, droppedSet);
    if (approxUtf8Bytes(formatForLLM(candidate)) <= NARRATIVE_BYTE_CAP) {
      return candidate;
    }
  }

  // Couldn't fit even after dropping all dispensable lines.
  // Return the best we could do — the kept-set with a hidden filler.
  return buildTruncated(narrative, droppedSet);
}

function buildTruncated(
  source: Narrative,
  dropped: Set<number>,
): Narrative {
  const lines = source.lines;
  const out: NarrativeLine[] = [];
  let runStart = -1;
  let runCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (dropped.has(i)) {
      if (runStart < 0) runStart = i;
      runCount += 1;
      continue;
    }
    if (runCount > 0) {
      // Emit a filler line between the kept blocks.
      out.push({
        timestampMs: lines[runStart].timestampMs,
        sessionElapsedSec: lines[runStart].sessionElapsedSec,
        kind: "user-action",
        text: `[${runCount} earlier line${runCount === 1 ? "" : "s"} hidden]`,
      });
      runStart = -1;
      runCount = 0;
    }
    out.push(lines[i]);
  }
  return {
    startedAtMs: source.startedAtMs,
    segmentCount: source.segmentCount,
    lines: out,
  };
}

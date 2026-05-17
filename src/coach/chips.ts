/**
 * Phase 5 — Chip Catalog
 *
 * Chips are pre-curated, context-aware follow-up questions surfaced
 * after a mini-report (Signal B) or via the mid-session "ask coach"
 * affordance. They are the **primary discovery surface** for what the
 * coach can answer: a curated menu beats a blank text box every time
 * (plan PREMISE 6).
 *
 * Each chip declares a hard predicate (does it qualify *at all* given
 * the current session state?), an answer pathway (Canned | TemplateFill
 * | LLM), and a category for diversity. The selector runs a five-step
 * pipeline (hard filter → relevance score → recency penalty → diversity
 * → top-3 + Escape) and returns at most four chips: three substantive
 * plus the always-present "Ask something else…" escape hatch.
 *
 * **Why "menu of chips" instead of "free LLM Q&A"?**
 *   - Chips are visible: the user discovers what the coach can do
 *     without having to guess wording.
 *   - Chips are deterministic: the answers go through TemplateFill
 *     (or static Canned strings), so the same chip on the same data
 *     never hallucinates.
 *   - Free text is still available via the Escape chip — chips are
 *     the fast path, not the only path.
 *
 * This module ships:
 *   - The `Chip` / `ChipCategory` / `AnswerPathway` types.
 *   - A starter catalog (the seven chips the plan's example list calls
 *     out, authored to be extension-friendly — adding a chip is a
 *     single entry in `CHIP_CATALOG`).
 *   - `selectChips(ctx)` — the five-step selector.
 *   - `answerChip(chip, ctx)` — resolves a chip to its rendered answer
 *     for the Canned + TemplateFill pathways. LLM pathway is left to
 *     the caller (it routes into the existing rephrase / free-text
 *     pipeline owned by `useSession`).
 *
 * Recency tracking lives in `localStorage` (key
 * `coach.chips.lastShownIds`) so it persists across sessions without
 * touching the Rust store layer. Trivial state — fine for v1.
 */

import type { SessionReport } from "../types";
import { fillTemplate } from "./templates";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChipCategory =
  | "bpm-advice"
  | "timing-pattern"
  | "comparison"      // current session vs past
  | "next-step"       // what to work on
  | "diagnostic"      // why am I struggling
  | "escape";         // "Ask something else…"

export type AnswerPathway = "canned" | "template-fill" | "llm";

/**
 * One chip in the catalog. Authoring shape — kept declarative so the
 * catalog can be reviewed/edited as data, not code.
 */
export interface Chip {
  id: string;
  label: string;
  /** Hard predicate — does this chip qualify at all? */
  qualifies: (ctx: ChipContext) => boolean;
  /** Base relevance score in [0, 1]. Modulated by category bonuses. */
  baseRelevance: number;
  /** Higher = stronger context bonus when its category fits. */
  contextBonus?: (ctx: ChipContext) => number;
  pathway: AnswerPathway;
  /** Template string for `template-fill` pathway. Ignored otherwise. */
  template?: string;
  /** Canned answer for `canned` pathway. Ignored otherwise. */
  answer?: string;
  /** Optional follow-up affordance (e.g. "Drop to {bpm-10} BPM"). */
  followUp?: ChipAffordance;
  category: ChipCategory;
}

export interface ChipAffordance {
  /** Short button label, may contain `{placeholders}` filled at render time. */
  label: string;
  /** Action key the UI handles. UI is free to add new actions; chips
   *  produce intent, the UI decides side effects. */
  action: "set-bpm" | "open-chat";
  /** For `set-bpm`: the delta from current BPM. */
  bpmDelta?: number;
}

/**
 * Snapshot of session state the selector needs. Pure data — the
 * selector never reads from the DOM, IPC, or storage (recency is
 * passed in as `recentChipIds`).
 */
export interface ChipContext {
  /** Latest segment's `SessionReport`. */
  report: SessionReport;
  /** BPM at segment end. */
  bpm: number;
  /** Time signature at segment end. */
  timeSignature: number;
  /** Personal best score at this BPM, if known. Used by `comparison`. */
  personalBestAtBpm?: number;
  /** Best score from prior session (this preset, if any). */
  previousSessionScore?: number;
  /** How many segments the coach has emitted this session. */
  segmentsCompleted: number;
  /** Sustained early-tendency flag — last N segments averaged ahead. */
  sustainedRushing?: boolean;
  /** Sustained late-tendency flag — last N segments averaged behind. */
  sustainedDragging?: boolean;
  /** Chip ids shown in the immediately previous session. Used for the
   *  recency penalty (×0.7). Pass an empty array for first session. */
  recentChipIds: ReadonlySet<string>;
  /** All segments scored this session (so "best run" chips can pick one). */
  segments: { report: SessionReport; bpm: number; timeSignature: number }[];
}

/**
 * Output of the selector. The UI uses `label` for the chip text and
 * passes the chip back into `answerChip(chip, ctx)` on tap.
 */
export interface SelectedChip {
  chip: Chip;
  score: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Multiplier applied to a chip's score if it was shown last session. */
export const RECENCY_PENALTY = 0.7;

/** Maximum number of substantive chips (before adding Escape). */
export const MAX_SUBSTANTIVE_CHIPS = 3;

/** localStorage key for cross-session recency tracking. */
export const CHIPS_RECENCY_LS_KEY = "coach.chips.lastShownIds";

// ---------------------------------------------------------------------------
// Catalog — Phase 5 starter. The plan targets ~50; we author the
// seven the example list calls out plus a couple of defensive fillers
// so the selector never returns zero substantive chips. Adding chips
// later is purely an authoring task — drop a new entry into the array.
//
// Note: the catalog is intentionally exported as `readonly`. The
// selector never mutates entries; recency state lives in `ChipContext`.
// ---------------------------------------------------------------------------

export const CHIP_CATALOG: readonly Chip[] = Object.freeze([
  // -------- BpmAdvice --------
  {
    id: "drop-bpm",
    label: "Should I drop the BPM?",
    qualifies: (ctx) => ctx.report.score < 70 && ctx.bpm > 80,
    baseRelevance: 0.9,
    contextBonus: (ctx) => (ctx.report.score < 55 ? 0.3 : 0),
    pathway: "template-fill",
    template:
      "You scored {score}% at {bpm} BPM — your best at this BPM is " +
      "{personalBest}%. Try {newBpm}?",
    followUp: { label: "Drop to {newBpm} BPM", action: "set-bpm", bpmDelta: -10 },
    category: "bpm-advice",
  },
  {
    id: "ready-faster",
    label: "Ready for faster?",
    qualifies: (ctx) => ctx.report.score > 90 && ctx.bpm < 180,
    baseRelevance: 0.85,
    contextBonus: (ctx) => (ctx.report.score >= 95 ? 0.3 : 0),
    pathway: "template-fill",
    template: "You're locked in at {bpm} ({score}%). Bump to {newBpm}?",
    followUp: { label: "Bump to {newBpm} BPM", action: "set-bpm", bpmDelta: 10 },
    category: "bpm-advice",
  },

  // -------- Comparison --------
  {
    id: "compare-last-session",
    label: "How does this compare to last session?",
    qualifies: (ctx) => ctx.previousSessionScore !== undefined,
    baseRelevance: 0.7,
    pathway: "template-fill",
    template:
      "Last session at {bpm} BPM you averaged {prevScore}%. Today " +
      "you're at {todayScore}% — {deltaDirection} by {delta}%.",
    category: "comparison",
  },
  {
    id: "best-run-today",
    label: "What was my best run today?",
    qualifies: (ctx) => ctx.segmentsCompleted >= 3,
    baseRelevance: 0.6,
    pathway: "template-fill",
    template:
      "Your tightest run was segment {n} at {bestBpm} BPM — " +
      "{bestScore}% with σ={bestSigma}ms.",
    category: "comparison",
  },

  // -------- Diagnostic --------
  {
    id: "why-rushing",
    label: "Why do I keep rushing?",
    qualifies: (ctx) =>
      ctx.sustainedRushing === true ||
      (ctx.report.meanDeviationMs < -5 && ctx.segmentsCompleted >= 1),
    baseRelevance: 0.85,
    contextBonus: (ctx) => (ctx.sustainedRushing ? 0.3 : 0),
    pathway: "template-fill",
    template:
      "You're averaging {absOffset}ms ahead of the click. Try " +
      "emphasizing the *back* of the beat for a minute.",
    category: "diagnostic",
  },
  {
    id: "why-dragging",
    label: "Why do I keep dragging?",
    qualifies: (ctx) =>
      ctx.sustainedDragging === true ||
      (ctx.report.meanDeviationMs > 5 && ctx.segmentsCompleted >= 1),
    baseRelevance: 0.85,
    contextBonus: (ctx) => (ctx.sustainedDragging ? 0.3 : 0),
    pathway: "template-fill",
    template:
      "You're averaging {offset}ms behind the click. Try anticipating " +
      "the click — feel for it just before it arrives.",
    category: "diagnostic",
  },

  // -------- NextStep --------
  //
  // The template intentionally omits the raw metric (e.g. "1777ms σ",
  // "60ms avg") — chip answers are read aloud by TTS, and "milliseconds
  // sigma" is gibberish to a player who doesn't think in terms of
  // standard deviation. The numerical detail is already visible on the
  // mini-report card; this chip is the conversational summary.
  {
    id: "what-to-work-on",
    label: "What should I work on?",
    qualifies: () => true, // always — lowest-priority fallback
    baseRelevance: 0.4,
    pathway: "template-fill",
    template:
      "Your weakest area this session is {worstComponent}. " +
      "Most likely fix: {remediation}.",
    category: "next-step",
  },

  // -------- Escape (DEPRECATED) --------
  //
  // The "Ask something else…" escape chip used to sit in slot 4 as a
  // permanent affordance, but the coach card already exposes a chat
  // text input pinned to the bottom (`Ask the coach…`) so the chip
  // duplicated that affordance and added clutter. v0.9 stopped
  // appending it in `selectChips`; the catalog entry is kept here
  // (with the original definition) so external referrers — tests,
  // telemetry recency keys, future "give me an escape hatch on a
  // different surface" reuses — don't break, but the chip never
  // surfaces in the feed any more.
  {
    id: "ask-something-else",
    label: "Ask something else…",
    qualifies: () => false, // never selected — gated by category filter too
    baseRelevance: 0,
    pathway: "llm",
    followUp: { label: "Type your question", action: "open-chat" },
    category: "escape",
  },
]);

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------

/**
 * Four-step chip selection pipeline (plan §"Chip selection algorithm"):
 *
 *   1. Hard filter — drop chips whose `qualifies` predicate is false.
 *   2. Relevance score — `baseRelevance + contextBonus(ctx)`.
 *   3. Recency penalty — ×0.7 if id is in `recentChipIds`.
 *   4. Diversity — no two chips of the same category.
 *
 * The plan originally specified "Top-3 + Escape" but the Escape chip
 * (`Ask something else…`) duplicated the always-visible chat input
 * pinned to the bottom of the coach card and was retired in v0.9. The
 * selector now returns at most `MAX_SUBSTANTIVE_CHIPS` (3) substantive
 * chips with no permanent slot-4 affordance — when there's nothing
 * substantive to suggest the chip-prompt bubble doesn't render at
 * all.
 *
 * Returns an array of selected chips in display order. `length` ≤ 3.
 */
export function selectChips(ctx: ChipContext): SelectedChip[] {
  // 1. Hard filter. The escape chip's `qualifies` is now `() => false`
  // so it falls out here automatically — keeping the explicit
  // category exclusion is belt-and-braces in case the qualifies
  // predicate gets re-enabled accidentally.
  const qualifying = CHIP_CATALOG
    .filter((c) => c.category !== "escape")
    .filter((c) => c.qualifies(ctx));

  // 2 + 3. Score with recency.
  const scored: SelectedChip[] = qualifying.map((chip) => {
    const bonus = chip.contextBonus?.(ctx) ?? 0;
    const raw = chip.baseRelevance + bonus;
    const recencyMul = ctx.recentChipIds.has(chip.id) ? RECENCY_PENALTY : 1;
    return { chip, score: raw * recencyMul };
  });

  // 4. Diversity — descending score, skip same category.
  scored.sort((a, b) => b.score - a.score);
  const seenCategories = new Set<ChipCategory>();
  const diverse: SelectedChip[] = [];
  for (const cand of scored) {
    if (diverse.length >= MAX_SUBSTANTIVE_CHIPS) break;
    if (seenCategories.has(cand.chip.category)) continue;
    diverse.push(cand);
    seenCategories.add(cand.chip.category);
  }

  return diverse;
}

// ---------------------------------------------------------------------------
// Answer resolution
// ---------------------------------------------------------------------------

/**
 * Build the placeholder context used by `template-fill` chips.
 * Centralized so adding a new placeholder in a template only requires
 * editing this function — chips themselves stay declarative.
 */
export function buildChipPlaceholders(
  chip: Chip,
  ctx: ChipContext,
): Record<string, string | number> {
  const out: Record<string, string | number> = {
    bpm: ctx.bpm,
    score: ctx.report.score,
    timeSignature: ctx.timeSignature,
  };

  if (chip.followUp?.action === "set-bpm" && chip.followUp.bpmDelta) {
    out.newBpm = Math.max(20, Math.min(300, ctx.bpm + chip.followUp.bpmDelta));
  }

  if (chip.id === "drop-bpm") {
    out.personalBest = ctx.personalBestAtBpm ?? ctx.report.score;
  }

  if (chip.id === "compare-last-session" && ctx.previousSessionScore !== undefined) {
    const prev = ctx.previousSessionScore;
    const today = ctx.report.score;
    const delta = Math.abs(today - prev);
    out.prevScore = prev;
    out.todayScore = today;
    out.delta = delta;
    out.deltaDirection = today > prev ? "up" : today < prev ? "down" : "flat";
  }

  if (chip.id === "best-run-today") {
    // Pick the segment with the highest score.
    let bestIdx = 0;
    for (let i = 1; i < ctx.segments.length; i++) {
      if (ctx.segments[i].report.score > ctx.segments[bestIdx].report.score) bestIdx = i;
    }
    const best = ctx.segments[bestIdx];
    out.n = bestIdx + 1;
    out.bestBpm = best?.bpm ?? ctx.bpm;
    out.bestScore = best?.report.score ?? ctx.report.score;
    out.bestSigma = Math.round(best?.report.stdDeviationMs ?? ctx.report.stdDeviationMs);
  }

  if (chip.id === "why-rushing") {
    out.absOffset = Math.abs(Math.round(ctx.report.meanDeviationMs));
  }
  if (chip.id === "why-dragging") {
    out.offset = Math.round(ctx.report.meanDeviationMs);
  }

  if (chip.id === "what-to-work-on") {
    // Crude proxy: pick the worst-looking aggregate signal and label it
    // with a plain-language phrase. TTS speaks this answer aloud, so the
    // strings need to read naturally without technical shorthand
    // ("σ", "ms", "/100") that a typical player won't parse. Numeric
    // detail stays on the mini-report card; the chip is the verbal
    // summary. The branch ordering reflects user-impact priority:
    // uneven pulse > off the beat > missed beats > everything-ok-but.
    const score = ctx.report.score;
    const meanAbs = ctx.report.meanAbsDeviationMs;
    const tempoStd = ctx.report.tempoStabilityMs;
    if (tempoStd > 25) {
      out.worstComponent = "keeping a steady pulse";
      out.remediation = "subdivide mentally to keep an even pulse";
    } else if (meanAbs > 25) {
      out.worstComponent = "landing on the beat";
      out.remediation = "slow the BPM by 10 and lock back in";
    } else if (score < 60) {
      out.worstComponent = "catching every beat";
      out.remediation = "focus on landing each beat before chasing precision";
    } else {
      out.worstComponent = "consistency";
      out.remediation = "play eight bars without looking at the screen";
    }
  }

  return out;
}

/**
 * Resolve a chip into the text the feed should render. For `llm`
 * chips, returns `null` — the caller should route into the free-text
 * pipeline (text input + rephrase/coach generation).
 */
export function answerChip(chip: Chip, ctx: ChipContext): string | null {
  switch (chip.pathway) {
    case "canned":
      return chip.answer ?? null;
    case "template-fill":
      if (!chip.template) return null;
      return fillTemplate(chip.template, buildChipPlaceholders(chip, ctx));
    case "llm":
      return null;
  }
}

/**
 * Render a chip's follow-up affordance label with any placeholders
 * filled. Convenience for the UI button.
 */
export function renderAffordanceLabel(
  chip: Chip,
  ctx: ChipContext,
): string | null {
  if (!chip.followUp) return null;
  return fillTemplate(chip.followUp.label, buildChipPlaceholders(chip, ctx));
}

// ---------------------------------------------------------------------------
// Recency tracking — localStorage-backed, opt-in via injected reader.
// Tests pass an in-memory mock; production passes `window.localStorage`.
// ---------------------------------------------------------------------------

export interface RecencyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Load the most-recently-shown chip ids from storage (best-effort). */
export function loadRecentChipIds(storage: RecencyStorage): Set<string> {
  try {
    const raw = storage.getItem(CHIPS_RECENCY_LS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter((x) => typeof x === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

/** Persist the set of chip ids that were just shown to the user. */
export function saveRecentChipIds(
  storage: RecencyStorage,
  ids: Iterable<string>,
): void {
  try {
    storage.setItem(CHIPS_RECENCY_LS_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Storage might be unavailable (incognito, etc.) — silent failure.
  }
}

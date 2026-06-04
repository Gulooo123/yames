# Report UI Clarity — Plan 1

> **Scope.** All the numbers in the end-session report and the
> segment-timeline card are currently unexplained. Users see "0.70"
> for Note spacing and "0.85" for Beat placement and "70%" in the
> timeline with no labels, no scale reference, and no hint on what
> they mean or how to improve. This plan makes every user-visible
> number self-explanatory without adding noise.
>
> **File in scope.** `src/containers/practice-coach/CoachFeedMessage.tsx`
> — all changes are in `EndReportSummary` and `SegmentTimeline`.
> No Rust, no IPC, no other TS files.
>
> **Principle.** Every number a user can see must answer three
> questions with a glance: *What is being measured?* *What does the
> number mean?* *What does a good value look like?* We do this with
> plain-English subtitles and tooltips rather than a modal or info
> panel — the report is already dense enough.

---

## Problem catalogue (from screenshot, 2026-05-28)

### Problem 1 — IC/GA values displayed as 2-decimal floats

**Where:** `EndReportSummary` → `end-report-components` block,
lines 337–350 in `CoachFeedMessage.tsx`.

**Current code:**
```tsx
<span className="end-report-component-value">
  {report.intervalConsistency.toFixed(2)}     {/* → "0.70" */}
</span>
...
<span className="end-report-component-value">
  {report.gridAlignment !== undefined ? report.gridAlignment.toFixed(2) : "—"}  {/* → "0.85" */}
</span>
```

**What users see:** `0.70`, `0.85` — looks like a probability, not a
score. Users don't know whether higher is better or what the scale is.

**Fix:** Multiply by 100 and round → `70`, `85`. Bar fills already
use `Math.round(v * 100)%` for their width — the value label should
match.

```tsx
// Note spacing value
{Math.round(report.intervalConsistency * 100)}

// Beat placement value
{report.gridAlignment !== undefined
  ? Math.round(report.gridAlignment * 100)
  : "—"}
```

The value span should also append a `%` suffix after the integer so
the user instantly reads "70%" as "out of 100":
```tsx
{Math.round(report.intervalConsistency * 100)}%
```

---

### Problem 2 — IC/GA row labels carry no explanation

**Where:** Same `end-report-components` block. Labels "Note spacing"
and "Beat placement" are terse. New users don't know what either
measures.

**Fix:** Add a one-line subtitle directly under each label using a
`<span className="end-report-component-sublabel">` that renders
in a smaller muted style:

```tsx
<span className="end-report-component-label">Note spacing</span>
<span className="end-report-component-sublabel">
  Even gaps between your notes
</span>
```
```tsx
<span className="end-report-component-label">Beat placement</span>
<span className="end-report-component-sublabel">
  How close your hits land to the beat
</span>
```

These subtitles sit below the label, left-aligned, and are always
visible (no hover required). They should be ~10px, muted at 50%
opacity — informative but not competing with the number.

A `title` attribute on the label `<span>` (shown on desktop hover) is
a nice secondary layer but is NOT a substitute for always-visible text.

---

### Problem 3 — "70%" in the timeline card has no label, and "Accuracy" is jargon too

**Where:** `SegmentTimeline` → `coach-segment-info` div,
line 499 in `CoachFeedMessage.tsx`.

**Current code:**
```tsx
<span>{seg.bpm} BPM</span>
<span className="coach-segment-sep">&middot;</span>
<span>{accuracy}%</span>           {/* ← what is this? */}
<span className="coach-segment-sep">&middot;</span>
<span>{pocket}</span>
```

**What users see:** `Semi-structured · 120 BPM · 70% · on beat`
— the `70%` is contextless. Is it the score? The overall session?
How many bars you played? Users have no idea.

**What "accuracy" actually means here:** `hits / (hits + misses)` —
the percentage of the beats the metronome was counting that the user
actually played. If the metronome counted 10 beats and the user hit 7
of them, accuracy is 70%. A user would call this "beats I played" or
"beats I didn't miss".

**Why "Accuracy X%" is still not enough.** Even with a label, the word
"accuracy" is technical — it doesn't immediately communicate "how many
beats you played". The inline label should describe what happened in
plain terms.

**Fix:** Use a human-readable label that embeds the meaning:

```tsx
<span title="How many expected beats you actually played">
  Beats hit: {accuracy}%
</span>
```

"Beats hit: 70%" reads immediately as "I hit 70% of the beats."
The `title` tooltip provides the longer definition on hover.
No layout change required.

**Same problem in `EndReportSummary` stat grid (line 311).**
The grid uses `<span className="coach-end-report-stat-label">Accuracy</span>`.
This is the identical problem one level up — the label "Accuracy" is
meaningless without context. Fix the same way: change the label text
to "Beats hit" and add a sublabel:

```tsx
<span className="coach-end-report-stat-label">Beats hit</span>
<span className="coach-end-report-stat-sublabel">
  beats you played vs. beats counted
</span>
<span className="coach-end-report-stat-value">{accuracy}%</span>
```

This brings both the timeline card and the stat grid into alignment
with the same plain language.

---

### Problem 4 — "Semi-structured" and "on beat" have no definition

**Where:** `SegmentTimeline`, lines 482–486.

**Current code:**
```tsx
const style = seg.report.gridCorrelation > 0.8 ? "Grid exercise"
  : seg.report.gridCorrelation > 0.3 ? "Semi-structured"
  : "Free playing";
const pocket = seg.report.meanDeviationMs < -5 ? "rushing"
  : seg.report.meanDeviationMs > 5 ? "dragging" : "on beat";
```

**What users see:** Labels like "Semi-structured" or "rushing" with
zero context. What's the threshold between "Grid exercise" and
"Semi-structured"? What does "rushing" mean numerically?

**Fix — `title` attributes on the style and pocket spans:**

```tsx
const styleTitle =
  seg.report.gridCorrelation > 0.8
    ? "Your playing closely matched the metronome grid"
    : seg.report.gridCorrelation > 0.3
    ? "Your playing roughly followed the beat with some variation"
    : "Your playing wasn't tightly tied to the beat — exploratory";

const pocketTitle =
  seg.report.meanDeviationMs < -5
    ? `You played an average of ${Math.abs(Math.round(seg.report.meanDeviationMs))}ms early`
    : seg.report.meanDeviationMs > 5
    ? `You played an average of ${Math.round(seg.report.meanDeviationMs)}ms late`
    : `Your timing was centred on the beat (±5ms average)`;
```

```tsx
<span title={styleTitle} className="coach-segment-style">{style}</span>
...
<span title={pocketTitle}>{pocket}</span>
```

`title` attributes render as native OS tooltips on hover with zero
CSS cost. On mobile/touch (if a mobile view ships later), these would
need an alternative — flag in the implementation PR.

---

### Problem 5 — Session score ring has no context clue

**Where:** `EndReportSummary` → `coach-mini-report-header`, line 292.

**Current output:** A score ring (gradient-colored, 0–100) with the
label "Session Score" above it and nothing else. A user doesn't know
if 70 is excellent or poor.

**Fix:** Add a one-line qualifier below "Session Score" that reflects
the score band — the same qualitative language the coach template
catalog already uses:

```tsx
const scoreQualifier = (score: number): string =>
  score >= 90 ? "Excellent" :
  score >= 75 ? "Good" :
  score >= 55 ? "Fair" :
  "Keep practicing";
```

```tsx
<div className="coach-mini-report-stats">
  <span className="coach-mini-report-score-label">Session Score</span>
  <span className="coach-mini-report-score-sublabel">
    {scoreQualifier(report.score)}
  </span>
</div>
```

This replaces the grade letter that was removed in v0.10 but without
the academic connotation — it's directional ("Good"), not evaluative
("B+").

Score band thresholds: `≥90 Excellent`, `≥75 Good`, `≥55 Fair`,
`<55 Keep practicing`. These intentionally match the `ScoreBadge`
visual thresholds already used in the drill/evaluation view so the
language is consistent.

---

### Problem 6 — "Avg Timing Error" unit is opaque

**Where:** `EndReportSummary` → `coach-end-report-grid`, line 315.

**Current output:** `±4.2ms` — milliseconds are developer units.

**Fix:** Add a subtitle hint:
```tsx
<span className="coach-end-report-stat-label">Avg Timing Error</span>
<span className="coach-end-report-stat-sublabel">lower is tighter</span>
```

This one phrase — "lower is tighter" — is enough to orient a user.
No further explanation needed because the value itself (with the `ms`
unit) is already formatted in a familiar-enough way.

---

## CSS additions required

All the new `*-sublabel` classes follow the same pattern — they are
just a smaller, muted variant of the corresponding label. Add to the
practice-coach stylesheet (or inline styles if no external CSS file
exists yet for these selectors):

```css
/* Sub-labels under component labels (IC / GA rows) */
.end-report-component-sublabel {
  display: block;
  font-size: 10px;
  opacity: 0.5;
  margin-top: 1px;
  font-weight: 400;
  line-height: 1.3;
}

/* Sub-label under "Session Score" in the end-report header */
.coach-mini-report-score-sublabel {
  display: block;
  font-size: 11px;
  opacity: 0.55;
  font-weight: 400;
  margin-top: 2px;
}

/* Sub-label under "Avg Timing Error" in the stat grid */
.coach-end-report-stat-sublabel {
  display: block;
  font-size: 10px;
  opacity: 0.45;
  font-weight: 400;
  margin-top: 1px;
}
```

Find the existing coach stylesheet — check for
`practice-coach.css` or a co-located `CoachFeedMessage.css`. If the
styles are injected via a global `index.css`, add there.
Run `grep -r "end-report-component-label" src/` to locate the file.

---

## Implementation order

These are all independent edits in `CoachFeedMessage.tsx`. Do them
in this order to keep diffs reviewable:

1. **Problem 1** — swap `toFixed(2)` for integer `%` display. Two
   surgical one-line edits. Run `tsc --noEmit` after. No CSS needed.

2. **Problem 3** — change `{accuracy}%` in `SegmentTimeline` to
   `Beats hit: {accuracy}%` with tooltip. Also rename the "Accuracy"
   stat label in `EndReportSummary` to "Beats hit" and add sublabel.
   Run `tsc --noEmit` after.

3. **Problem 4** — add `title` attributes to `style` and `pocket`
   spans. Derive `styleTitle` and `pocketTitle` constants in the
   `SegmentTimeline` map callback. Run `tsc --noEmit` after.

4. **Problem 5** — add `scoreQualifier` function and the sublabel
   span in `EndReportSummary`. CSS class `coach-mini-report-score-sublabel`.

5. **Problem 2** — add IC/GA sublabels. Requires adding the sublabel
   text spans AND the CSS class `end-report-component-sublabel`.

6. **Problem 6** — add "lower is tighter" sublabel under timing error.
   CSS class `coach-end-report-stat-sublabel`.

Validate after each step: `bun run tsc --noEmit` + visual check in
the app. Do not batch all six into one diff.

---

## Acceptance criteria

- [ ] IC and GA display as integer `%` (e.g. `70%`, `85%`) in the
      end-session report. The bar fill width is unchanged.
- [ ] Hovering "Note spacing" shows a tooltip describing interval
      consistency; the sublabel is always visible below the label.
- [ ] Hovering "Beat placement" shows a tooltip describing grid
      alignment; the sublabel is always visible below the label.
- [ ] The `{accuracy}%` value in every timeline segment row shows
      as `Beats hit: 70%` with a hover tooltip "How many expected
      beats you actually played".
- [ ] The "Accuracy" stat label in the end-report grid reads
      "Beats hit" with sublabel "beats you played vs. beats counted".
- [ ] Hovering the style label ("Semi-structured", "Grid exercise",
      "Free playing") shows the gridCorrelation tooltip text.
- [ ] Hovering the pocket label ("on beat", "rushing", "dragging")
      shows the meanDeviationMs tooltip text with the actual ms value.
- [ ] "Session Score" now has a qualitative sublabel ("Good", "Excellent",
      etc.) matching the score band.
- [ ] "Avg Timing Error" has a "lower is tighter" sublabel.
- [ ] `tsc --noEmit` clean; no new TS errors.
- [ ] No existing tests broken (`bun run test` green).

---

## What this plan does NOT cover

- Redesigning the report layout or restructuring the grid.
- Adding new metrics or changing what is computed.
- Mini-report card (`case "mini-report"`) — that card's `MiniReportComponents`
  already shows Cov/Eff/Grid as abbreviations. A separate pass can
  expand those abbreviations; out of scope here.
- Mobile touch-tooltip alternative for `title` attributes.
- LLM-generated explanations of scores (a different, larger feature).

---

*Created 2026-05-28. Companion to `COACH_DSP_POLISH_PLAN.md`.
Implement in `CoachFeedMessage.tsx` only — no Rust changes, no IPC.*

/**
 * Renders a `SessionNarrative` (see `sessionNarrative.ts`) as a small card
 * with a prominent headline, an optional praise line, an optional focus
 * line, and an optional caveat. Lives between the ScoreRing and the
 * rule-based insights on both the live end-of-session report
 * (`EvaluationPanel.tsx`) and the history detail (`CoachSessionDetail.tsx`).
 *
 * Why a component instead of inline JSX in each screen:
 *   * The two screens lived independently for a while and the user
 *     reported that the same score (e.g. 65) felt misleading because
 *     no copy explained *why* the number was what it was. We want to
 *     fix that once, in one place, and have it look identical in both
 *     views — so a shared component beats two parallel implementations.
 *   * Styling is centralised in `styles/session-narrative.css`, so a
 *     visual tweak (e.g. praise color) flows to both screens for free.
 */

import type { SessionReport } from "../types";
import { buildSessionNarrative } from "./sessionNarrative";

export function SessionNarrativeView({ report }: { report: SessionReport }) {
  const narrative = buildSessionNarrative(report);
  return (
    <div className="session-narrative">
      <div className="session-narrative-headline">{narrative.headline}</div>
      {narrative.praise && (
        <div className="session-narrative-praise">{narrative.praise}</div>
      )}
      {narrative.focus && (
        <div className="session-narrative-focus">{narrative.focus}</div>
      )}
      {narrative.caveat && (
        <div className="session-narrative-caveat">{narrative.caveat}</div>
      )}
    </div>
  );
}

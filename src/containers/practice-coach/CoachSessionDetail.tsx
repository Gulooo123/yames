import { ScoreRing, BreakdownBar, Histogram } from "../drill/evaluation";
import { FEEDBACK_COLORS } from "../../hooks/useEvaluation";
import type { SavedSession } from "../../types";
import { formatDate } from "./coachCardHelpers";
import { accuracyPct, scoredBeats } from "../../coach/reportStats";
import { SessionNarrativeView } from "../../coach/SessionNarrativeView";

/**
 * Detail view for a single saved session — shown when the user picks a
 * card from CoachHistoryList. Renders the score ring, AI insights, the
 * perfect/good/ok/miss breakdown bars, a histogram of timing deviations
 * (only when we have enough samples), and the full stats grid.
 */
export function CoachSessionDetail({
  session,
  onDelete,
}: {
  session: SavedSession;
  onDelete: () => void;
}) {
  const report = session.report;
  // In Default mode with subdivision > 1, show accent (downbeat) accuracy
  // so the number reflects what the scoring formula actually measures.
  // Fall back to hit/(hit+miss) for Pro mode, old sessions, or short warmups
  // where accent counts are unavailable. See `src/coach/reportStats.ts`.
  const hitRate =
    report.coachMode === "default" &&
    report.accentBeatsCount != null &&
    report.accentBeatsCount > 0
      ? Math.round((report.accentHitsCount! / report.accentBeatsCount) * 100)
      : accuracyPct(report);

  // Convert longestStreak (subdivision units) to quarter-note beats for display.
  const streakBeats =
    report.subdivision && report.subdivision > 1
      ? Math.floor(report.longestStreak / report.subdivision)
      : report.longestStreak;

  const scored = scoredBeats(report);

  return (
    <div className="coach-detail">
      <div className="coach-detail-ring">
        <ScoreRing score={report.score} size={80} strokeWidth={5} />
        <div className="coach-detail-meta">
          {session.presetName && <>{session.presetName} &middot; </>}
          {session.bpm} BPM &middot; {formatDate(session.timestamp)}
        </div>
        {report.comment && (
          <div className="coach-detail-comment">{report.comment}</div>
        )}
      </div>

      {/*
        Narrative goes BEFORE the rule-based insights. The narrative
        explains what the score means relative to the underlying
        components (e.g. "65 with tight consistency is closer to an A
        than the number suggests"); the insights below are concrete
        rule-fired observations ("you dragged ~20 ms behind the click").
        Reading the narrative first gives the user the framing they
        need to interpret the insights instead of treating each one as
        an isolated complaint.
      */}
      <SessionNarrativeView report={report} />

      {report.insights.length > 0 && (
        <div className="coach-detail-insights">
          {report.insights.map((insight, i) => (
            <div key={i} className="coach-detail-insight">{insight}</div>
          ))}
        </div>
      )}

      <div className="coach-detail-section">
        <div className="coach-detail-section-title">Breakdown</div>
        <div className="coach-detail-bars">
          <BreakdownBar label="Perfect" count={report.perfectCount} total={scored} color={FEEDBACK_COLORS.perfect} />
          <BreakdownBar label="Good" count={report.goodCount} total={scored} color={FEEDBACK_COLORS.good} />
          <BreakdownBar label="OK" count={report.okCount} total={scored} color={FEEDBACK_COLORS.ok} />
          <BreakdownBar label="Miss" count={report.missCount} total={scored} color={FEEDBACK_COLORS.miss} />
        </div>
      </div>

      {report.deviations.length > 4 && (
        <div className="coach-detail-section">
          <div className="coach-detail-section-title">Timing Distribution</div>
          <Histogram deviations={report.deviations} />
        </div>
      )}

      <div className="coach-detail-section">
        <div className="coach-detail-section-title">Details</div>
        <div className="coach-detail-stats">
          <div className="coach-detail-stat">
            <span className="coach-detail-stat-label">Hit rate</span>
            <span className="coach-detail-stat-value">{hitRate}%</span>
          </div>
          <div className="coach-detail-stat">
            {/*
              "Avg timing error" uses the MAGNITUDE (meanAbsDeviationMs) — not
              the signed mean (meanDeviationMs), which cancels to ~0 whenever
              early/late errors are symmetric and produced the misleading
              "+0.0 ms" display on sloppy sessions. The signed mean still
              carries information ("rushing" vs "dragging") and is surfaced
              in the narrative block / Bias row below.
            */}
            <span className="coach-detail-stat-label">Avg timing error</span>
            <span className="coach-detail-stat-value">{"\u00B1"}{report.meanAbsDeviationMs.toFixed(1)}ms</span>
          </div>
          <div className="coach-detail-stat">
            <span className="coach-detail-stat-label">Consistency</span>
            <span className="coach-detail-stat-value">{"\u00B1"}{report.stdDeviationMs.toFixed(1)}ms</span>
          </div>
          <div className="coach-detail-stat">
            <span className="coach-detail-stat-label">Tempo stability</span>
            <span className="coach-detail-stat-value">{"\u00B1"}{report.tempoStabilityMs.toFixed(1)}ms</span>
          </div>
          <div className="coach-detail-stat">
            <span className="coach-detail-stat-label">Longest streak</span>
            <span className="coach-detail-stat-value">{streakBeats}</span>
          </div>
          <div className="coach-detail-stat">
            <span className="coach-detail-stat-label">Scored beats</span>
            <span className="coach-detail-stat-value">{scored}</span>
          </div>
          {report.skippedBeats > 0 && (
            <div className="coach-detail-stat">
              <span className="coach-detail-stat-label">Skipped</span>
              <span className="coach-detail-stat-value">{report.skippedBeats}</span>
            </div>
          )}
          {report.intervalConsistency !== undefined && (
            <div className="coach-detail-stat">
              <span className="coach-detail-stat-label">Note spacing</span>
              <span className="coach-detail-stat-value">{report.intervalConsistency.toFixed(2)}</span>
            </div>
          )}
          {report.gridAlignment !== undefined && (
            <div className="coach-detail-stat">
              <span className="coach-detail-stat-label">Beat placement</span>
              <span className="coach-detail-stat-value">{report.gridAlignment.toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>

      <button className="coach-detail-delete-btn" onClick={onDelete}>Delete Session</button>
    </div>
  );
}

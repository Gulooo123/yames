import { ScoreRing, BreakdownBar, Histogram } from "../drill/evaluation";
import { FEEDBACK_COLORS } from "../../hooks/useEvaluation";
import type { SavedSession } from "../../types";
import { formatDate } from "./coachCardHelpers";
import { accuracyPct, scoredBeats } from "../../coach/reportStats";

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
  // `hitRate` and `scored` use the SCORED-beat denominator (hits + miss)
  // so the displayed accuracy matches the Rust score and the breakdown
  // bars below. See `src/coach/reportStats.ts`.
  const hitRate = accuracyPct(report);
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
            <span className="coach-detail-stat-label">Avg deviation</span>
            <span className="coach-detail-stat-value">
              {report.meanDeviationMs >= 0 ? "+" : ""}{report.meanDeviationMs.toFixed(1)}ms
            </span>
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
            <span className="coach-detail-stat-value">{report.longestStreak}</span>
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
        </div>
      </div>

      <button className="coach-detail-delete-btn" onClick={onDelete}>Delete Session</button>
    </div>
  );
}

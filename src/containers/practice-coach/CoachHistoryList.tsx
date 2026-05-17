import { ScoreBadge, MiniSparkline } from "../drill/evaluation";
import type { SavedSession } from "../../types";
import { groupByDay } from "./coachCardHelpers";

/**
 * Saved-session list inside the coach card's History tab. Sessions are
 * grouped by day (Today / Yesterday / weekday / date) via the shared
 * groupByDay helper. Clicking a card calls `onSelect`; the trash icon
 * calls `onDelete` (stopPropagation prevents the card click).
 */
export function CoachHistoryList({
  sessions,
  onSelect,
  onDelete,
}: {
  sessions: SavedSession[];
  onSelect: (s: SavedSession) => void;
  onDelete: (id: string) => void;
}) {
  if (sessions.length === 0) {
    return (
      <div className="coach-card-empty">
        <p className="coach-card-empty-text">
          No sessions yet.<br/>
          Complete a practice session to build your history.
        </p>
      </div>
    );
  }

  const grouped = groupByDay(sessions);

  return (
    <div className="coach-history-list">
      {grouped.map((group) => (
        <div key={group.label}>
          <div className="coach-history-heading">{group.label}</div>
          {group.sessions.map((session) => (
            <div
              key={session.id}
              className="coach-history-card"
              onClick={() => onSelect(session)}
            >
              <button
                className="coach-history-delete"
                onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
              <div className="coach-history-card-top">
                <ScoreBadge score={session.report.score} />
                <span className="coach-history-time">
                  {new Date(session.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </span>
                <span className="coach-history-sep">&middot;</span>
                <span className="coach-history-bpm">{session.bpm} BPM</span>
              </div>
              {session.presetName && (
                <div className="coach-history-preset">{session.presetName}</div>
              )}
              {session.report.comment && (
                <div className="coach-history-comment">{session.report.comment}</div>
              )}
              {session.report.deviations.length > 2 && (
                <MiniSparkline deviations={session.report.deviations} />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

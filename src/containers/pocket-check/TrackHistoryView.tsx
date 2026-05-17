import { useState } from "react";
import { createPortal } from "react-dom";
import type { GameResult } from "./trackTypes";
import { RATING_COLORS, RATING_LABELS } from "./trackTypes";

/** History list view — shows past Pocket Check sessions with a clear-all confirm. */
export function TrackHistoryView({
  history,
  onBack,
  onPick,
  onClearAll,
  onStartSession,
}: {
  history: GameResult[];
  onBack: () => void;
  onPick: (game: GameResult) => void;
  onClearAll: () => void;
  onStartSession: () => void;
}) {
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  return (
    <div className="track-view track-history-view">
      <div className="track-history-header">
        <button
          className="track-history-back"
          onClick={onBack}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0"
            />
          </svg>
        </button>
        <h3>History</h3>
        <button
          className="track-toolbar-btn track-history-delete"
          data-tooltip="Clear all"
          onClick={() => setShowClearConfirm(true)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
      <div className="track-history-list">
        {history.map((game, i) => (
          <button
            key={game.id}
            className="track-history-item view-stagger-item"
            style={{ animationDelay: `${i * 40}ms` }}
            onClick={() => onPick(game)}
          >
            <span
              className="track-history-rating"
              style={{ color: RATING_COLORS[game.overallRating] }}
            >
              {RATING_LABELS[game.overallRating]}
            </span>
            <span className="track-history-detail">
              {game.bpm} BPM · {game.hitRate}% hits
            </span>
            <span className="track-history-date">
              {new Date(game.date).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
          </button>
        ))}
      </div>
      {createPortal(
        <button className="play-btn full-width track-floating-cta" onClick={onStartSession}>
          Try Again
        </button>,
        document.body
      )}
      {showClearConfirm && (
        <div className="keybinding-overlay" onClick={() => setShowClearConfirm(false)}>
          <div className="keybinding-capture" onClick={(e) => e.stopPropagation()}>
            <div className="keybinding-capture-title">Clear History</div>
            <p className="about-text" style={{ textAlign: "center", marginBottom: 0 }}>
              Delete all {history.length} saved games? This cannot be undone.
            </p>
            <div className="keybinding-capture-actions">
              <button
                className="keybinding-btn-remove"
                onClick={() => {
                  onClearAll();
                  setShowClearConfirm(false);
                }}
              >
                Delete All
              </button>
              <button
                className="keybinding-btn-reset"
                onClick={() => setShowClearConfirm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

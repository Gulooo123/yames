import type { Rating } from "./trackTypes";
import { RATING_LABELS, RATING_COLORS } from "./trackTypes";

/** Idle (welcome) view for Pocket Check before a session starts. */
export function TrackIdleView({
  evaluationEnabled,
  scoredBeats,
  savedOffset,
  hasHistory,
  onStart,
  onCalibrate,
  onShowHistory,
}: {
  evaluationEnabled?: boolean;
  scoredBeats: number;
  savedOffset: number | null;
  hasHistory: boolean;
  onStart: () => void;
  onCalibrate: () => void;
  onShowHistory: () => void;
}) {
  return (
    <div className="track-view">
      <div className="track-intro view-stagger-item" style={{ animationDelay: '0ms' }}>
        <div className="track-intro-icon">🎯</div>
        <h3>Pocket Check</h3>
        <p>
          {evaluationEnabled
            ? `Play along with the metronome for ${scoredBeats} beats. Your instrument input is detected automatically.`
            : `Tap along with the metronome for ${scoredBeats} beats. Click the target to log each beat.`}
        </p>
        {savedOffset !== null ? (
          <p className="track-config-hint">
            Calibrated: {savedOffset >= 0 ? "+" : ""}
            {savedOffset.toFixed(1)}ms offset
          </p>
        ) : (
          <p className="track-config-hint">
            Calibrate first for best accuracy on your system.
          </p>
        )}
        <div className="track-ratings-legend">
          {(
            ["metronomic", "tight", "solid", "loose", "miss"] as Rating[]
          ).map((r) => (
            <span key={r} className="track-legend-item">
              <span
                className="track-legend-dot"
                style={{ background: RATING_COLORS[r] }}
              />
              {RATING_LABELS[r]}
            </span>
          ))}
        </div>
      </div>
      <button className="play-btn full-width view-stagger-item" style={{ animationDelay: '80ms' }} onClick={onStart}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4 2.5a.5.5 0 0 1 .77-.42l9 5.5a.5.5 0 0 1 0 .84l-9 5.5A.5.5 0 0 1 4 13.5z" />
        </svg>
        Start
      </button>
      <div className="track-secondary-actions view-stagger-item" style={{ animationDelay: '120ms' }}>
        <button
          className="play-btn full-width secondary"
          onClick={onCalibrate}
        >
          Calibrate
        </button>
        <button
          className="play-btn full-width secondary"
          onClick={onShowHistory}
          disabled={!hasHistory}
        >
          History
        </button>
      </div>
    </div>
  );
}

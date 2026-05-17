/** Calibration completion view — shows the saved offset and a Done button. */
export function TrackCalibrationDoneView({
  savedOffset,
  onDone,
}: {
  savedOffset: number | null;
  onDone: () => void;
}) {
  return (
    <div className="track-view">
      <div className="track-intro">
        <div className="track-intro-icon">✅</div>
        <h3>Calibrated!</h3>
        <p>
          Your system offset:{" "}
          <strong>
            {savedOffset !== null
              ? `${savedOffset >= 0 ? "+" : ""}${savedOffset.toFixed(1)}ms`
              : "0ms"}
          </strong>
        </p>
        <p className="track-config-hint">
          This accounts for audio output latency and input lag on your system.
          You can recalibrate anytime.
        </p>
      </div>
      <button className="play-btn full-width" onClick={onDone}>
        Done
      </button>
    </div>
  );
}

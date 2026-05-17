type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "up-to-date";

/**
 * About section — version, update status (with inline install button when an
 * update is available), platform/user-agent, and footer tagline. The parent
 * owns the update lifecycle and passes setters / handlers.
 */
export function AboutSection({
  appVersion,
  updateStatus,
  latestVersion,
  onInstallUpdate,
  onCheckUpdate,
}: {
  appVersion: string;
  updateStatus: UpdateStatus;
  latestVersion: string;
  onInstallUpdate: () => void;
  onCheckUpdate: () => void;
}) {
  return (
    <section className="settings-section about-section">
      <h2>About</h2>
      <div className="about-info">
        <div className="about-row">
          <span className="about-label">Version</span>
          <span className="about-value">{appVersion}</span>
        </div>
        <div className="about-row">
          <span className="about-label">Updates</span>
          <span className="about-value">
            {updateStatus === "checking" && (
              <span className="update-status">Checking…</span>
            )}
            {updateStatus === "available" && (
              <button
                className="update-available-btn"
                onClick={onInstallUpdate}
              >
                v{latestVersion} available — Install
              </button>
            )}
            {updateStatus === "downloading" && (
              <span className="update-status">Updating…</span>
            )}
            {updateStatus === "up-to-date" && (
              <span className="update-status up-to-date">
                Up to date ✓
              </span>
            )}
            {updateStatus === "idle" && (
              <button
                className="update-check-btn"
                onClick={onCheckUpdate}
              >
                Check for updates
              </button>
            )}
          </span>
        </div>
        <div className="about-row">
          <span className="about-label">Platform</span>
          <span className="about-value">{navigator.platform}</span>
        </div>
        <div className="about-row">
          <span className="about-label">User Agent</span>
          <span className="about-value about-value-small">
            {navigator.userAgent}
          </span>
        </div>
      </div>
      <div className="about-footer-divider"></div>
      <p className="about-footer">
        Made with <span className="about-heart">♥</span> for musicians
        everywhere
      </p>
    </section>
  );
}

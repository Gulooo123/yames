import type { WidgetMode } from "../../types";

/**
 * Widget settings — layout mode (compact/comfortable) and always-on-top
 * toggle for the floating widget window. Pure UI; state is owned by the
 * parent, mutations go through IPC setters.
 */
export function WidgetSettingsSection({
  widgetMode,
  setWidgetMode,
  widgetAlwaysOnTop,
  setWidgetAlwaysOnTop,
}: {
  widgetMode: WidgetMode;
  setWidgetMode: (mode: WidgetMode) => void;
  widgetAlwaysOnTop: boolean;
  setWidgetAlwaysOnTop: (next: boolean) => void;
}) {
  return (
    <section className="settings-section">
      <h2>Widget</h2>
      <div className="setting-row">
        <div className="setting-label">
          <label>Mode</label>
          <span className="setting-hint">Widget layout on screen</span>
        </div>
        <div className="toggle-group">
          {(["compact", "comfortable"] as WidgetMode[]).map((mode) => (
            <button
              key={mode}
              className={`toggle-btn ${widgetMode === mode ? "active" : ""}`}
              onClick={() => setWidgetMode(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
      <div className="setting-row">
        <div className="setting-label">
          <label>Always on top</label>
          <span className="setting-hint">
            Keep widget visible over other apps
          </span>
        </div>
        <button
          className={`toggle-btn ${widgetAlwaysOnTop ? "active" : ""}`}
          onClick={() => setWidgetAlwaysOnTop(!widgetAlwaysOnTop)}
        >
          {widgetAlwaysOnTop ? "On" : "Off"}
        </button>
      </div>
    </section>
  );
}

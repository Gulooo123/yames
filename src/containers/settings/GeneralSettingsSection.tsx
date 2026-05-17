import type { Dispatch, SetStateAction } from "react";
import { storeSave } from "../../ipc";

/**
 * General settings — auto-update, always-on-top, button flash, active border,
 * drill auto-collapse. Pure UI; state lives in the parent.
 */
export function GeneralSettingsSection({
  autoCheckUpdates,
  setAutoCheckUpdates,
  alwaysOnTop,
  setAlwaysOnTop,
  buttonFlash,
  setButtonFlash,
  activeBorder,
  setActiveBorder,
  drillAutoCollapse,
  setDrillAutoCollapse,
}: {
  autoCheckUpdates: boolean;
  setAutoCheckUpdates: Dispatch<SetStateAction<boolean>>;
  alwaysOnTop: boolean;
  setAlwaysOnTop: (next: boolean) => void;
  buttonFlash: boolean;
  setButtonFlash: Dispatch<SetStateAction<boolean>>;
  activeBorder: boolean;
  setActiveBorder: Dispatch<SetStateAction<boolean>>;
  drillAutoCollapse: boolean;
  setDrillAutoCollapse: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <section className="settings-section">
      <h2>General</h2>
      <div className="setting-row">
        <div className="setting-label">
          <label>Check for updates</label>
          <span className="setting-hint">
            Automatically check on launch
          </span>
        </div>
        <button
          className={`toggle-btn ${autoCheckUpdates ? "active" : ""}`}
          onClick={() => {
            const next = !autoCheckUpdates;
            setAutoCheckUpdates(next);
            storeSave("autoCheckUpdates", next);
          }}
        >
          {autoCheckUpdates ? "On" : "Off"}
        </button>
      </div>
      <div className="setting-row">
        <div className="setting-label">
          <label>Always on top</label>
          <span className="setting-hint">
            Keep main window above other apps
          </span>
        </div>
        <button
          className={`toggle-btn ${alwaysOnTop ? "active" : ""}`}
          onClick={() => setAlwaysOnTop(!alwaysOnTop)}
        >
          {alwaysOnTop ? "On" : "Off"}
        </button>
      </div>
      <div className="setting-row">
        <div className="setting-label">
          <label>Button flash</label>
          <span className="setting-hint">
            Flash play button on accents
          </span>
        </div>
        <button
          className={`toggle-btn ${buttonFlash ? "active" : ""}`}
          onClick={() => {
            const next = !buttonFlash;
            setButtonFlash(next);
            storeSave("buttonFlash", next);
          }}
        >
          {buttonFlash ? "On" : "Off"}
        </button>
      </div>
      <div className="setting-row">
        <div className="setting-label">
          <label>Active border</label>
          <span className="setting-hint">Show border when playing</span>
        </div>
        <button
          className={`toggle-btn ${activeBorder ? "active" : ""}`}
          onClick={() => {
            const next = !activeBorder;
            setActiveBorder(next);
            storeSave("activeBorder", next);
          }}
        >
          {activeBorder ? "On" : "Off"}
        </button>
      </div>
      <div className="setting-row">
        <div className="setting-label">
          <label>Drill auto-collapse</label>
          <span className="setting-hint">
            Collapse drill config while playing
          </span>
        </div>
        <button
          className={`toggle-btn ${drillAutoCollapse ? "active" : ""}`}
          onClick={() => {
            const next = !drillAutoCollapse;
            setDrillAutoCollapse(next);
            storeSave("drillAutoCollapse", next);
          }}
        >
          {drillAutoCollapse ? "On" : "Off"}
        </button>
      </div>
    </section>
  );
}

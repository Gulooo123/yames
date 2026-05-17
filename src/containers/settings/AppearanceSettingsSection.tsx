import type { Dispatch, SetStateAction } from "react";
import { storeSave } from "../../ipc";
import { THEMES } from "../../themes";

type ViewTransitions = "off" | "subtle" | "smooth" | "expressive";
type AnimationStyle = "fade" | "scale" | "blur" | "slide" | "reveal";

/**
 * Appearance settings — theme picker grid and view-transition controls
 * (level + animation style). Pure UI; state lives in the parent.
 */
export function AppearanceSettingsSection({
  themeId,
  setTheme,
  viewTransitions,
  setViewTransitions,
  animationStyle,
  setAnimationStyle,
}: {
  themeId: string;
  setTheme: (id: string) => void;
  viewTransitions: ViewTransitions;
  setViewTransitions: Dispatch<SetStateAction<ViewTransitions>>;
  animationStyle: AnimationStyle;
  setAnimationStyle: Dispatch<SetStateAction<AnimationStyle>>;
}) {
  return (
    <section className="settings-section">
      <h2>Appearance</h2>
      <div className="theme-grid">
        {THEMES.map((t) => (
          <button
            key={t.id}
            className={`theme-card ${themeId === t.id ? "active" : ""}`}
            onClick={() => setTheme(t.id)}
            title={t.name}
          >
            <div className="theme-card-preview">
              {t.preview.map((color, i) => (
                <div
                  key={i}
                  className="theme-card-swatch"
                  style={{ background: color }}
                />
              ))}
            </div>
            <span className="theme-card-name">{t.name}</span>
          </button>
        ))}
      </div>
      <div className="setting-row">
        <div className="setting-label">
          <label>View animations</label>
          <span className="setting-hint">
            Animate elements when switching views
          </span>
        </div>
        <div className="toggle-group">
          {(["off", "subtle", "smooth", "expressive"] as const).map((level) => (
            <button
              key={level}
              className={`toggle-btn ${viewTransitions === level ? "active" : ""}`}
              onClick={() => {
                setViewTransitions(level);
                storeSave("viewTransitions", level);
              }}
            >
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="setting-row">
        <div className="setting-label">
          <label>Animation style</label>
          <span className="setting-hint">
            Effect used when switching views
          </span>
        </div>
        <div className="toggle-group">
          {(["fade", "scale", "blur", "slide", "reveal"] as const).map((style) => (
            <button
              key={style}
              className={`toggle-btn ${animationStyle === style ? "active" : ""}`}
              disabled={viewTransitions === "off"}
              onClick={() => {
                setAnimationStyle(style);
                storeSave("animationStyle", style);
              }}
            >
              {style.charAt(0).toUpperCase() + style.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

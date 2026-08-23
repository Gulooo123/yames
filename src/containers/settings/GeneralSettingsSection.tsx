import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { storeLoad, storeSave } from "../../ipc";
import { getLanguages } from "../../i18n";

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
  const { t, i18n } = useTranslation();
  const [language, setLanguage] = useState("en");
  const languages = getLanguages();

  useEffect(() => {
    storeLoad<string>("language").then((l) => {
      if (l && i18n.hasResourceBundle(l, "translation")) {
        setLanguage(l);
        i18n.changeLanguage(l);
      }
    });
  }, [i18n]);

  function applyLanguage(l: string) {
    setLanguage(l);
    i18n.changeLanguage(l);
    storeSave("language", l);
  }

  return (
    <section className="settings-section">
      <h2>{t("settings.general.title")}</h2>
      <div className="setting-row">
        <div className="setting-label">
          <label>{t("common.language")}</label>
          <span className="setting-hint">
            {t("common.languageHint")}
          </span>
        </div>
        {languages.map(({ code, name }) => (
          <button
            key={code}
            className={`toggle-btn ${language === code ? "active" : ""}`}
            onClick={() => applyLanguage(code)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="setting-row">
        <div className="setting-label">
          <label>{t("settings.general.checkUpdates")}</label>
          <span className="setting-hint">
            {t("settings.general.checkUpdatesHint")}
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
          {autoCheckUpdates ? t("common.on") : t("common.off")}
        </button>
      </div>
      <div className="setting-row">
        <div className="setting-label">
          <label>{t("settings.general.alwaysOnTop")}</label>
          <span className="setting-hint">
            {t("settings.general.alwaysOnTopHint")}
          </span>
        </div>
        <button
          className={`toggle-btn ${alwaysOnTop ? "active" : ""}`}
          onClick={() => setAlwaysOnTop(!alwaysOnTop)}
        >
          {alwaysOnTop ? t("common.on") : t("common.off")}
        </button>
      </div>
      <div className="setting-row">
        <div className="setting-label">
          <label>{t("settings.general.buttonFlash")}</label>
          <span className="setting-hint">
            {t("settings.general.buttonFlashHint")}
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
          {buttonFlash ? t("common.on") : t("common.off")}
        </button>
      </div>
      <div className="setting-row">
        <div className="setting-label">
          <label>{t("settings.general.activeBorder")}</label>
          <span className="setting-hint">
            {t("settings.general.activeBorderHint")}
          </span>
        </div>
        <button
          className={`toggle-btn ${activeBorder ? "active" : ""}`}
          onClick={() => {
            const next = !activeBorder;
            setActiveBorder(next);
            storeSave("activeBorder", next);
          }}
        >
          {activeBorder ? t("common.on") : t("common.off")}
        </button>
      </div>
      <div className="setting-row">
        <div className="setting-label">
          <label>{t("settings.general.drillAutoCollapse")}</label>
          <span className="setting-hint">
            {t("settings.general.drillAutoCollapseHint")}
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
          {drillAutoCollapse ? t("common.on") : t("common.off")}
        </button>
      </div>
    </section>
  );
}

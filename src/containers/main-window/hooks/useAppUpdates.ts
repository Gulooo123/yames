import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { checkForUpdate, storeLoad } from "../../../ipc";

/**
 * Owns the auto-update lifecycle:
 *
 *   - `autoCheckUpdates`   — user preference, persisted under the same key
 *                            (the actual save happens inside Settings →
 *                            General; this hook only hydrates it on mount).
 *   - `appVersion`         — the live version pulled from Tauri at startup.
 *                            Stays "0.0.0" until the async call resolves.
 *   - `latestVersion`      — the remote-side version when an update is
 *                            available; empty string otherwise.
 *   - `updateStatus`       — the current banner state used by the
 *                            `UpdateBanner` component.
 *   - `doUpdateCheck()`    — manual "Check now" callback that the Settings
 *                            section binds to its button.
 *
 * On mount: load the persisted `autoCheckUpdates` flag, fetch the app
 * version, and (if the flag is on, or unset → default true) hit the update
 * endpoint and flip `updateStatus` to "available" when there's something to
 * download.
 */

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading";

export interface AppUpdates {
  autoCheckUpdates: boolean;
  setAutoCheckUpdates: Dispatch<SetStateAction<boolean>>;
  appVersion: string;
  setAppVersion: Dispatch<SetStateAction<string>>;
  latestVersion: string;
  setLatestVersion: Dispatch<SetStateAction<string>>;
  updateStatus: UpdateStatus;
  setUpdateStatus: Dispatch<SetStateAction<UpdateStatus>>;
  doUpdateCheck: () => Promise<void>;
}

export function useAppUpdates(): AppUpdates {
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(true);
  const [appVersion, setAppVersion] = useState("0.0.0");
  const [latestVersion, setLatestVersion] = useState("");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");

  const doUpdateCheck = useCallback(async () => {
    setUpdateStatus("checking");
    try {
      const ver = appVersion === "0.0.0" ? await getVersion() : appVersion;
      const result = await checkForUpdate(ver);
      if (result.hasUpdate) {
        setLatestVersion(result.latestVersion);
        setUpdateStatus("available");
      } else {
        setUpdateStatus("up-to-date");
      }
    } catch {
      setUpdateStatus("idle");
    }
  }, [appVersion]);

  // Mount: hydrate pref, fetch version, optionally auto-check.
  useEffect(() => {
    (async () => {
      const acu = await storeLoad<boolean>("autoCheckUpdates");
      if (acu !== undefined) setAutoCheckUpdates(acu);

      const ver = await getVersion();
      setAppVersion(ver);

      const shouldAutoCheck = acu !== undefined ? acu : true;
      if (shouldAutoCheck) {
        const result = await checkForUpdate(ver);
        if (result.hasUpdate) {
          setLatestVersion(result.latestVersion);
          setUpdateStatus("available");
        }
      }
    })();
  }, []);

  return {
    autoCheckUpdates,
    setAutoCheckUpdates,
    appVersion,
    setAppVersion,
    latestVersion,
    setLatestVersion,
    updateStatus,
    setUpdateStatus,
    doUpdateCheck,
  };
}

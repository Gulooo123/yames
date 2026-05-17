import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { storeLoad } from "../../../ipc";

/**
 * Owns the five MainWindow visual / UX preferences that the user can toggle
 * from Settings → Appearance & General:
 *
 *   - `buttonFlash`        — pulse the floating play button on each downbeat
 *   - `activeBorder`       — highlight the active section with a border
 *   - `drillAutoCollapse`  — auto-collapse the drill panel between segments
 *   - `viewTransitions`    — global tab-transition intensity
 *   - `animationStyle`     — preferred CSS animation family for transitions
 *
 * Each value is loaded from the Tauri store on mount; the *save* side is
 * handled inside the individual `<setting-row>` controls (they call
 * `storeSave` directly when the user changes the value), so this hook stays
 * read-on-mount only.
 *
 * Load failures are silent — if a key isn't present the React default wins.
 */

export type ViewTransitionLevel = "off" | "subtle" | "smooth" | "expressive";
export type AnimationStyle = "fade" | "scale" | "blur" | "slide" | "reveal";

const ANIMATION_STYLES: readonly AnimationStyle[] = [
  "fade",
  "scale",
  "blur",
  "slide",
  "reveal",
];

const VIEW_TRANSITION_LEVELS: readonly ViewTransitionLevel[] = [
  "off",
  "subtle",
  "smooth",
  "expressive",
];

export interface UiPreferences {
  buttonFlash: boolean;
  setButtonFlash: Dispatch<SetStateAction<boolean>>;
  activeBorder: boolean;
  setActiveBorder: Dispatch<SetStateAction<boolean>>;
  drillAutoCollapse: boolean;
  setDrillAutoCollapse: Dispatch<SetStateAction<boolean>>;
  viewTransitions: ViewTransitionLevel;
  setViewTransitions: Dispatch<SetStateAction<ViewTransitionLevel>>;
  animationStyle: AnimationStyle;
  setAnimationStyle: Dispatch<SetStateAction<AnimationStyle>>;
}

export function useUiPreferences(): UiPreferences {
  const [buttonFlash, setButtonFlash] = useState(true);
  const [activeBorder, setActiveBorder] = useState(true);
  const [drillAutoCollapse, setDrillAutoCollapse] = useState(true);
  const [viewTransitions, setViewTransitions] =
    useState<ViewTransitionLevel>("smooth");
  const [animationStyle, setAnimationStyle] =
    useState<AnimationStyle>("scale");

  useEffect(() => {
    (async () => {
      const bf = await storeLoad<boolean>("buttonFlash");
      if (bf !== undefined) setButtonFlash(bf);

      const ab = await storeLoad<boolean>("activeBorder");
      if (ab !== undefined) setActiveBorder(ab);

      const dac = await storeLoad<boolean>("drillAutoCollapse");
      if (dac !== undefined) setDrillAutoCollapse(dac);

      const vt = await storeLoad<string | boolean>("viewTransitions");
      if (vt !== undefined) {
        // Backwards compatibility: convert old boolean format
        if (typeof vt === "boolean") {
          setViewTransitions(vt ? "smooth" : "off");
        } else if (
          VIEW_TRANSITION_LEVELS.includes(vt as ViewTransitionLevel)
        ) {
          setViewTransitions(vt as ViewTransitionLevel);
        }
      }

      const as = await storeLoad<string>("animationStyle");
      if (as && ANIMATION_STYLES.includes(as as AnimationStyle)) {
        setAnimationStyle(as as AnimationStyle);
      }
    })();
  }, []);

  return {
    buttonFlash,
    setButtonFlash,
    activeBorder,
    setActiveBorder,
    drillAutoCollapse,
    setDrillAutoCollapse,
    viewTransitions,
    setViewTransitions,
    animationStyle,
    setAnimationStyle,
  };
}

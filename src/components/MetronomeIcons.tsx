/**
 * Pure SVG icon helpers used across the metronome UI.
 *
 * `SubdivisionIcon` renders the appropriate musical-note glyph for a
 * subdivision value (1..6). `INSTRUMENT_ICONS` is a static map keyed by
 * the instrument id used in the Practice Coach settings dropdown.
 *
 * Extracted from MainWindow.tsx — these have no React state and no
 * dependencies on MainWindow's component scope, so they live here for
 * reuse and to keep MainWindow.tsx leaner.
 */
import type { JSX } from "react";
import type { Subdivision } from "../types";

// SVG subdivision icons — clean musical note representations
export function SubdivisionIcon({
  sub,
  size = 20,
}: {
  sub: Subdivision;
  size?: number;
}) {
  const h = size;
  const w = Math.round(size * 0.9);
  const noteColor = "currentColor";
  switch (sub) {
    case 1: // Quarter note — single stem + filled head
      return (
        <svg width={w} height={h} viewBox="0 0 18 24" fill={noteColor}>
          <ellipse cx="7" cy="20" rx="5" ry="3.5" transform="rotate(-15 7 20)" />
          <rect x="11" y="2" width="1.8" height="18" rx="0.9" />
        </svg>
      );
    case 2: // Eighth notes — two beamed
      return (
        <svg width={w} height={h} viewBox="0 0 22 24" fill={noteColor}>
          <ellipse cx="5" cy="20" rx="4.5" ry="3.2" transform="rotate(-15 5 20)" />
          <ellipse cx="17" cy="20" rx="4.5" ry="3.2" transform="rotate(-15 17 20)" />
          <rect x="8.5" y="3" width="1.8" height="17" rx="0.9" />
          <rect x="20" y="3" width="1.8" height="17" rx="0.9" />
          <rect x="8.5" y="3" width="13.3" height="2.5" rx="1" />
        </svg>
      );
    case 3: // Triplet — three beamed
      return (
        <svg width={Math.round(size * 1.1)} height={h} viewBox="0 0 30 24" fill={noteColor}>
          <ellipse cx="4" cy="20" rx="3.8" ry="3" transform="rotate(-15 4 20)" />
          <ellipse cx="14" cy="20" rx="3.8" ry="3" transform="rotate(-15 14 20)" />
          <ellipse cx="24" cy="20" rx="3.8" ry="3" transform="rotate(-15 24 20)" />
          <rect x="7" y="4" width="1.6" height="16" rx="0.8" />
          <rect x="17" y="4" width="1.6" height="16" rx="0.8" />
          <rect x="27" y="4" width="1.6" height="16" rx="0.8" />
          <rect x="7" y="4" width="21.6" height="2.2" rx="1" />
        </svg>
      );
    case 4: // 16th notes — two stems with double beam
      return (
        <svg width={w} height={h} viewBox="0 0 22 24" fill={noteColor}>
          <ellipse cx="5" cy="20" rx="4.5" ry="3.2" transform="rotate(-15 5 20)" />
          <ellipse cx="17" cy="20" rx="4.5" ry="3.2" transform="rotate(-15 17 20)" />
          <rect x="8.5" y="3" width="1.8" height="17" rx="0.9" />
          <rect x="20" y="3" width="1.8" height="17" rx="0.9" />
          <rect x="8.5" y="3" width="13.3" height="2.2" rx="1" />
          <rect x="8.5" y="7.5" width="13.3" height="2.2" rx="1" />
        </svg>
      );
    case 5: // Quintuplet — beamed pair
      return (
        <svg width={w} height={h} viewBox="0 0 22 24" fill={noteColor}>
          <ellipse cx="5" cy="20" rx="4.5" ry="3.2" transform="rotate(-15 5 20)" />
          <ellipse cx="17" cy="20" rx="4.5" ry="3.2" transform="rotate(-15 17 20)" />
          <rect x="8.5" y="3" width="1.8" height="17" rx="0.9" />
          <rect x="20" y="3" width="1.8" height="17" rx="0.9" />
          <rect x="8.5" y="3" width="13.3" height="2.2" rx="1" />
        </svg>
      );
    case 6: // Sextuplet — double beam
      return (
        <svg width={w} height={h} viewBox="0 0 22 24" fill={noteColor}>
          <ellipse cx="5" cy="20" rx="4.5" ry="3.2" transform="rotate(-15 5 20)" />
          <ellipse cx="17" cy="20" rx="4.5" ry="3.2" transform="rotate(-15 17 20)" />
          <rect x="8.5" y="3" width="1.8" height="17" rx="0.9" />
          <rect x="20" y="3" width="1.8" height="17" rx="0.9" />
          <rect x="8.5" y="3" width="13.3" height="2.2" rx="1" />
          <rect x="8.5" y="7.5" width="13.3" height="2.2" rx="1" />
        </svg>
      );
  }
}

export const INSTRUMENT_ICONS: Record<string, JSX.Element> = {
  drums: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="14" rx="10" ry="5" />
      <ellipse cx="12" cy="14" rx="10" ry="5" fill="currentColor" opacity="0.08" />
      <path d="M2 14v-4c0-2.76 4.48-5 10-5s10 2.24 10 5v4" />
      <ellipse cx="12" cy="10" rx="10" ry="5" />
      <line x1="6" y1="3" x2="10" y2="10" />
      <line x1="18" y1="3" x2="14" y2="10" />
      <circle cx="6" cy="2.5" r="1.5" fill="currentColor" />
      <circle cx="18" cy="2.5" r="1.5" fill="currentColor" />
    </svg>
  ),
  "electric-guitar": (
    // Stratocaster-style silhouette: angular double-cutaway body with
    // two horns + a slanted headstock with visible tuners. The neck
    // runs diagonally from the body up to the headstock so the shape
    // reads as "electric guitar" at 16px instead of an abstract blob.
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* Headstock */}
      <path d="M18.5 2.5 L22 4.5 L20.5 7 L17 5 Z" />
      {/* Tuning pegs */}
      <circle cx="18.2" cy="3.6" r="0.4" fill="currentColor" stroke="none" />
      <circle cx="20.3" cy="4.8" r="0.4" fill="currentColor" stroke="none" />
      {/* Neck */}
      <line x1="17.5" y1="6" x2="10.5" y2="13" />
      {/* Strat body — upper horn, lower horn, bottom bout */}
      <path d="M10.5 13 Q12 12 13.5 13 L14.5 14 Q16.5 13.5 18 15.5 Q19.5 18.5 17.5 20.5 Q15 22 12.5 20 L11 18.5 Q9 22 6 21 Q3 19.5 3.5 16.5 Q4.5 13.5 7.5 13 Q9 13 10.5 13 Z" />
      {/* Single-coil pickup */}
      <rect x="10.5" y="16.5" width="3.5" height="1.1" rx="0.2" fill="currentColor" stroke="none" />
    </svg>
  ),
  "acoustic-guitar": (
    // Dreadnought-style silhouette: rounded figure-8 body with a clear
    // sound hole, slim headstock at the top of a diagonal neck. The
    // sound hole is the strongest "this is acoustic" cue at 16px.
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* Headstock */}
      <path d="M19 2 L22 3.5 L21 6.5 L18 5 Z" />
      {/* Neck */}
      <line x1="18" y1="6" x2="11" y2="13" />
      {/* Hourglass body — upper bout (smaller), waist, lower bout (larger) */}
      <path d="M11 13 Q13 12 14.5 13.5 Q16 15 15.5 16.5 Q17.5 18 17 20.5 Q15.5 22.5 12 22 Q8 22.5 6 20.5 Q4.5 18 6.5 16 Q6 14.5 7.5 13 Q9.5 11.5 11 13 Z" />
      {/* Sound hole */}
      <circle cx="11" cy="18" r="2" />
    </svg>
  ),
  bass: (
    // P-Bass / J-Bass style silhouette: similar to electric but with a
    // longer, slimmer neck and a single offset horn. Distinguishing
    // touches: visible string passing across the body to suggest the
    // characteristic bass scale length.
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* Headstock (longer, narrower than guitar) */}
      <path d="M20 2 L22.5 3 L21.5 6 L19 5 Z" />
      {/* Tuners */}
      <circle cx="19.7" cy="3.4" r="0.4" fill="currentColor" stroke="none" />
      <circle cx="21.5" cy="4.4" r="0.4" fill="currentColor" stroke="none" />
      {/* Long neck */}
      <line x1="19" y1="5.5" x2="11" y2="13.5" />
      {/* Offset body — single sharper horn at top, wide lower bout */}
      <path d="M11 13.5 Q13 12.5 14.5 14 L15.5 15 Q18 14.5 19 17 Q19.5 20 17 21.5 Q14 22.5 11.5 20.5 L10 19 Q8 22 5 21 Q2.5 19 3.5 16 Q5 13.5 8 13.5 Q9.5 13.5 11 13.5 Z" />
      {/* Pickup */}
      <rect x="11" y="17" width="3" height="1.1" rx="0.2" fill="currentColor" stroke="none" />
    </svg>
  ),
  piano: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <rect x="2" y="4" width="20" height="16" rx="2" fill="currentColor" opacity="0.05" />
      <line x1="6" y1="4" x2="6" y2="20" />
      <line x1="10" y1="4" x2="10" y2="20" />
      <line x1="14" y1="4" x2="14" y2="20" />
      <line x1="18" y1="4" x2="18" y2="20" />
      <rect x="5" y="4" width="2.5" height="10" rx="0.5" fill="currentColor" opacity="0.6" />
      <rect x="8.5" y="4" width="2.5" height="10" rx="0.5" fill="currentColor" opacity="0.6" />
      <rect x="13" y="4" width="2.5" height="10" rx="0.5" fill="currentColor" opacity="0.6" />
      <rect x="16.5" y="4" width="2.5" height="10" rx="0.5" fill="currentColor" opacity="0.6" />
    </svg>
  ),
  // "Other" — generic musical-note icon for the neutral fallback.
  other: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" fill="currentColor" />
      <circle cx="18" cy="16" r="3" fill="currentColor" />
    </svg>
  ),
};

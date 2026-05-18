/**
 * Static data constants for the metronome UI.
 *
 * These are pure data with no React or runtime dependencies — extracted
 * from MainWindow.tsx so that they can be reused (and so MainWindow.tsx
 * stays focused on component logic rather than reference data).
 */
import type { Subdivision } from "../types";

export const SHARE_URL = "https://yames.app";
export const SHARE_TEXT =
  "Check out Yames — a free open-source metronome for serious practice 🎵";

export const SHARE_OPTIONS = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    url: `https://wa.me/?text=${encodeURIComponent(SHARE_TEXT + "\n" + SHARE_URL)}`,
  },
  {
    id: "x",
    label: "X / Twitter",
    url: `https://x.com/intent/tweet?text=${encodeURIComponent(SHARE_TEXT)}&url=${encodeURIComponent(SHARE_URL)}`,
  },
  {
    id: "facebook",
    label: "Facebook",
    url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(SHARE_URL)}`,
  },
  {
    id: "reddit",
    label: "Reddit",
    url: `https://www.reddit.com/submit?url=${encodeURIComponent(SHARE_URL)}&title=${encodeURIComponent(SHARE_TEXT)}`,
  },
  { id: "copy", label: "Copy link", url: "" },
] as const;

export const SOUND_TYPES = [
  { id: "click", name: "Click", icon: "○" },
  { id: "wood", name: "Wood", icon: "◆" },
  { id: "beep", name: "Beep", icon: "◉" },
  { id: "drum", name: "Drum", icon: "◎" },
];

export const INSTRUMENTS: Array<{ id: string; name: string; soon?: boolean }> =
  [
    { id: "drums", name: "Drums" },
    { id: "electric-guitar", name: "Electric Guitar" },
    { id: "acoustic-guitar", name: "Acoustic Guitar" },
    // Bass onset detection via aubio is planned — mark as coming soon until
    // the instrument profile is fully calibrated.
    { id: "bass", name: "Bass", soon: true },
    { id: "piano", name: "Piano" },
    // "Other" is the neutral fallback for users whose instrument isn't in the
    // calibrated list. DSP runs on moderate defaults; coach vocabulary stays
    // generic.
    { id: "other", name: "Other" },
  ];

export const TIME_SIGNATURES = [
  { beats: 0, label: "Never" },
  { beats: 1, label: "Always" },
  { beats: 2, label: "2/4" },
  { beats: 3, label: "3/4" },
  { beats: 4, label: "4/4" },
  { beats: 5, label: "5/4" },
  { beats: 6, label: "6/8" },
  { beats: 7, label: "7/8" },
];

export const TEMPO_MARKINGS: [number, string][] = [
  [20, "Grave"],
  [40, "Largo"],
  [45, "Lento"],
  [55, "Adagio"],
  [66, "Adagietto"],
  [72, "Andante"],
  [80, "Andantino"],
  [84, "Moderato"],
  [100, "Allegretto"],
  [112, "Allegro"],
  [132, "Vivace"],
  [140, "Presto"],
  [178, "Prestissimo"],
];

export function getTempoMarking(bpm: number): string {
  for (let i = TEMPO_MARKINGS.length - 1; i >= 0; i--) {
    if (bpm >= TEMPO_MARKINGS[i][0]) return TEMPO_MARKINGS[i][1];
  }
  return TEMPO_MARKINGS[0][1];
}

export const SUBDIVISION_NAMES: Record<Subdivision, string> = {
  1: "Quarter",
  2: "Eighth",
  3: "Triplet",
  4: "16th",
  5: "Quintuplet",
  6: "Sextuplet",
};

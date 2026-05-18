/**
 * C5 — Seeded Template Catalog.
 *
 * The plan calls for ~5 instruments × ~30 scenarios × ~3 severities =
 * ~450 slots with 3–5 variants each (≈ 1800 lines of authored
 * content). The full catalog is content-design work: each phrasing
 * needs an instrument-appropriate vocabulary check (drums never says
 * "downstroke", guitar never says "ghost note on snare") and a
 * musician's ear for severity grading.
 *
 * What ships here:
 *   - The `generic` vocabulary covers every gatekeeper scenario at
 *     all three severities, so the system always has a fallback.
 *   - All five instrument vocabularies (`drums`, `electric-guitar`,
 *     `acoustic-guitar`, `bass`, `piano`) cover the nine highest-
 *     frequency scenarios with instrument-specific overrides:
 *     accuracy_drop, rushing_trend, dragging_trend, personal_best_streak,
 *     new_band_locked, recovery, fatigue, tempo_milestone, check_in.
 *   - Remaining scenarios (`low_confidence`, `boundary_signal_a`,
 *     `boundary_signal_b`) fall through to the `generic` catalog,
 *     which is intentional — those scenarios are about the
 *     metronome/signal layer, not the instrument, so a single
 *     consistent voice across instruments is the right call.
 *
 * Authoring guidance (from the plan's "voice rules"):
 *   - Coach voice, not chatbot voice.
 *   - Specific metrics, not generic encouragement.
 *   - Instrument-appropriate vocabulary baked in at authoring time.
 *   - Severity-graded: encouragement vs. neutral observation vs.
 *     technical correction. Same observation, different tone.
 */

import type { ScenarioCatalog, TemplateCatalog } from "./templates";

// ---------------------------------------------------------------------------
// Generic (always available — fallback path)
// ---------------------------------------------------------------------------

const GENERIC: ScenarioCatalog = {
  accuracy_drop: {
    encouragement: [
      "Couple of misses crept in — ease up a touch, breathe, then come back to it.",
      "You were locked in, then a wobble. Reset on the next downbeat.",
      "Quick dip. Slow the pulse in your head and pick it back up.",
    ],
    neutral: [
      "Hit rate's slipped a bit — reset on the next bar.",
      "Accuracy is sliding. Let it settle on the next downbeat.",
      "Things are slipping — slow it in your head, then back in.",
    ],
    correction: [
      "The slip is sustained — consider dialing the tempo back a few BPM.",
      "Hits are scattering. Slow down and rebuild from clean.",
      "Get one clean bar, then climb again.",
    ],
  },
  rushing_trend: {
    encouragement: [
      "Sitting just ahead of the click — breathe and ride it.",
      "Slight rush creeping in. Plant your foot, let the metronome lead.",
      "A little early — settle into the next click.",
    ],
    neutral: [
      "Trending a touch early — try riding the back of the beat.",
      "You're nudging ahead of the click — let it come to you.",
      "Drifting early. Sit deeper into each click.",
    ],
    correction: [
      "Still leaning early — subdivide and place each note ON the click.",
      "The rush is sticking. Slow it down, feel the AND of each beat.",
      "Pause, count yourself in slow, and re-enter.",
    ],
  },
  dragging_trend: {
    encouragement: [
      "Sitting just behind the click — lift the tempo back under your fingers.",
      "Slight drag. Breathe and push back into the beat.",
      "A little behind — lean forward, you're close.",
    ],
    neutral: [
      "Trending a touch late — try anticipating the click.",
      "You're sitting behind the beat — push into each one.",
      "Drifting late. Reach for the front of each click.",
    ],
    correction: [
      "Still hanging back — anticipate the click instead of waiting for it.",
      "The drag is sticking. Push the tempo with your fingers.",
      "Stop, reset, and re-enter with intent on beat 1.",
    ],
  },
  personal_best_streak: {
    // v0.11: per user feedback, drop the numeric streak count from the
    // in-play affirmations — a glanceable "nice" lands better than a
    // figure the player has to register mid-bar. The numeric detail
    // still surfaces in the post-segment mini-report card.
    encouragement: [
      "Locked in — keep it going.",
      "Streak's going. Nice.",
      "On a run — stay there.",
    ],
    neutral: [
      "New session best — locked in.",
      "Cleanest stretch so far. Hold it.",
      "Best run yet today. Don't change a thing.",
    ],
    correction: [
      "Locked in — hold tempo, don't push faster yet.",
      "Streak's clean. Stay at this BPM until it's automatic.",
      "Exactly where you want to live for a minute.",
    ],
  },
  new_band_locked: {
    encouragement: [
      "{bpmLow} BPM — yours now.",
      "Locked at {bpmLow} BPM. Nice.",
      "Held this tempo clean — new ceiling.",
    ],
    neutral: [
      "Sustained clean play at {bpmLow}–{bpmHigh} BPM for a minute.",
      "{bpmLow}–{bpmHigh} BPM band: locked in.",
      "New BPM band owned: {bpmLow}–{bpmHigh}.",
    ],
    correction: [
      "{bpmLow}–{bpmHigh} is stable. Stay here, then push a touch.",
      "Held {bpmLow}–{bpmHigh} clean. Ready to climb when you are.",
      "{bpmLow}–{bpmHigh} feels owned. Next session, start here.",
    ],
  },
  check_in: {
    encouragement: [
      "You've been deep in it. Anything you want to focus on next?",
      "Five-plus minutes locked in. Want me to call out anything specific?",
      "Long stretch — pause if you want, I'm here.",
    ],
    neutral: [
      "Five minutes in, no alerts. Solid pocket. Continue or switch focus?",
      "Quiet stretch. Tell me what you're working on.",
      "Long uninterrupted run. Anything you want feedback on?",
    ],
    correction: [
      "Heads up — you've been in this for a while. Take 10 if your hands need it.",
      "Five-plus minutes continuous. Check in with your body before you push more.",
      "Sustained session — stretch your fingers, then come back.",
    ],
  },
  fatigue: {
    encouragement: [
      "Accuracy's been sliding the last few minutes. Take a beat.",
      "Hands tightening up? Quick stretch — come back fresh.",
      "Quality's drifting. Pause, breathe, return.",
    ],
    neutral: [
      "Accuracy declined over the last 3 minutes at constant BPM — likely fatigue.",
      "Score trending down without tempo change. Take a rest.",
      "Sustained accuracy drop at the same BPM — call it a rest cycle.",
    ],
    correction: [
      "Fatigue showing — stop now, 90 seconds off, then re-evaluate.",
      "You're past your peak window. Rest before quality erodes further.",
      "Take the rest. Coming back tired entrenches sloppy timing.",
    ],
  },
  recovery: {
    encouragement: [
      "Nice save — stay here.",
      "Pulled it back. Hold it.",
      "Recovered — keep this exact feel.",
    ],
    neutral: [
      "Back to clean after the dip. Keep this pace.",
      "Score's back up — hold it.",
      "Recovery confirmed — accuracy steady again.",
    ],
    correction: [
      "Recovery's holding. Don't push the tempo for a bit.",
      "Back from the dip — stay flat, no climbing yet.",
      "You salvaged it. Hold this exact BPM for a full minute.",
    ],
  },
  tempo_milestone: {
    encouragement: [
      "{bpmLow} BPM — new gear.",
      "Past {bpmLow} BPM, clean.",
      "{bpmLow}+ and holding. Nice.",
    ],
    neutral: [
      "Crossed the {bpmLow}-BPM boundary upward.",
      "Tempo milestone: now in the {bpmLow}-{bpmHigh} band.",
      "{bpmLow} BPM and climbing.",
    ],
    correction: [
      "At {bpmLow} BPM — stay here until clean, don't auto-ramp.",
      "{bpmLow} BPM milestone. Stabilise before pushing.",
      "New band: {bpmLow}-{bpmHigh}. Make sure this one sticks before climbing.",
    ],
  },
  low_confidence: {
    encouragement: [
      "Signal's a bit murky on my end — keep playing, I'll catch up.",
      "Audio's harder to read here, but you sound good.",
      "I'm having a slightly tough time reading you — keep going.",
    ],
    neutral: [
      "Detection confidence has been lower for the last 30s — readings may be noisier than usual.",
      "Lower onset confidence — feedback might be imprecise this stretch.",
      "Audio signal less clear; metrics slightly less reliable.",
    ],
    correction: [
      "Detection confidence is low — check your input level or mic position.",
      "Signal's hard to read. Bump your input gain or move closer to the mic.",
      "Onset detection is uncertain — the room might be too noisy.",
    ],
  },
  boundary_signal_a: {
    encouragement: [
      "{change}. Fresh segment — take a beat, find the feel.",
      "{change} — reset your ear and ride this one out.",
      "Settings shifted: {change}. Let's see how this new shape feels.",
    ],
    neutral: [
      "{change}. New segment opens here.",
      "Boundary marker — {change}. Next stretch is scored on its own.",
      "Settings change: {change}. Closing previous segment.",
    ],
    correction: [
      "{change}. Anchor the new config before you push.",
      "{change} — old segment closed. Make sure this feels right before adding complexity.",
      "Settings changed mid-segment: {change}. Score the new config separately.",
    ],
  },
  boundary_signal_b: {
    encouragement: [
      "Nice segment — {score}% at {bpm} BPM. Take a beat.",
      "{score}% at {bpm} BPM — solid bookend.",
      "Wrapped that one at {score}% / {bpm} BPM. Good pause point.",
    ],
    neutral: [
      "Segment ended after silence — {score}% at {bpm} BPM.",
      "Activity gap closed segment: {score}% scored.",
      "Quiet stretch — segment closed at {score}%.",
    ],
    correction: [
      "Segment ended at {score}% — review before the next pass.",
      "{score}% closed the segment. Check what slipped before the next attempt.",
      "Pause noted — {score}%. Replay the segment summary before continuing.",
    ],
  },
} as const;

// ---------------------------------------------------------------------------
// Instrument-specific overlays (cover the highest-impact scenarios)
// ---------------------------------------------------------------------------

const DRUMS: ScenarioCatalog = {
  accuracy_drop: {
    correction: [
      "Kick is drifting. Lock the right foot to the click before the snare.",
      "Hits are scattering. Bring the bass-snare conversation back to the grid.",
      "Stop, count a bar, restart with the foot only.",
    ],
  },
  rushing_trend: {
    correction: [
      "Right hand is leading the kick — lay it back.",
      "Snare's rushing. Subdivide 16ths between hits and place beat 2 ON the click.",
      "You're driving the click. Slow the right hand; the foot will follow.",
    ],
  },
  dragging_trend: {
    correction: [
      "Right hand is lagging the kick — lean into the hi-hat.",
      "Snare's dragging. Anticipate beat 2 and 4 slightly, don't wait for the click.",
      "Push the hi-hat ahead; the kick should sit ON the click, not after.",
    ],
  },
  personal_best_streak: {
    encouragement: [
      "Kick-snare locked.",
      "Pocket. Stay.",
      "Streak going — stay there.",
    ],
  },
  new_band_locked: {
    neutral: [
      "{bpmLow}–{bpmHigh} BPM band sustained — kick-snare relationship is locked.",
      "Pocket holding at {bpmLow}–{bpmHigh} BPM.",
      "Sustained at {bpmLow}–{bpmHigh} BPM — that's the new floor.",
    ],
  },
  recovery: {
    encouragement: [
      "Groove's back. Stay here.",
      "Kick-snare lock recovered. Hold it.",
      "Limbs talking again — keep it.",
    ],
  },
  fatigue: {
    encouragement: [
      "Hands tightening up? Shake the wrists out and come back.",
      "Quality's drifting — get off the throne for 60 seconds.",
      "Forearms talking to you? Brief pause, then back in.",
    ],
    correction: [
      "Fatigue's showing — stop now, drop the sticks, 90s rest. Tired drumming entrenches sloppy timing.",
      "You're past peak — sticks down, walk a lap, then re-evaluate.",
      "Stop before tension takes over. 90 seconds off, hydrate, return.",
    ],
  },
  tempo_milestone: {
    correction: [
      "At {bpmLow} BPM — stay here until the kick is automatic. Don't auto-ramp.",
      "{bpmLow} BPM milestone. Make sure both feet are clean before pushing.",
      "New band: {bpmLow}-{bpmHigh}. Single-stroke roll along to the click before climbing.",
    ],
  },
  check_in: {
    encouragement: [
      "Long stretch on the kit — anything specific you're working on?",
      "Five-plus minutes in. Want me to call out the kick, the hat, or both?",
      "You've been deep in the pocket. Tell me what you want next.",
    ],
  },
} as const;

const ELECTRIC_GUITAR: ScenarioCatalog = {
  accuracy_drop: {
    correction: [
      "Picking hand is losing the grid. Anchor with your palm.",
      "Hits are scattering. Slow the picking pattern, accent beat 1.",
      "Mute the strings, alternate-pick one bar to the click, then re-enter.",
    ],
  },
  rushing_trend: {
    correction: [
      "Downstrokes are leading — anchor the upstrokes ON the click.",
      "Picking hand's rushing. Plant the wrist; let the metronome lead the downstroke.",
      "Subdivide eighths inside each beat and feel the AND.",
    ],
  },
  dragging_trend: {
    correction: [
      "Upstrokes are lagging — lift the wrist; meet the click on the down.",
      "Picking hand's dragging. Anticipate slightly; don't wait for the click to arrive.",
      "Push from the forearm, not the fingers — let the pick lead.",
    ],
  },
  personal_best_streak: {
    encouragement: [
      "Picking's locked — keep going.",
      "Clean run going. Stay there.",
      "Streak holding — don't change anything.",
    ],
  },
  new_band_locked: {
    neutral: [
      "{bpmLow}–{bpmHigh} BPM band sustained — alternate picking is locked.",
      "Picking-hand pocket holding at {bpmLow}–{bpmHigh} BPM.",
      "Sustained at {bpmLow}–{bpmHigh} BPM — new floor for this riff.",
    ],
  },
  recovery: {
    encouragement: [
      "Picking hand back — hold it.",
      "Pulled it back. Stay loose.",
      "Recovered — keep this feel.",
    ],
  },
  fatigue: {
    encouragement: [
      "Picking arm tightening up? Shake it out, then back in.",
      "Wrist or forearm feeling locked? Quick pause, then re-enter.",
      "Tension creeping in — set the guitar down for 60 seconds.",
    ],
    correction: [
      "Fatigue's showing in the pick attack — stop, rest the arm 90s. Tired picking entrenches tension.",
      "You're past peak — guitar down, stretch the wrist, then back in.",
      "Stop before tendonitis starts whispering. 90s off the strings.",
    ],
  },
  tempo_milestone: {
    correction: [
      "At {bpmLow} BPM — make sure the upstrokes are even before pushing.",
      "{bpmLow} BPM milestone. Hold this until the pick attack is consistent.",
      "New band: {bpmLow}-{bpmHigh}. Run alternate picking on a single string before climbing.",
    ],
  },
  check_in: {
    encouragement: [
      "Long stretch with the guitar — riff, chords, something specific?",
      "Five-plus minutes in. Want me to call out picking, rhythm, or both?",
      "You've been locked in. Tell me what you want feedback on.",
    ],
  },
} as const;

const BASS: ScenarioCatalog = {
  accuracy_drop: {
    correction: [
      "Right hand is drifting from the kick. Re-anchor on beat 1.",
      "Hits are scattering. Slow the fingering, lock to the kick.",
      "Stop, play just root notes to the click, then add the line.",
    ],
  },
  rushing_trend: {
    correction: [
      "Plucking hand is leading the kick — lay it back.",
      "Right hand's rushing. Sit deeper behind the beat with the drummer.",
      "Subdivide; place each pluck ON the click, not before it.",
    ],
  },
  dragging_trend: {
    correction: [
      "Plucks are lagging the kick — push slightly into each note.",
      "Right hand's dragging. Anticipate the click; don't wait for the kick to land.",
      "Lift the plucking finger sooner — meet the click on the front of the note.",
    ],
  },
  personal_best_streak: {
    encouragement: [
      "Locked with the kick.",
      "Pocket. Stay.",
      "Streak going — stay there.",
    ],
  },
  new_band_locked: {
    neutral: [
      "{bpmLow}–{bpmHigh} BPM band sustained — bass-kick lock is solid.",
      "Root-note pocket holding at {bpmLow}–{bpmHigh} BPM.",
      "Sustained at {bpmLow}–{bpmHigh} BPM — new floor for this groove.",
    ],
  },
  recovery: {
    encouragement: [
      "Back in the pocket. Stay.",
      "Pulled the line back. Hold it.",
      "Bass-kick lock recovered. Keep it.",
    ],
  },
  fatigue: {
    encouragement: [
      "Plucking fingers tightening up? Quick stretch — back in.",
      "Forearm starting to lock? Bass down for 60 seconds.",
      "Tension building in the right hand? Brief break, then re-enter.",
    ],
    correction: [
      "Fatigue's showing in the attack — stop, 90s off, then re-evaluate.",
      "You're past peak — bass down, stretch, then back in.",
      "Stop now. Tired plucking entrenches a sloppy pluck attack.",
    ],
  },
  tempo_milestone: {
    correction: [
      "At {bpmLow} BPM — make sure each note rings clean before climbing.",
      "{bpmLow} BPM milestone. Lock root notes to the click before pushing.",
      "New band: {bpmLow}-{bpmHigh}. Walk it slow first, then add ghost notes.",
    ],
  },
  check_in: {
    encouragement: [
      "Long stretch on the bass — line, groove, something specific?",
      "Five-plus minutes locked with the kick. Anything you want to dial in?",
      "You've been deep in the pocket. What's next?",
    ],
  },
} as const;

const ACOUSTIC_GUITAR: ScenarioCatalog = {
  accuracy_drop: {
    correction: [
      "Strumming hand is losing the grid. Anchor with the thumb.",
      "Hits are scattering. Soften the strum, accent the downbeat.",
      "Just open-string downstrokes to the click, then re-enter.",
    ],
  },
  rushing_trend: {
    correction: [
      "Strumming arm is leading — anchor the downstroke ON the click.",
      "Strumming hand's rushing. Slow the wrist; let the click drive the strum.",
      "Feel the AND of each beat between strums.",
    ],
  },
  dragging_trend: {
    correction: [
      "Strum is lagging — lift the wrist earlier; meet the click on the down.",
      "Strumming hand's dragging. Anticipate; don't wait for the click to land.",
      "Drive from the elbow, not just the wrist.",
    ],
  },
  personal_best_streak: {
    encouragement: [
      "Strumming's locked — keep going.",
      "Nice groove going. Stay.",
      "Streak holding — stay there.",
    ],
  },
  new_band_locked: {
    neutral: [
      "{bpmLow}–{bpmHigh} BPM band sustained — strumming is locked.",
      "Strumming pocket holding at {bpmLow}–{bpmHigh} BPM.",
      "Sustained at {bpmLow}–{bpmHigh} BPM — new floor for this pattern.",
    ],
  },
  recovery: {
    encouragement: [
      "Strum back on the grid. Hold it.",
      "Pulled the pattern back. Stay loose.",
      "Recovered — keep this feel.",
    ],
  },
  fatigue: {
    encouragement: [
      "Strumming arm tightening up? Shake it out, then back in.",
      "Wrist feeling locked? Quick stretch, then re-enter.",
      "Tension creeping into the strum — guitar down for 60 seconds.",
    ],
    correction: [
      "Fatigue's showing in the strum — stop, 90s off the strings.",
      "You're past peak — set the guitar down, stretch the wrist, then return.",
      "Tired strumming buries the dynamics. Stop, rest, restart.",
    ],
  },
  tempo_milestone: {
    correction: [
      "At {bpmLow} BPM — make sure each strum has equal weight before climbing.",
      "{bpmLow} BPM milestone. Hold here until the down-up balance is even.",
      "New band: {bpmLow}-{bpmHigh}. Try the pattern on one chord first, then move.",
    ],
  },
  check_in: {
    encouragement: [
      "Long stretch on the acoustic — chords, fingerpicking, something specific?",
      "Five-plus minutes in. Want me to call out the strumming or the chord changes?",
      "You've been locked in. Tell me what you want feedback on.",
    ],
  },
} as const;

const PIANO: ScenarioCatalog = {
  accuracy_drop: {
    correction: [
      "Hands are drifting apart. Lock the left hand to the click first.",
      "Hits are scattering. Slow down; hands separately, then together.",
      "Just left hand to the click for a bar, then add the right.",
    ],
  },
  rushing_trend: {
    correction: [
      "Right hand is leading the left — anchor the bass note ON the click.",
      "Rushing — sit deeper into the keybed; let the click pull each note.",
      "Subdivide; place each note where the click lands, not before.",
    ],
  },
  dragging_trend: {
    correction: [
      "Left hand is lagging — lead with the bass, not the melody.",
      "Dragging — anticipate the downbeat with the left hand; don't wait for the click.",
      "Lift the wrists earlier — meet the click on the front of each note.",
    ],
  },
  personal_best_streak: {
    encouragement: [
      "Hands locked. Stay.",
      "Both hands synced.",
      "Streak going — stay there.",
    ],
  },
  new_band_locked: {
    neutral: [
      "{bpmLow}–{bpmHigh} BPM band sustained — both hands locked to the click.",
      "Hand-sync pocket holding at {bpmLow}–{bpmHigh} BPM.",
      "Sustained at {bpmLow}–{bpmHigh} BPM — new floor for this voicing.",
    ],
  },
  recovery: {
    encouragement: [
      "Hands back in sync. Hold it.",
      "Two-hand lock back. Don't change anything.",
      "Recovered — stay loose in the shoulders.",
    ],
  },
  fatigue: {
    encouragement: [
      "Wrists tightening up? Quick float-and-stretch, then back in.",
      "Forearms feeling locked? Pause, drop the hands, breathe.",
      "Tension creeping into the shoulders — 60 seconds off the keys.",
    ],
    correction: [
      "Fatigue's showing in the touch — stop, hands down 90s.",
      "You're past peak — get off the bench, shake it out, then return.",
      "Tired playing buries the dynamics. Stop, rest the wrists, restart.",
    ],
  },
  tempo_milestone: {
    correction: [
      "At {bpmLow} BPM — make sure the left hand is rock-solid before climbing.",
      "{bpmLow} BPM milestone. Hold here until both hands are independent.",
      "New band: {bpmLow}-{bpmHigh}. Hands separately first, then together.",
    ],
  },
  check_in: {
    encouragement: [
      "Long stretch at the keys — piece, exercise, something specific?",
      "Five-plus minutes in. Want me to call out the left hand, right hand, or both?",
      "You've been locked in. Tell me what you want feedback on.",
    ],
  },
} as const;

// ---------------------------------------------------------------------------
// Catalog export
// ---------------------------------------------------------------------------

export const TEMPLATE_CATALOG: TemplateCatalog = {
  generic: GENERIC,
  drums: DRUMS,
  "electric-guitar": ELECTRIC_GUITAR,
  "acoustic-guitar": ACOUSTIC_GUITAR,
  bass: BASS,
  piano: PIANO,
};

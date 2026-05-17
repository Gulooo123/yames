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
      "Accuracy dropped from {priorAccuracyPct}% to {recentAccuracyPct}% over the last {windowBeats} beats.",
      "Hit rate slipped — {recentAccuracyPct}% in the last {windowBeats} versus {priorAccuracyPct}% before.",
      "Last {windowBeats} beats: {recentAccuracyPct}%. Prior block: {priorAccuracyPct}%.",
    ],
    correction: [
      "{recentAccuracyPct}% accuracy is below your previous block of {priorAccuracyPct}%. Consider slowing the tempo until it stabilises.",
      "You've dropped {priorAccuracyPct} → {recentAccuracyPct}%. Dial it back 5 BPM and rebuild.",
      "The slip is sustained. Slow down, get one clean bar, then climb again.",
    ],
  },
  rushing_trend: {
    encouragement: [
      "You're sitting {offsetMs}ms ahead — bring your awareness to the next click.",
      "Slight rush developing. Plant your foot, let the metronome lead.",
      "About {offsetMs}ms early. Inhale, settle, ride the beat.",
    ],
    neutral: [
      "Last {windowBeats} beats averaged {offsetMs}ms early (prior block: {priorOffsetMs}ms).",
      "Trending early — {offsetMs}ms ahead, was {priorOffsetMs}ms.",
      "You're rushing the click by ~{offsetMs}ms over the last few bars.",
    ],
    correction: [
      "Sustained rushing — {offsetMs}ms early. Subdivide internally and place each note ON the click, not before it.",
      "{offsetMs}ms ahead of the beat for {windowBeats} beats running. Slow down and feel the AND of each beat.",
      "The rush isn't fading. Pause, count yourself in slow, and re-enter.",
    ],
  },
  dragging_trend: {
    encouragement: [
      "Sitting {offsetMs}ms behind — lift the tempo back up under your fingers.",
      "Slight drag. Take a breath and push back into the beat.",
      "About {offsetMs}ms late. You're close — keep leaning forward.",
    ],
    neutral: [
      "Last {windowBeats} beats averaged {offsetMs}ms late (prior block: {priorOffsetMs}ms).",
      "Trending late — {offsetMs}ms behind, was {priorOffsetMs}ms.",
      "You're dragging the click by ~{offsetMs}ms over the last few bars.",
    ],
    correction: [
      "Sustained drag — {offsetMs}ms late. Anticipate the click slightly; don't wait for it to arrive.",
      "{offsetMs}ms behind the beat for {windowBeats} beats running. Push the tempo with your right hand.",
      "The drag is sticking. Stop, reset, and re-enter with intent on beat 1.",
    ],
  },
  personal_best_streak: {
    // v0.10: shortened to single-beat affirmations. Earlier copy
    // ("{streak} clean beats — new best this session. Keep
    // breathing.") tested fine in isolation but landed mid-flow like
    // an interruption. A positive tip is most useful as a quick
    // "you're doing the thing" — diagnostics belong in the neutral/
    // correction tiers below. Numeric `{streak}` stays so the praise
    // is grounded, not generic.
    encouragement: [
      "{streak} clean — keep it going.",
      "{streak} in a row. Nice.",
      "{streak} straight — stay there.",
    ],
    neutral: [
      "{streak}-beat clean streak — beats your previous best of {previousBest}.",
      "New streak: {streak} beats unbroken (was {previousBest}).",
      "{streak} clean — your best run today.",
    ],
    correction: [
      "{streak}-beat run — locked in. Hold tempo, don't push faster yet.",
      "{streak} clean. Stay at this BPM until it's automatic.",
      "{streak} in a row — exactly where you want to live for a minute.",
    ],
  },
  new_band_locked: {
    encouragement: [
      "{bpmLow} BPM, {accuracyPct}% — yours now.",
      "Locked at {bpmLow} BPM. Nice.",
      "{accuracyPct}% sustained — new ceiling.",
    ],
    neutral: [
      "Sustained ≥{accuracyPct}% accuracy at {bpmLow}-{bpmHigh} BPM for 60+ seconds.",
      "{bpmLow}-{bpmHigh} BPM band: {accuracyPct}% sustained.",
      "New BPM band locked in: {bpmLow}-{bpmHigh}, {accuracyPct}% accuracy.",
    ],
    correction: [
      "{bpmLow}-{bpmHigh} is stable. Stay here, then push ~5 BPM.",
      "Held {bpmLow}-{bpmHigh} clean. Ready to climb when you are.",
      "{bpmLow}-{bpmHigh} feels owned. Next session, start here.",
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
      "Score recovered from rough patch back to {recentAccuracyPct}%.",
      "Back to clean after a dip. Keep the new pace.",
      "Recovery confirmed — accuracy back above threshold.",
    ],
    correction: [
      "Recovery's holding. Don't push the tempo until 30 more seconds clean.",
      "Back from the dip — stay flat, no climbing yet.",
      "You salvaged it. Now hold this exact BPM for a full minute.",
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
      "{recentAccuracyPct}% — your kick is drifting. Lock the right foot to the click before the snare.",
      "Hits scattered the last {windowBeats} beats. Bring the bass-snare conversation back to the grid.",
      "Drop to {recentAccuracyPct}%. Stop, count a bar, restart with the foot only.",
    ],
  },
  rushing_trend: {
    correction: [
      "{offsetMs}ms ahead — your right hand is leading the kick. Lay it back.",
      "Snare's rushing by {offsetMs}ms. Subdivide 16ths between hits and place beat 2 ON the click.",
      "You're driving the click {offsetMs}ms. Slow the right hand; the foot will follow.",
    ],
  },
  dragging_trend: {
    correction: [
      "{offsetMs}ms behind — your right hand is lagging the kick. Lean into the hi-hat.",
      "Snare's dragging by {offsetMs}ms. Anticipate beat 2 and 4 slightly, don't wait for the click.",
      "You're behind by {offsetMs}ms. Push the hi-hat ahead; the kick should sit ON the click, not after.",
    ],
  },
  personal_best_streak: {
    encouragement: [
      "{streak} clean — kick-snare locked.",
      "{streak} in a row. Pocket.",
      "{streak} clean — stay there.",
    ],
  },
  new_band_locked: {
    neutral: [
      "{bpmLow}-{bpmHigh} BPM band sustained at {accuracyPct}% — kick-snare relationship is locked.",
      "Pocket holding at {bpmLow}-{bpmHigh} BPM, {accuracyPct}% sustained.",
      "{accuracyPct}% sustained at {bpmLow}-{bpmHigh} BPM — that's the new floor.",
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
      "{recentAccuracyPct}% — your picking hand is losing the grid. Anchor with your palm.",
      "Hits scattered the last {windowBeats} beats. Slow the picking pattern, accent beat 1.",
      "Drop to {recentAccuracyPct}%. Mute the strings, alternate-pick one bar to the click, then re-enter.",
    ],
  },
  rushing_trend: {
    correction: [
      "{offsetMs}ms ahead — your downstrokes are leading. Anchor the upstrokes ON the click.",
      "Picking hand rushing by {offsetMs}ms. Plant the wrist; let the metronome lead the downstroke.",
      "You're ahead by {offsetMs}ms. Subdivide eighths inside each beat and feel the AND.",
    ],
  },
  dragging_trend: {
    correction: [
      "{offsetMs}ms behind — your upstrokes are lagging. Lift the wrist; meet the click on the down.",
      "Picking hand dragging by {offsetMs}ms. Anticipate slightly; don't wait for the click to arrive.",
      "You're behind by {offsetMs}ms. Push from the forearm, not the fingers — let the pick lead.",
    ],
  },
  personal_best_streak: {
    encouragement: [
      "{streak} clean picks — keep going.",
      "{streak} in a row. Picking's locked.",
      "{streak} clean — stay there.",
    ],
  },
  new_band_locked: {
    neutral: [
      "{bpmLow}-{bpmHigh} BPM band sustained at {accuracyPct}% — alternate picking is locked.",
      "Picking-hand pocket holding at {bpmLow}-{bpmHigh} BPM, {accuracyPct}% sustained.",
      "{accuracyPct}% sustained at {bpmLow}-{bpmHigh} BPM — new floor for this riff.",
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
      "{recentAccuracyPct}% — your right hand is drifting from the kick. Re-anchor on beat 1.",
      "Hits scattered the last {windowBeats} beats. Slow the fingering, lock to the kick.",
      "Drop to {recentAccuracyPct}%. Stop, play just root notes to the click, then add the line.",
    ],
  },
  rushing_trend: {
    correction: [
      "{offsetMs}ms ahead — your plucking hand is leading the kick. Lay it back.",
      "Right hand rushing by {offsetMs}ms. Sit deeper behind the beat with the drummer.",
      "You're ahead by {offsetMs}ms. Subdivide; place each pluck ON the click, not before it.",
    ],
  },
  dragging_trend: {
    correction: [
      "{offsetMs}ms behind — your plucks are lagging the kick. Push slightly into each note.",
      "Right hand dragging by {offsetMs}ms. Anticipate the click; don't wait for the kick to land.",
      "You're behind by {offsetMs}ms. Lift the plucking finger sooner — meet the click on the front of the note.",
    ],
  },
  personal_best_streak: {
    encouragement: [
      "{streak} clean — locked with the kick.",
      "{streak} in a row. Pocket.",
      "{streak} clean — stay there.",
    ],
  },
  new_band_locked: {
    neutral: [
      "{bpmLow}-{bpmHigh} BPM band sustained at {accuracyPct}% — bass-kick lock is solid.",
      "Root-note pocket holding at {bpmLow}-{bpmHigh} BPM, {accuracyPct}% sustained.",
      "{accuracyPct}% sustained at {bpmLow}-{bpmHigh} BPM — new floor for this groove.",
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
      "{recentAccuracyPct}% — your strumming hand is losing the grid. Anchor with the thumb.",
      "Hits scattered the last {windowBeats} beats. Soften the strum, accent the downbeat.",
      "Drop to {recentAccuracyPct}%. Just open-string downstrokes to the click, then re-enter.",
    ],
  },
  rushing_trend: {
    correction: [
      "{offsetMs}ms ahead — your strumming arm is leading. Anchor the downstroke ON the click.",
      "Strumming hand rushing by {offsetMs}ms. Slow the wrist; let the click drive the strum.",
      "You're ahead by {offsetMs}ms. Feel the AND of each beat between strums.",
    ],
  },
  dragging_trend: {
    correction: [
      "{offsetMs}ms behind — your strum is lagging. Lift the wrist earlier; meet the click on the down.",
      "Strumming hand dragging by {offsetMs}ms. Anticipate; don't wait for the click to land.",
      "You're behind by {offsetMs}ms. Drive from the elbow, not just the wrist.",
    ],
  },
  personal_best_streak: {
    encouragement: [
      "{streak} clean strums — keep going.",
      "{streak} in a row. Nice groove.",
      "{streak} clean — stay there.",
    ],
  },
  new_band_locked: {
    neutral: [
      "{bpmLow}-{bpmHigh} BPM band sustained at {accuracyPct}% — strumming is locked.",
      "Strumming pocket holding at {bpmLow}-{bpmHigh} BPM, {accuracyPct}% sustained.",
      "{accuracyPct}% sustained at {bpmLow}-{bpmHigh} BPM — new floor for this pattern.",
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
      "{recentAccuracyPct}% — your hands are drifting apart. Lock the left hand to the click first.",
      "Hits scattered the last {windowBeats} beats. Slow down; hands separately, then together.",
      "Drop to {recentAccuracyPct}%. Just left hand to the click for a bar, then add the right.",
    ],
  },
  rushing_trend: {
    correction: [
      "{offsetMs}ms ahead — your right hand is leading the left. Anchor the bass note ON the click.",
      "Rushing by {offsetMs}ms. Sit deeper into the keybed; let the click pull each note.",
      "You're ahead by {offsetMs}ms. Subdivide; place each note where the click lands, not before.",
    ],
  },
  dragging_trend: {
    correction: [
      "{offsetMs}ms behind — your left hand is lagging. Lead with the bass, not the melody.",
      "Dragging by {offsetMs}ms. Anticipate the downbeat with the left hand; don't wait for the click.",
      "You're behind by {offsetMs}ms. Lift the wrists earlier — meet the click on the front of each note.",
    ],
  },
  personal_best_streak: {
    encouragement: [
      "{streak} clean — hands locked.",
      "{streak} in a row. Both hands synced.",
      "{streak} clean — stay there.",
    ],
  },
  new_band_locked: {
    neutral: [
      "{bpmLow}-{bpmHigh} BPM band sustained at {accuracyPct}% — both hands locked to the click.",
      "Hand-sync pocket holding at {bpmLow}-{bpmHigh} BPM, {accuracyPct}% sustained.",
      "{accuracyPct}% sustained at {bpmLow}-{bpmHigh} BPM — new floor for this voicing.",
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

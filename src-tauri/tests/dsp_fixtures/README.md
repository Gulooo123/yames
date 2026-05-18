# DSP scoring fixtures

Pinned input → output pairs for the post-match scoring path
(`score_feedbacks`). The harness lives at `../dsp_fixtures.rs`.

## Files

Every fixture has two siblings:

| Suffix | Role |
| --- | --- |
| `<name>.input.json` | The `BeatFeedback[]` to replay + name/description metadata |
| `<name>.golden.json` | The full `SessionReport` that the current code produces from that input |

Both are tracked in git. The golden file is the *baseline*; if the
scoring formula changes, this file changes, and the diff is the
review surface for the change.

## Adding a fixture

1. Hand-author or capture (TODO: capture helper from real sessions)
   the input as `<descriptive_name>.input.json`. Schema:
   ```json
   {
     "name": "human readable name",
     "description": "what scenario this captures (e.g. 16 perfect beats at 120 BPM)",
     "feedbacks": [
       {
         "beatIndex": 0,
         "deviationMs": 0.0,
         "intervalErrorMs": 0.0,
         "classification": "perfect",
         "amplitude": 0.5,
         "calibrationOffsetMs": 0.0,
         "calibrationConfidence": 1.0,
         "gridCorrelation": 1.0
       }
       /* … */
     ]
   }
   ```
2. From the repo root:
   ```sh
   UPDATE_FIXTURES=1 cargo test --manifest-path src-tauri/Cargo.toml --test dsp_fixtures
   ```
   This writes / rewrites every `.golden.json` from the current
   scoring output. Inspect with `git diff`.
3. Commit input + golden together.

## Accepting an intentional scoring change

Same procedure — re-run with `UPDATE_FIXTURES=1`, eyeball the diff in
every golden file, commit. Any unexpected drift in an unrelated
fixture is a regression and the change should be reverted or
narrowed.

## Why this exists

DSP changes are unusually easy to ship with subtle damage — the
formula touches many fixed weights and a bad tweak can pass every
synthetic matrix test while degrading the score on real sessions.
The fixture set is the cheap regression net between "synthetic clean
signals" (covered by `timing.rs::tests`) and "real end-to-end
session" (covered by D1 logs but expensive to run).

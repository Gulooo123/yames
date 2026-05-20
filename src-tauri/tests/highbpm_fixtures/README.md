# highbpm_fixtures

Layer-2 raw-onset regression fixtures for the `highbpm_fixtures` test suite.

## What is Layer-2?

- **Layer-1** (`dsp_fixtures`): starts from already-matched `BeatFeedback` values and exercises the scoring formula.
- **Layer-2** (this suite): starts from raw `DetectedOnset` + `ExpectedBeat` arrays and exercises the full `match_and_score` pipeline — onset matching + scoring formula together.

## Fixture list

| Stem | BPM | Type | Beats |
|------|-----|------|-------|
| `80bpm_16ths_perfect` | 80 | perfect | 64 |
| `100bpm_16ths_perfect` | 100 | perfect | 64 |
| `120bpm_16ths_perfect` | 120 | perfect | 64 |
| `140bpm_16ths_perfect` | 140 | perfect | 64 |
| `160bpm_16ths_perfect` | 160 | perfect (synthetic) | 64 |
| `180bpm_16ths_perfect` | 180 | perfect (synthetic) | 64 |
| `120bpm_16ths_jittered_5ms` | 120 | jitter σ=5ms, seed=0xC005 | 64 |
| `140bpm_16ths_jittered_10ms` | 140 | jitter σ=10ms, seed=0xE010 | 64 |
| `120bpm_16ths_chord_strum` | 120 | 2 onsets/beat 15ms apart | 64 |

All fixtures use the `electric-guitar` instrument profile.

## Adding a fixture

1. Add a row to `src/bin/seed-highbpm-fixtures.rs` (the `build_fixtures()` function).
2. Run `cargo run --bin seed-highbpm-fixtures` — writes the `.input.json`.
3. Run `UPDATE_FIXTURES=1 cargo test --test highbpm_fixtures` — bakes the `.golden.json`.
4. Commit both files.

## Re-baking goldens after an intentional change

```
UPDATE_FIXTURES=1 cargo test --test highbpm_fixtures
```

Review the diff against the committed golden files. The diff is the audit trail for any matcher or scoring formula change. Commit the updated goldens if the new numbers are correct.

## Running the suite

```
cargo test --test highbpm_fixtures
```

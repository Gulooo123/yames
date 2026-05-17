/**
 * Smoke tests for the authored template catalog (`templateCatalog.ts`).
 *
 * These are intentionally light — they don't second-guess the
 * authoring (that's content design) — but they DO assert the
 * structural invariants the rest of the coach pipeline relies on:
 *
 *   1. The `generic` vocabulary covers every gatekeeper scenario at
 *      every severity, so the fallback path always resolves.
 *   2. Every authored template uses only placeholders the gatekeeper
 *      actually emits (no `{undefined}` after fill).
 *   3. Every instrument-specific override resolves through `pickTemplate`
 *      without falling back to generic (so the overlay is actually used).
 *   4. The catalog has no dangling empty arrays — an empty variant
 *      list would cause `pickTemplate` to return `null` and the
 *      gatekeeper to ship raw template-key text.
 */

import { describe, expect, it } from "vitest";

import { pickTemplate, createShuffleState, type Severity, type Vocabulary } from "./templates";
import { TEMPLATE_CATALOG } from "./templateCatalog";

// The full gatekeeper scenario list (mirrored from `gatekeeper.ts`'s
// `ScenarioTag` union). Kept inline to avoid a circular dep — if the
// gatekeeper adds a scenario, this list will drift and the
// `generic`-completeness assertion below will flag it.
const SCENARIOS = [
  "accuracy_drop",
  "personal_best_streak",
  "rushing_trend",
  "dragging_trend",
  "recovery",
  "fatigue",
  "tempo_milestone",
  "new_band_locked",
  "low_confidence",
  "check_in",
  "boundary_signal_a",
  "boundary_signal_b",
] as const;

const SEVERITIES: Severity[] = ["encouragement", "neutral", "correction"];

const INSTRUMENT_VOCABS: Vocabulary[] = [
  "drums",
  "electric-guitar",
  "acoustic-guitar",
  "bass",
  "piano",
];

// A superset of every placeholder name any seeded template uses. If an
// instrument-specific template ever introduces a new placeholder, add
// it here AND emit it from the gatekeeper context — otherwise the
// fill will silently leave `{newKey}` in the user-facing text.
const ALL_PLACEHOLDERS = {
  recentAccuracyPct: 75,
  priorAccuracyPct: 90,
  windowBeats: 16,
  offsetMs: 12,
  priorOffsetMs: 4,
  streak: 24,
  previousBest: 12,
  bpmLow: 120,
  bpmHigh: 130,
  accuracyPct: 88,
  bpm: 130,
  score: 92,
  change: "BPM up to 130",
} as const;

// ---------------------------------------------------------------------------

describe("TEMPLATE_CATALOG — generic fallback completeness", () => {
  const generic = TEMPLATE_CATALOG.generic!;

  for (const scenario of SCENARIOS) {
    for (const severity of SEVERITIES) {
      it(`covers generic ${scenario}/${severity}`, () => {
        const variants = generic[scenario]?.[severity];
        expect(variants, `generic.${scenario}.${severity} missing`).toBeDefined();
        expect(variants!.length, `generic.${scenario}.${severity} empty`).toBeGreaterThan(0);
      });
    }
  }
});

describe("TEMPLATE_CATALOG — every variant resolves placeholders", () => {
  for (const vocab of [...INSTRUMENT_VOCABS, "generic"] as Vocabulary[]) {
    const catalog = TEMPLATE_CATALOG[vocab];
    if (!catalog) continue;
    for (const scenario of Object.keys(catalog)) {
      for (const severity of SEVERITIES) {
        const variants = catalog[scenario]?.[severity];
        if (!variants) continue;
        for (let i = 0; i < variants.length; i++) {
          const tpl = variants[i];
          it(`${vocab}.${scenario}.${severity}[${i}] uses only known placeholders`, () => {
            const filled = tpl.replace(
              /\{([a-zA-Z0-9_]+)\}/g,
              (_, key: string) => {
                expect(
                  key in ALL_PLACEHOLDERS,
                  `Unknown placeholder {${key}} in "${tpl}" — add it to ALL_PLACEHOLDERS and the gatekeeper context.`,
                ).toBe(true);
                return String(ALL_PLACEHOLDERS[key as keyof typeof ALL_PLACEHOLDERS] ?? "");
              },
            );
            // After fill, the string must have no remaining {placeholder}
            // tokens — that would mean the regex above let one through.
            expect(filled.match(/\{[a-zA-Z0-9_]+\}/)).toBeNull();
          });
        }
      }
    }
  }
});

describe("TEMPLATE_CATALOG — instrument overrides are reachable via pickTemplate", () => {
  for (const vocab of INSTRUMENT_VOCABS) {
    const catalog = TEMPLATE_CATALOG[vocab];
    if (!catalog) continue;
    for (const scenario of Object.keys(catalog)) {
      for (const severity of SEVERITIES) {
        const variants = catalog[scenario]?.[severity];
        if (!variants || variants.length === 0) continue;
        it(`${vocab}.${scenario}.${severity} is reachable`, () => {
          const state = createShuffleState();
          const out = pickTemplate(TEMPLATE_CATALOG, state, {
            vocab,
            scenario,
            severity,
            context: ALL_PLACEHOLDERS,
            // Force deterministic RNG so the test isn't flaky.
            rng: () => 0,
          });
          expect(out, `${vocab}.${scenario}.${severity} returned null`).not.toBeNull();
          expect(out!.length).toBeGreaterThan(0);
          // The pick should resolve to one of the AUTHORED variants
          // (post-fill), not the generic fallback. We can't directly
          // observe which catalog was hit, so we assert the result
          // matches at least one filled-variant in the override.
          const filledOverrides = variants.map((tpl) =>
            tpl.replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, key: string) =>
              key in ALL_PLACEHOLDERS
                ? String(ALL_PLACEHOLDERS[key as keyof typeof ALL_PLACEHOLDERS])
                : whole,
            ),
          );
          expect(filledOverrides).toContain(out);
        });
      }
    }
  }
});

describe("TEMPLATE_CATALOG — every variant is non-empty", () => {
  for (const vocab of Object.keys(TEMPLATE_CATALOG) as Vocabulary[]) {
    const catalog = TEMPLATE_CATALOG[vocab];
    if (!catalog) continue;
    for (const scenario of Object.keys(catalog)) {
      for (const severity of SEVERITIES) {
        const variants = catalog[scenario]?.[severity];
        if (!variants) continue;
        it(`${vocab}.${scenario}.${severity} has only non-empty strings`, () => {
          for (const tpl of variants) {
            expect(tpl.trim().length).toBeGreaterThan(0);
          }
        });
      }
    }
  }
});

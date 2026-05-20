import { describe, expect, it } from "vitest";

import {
  SIMILARITY_MAX_RETRIES,
  SIMILARITY_RING_SIZE,
  SIMILARITY_THRESHOLD,
  bigramOverlap,
  createShuffleState,
  fillTemplate,
  pickTemplate,
  recordUtterance,
  type TemplateCatalog,
  type Vocabulary,
} from "./templates";
import { TEMPLATE_CATALOG } from "./templateCatalog";

// ---------------------------------------------------------------------------
// Deterministic RNG helpers
// ---------------------------------------------------------------------------

/**
 * Sequence-driven RNG: returns numbers from `values` in order, wrapping
 * back to the start when exhausted. Lets a test pin Fisher–Yates to a
 * known permutation.
 */
function rngSeq(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i++;
    return v;
  };
}

/** Returns the same constant every call. Forces a fixed shuffle. */
function rngConstant(value: number): () => number {
  return () => value;
}

// ---------------------------------------------------------------------------
// fillTemplate
// ---------------------------------------------------------------------------

describe("fillTemplate", () => {
  it("substitutes a single placeholder", () => {
    expect(fillTemplate("Hello {name}", { name: "world" })).toBe("Hello world");
  });

  it("substitutes multiple placeholders", () => {
    const out = fillTemplate("{a} and {b} and {a}", { a: "x", b: "y" });
    expect(out).toBe("x and y and x");
  });

  it("coerces numeric values to strings", () => {
    expect(fillTemplate("BPM={bpm}", { bpm: 120 })).toBe("BPM=120");
  });

  it("coerces boolean values to strings", () => {
    expect(fillTemplate("flag={f}", { f: true })).toBe("flag=true");
  });

  it("leaves unmatched placeholders in place", () => {
    expect(fillTemplate("Hi {missing}", {})).toBe("Hi {missing}");
  });

  it("leaves invalid placeholder syntax untouched", () => {
    // Spaces inside braces are not a valid token shape, so we leave it alone.
    expect(fillTemplate("Hi { name }", { name: "x" })).toBe("Hi { name }");
  });

  it("supports underscored and alphanumeric keys", () => {
    const out = fillTemplate("{bpm_low}-{bpm2}", { bpm_low: 100, bpm2: 110 });
    expect(out).toBe("100-110");
  });

  it("returns the input unchanged when there are no placeholders", () => {
    expect(fillTemplate("plain text", { foo: "bar" })).toBe("plain text");
  });
});

// ---------------------------------------------------------------------------
// bigramOverlap
// ---------------------------------------------------------------------------

describe("bigramOverlap", () => {
  it("returns 1.0 for identical strings", () => {
    expect(bigramOverlap("the quick brown fox", "the quick brown fox")).toBe(1);
  });

  it("returns 1.0 when both inputs are empty", () => {
    expect(bigramOverlap("", "")).toBe(1);
  });

  it("returns 0 when one input is empty and the other is not", () => {
    expect(bigramOverlap("", "hello world")).toBe(0);
    expect(bigramOverlap("hello world", "")).toBe(0);
  });

  it("returns 0 for fully disjoint inputs", () => {
    expect(bigramOverlap("one two three", "four five six")).toBe(0);
  });

  it("is symmetric", () => {
    const a = "the quick brown fox";
    const b = "the quick brown dog";
    expect(bigramOverlap(a, b)).toBeCloseTo(bigramOverlap(b, a), 10);
  });

  it("computes partial overlap correctly", () => {
    // "a b c" → {a b, b c}; "a b d" → {a b, b d}. Shared = 1. Max = 2.
    expect(bigramOverlap("a b c", "a b d")).toBeCloseTo(0.5, 10);
  });

  it("is case-insensitive", () => {
    expect(bigramOverlap("The Quick BROWN", "the quick brown")).toBe(1);
  });

  it("strips punctuation before tokenising", () => {
    expect(bigramOverlap("hello, world!", "hello world")).toBe(1);
  });

  it("uses max-size denominator (not min)", () => {
    // "a b c d e" → 4 bigrams; "a b" → 1 bigram. Shared = 1 ("a b").
    // overlap = 1/4 = 0.25 (NOT 1/1 = 1.0).
    expect(bigramOverlap("a b c d e", "a b")).toBeCloseTo(0.25, 10);
  });
});

// ---------------------------------------------------------------------------
// pickTemplate — basic behaviour
// ---------------------------------------------------------------------------

describe("pickTemplate", () => {
  const catalog: TemplateCatalog = {
    generic: {
      scenarioA: {
        neutral: ["one", "two", "three"],
      },
      scenarioFallbackOnly: {
        neutral: ["fallback only A", "fallback only B"],
      },
    },
    drums: {
      scenarioA: {
        neutral: ["drums-one", "drums-two"],
      },
      // scenarioFallbackOnly intentionally absent → drums falls back to generic.
    },
  };

  it("returns null when no entries exist anywhere", () => {
    const state = createShuffleState();
    const out = pickTemplate(catalog, state, {
      vocab: "drums",
      scenario: "doesNotExist",
      severity: "neutral",
    });
    expect(out).toBeNull();
  });

  it("returns the only available template when bag has size 1", () => {
    const singleton: TemplateCatalog = {
      generic: { s: { neutral: ["only one"] } },
    };
    const state = createShuffleState();
    const out = pickTemplate(singleton, state, {
      vocab: "generic",
      scenario: "s",
      severity: "neutral",
    });
    expect(out).toBe("only one");
  });

  it("falls back to generic when the requested vocab has no entry", () => {
    const state = createShuffleState();
    const out = pickTemplate(catalog, state, {
      vocab: "drums",
      scenario: "scenarioFallbackOnly",
      severity: "neutral",
    });
    expect(out !== null && out.startsWith("fallback only")).toBe(true);
  });

  it("prefers the instrument-specific entry over generic when both exist", () => {
    const state = createShuffleState();
    // Constant rng=0 → Fisher–Yates leaves array stable; we pop from end.
    const out = pickTemplate(catalog, state, {
      vocab: "drums",
      scenario: "scenarioA",
      severity: "neutral",
      rng: rngConstant(0),
    });
    expect(out !== null && out.startsWith("drums-")).toBe(true);
  });

  it("substitutes context placeholders in the returned string", () => {
    const cat: TemplateCatalog = {
      generic: {
        s: { neutral: ["BPM is {bpm}"] },
      },
    };
    const state = createShuffleState();
    const out = pickTemplate(cat, state, {
      vocab: "generic",
      scenario: "s",
      severity: "neutral",
      context: { bpm: 120 },
    });
    expect(out).toBe("BPM is 120");
  });
});

// ---------------------------------------------------------------------------
// pickTemplate — shuffle-bag draws without replacement
// ---------------------------------------------------------------------------

describe("pickTemplate shuffle-bag", () => {
  it("draws every variant before repeating", () => {
    // Multi-word, mutually-disjoint phrases so each pair has 0 bigram
    // overlap (a single-word fixture would collide because two empty
    // bigram sets are treated as fully overlapping by design).
    const cat: TemplateCatalog = {
      generic: {
        s: {
          neutral: [
            "alpha aardvark",
            "beta beluga",
            "gamma giraffe",
            "delta dolphin",
          ],
        },
      },
    };
    const state = createShuffleState();
    const draws: string[] = [];
    for (let i = 0; i < 4; i++) {
      const out = pickTemplate(cat, state, {
        vocab: "generic",
        scenario: "s",
        severity: "neutral",
        rng: rngConstant(0),
      });
      expect(out).not.toBeNull();
      draws.push(out!);
    }
    // All four unique → bag was drawn without replacement.
    expect(new Set(draws).size).toBe(4);
  });

  it("reseeds the bag after exhaustion", () => {
    const cat: TemplateCatalog = {
      generic: {
        s: { neutral: ["alpha", "beta"] },
      },
    };
    const state = createShuffleState();
    const draws: string[] = [];
    // Two draws empty the bag, third forces a refill.
    for (let i = 0; i < 5; i++) {
      const out = pickTemplate(cat, state, {
        vocab: "generic",
        scenario: "s",
        severity: "neutral",
        rng: rngConstant(0),
      });
      draws.push(out!);
    }
    // After reseed we should see at least both options eventually.
    expect(new Set(draws).size).toBe(2);
    expect(draws.length).toBe(5);
  });

  it("maintains independent bags per scenario", () => {
    const cat: TemplateCatalog = {
      generic: {
        sA: { neutral: ["a1", "a2"] },
        sB: { neutral: ["b1", "b2"] },
      },
    };
    const state = createShuffleState();
    const aOut = pickTemplate(cat, state, {
      vocab: "generic",
      scenario: "sA",
      severity: "neutral",
    });
    const bOut = pickTemplate(cat, state, {
      vocab: "generic",
      scenario: "sB",
      severity: "neutral",
    });
    expect(aOut === "a1" || aOut === "a2").toBe(true);
    expect(bOut === "b1" || bOut === "b2").toBe(true);
  });

  it("maintains independent bags per severity within the same scenario", () => {
    const cat: TemplateCatalog = {
      generic: {
        s: {
          neutral: ["n1"],
          encouragement: ["e1"],
        },
      },
    };
    const state = createShuffleState();
    const n = pickTemplate(cat, state, {
      vocab: "generic",
      scenario: "s",
      severity: "neutral",
    });
    const e = pickTemplate(cat, state, {
      vocab: "generic",
      scenario: "s",
      severity: "encouragement",
    });
    expect(n).toBe("n1");
    expect(e).toBe("e1");
  });

  it("produces deterministic draws for a fixed rng sequence", () => {
    const cat: TemplateCatalog = {
      generic: {
        s: { neutral: ["a", "b", "c"] },
      },
    };
    // Fisher–Yates iterates from i=n-1 down to i=1, picking j in [0, i].
    // With three items the swaps are: i=2 j=floor(r0*3); i=1 j=floor(r1*2).
    // We don't pin the exact permutation here — just assert determinism
    // by re-running the same rng on a fresh state and getting identical
    // results.
    const seq = [0.1, 0.4, 0.7, 0.2];
    const draws1: string[] = [];
    const draws2: string[] = [];
    const s1 = createShuffleState();
    const s2 = createShuffleState();
    for (let i = 0; i < 3; i++) {
      draws1.push(
        pickTemplate(cat, s1, {
          vocab: "generic",
          scenario: "s",
          severity: "neutral",
          rng: rngSeq(seq),
        })!,
      );
      draws2.push(
        pickTemplate(cat, s2, {
          vocab: "generic",
          scenario: "s",
          severity: "neutral",
          rng: rngSeq(seq),
        })!,
      );
    }
    expect(draws1).toEqual(draws2);
  });
});

// ---------------------------------------------------------------------------
// pickTemplate — similarity guard
// ---------------------------------------------------------------------------

describe("pickTemplate similarity guard", () => {
  it("avoids a candidate that closely matches a prior utterance when an alternative exists", () => {
    const cat: TemplateCatalog = {
      generic: {
        s: {
          neutral: [
            "the quick brown fox jumps",
            "rain falls gently on rooftops",
          ],
        },
      },
    };
    const state = createShuffleState();
    // Prime the ring with something identical to the first variant so
    // the guard rejects it and we get the disjoint one.
    recordUtterance(state, "the quick brown fox jumps");

    const out = pickTemplate(cat, state, {
      vocab: "generic",
      scenario: "s",
      severity: "neutral",
    });
    expect(out).toBe("rain falls gently on rooftops");
  });

  it("ships a candidate anyway when all variants exceed the threshold", () => {
    // Both variants are near-identical to the primed utterance, so
    // every retry will be rejected. After SIMILARITY_MAX_RETRIES the
    // guard ships whatever it has.
    const cat: TemplateCatalog = {
      generic: {
        s: {
          neutral: [
            "the quick brown fox jumps over",
            "the quick brown fox jumps high",
          ],
        },
      },
    };
    const state = createShuffleState();
    recordUtterance(state, "the quick brown fox jumps now");
    const out = pickTemplate(cat, state, {
      vocab: "generic",
      scenario: "s",
      severity: "neutral",
    });
    expect(out).not.toBeNull();
    expect(typeof out).toBe("string");
  });

  it("records picked templates into the similarity ring", () => {
    const cat: TemplateCatalog = {
      generic: {
        s: {
          neutral: ["the quick brown fox", "an entirely different sentence"],
        },
      },
    };
    const state = createShuffleState();
    pickTemplate(cat, state, {
      vocab: "generic",
      scenario: "s",
      severity: "neutral",
    });
    expect(state.ring.length).toBeGreaterThan(0);
  });

  it("caps the ring at SIMILARITY_RING_SIZE entries", () => {
    const state = createShuffleState();
    for (let i = 0; i < SIMILARITY_RING_SIZE + 4; i++) {
      recordUtterance(state, `utterance number ${i} unique words`);
    }
    expect(state.ring.length).toBe(SIMILARITY_RING_SIZE);
  });

  it("keeps the most recent utterances when evicting", () => {
    const state = createShuffleState();
    for (let i = 0; i < SIMILARITY_RING_SIZE + 3; i++) {
      recordUtterance(state, `entry-${i}`);
    }
    // Oldest entries dropped → ring begins with `entry-3`.
    expect(state.ring[0]).toBe("entry-3");
    expect(state.ring[state.ring.length - 1]).toBe(
      `entry-${SIMILARITY_RING_SIZE + 2}`,
    );
  });

  it("uses the threshold strictly (> not >=)", () => {
    // The similarity guard uses `> SIMILARITY_THRESHOLD`, so a candidate
    // whose overlap exactly equals the threshold must NOT be rejected.
    // We construct variants with overlap exactly 0.5 = SIMILARITY_THRESHOLD.
    // "a b c" → {"a b", "b c"} (2 bigrams)
    // "a b d" → {"a b", "b d"} (2 bigrams)
    // shared = 1 ("a b"), max = 2 → overlap = 0.5.
    expect(SIMILARITY_THRESHOLD).toBe(0.5);
    const cat: TemplateCatalog = {
      generic: {
        s: { neutral: ["a b c"] },
      },
    };
    const state = createShuffleState();
    recordUtterance(state, "a b d");
    const out = pickTemplate(cat, state, {
      vocab: "generic",
      scenario: "s",
      severity: "neutral",
    });
    expect(out).toBe("a b c");
  });
});

// ---------------------------------------------------------------------------
// recordUtterance
// ---------------------------------------------------------------------------

describe("recordUtterance", () => {
  it("primes the ring without picking", () => {
    const state = createShuffleState();
    recordUtterance(state, "external utterance one");
    expect(state.ring).toEqual(["external utterance one"]);
    expect(state.remaining.size).toBe(0);
  });

  it("appends in order", () => {
    const state = createShuffleState();
    recordUtterance(state, "first");
    recordUtterance(state, "second");
    recordUtterance(state, "third");
    expect(state.ring).toEqual(["first", "second", "third"]);
  });

  it("influences the next pickTemplate via the similarity guard", () => {
    const cat: TemplateCatalog = {
      generic: {
        s: {
          neutral: ["alpha beta gamma delta", "totally other distinct line"],
        },
      },
    };
    const state = createShuffleState();
    recordUtterance(state, "alpha beta gamma delta epsilon");
    const out = pickTemplate(cat, state, {
      vocab: "generic",
      scenario: "s",
      severity: "neutral",
    });
    expect(out).toBe("totally other distinct line");
  });
});

// ---------------------------------------------------------------------------
// Constants sanity
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("SIMILARITY_RING_SIZE is sensible", () => {
    expect(SIMILARITY_RING_SIZE).toBeGreaterThanOrEqual(3);
    expect(SIMILARITY_RING_SIZE).toBeLessThanOrEqual(20);
  });

  it("SIMILARITY_THRESHOLD is in (0,1)", () => {
    expect(SIMILARITY_THRESHOLD).toBeGreaterThan(0);
    expect(SIMILARITY_THRESHOLD).toBeLessThan(1);
  });

  it("SIMILARITY_MAX_RETRIES is non-negative", () => {
    expect(SIMILARITY_MAX_RETRIES).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// session_start greeting slot — 96-combination snapshot
// (6 vocabs × 8 variants × 2 paths = cold + returning)
// ---------------------------------------------------------------------------

describe("session_start greeting slots — 96 combinations", () => {
  const VOCABS: Vocabulary[] = [
    "generic",
    "drums",
    "electric-guitar",
    "acoustic-guitar",
    "bass",
    "piano",
  ];

  // Fixed context values for the returning path.
  const RETURNING_CONTEXT = { lastScore: 88, lastBpm: 135 };

  for (const vocab of VOCABS) {
    const catalog = TEMPLATE_CATALOG[vocab];

    // -------------------------------------------------------------------------
    // Cold path — session_start_cold
    // -------------------------------------------------------------------------
    describe(`${vocab} / session_start_cold`, () => {
      it(`has exactly 8 variants`, () => {
        const variants = catalog?.["session_start_cold"]?.["neutral"];
        expect(variants, `${vocab}.session_start_cold.neutral missing`).toBeDefined();
        expect(variants!.length).toBe(8);
      });

      const coldVariants = catalog?.["session_start_cold"]?.["neutral"] ?? [];
      for (let i = 0; i < coldVariants.length; i++) {
        it(`variant [${i}] does not contain raw {lastScore} or {lastBpm}`, () => {
          // Cold variants must NOT contain these placeholders at all.
          const tpl = coldVariants[i];
          expect(tpl).not.toMatch(/\{lastScore\}/);
          expect(tpl).not.toMatch(/\{lastBpm\}/);
          // After filling with an empty context, no raw placeholder tokens remain.
          const filled = fillTemplate(tpl, {});
          expect(filled).not.toMatch(/\{[a-zA-Z0-9_]+\}/);
        });
      }
    });

    // -------------------------------------------------------------------------
    // Returning path — session_start_returning
    // -------------------------------------------------------------------------
    describe(`${vocab} / session_start_returning`, () => {
      it(`has exactly 8 variants`, () => {
        const variants = catalog?.["session_start_returning"]?.["neutral"];
        expect(variants, `${vocab}.session_start_returning.neutral missing`).toBeDefined();
        expect(variants!.length).toBe(8);
      });

      const returningVariants = catalog?.["session_start_returning"]?.["neutral"] ?? [];
      for (let i = 0; i < returningVariants.length; i++) {
        it(`variant [${i}] contains {lastScore} and {lastBpm} placeholders in template`, () => {
          const tpl = returningVariants[i];
          expect(tpl, `${vocab}.session_start_returning.neutral[${i}] missing {lastScore}`).toMatch(/\{lastScore\}/);
          expect(tpl, `${vocab}.session_start_returning.neutral[${i}] missing {lastBpm}`).toMatch(/\{lastBpm\}/);
        });

        it(`variant [${i}] resolves to actual values when filled`, () => {
          const tpl = returningVariants[i];
          const filled = fillTemplate(tpl, RETURNING_CONTEXT);
          // Resolved values appear in the output.
          expect(filled).toContain("88");
          expect(filled).toContain("135");
          // No raw placeholder tokens remain after fill.
          expect(filled).not.toMatch(/\{[a-zA-Z0-9_]+\}/);
        });
      }
    });
  }
});

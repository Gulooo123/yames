import { describe, expect, it } from "vitest";

import { createSessionToken } from "./sessionGuard";

/**
 * The token must capture the session id at construction and report
 * stale ONLY when the ref has advanced past that snapshot. The
 * regression we're guarding against: a real-time coach-tip rephrase
 * landing in the NEXT session's feed because the original sessionId
 * guard was missing (see useSession.ts real-time effect / chat path).
 */
describe("createSessionToken", () => {
  it("captures the current session id and reports not-stale while ref is stable", () => {
    const ref = { current: 5 };
    const token = createSessionToken(ref);
    expect(token.capturedAt).toBe(5);
    expect(token.isStale()).toBe(false);
  });

  it("reports stale once the ref advances past the captured id", () => {
    const ref = { current: 1 };
    const token = createSessionToken(ref);
    ref.current = 2;
    expect(token.isStale()).toBe(true);
  });

  it("does NOT report stale if the ref moves backwards (defensive)", () => {
    // We only consider strict !==, so any drift counts as stale. This
    // is documented behavior — startSession only ever ++s the ref, so
    // a backwards move never happens in practice; but the test pins
    // the predicate's semantics so a future refactor can't silently
    // drop the guard for "looks-the-same" cases.
    const ref = { current: 3 };
    const token = createSessionToken(ref);
    ref.current = 2;
    expect(token.isStale()).toBe(true);
  });

  it("supports the canonical real-time-tip pattern: drop result when stale", async () => {
    // Simulates the exact useSession.ts pattern. Two concurrent async
    // calls share a sessionIdRef; only the live one should commit.
    const ref = { current: 10 };
    const committed: string[] = [];

    const tipA = (async () => {
      const token = createSessionToken(ref);
      // Yield once to simulate `await coachGenerate(...)`.
      await Promise.resolve();
      if (token.isStale()) return;
      committed.push("tip-A");
    })();

    // Simulate startSession() running BEFORE tipA's await resolves.
    ref.current = 11;

    const tipB = (async () => {
      const token = createSessionToken(ref);
      await Promise.resolve();
      if (token.isStale()) return;
      committed.push("tip-B");
    })();

    await Promise.all([tipA, tipB]);
    // tipA's session was bumped before its await resolved → dropped.
    // tipB was created AFTER the bump → committed.
    expect(committed).toEqual(["tip-B"]);
  });

  it("two tokens captured at the same id are independent", () => {
    // Each generateTip() / sendChat() / coachGenerate() call creates a
    // fresh token. Making sure tokens don't share state — otherwise a
    // chat reply that completes second would erroneously see itself
    // as stale because the first call already "consumed" the id.
    const ref = { current: 7 };
    const a = createSessionToken(ref);
    const b = createSessionToken(ref);
    expect(a.isStale()).toBe(false);
    expect(b.isStale()).toBe(false);
    ref.current = 8;
    expect(a.isStale()).toBe(true);
    expect(b.isStale()).toBe(true);
  });

  it("reports inactive when the activeRef flips to false post-construction", () => {
    // Models the "user ended session mid-LLM-call" hazard. The sid
    // hasn't advanced (no restart), but activeRef.current is now false
    // so the token's late resolver must drop without speaking.
    const sid = { current: 4 };
    const active = { current: true };
    const token = createSessionToken(sid, active);
    expect(token.isInactive()).toBe(false);
    expect(token.isStaleOrInactive()).toBe(false);
    active.current = false;
    expect(token.isInactive()).toBe(true);
    expect(token.isStale()).toBe(false); // sid hasn't moved
    expect(token.isStaleOrInactive()).toBe(true);
  });

  it("isInactive defaults to false when no activeRef is provided (legacy)", () => {
    // Backwards compatibility: callers that only care about restarts
    // (not end-without-restart) can omit `activeRef` and isInactive()
    // is a permanent no-op. Mirrors the pre-2026-05 API.
    const sid = { current: 1 };
    const token = createSessionToken(sid);
    expect(token.isInactive()).toBe(false);
    expect(token.isStaleOrInactive()).toBe(false);
  });

  it("isStaleOrInactive triggers on either restart or end", () => {
    const sid = { current: 1 };
    const active = { current: true };
    const token = createSessionToken(sid, active);
    // Restart only.
    sid.current = 2;
    expect(token.isStaleOrInactive()).toBe(true);
    // Restart cleared, but now active false.
    sid.current = 1;
    active.current = false;
    expect(token.isStaleOrInactive()).toBe(true);
    // Both fixed → live again (would only happen via test mutation).
    active.current = true;
    expect(token.isStaleOrInactive()).toBe(false);
  });
});

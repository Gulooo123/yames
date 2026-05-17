/**
 * Stale-session guard for fire-and-forget async work in useSession.
 *
 * The coach pipeline kicks off several async LLM calls during a
 * session — greeting paraphrase, mini-report comment, real-time tip
 * rephrase, end-of-session summary, adaptive drill decision, chat
 * reply. Each one can outlive its originating session: the user can
 * click End → Start while a 2-second LLM call is still in-flight, and
 * the resolved promise would otherwise:
 *
 *   1. land its result in the NEW session's feed (`setMessages`)
 *   2. speak the stale content over the new session's greeting
 *   3. mutate `narrativeRef.current` of a different session
 *
 * The pattern in `useSession.ts` is uniform:
 *
 *     const sid = sessionIdRef.current;
 *     // ...await coachGenerate(...)...
 *     if (sid !== sessionIdRef.current) return;
 *
 * Wrapped as a token here so the invariant is unit-testable without
 * standing up a React component, and so future async sites can opt in
 * with a one-line `if (token.isStale()) return;`.
 *
 * The token captures the CURRENT session id eagerly at construction
 * time, so even if the ref it points to mutates before `isStale()` is
 * called, the token still compares against the original value.
 */
export interface SessionToken {
  /** Snapshot of the session id at construction time. */
  readonly capturedAt: number;
  /** True iff the session id has advanced since the token was created. */
  isStale(): boolean;
  /**
   * True iff the session ended without a restart since the token was
   * created. Distinct from `isStale` (sid bump = restart): `isInactive`
   * triggers when the user hits End and DOESN'T start a new session.
   * Without it, a late LLM resolve would still land in the just-ended
   * session's feed (and speak aloud over the user, who has by then
   * minimized the app or moved on).
   *
   * `activeRef` is optional — pre-existing call sites use `isStale`
   * only. New sites should prefer `isStaleOrInactive` to cover both
   * paths in one check.
   */
  isInactive(): boolean;
  /** Convenience: `isStale() || isInactive()`. */
  isStaleOrInactive(): boolean;
}

/**
 * Create a `SessionToken` rooted in the given refs. The token snapshots
 * `sessionIdRef.current` at construction and exposes cheap stale + live
 * checks. `activeRef` is optional; when omitted, `isInactive()` always
 * returns false (legacy behaviour for call sites that haven't been
 * migrated).
 */
export function createSessionToken(
  sessionIdRef: { current: number },
  activeRef?: { current: boolean },
): SessionToken {
  const capturedAt = sessionIdRef.current;
  return {
    capturedAt,
    isStale: () => capturedAt !== sessionIdRef.current,
    isInactive: () => (activeRef ? !activeRef.current : false),
    isStaleOrInactive: () =>
      capturedAt !== sessionIdRef.current ||
      (activeRef ? !activeRef.current : false),
  };
}

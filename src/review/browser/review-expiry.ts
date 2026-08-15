// Owns what an already-open page may say about a review it can no longer
// reach. The page cannot ask the runtime that stopped answering, so it answers
// from what it holds: it lost contact, and the deadline it was last told has
// since passed.
//
// It deliberately stops there rather than naming a cause. A passed deadline
// does NOT prove the runtime idled out: a working agent's idle reprieve
// touches the activity clock, and another tab can push it forward too, so the
// runtime's real deadline may be far ahead of the one this page remembers -
// and the runtime may then have been stopped by hand, or may even still be
// running while two requests merely timed out. Every explanation of why is
// therefore unknowable from here, and the page says only what it observed.
//
// This still earns its place: "the local review server stopped responding"
// leaves a reader who returns to a tab after lunch unable to tell a runtime
// that just died from one that went away while they were gone (BIG-65). It
// covers an already-open page whose polling stopped. A first navigation to an
// address whose runtime is gone never loads this code at all, and giving
// shared addresses an explicit lifetime remains a separate decision.

export type ReviewEndReason =
  { readonly kind: "stopped" } | { readonly kind: "deadline-passed" };

/**
 * Decides what an unreachable review page may report.
 *
 * The lifetime facts come from the last poll that succeeded, so they describe
 * the session as it last was, and the current time comes from when contact was
 * lost rather than from now - otherwise a runtime somebody stopped by hand
 * would silently turn into a passed deadline once its stale deadline elapsed.
 */
export const reviewEndReason = ({
  expiresAtMs,
  idleTimeoutMs,
  nowMs,
}: {
  readonly expiresAtMs: number | undefined;
  readonly idleTimeoutMs: number | undefined;
  readonly nowMs: number;
}): ReviewEndReason => {
  // No deadline was ever published, or expiry is disabled entirely, so there
  // is no deadline that could have passed and nothing extra to report.
  if (expiresAtMs === undefined) return { kind: "stopped" };
  if (idleTimeoutMs === undefined || idleTimeoutMs <= 0) {
    return { kind: "stopped" };
  }
  if (nowMs < expiresAtMs) return { kind: "stopped" };
  return { kind: "deadline-passed" };
};

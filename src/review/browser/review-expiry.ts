// Owns why a review the page can no longer reach is gone. The page cannot ask
// the runtime that just stopped answering, so it answers from the deadline it
// was last told: a deadline already in the past is an idle expiry it can name,
// and any other silence is a runtime that stopped for a reason only the person
// who stopped it knows.
//
// This exists because "the server stopped responding" is true and useless. A
// page left open to revisit later dies exactly this way (BIG-65), and the whole
// point is telling that reader what happened instead of that something did.

export type ReviewEndReason =
  | { readonly kind: "stopped" }
  | { readonly kind: "expired"; readonly idleTimeoutMs: number };

/**
 * Decides what to say about a review that has gone quiet.
 *
 * The lifetime facts come from the last poll that succeeded, so they describe
 * the session as it last was. That is precisely what makes the past-deadline
 * case provable: a page whose polls were reaching the runtime keeps pushing
 * its own deadline forward, so a deadline that has since gone by means the
 * polling stopped long enough for the runtime to expire - a suspended tab, a
 * closed laptop, a page revisited tomorrow - rather than a runtime someone
 * stopped a moment ago.
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
  // No deadline was ever published, or expiry is disabled entirely, so idle
  // expiry is not an available explanation and guessing it would be a lie.
  if (expiresAtMs === undefined) return { kind: "stopped" };
  if (idleTimeoutMs === undefined || idleTimeoutMs <= 0) {
    return { kind: "stopped" };
  }
  if (nowMs < expiresAtMs) return { kind: "stopped" };
  return { kind: "expired", idleTimeoutMs };
};

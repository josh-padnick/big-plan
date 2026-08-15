// Owns what an already-open page can observe after losing contact with its
// review runtime. A remembered deadline that passed by the time contact was
// lost is provable, but activity from another page or agent could have extended
// the runtime's actual deadline, so this observation cannot establish why the
// runtime ended.

export type ReviewEndObservation =
  { readonly kind: "unexplained" } | { readonly kind: "deadline-passed" };

/**
 * Classifies the remembered deadline after an already-open page loses contact.
 *
 * The lifetime facts describe only the last poll this page completed. Another
 * page or a working agent can extend the runtime's real deadline without this
 * page seeing it, so a passed remembered deadline is an observation rather
 * than a termination cause.
 */
export const reviewEndObservation = ({
  expiresAtMs,
  idleTimeoutMs,
  nowMs,
}: {
  readonly expiresAtMs: number | undefined;
  readonly idleTimeoutMs: number | undefined;
  readonly nowMs: number;
}): ReviewEndObservation => {
  if (expiresAtMs === undefined) return { kind: "unexplained" };
  if (idleTimeoutMs === undefined || idleTimeoutMs <= 0) {
    return { kind: "unexplained" };
  }
  if (nowMs < expiresAtMs) return { kind: "unexplained" };
  return { kind: "deadline-passed" };
};

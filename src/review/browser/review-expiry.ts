// Owns what an already-open page can observe after losing contact with its
// review runtime. A remembered deadline that passed by the time contact was
// lost is provable, but activity from another page or agent could have extended
// the runtime's actual deadline, so this observation cannot establish the
// runtime's current state.

export type ReviewContactLossObservation =
  { readonly kind: "unexplained" } | { readonly kind: "deadline-passed" };

export type ReviewContactLossRecovery =
  | { readonly kind: "replacement"; readonly href: string }
  | { readonly kind: "restart-command"; readonly command: string }
  | { readonly kind: "no-restart-command" };

/**
 * Classifies the remembered deadline after an already-open page loses contact.
 *
 * The lifetime facts describe only the last poll this page completed. Another
 * page or a working agent can extend the runtime's real deadline without this
 * page seeing it, so a passed remembered deadline does not establish the
 * runtime's current state.
 */
export const reviewContactLossObservation = ({
  expiresAtMs,
  idleTimeoutMs,
  nowMs,
}: {
  readonly expiresAtMs: number | undefined;
  readonly idleTimeoutMs: number | undefined;
  readonly nowMs: number;
}): ReviewContactLossObservation => {
  if (expiresAtMs === undefined) return { kind: "unexplained" };
  if (idleTimeoutMs === undefined || idleTimeoutMs <= 0) {
    return { kind: "unexplained" };
  }
  if (nowMs < expiresAtMs) return { kind: "unexplained" };
  return { kind: "deadline-passed" };
};

/** Chooses recovery without superseding a replacement runtime. */
export const reviewContactLossRecovery = ({
  observation,
  latestReviewUrl,
  restartCommand,
}: {
  readonly observation: ReviewContactLossObservation;
  readonly latestReviewUrl: string | undefined;
  readonly restartCommand: string | undefined;
}): ReviewContactLossRecovery | undefined => {
  if (observation.kind !== "deadline-passed") return undefined;
  if (latestReviewUrl !== undefined) {
    return { kind: "replacement", href: latestReviewUrl };
  }
  if (restartCommand !== undefined) {
    return { kind: "restart-command", command: restartCommand };
  }
  return { kind: "no-restart-command" };
};

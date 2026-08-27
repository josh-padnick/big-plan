// Owns browser request errors at the local review-runtime boundary so
// transport loss and application refusals retain distinct, stable identities.

export class ReviewRuntimeUnavailableError extends Error {
  constructor({ cause }: { readonly cause: unknown }) {
    super("The local review runtime is unavailable.", { cause });
    this.name = "ReviewRuntimeUnavailableError";
  }
}

export const isReviewRuntimeUnavailable = (error: unknown): boolean =>
  error instanceof ReviewRuntimeUnavailableError;

/**
 * A reachable runtime that refused. The reason preserves the runtime's own
 * words when available, while the status lets callers react without matching
 * prose. A status is not always enough to tell two refusals apart - two
 * unrelated ones can share it - so a refusal the browser must act on
 * differently also carries the code the runtime named it by.
 */
export class ReviewRuntimeRefusedError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor({
    status,
    reason,
    code,
  }: {
    readonly status: number;
    readonly reason: string;
    readonly code?: string;
  }) {
    super(reason);
    this.name = "ReviewRuntimeRefusedError";
    this.status = status;
    this.code = code;
  }
}

export const isReviewRuntimeRefusal = (error: unknown, code: string): boolean =>
  error instanceof ReviewRuntimeRefusedError && error.code === code;

export const reviewRuntimeRefusalStatus = (
  error: unknown,
): number | undefined =>
  error instanceof ReviewRuntimeRefusedError ? error.status : undefined;

/** Reads a refusal's reason from the runtime's JSON body when it carries one. */
export const reviewRuntimeRefusal = async ({
  status,
  readBody,
}: {
  readonly status: number;
  readonly readBody: () => Promise<unknown>;
}): Promise<ReviewRuntimeRefusedError> => {
  let reason = `Review runtime refused the request (${status})`;
  let code: string | undefined;
  try {
    const value = await readBody();
    if (typeof value === "object" && value !== null) {
      if (
        "error" in value &&
        typeof value.error === "string" &&
        value.error !== ""
      ) {
        reason = value.error;
      }
      if ("code" in value && typeof value.code === "string") {
        code = value.code;
      }
    }
  } catch {
    // A refusal without a readable body keeps the status-only reason.
  }
  return new ReviewRuntimeRefusedError({
    status,
    reason,
    ...(code === undefined ? {} : { code }),
  });
};

// A 4xx that names congestion rather than the request itself: something in
// front of the runtime is busy, so the same request can still be accepted.
// 425 stays out, because replaying an early request needs a replay-safe policy
// this boundary does not have.
const CONGESTED_STATUSES = new Set([408, 429]);

/**
 * True when repeating the request cannot change the answer. The runtime
 * examined this request and rejected it - a decision the plan no longer asks,
 * a session that no longer holds authority - so a retry loop would reissue a
 * refusal forever instead of telling the reader what happened. A 5xx is the
 * runtime failing at a request it accepted, which is worth trying again, and
 * so is a 4xx that reports congestion rather than a verdict on the request.
 */
export const isTerminalReviewRuntimeRefusal = (error: unknown): boolean => {
  const status = reviewRuntimeRefusalStatus(error);
  return (
    status !== undefined && status < 500 && !CONGESTED_STATUSES.has(status)
  );
};

// A status the runtime itself never sends, so it can only have come from
// something in front of it that had nothing to reach. A page served through
// the local service reaches its runtime over a hop, and when that runtime is
// gone the hop answers rather than failing to connect - which would otherwise
// leave the reader looking at a live-looking page whose session ended.
//
// 503 is deliberately not here: it is the runtime's own word for a session
// that still answers every read but has stopped accepting changes, and that
// answer names its own remedy. Treating it as a lost runtime would replace a
// true, actionable report with a false one.
const GATEWAY_STATUSES = new Set([502, 504]);

/**
 * Normalizes browser transport failures while preserving application errors.
 *
 * A refusal outranks the timeout flag. The runtime answers before its body is
 * read, so an abort that fires during that read would otherwise turn a verdict
 * the runtime already gave into "unavailable", and a caller would retry a
 * request that was refused. A gateway status is the exception, because it is
 * not a verdict the runtime gave: it is how a hop reports that there was no
 * runtime to ask.
 */
export const normalizeReviewRuntimeRequestError = ({
  error,
  timedOut,
}: {
  readonly error: unknown;
  readonly timedOut: boolean;
}): unknown => {
  if (error instanceof ReviewRuntimeRefusedError) {
    return GATEWAY_STATUSES.has(error.status)
      ? new ReviewRuntimeUnavailableError({ cause: error })
      : error;
  }
  return timedOut || error instanceof TypeError
    ? new ReviewRuntimeUnavailableError({ cause: error })
    : error;
};

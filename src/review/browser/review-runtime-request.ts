// Owns browser request-error normalization at the local review-runtime
// boundary so transport loss has one stable error identity.

export class ReviewRuntimeUnavailableError extends Error {
  constructor({ cause }: { readonly cause: unknown }) {
    super("The local review runtime is unavailable.", { cause });
    this.name = "ReviewRuntimeUnavailableError";
  }
}

export const isReviewRuntimeUnavailable = (error: unknown): boolean =>
  error instanceof ReviewRuntimeUnavailableError;

/** A request the runtime answered, and answered with a refusal. */
export class ReviewRuntimeRefusedError extends Error {
  readonly status: number;

  constructor({
    status,
    reason,
  }: {
    readonly status: number;
    readonly reason: string;
  }) {
    super(reason);
    this.name = "ReviewRuntimeRefusedError";
    this.status = status;
  }
}

/**
 * True when repeating the request cannot change the answer. The runtime
 * examined this request and rejected it - a decision the plan no longer asks,
 * a session that no longer holds authority - so a retry loop would reissue a
 * refusal forever instead of telling the reader what happened. A 5xx is the
 * runtime failing at a request it accepted, which is worth trying again.
 */
export const isReviewRuntimeRefusal = (error: unknown): boolean =>
  error instanceof ReviewRuntimeRefusedError && error.status < 500;

/** Normalizes browser transport failures while preserving application errors. */
export const normalizeReviewRuntimeRequestError = ({
  error,
  timedOut,
}: {
  readonly error: unknown;
  readonly timedOut: boolean;
}): unknown =>
  timedOut || error instanceof TypeError
    ? new ReviewRuntimeUnavailableError({ cause: error })
    : error;

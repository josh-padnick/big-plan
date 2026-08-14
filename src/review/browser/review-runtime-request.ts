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

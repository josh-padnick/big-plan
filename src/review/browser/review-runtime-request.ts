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

/**
 * A reachable runtime that refused. The reason is the runtime's own words, so
 * a caller can show it and a caller that must react to one refusal can read
 * the status instead of matching prose.
 */
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
  try {
    const value = await readBody();
    if (
      typeof value === "object" &&
      value !== null &&
      "error" in value &&
      typeof value.error === "string" &&
      value.error !== ""
    ) {
      reason = value.error;
    }
  } catch {
    // A refusal without a readable body keeps the status-only reason.
  }
  return new ReviewRuntimeRefusedError({ status, reason });
};

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

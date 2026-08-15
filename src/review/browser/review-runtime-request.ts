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

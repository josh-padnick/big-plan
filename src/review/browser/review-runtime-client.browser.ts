// The browser's one way to reach the local review runtime: who this page is,
// and how it asks. Every lookup here reads the document when it is called
// rather than at load, so importing this module is safe wherever a review
// module is imported - including a unit test with no DOM at all. Both were private to the review controller until a second
// island surface - the change-set tour, which mounts above the controller and
// so cannot be handed anything by it - needed to read and write review state of
// its own. A second copy of the token header, the timeout, and the refusal
// decoding is a second place they can drift.

import {
  normalizeReviewRuntimeRequestError,
  reviewRuntimeRefusal,
} from "./review-runtime-request.js";

const TOKEN_HEADER = "x-big-plan-review-token";
// Long enough for a local write behind the runtime's write gate, short enough
// that a wedged runtime surfaces as a failure rather than a silent hang.
const REQUEST_TIMEOUT_MS = 10_000;

/** Who this page is to the runtime it was served by. */
export type RuntimeIdentity = {
  readonly planId: string;
  readonly sessionId: string;
  readonly token: string;
};

/**
 * The identity the served document carries, or nothing when this document was
 * not served by a live runtime - an exported review document, for one, which
 * has no runtime to talk to and must stay fully readable anyway.
 */
export const runtimeIdentity = (): RuntimeIdentity | null => {
  const root = document.documentElement;
  const planId = root.getAttribute("data-plan-id") ?? "";
  const sessionId = root.getAttribute("data-review-session") ?? "";
  const token = root.getAttribute("data-review-token") ?? "";
  return planId === "" || sessionId === "" || token === ""
    ? null
    : { planId, sessionId, token };
};

/** True while the runtime has told this page it may not write. */
export const isReadOnlyReview = (): boolean =>
  document.documentElement.hasAttribute("data-review-read-only");

const requestRuntime = async <Result>({
  path,
  identity,
  method = "GET",
  body,
  readResponse,
}: {
  readonly path: string;
  readonly identity: RuntimeIdentity;
  readonly method?: "GET" | "PUT" | "POST";
  readonly body?: unknown;
  readonly readResponse: (response: Response) => Promise<Result>;
}): Promise<Result> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );
  try {
    // The document can live at the runtime root or beneath the service's plan
    // prefix. A relative request follows whichever address served the page.
    const response = await fetch(path.replace(/^\/+/u, ""), {
      method,
      mode: "same-origin",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: {
        [TOKEN_HEADER]: identity.token,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      throw await reviewRuntimeRefusal({
        status: response.status,
        readBody: () => response.json(),
        ...(retryAfter === null ? {} : { retryAfter }),
      });
    }
    return await readResponse(response);
  } catch (error) {
    throw normalizeReviewRuntimeRequestError({
      error,
      timedOut: controller.signal.aborted,
    });
  } finally {
    window.clearTimeout(timeout);
  }
};

export const requestJson = async (input: {
  readonly path: string;
  readonly identity: RuntimeIdentity;
  readonly method?: "GET" | "PUT" | "POST";
  readonly body?: unknown;
}): Promise<unknown> =>
  requestRuntime({
    ...input,
    readResponse: (response) => response.json(),
  });

export type MarkdownExportDownload = {
  readonly blob: Blob;
  readonly filename: string;
  readonly snapshot: string;
};

const attachmentFilename = (value: string | null): string => {
  const match = value?.match(/(?:^|;)\s*filename="([^"]+)"(?:;|$)/iu);
  return match?.[1] ?? "plan.md";
};

/** Downloads one authenticated runtime response without duplicating transport policy. */
export const requestMarkdownExport = async ({
  identity,
}: {
  readonly identity: RuntimeIdentity;
}): Promise<MarkdownExportDownload> => {
  return requestRuntime({
    path: "/api/export-markdown",
    identity,
    readResponse: async (response) => ({
      blob: await response.blob(),
      filename: attachmentFilename(response.headers.get("content-disposition")),
      snapshot: response.headers.get("x-big-plan-snapshot") ?? "",
    }),
  });
};

/**
 * Announces that this page has applied a newer copy of the record the review's
 * input contract is derived from.
 *
 * A surface that showed the contract on a clock of its own would be more
 * current than the surfaces that record drives - and the two would disagree
 * about the same review for as long as the clocks were apart. Deriving it from
 * what this page has already applied is what keeps every surface on one
 * revision of the truth.
 */
const REVIEW_RECORD_APPLIED_EVENT = "bigplan:review-record-applied";

/** Announces one applied record, for surfaces derived from it. */
export const announceAppliedReviewRecord = (): void => {
  document.dispatchEvent(new CustomEvent(REVIEW_RECORD_APPLIED_EVENT));
};

/**
 * Subscribes a surface derived from an applied record to the moments this page
 * applied a newer copy of one, and returns how to stop.
 */
export const onAppliedReviewRecord = (react: () => void): (() => void) => {
  document.addEventListener(REVIEW_RECORD_APPLIED_EVENT, react);
  return () => document.removeEventListener(REVIEW_RECORD_APPLIED_EVENT, react);
};

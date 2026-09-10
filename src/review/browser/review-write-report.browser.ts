// Owns how a served review tells the reviewer that a write they asked for did
// not happen. Every explicit mutation path used to report its refusal and its
// failure into the rail's status string, and a served review renders that
// string for two constants only, so a Disconnect click answered by a 401
// changed nothing on screen (BIG-282). A notice that interrupts is the right
// shape here: the reviewer acted from the agent sidebar, a dialog, or a
// thread, and the rail's status line is on none of those.

import {
  reviewWritePathTitle,
  type ReviewWritePath,
} from "./review-write-availability.js";
import { toast } from "./ui.browser.js";

// Long enough to read a two-sentence remedy; the reviewer can dismiss sooner.
const NOTICE_DURATION_MS = 10_000;

// One notice per path: a second click replaces the first rather than stacking.
const noticeId = (path: ReviewWritePath): string => `review-write:${path}`;

/** The runtime's own words when it gave any, and a plain sentence otherwise. */
export const reviewFailureDetail = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong.";

/** Says why a write was refused before it was sent, and what clears that. */
export const reportRefusedWrite = ({
  path,
  refusal,
}: {
  readonly path: ReviewWritePath;
  /** The gate's sentence: the cause, what became of the input, the remedy. */
  readonly refusal: string;
}): void => {
  toast.error(reviewWritePathTitle(path), {
    id: noticeId(path),
    description: refusal,
    duration: NOTICE_DURATION_MS,
  });
};

/** Says that a write the runtime was asked for did not land, in its words. */
export const reportFailedWrite = ({
  path,
  error,
}: {
  readonly path: ReviewWritePath;
  readonly error: unknown;
}): void => {
  toast.error(reviewWritePathTitle(path), {
    id: noticeId(path),
    description: reviewFailureDetail(error),
    duration: NOTICE_DURATION_MS,
  });
};

// Auto-accept is a reviewer setting, not a message to a live agent, so a tab
// that cannot reach the runtime queues the change rather than dropping it. This
// is the standing notice that says so, dismissed by id the moment the change
// lands. It is not an error: nothing failed, and nothing was lost.
const REVIEW_MODE_PENDING_TOAST_ID = "big-plan-review-mode-pending";

/** Says a queued review-mode change is waiting for the tab to reconnect. */
export const reportPendingReviewMode = (
  mode: "review" | "auto-accept",
): void => {
  toast(
    mode === "auto-accept"
      ? "Auto-accept is pending"
      : "Switching to review is pending",
    {
      id: REVIEW_MODE_PENDING_TOAST_ID,
      description:
        "This tab is reconnecting to the review session. Big Plan applies this the moment it is back — nothing was dropped.",
      duration: Infinity,
    },
  );
};

/** Clears the pending review-mode notice once the change has landed. */
export const dismissPendingReviewMode = (): void => {
  toast.dismiss(REVIEW_MODE_PENDING_TOAST_ID);
};

/**
 * A read or a background write the page needed and could not get. The title
 * names what the reader is missing, because the runtime's sentence alone does
 * not say which surface went quiet; the detail is that sentence, already in
 * words, because one caller receives it as a message rather than an error.
 */
export const reportReviewFailure = ({
  title,
  detail,
}: {
  readonly title: string;
  readonly detail: string;
}): void => {
  toast.error(title, {
    id: `review-failure:${title}`,
    description: detail,
    duration: NOTICE_DURATION_MS,
  });
};

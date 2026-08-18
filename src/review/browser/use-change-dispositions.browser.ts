// Owns the browser's copy of the change dispositions the review has recorded:
// reading the record, applying the reviewer's gesture to it, and keeping what
// the page shows equal to what the runtime stored.
//
// Two rules make that equality honest rather than approximate. A gesture is
// shown immediately and kept only while its write is still on its way, so what
// the reviewer sees is either the record or a mutation still going to it - and
// a refusal takes the gesture back off the screen instead of leaving a page
// that claims work is closed when nothing recorded it. And every response
// carries the whole record with the revision that produced it, so a response
// older than the one already applied is dropped: an in-flight read can never
// land on top of a completed write.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  acceptedChangeKeys,
  changeDispositionBatches,
  changeDispositionKey,
  type ChangeDispositionState,
} from "../shared/change-disposition.js";
import { decodeChangeDispositions } from "../shared/review-wire.js";
import {
  announceAppliedReviewRecord,
  isReadOnlyReview,
  requestJson,
  runtimeIdentity,
  type RuntimeIdentity,
} from "./review-runtime-client.browser.js";
import { isTerminalReviewRuntimeRefusal } from "./review-runtime-request.js";
import { useArticleVersion } from "./use-article-version.browser.js";
import { toast } from "./ui.browser.js";

const DISPOSITIONS_PATH = "/api/change-dispositions";
const RETRY_DELAY_MS = 2_000;
// The first failure is usually the runtime being briefly busy and is not worth
// interrupting a reader over. A second one has outlived that explanation.
const FAILURES_BEFORE_NOTICE = 2;
// The two notices say different things and are dismissed by different events:
// a retry notice is resolved by the write finally landing, while a refusal is
// the only surviving evidence that an acceptance was dropped and outlives every
// later gesture.
const DISPOSITION_RETRY_TOAST_ID = "big-plan-change-disposition-retry";
const DISPOSITION_REFUSED_TOAST_ID = "big-plan-change-disposition-refused";

/** One gesture on its way to the record. */
type PendingDisposition = {
  readonly op: "accept" | "withdraw";
  readonly from: string;
  readonly to: string;
  readonly placeIds: ReadonlyArray<string>;
};

/** What every surface that shows a change set's standing reads. */
export type ChangeDispositionsValue = {
  /** The accepted change keys, including gestures still being written. */
  readonly accepted: ReadonlySet<string>;
  /** False while the runtime has told this page it may not record anything. */
  readonly canRecord: boolean;
  readonly disposeOfChanges: (input: PendingDisposition) => void;
};

const overlay = ({
  stored,
  pending,
}: {
  readonly stored: ChangeDispositionState;
  readonly pending: ReadonlyArray<PendingDisposition>;
}): ReadonlySet<string> => {
  const keys = new Set(acceptedChangeKeys(stored));
  for (const mutation of pending) {
    for (const placeId of mutation.placeIds) {
      const key = changeDispositionKey({
        from: mutation.from,
        to: mutation.to,
        placeId,
      });
      if (mutation.op === "accept") keys.add(key);
      else keys.delete(key);
    }
  }
  return keys;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

/**
 * Keeps one review's disposition record in step with the runtime.
 *
 * The record is re-read after an article replacement for the same reason the
 * answers record is: a replaced article hands back freshly rendered change
 * attachments, and the standing they show has to come from the store rather
 * than from whatever the previous DOM happened to hold.
 */
export const useChangeDispositions = (): ChangeDispositionsValue => {
  const articleVersion = useArticleVersion();
  const [identity] = useState<RuntimeIdentity | null>(runtimeIdentity);
  const [stored, setStored] = useState<ChangeDispositionState>({
    accepted: [],
    revision: -1,
  });
  const [pending, setPending] = useState<ReadonlyArray<PendingDisposition>>([]);
  const [canRecord, setCanRecord] = useState(
    () => identity !== null && !isReadOnlyReview(),
  );
  const queue = useRef<Array<PendingDisposition>>([]);
  const isFlushing = useRef(false);
  const appliedRevision = useRef(-1);
  const isMounted = useRef(true);
  useEffect(
    () => () => {
      isMounted.current = false;
    },
    [],
  );

  // Authority arrives after the first paint and can be withdrawn later, so the
  // controls follow the runtime's own published answer rather than assume it.
  useEffect(() => {
    const onAuthority = () =>
      setCanRecord(identity !== null && !isReadOnlyReview());
    document.addEventListener("bigplan:review-authority", onAuthority);
    onAuthority();
    return () =>
      document.removeEventListener("bigplan:review-authority", onAuthority);
  }, [identity]);

  const applyResponse = useCallback((value: unknown): void => {
    const state = decodeChangeDispositions(value);
    if (state.revision < appliedRevision.current) return;
    appliedRevision.current = state.revision;
    setStored(state);
    announceAppliedReviewRecord();
  }, []);

  const flush = useCallback(async (): Promise<void> => {
    if (identity === null || isFlushing.current) return;
    isFlushing.current = true;
    let failures = 0;
    try {
      while (isMounted.current) {
        const head = queue.current.at(0);
        if (head === undefined) break;
        try {
          applyResponse(
            await requestJson({
              path: DISPOSITIONS_PATH,
              identity,
              method: "POST",
              body: {
                op: head.op,
                from: head.from,
                to: head.to,
                placeIds: head.placeIds,
              },
            }),
          );
          queue.current = queue.current.filter((entry) => entry !== head);
          setPending([...queue.current]);
          failures = 0;
          toast.dismiss(DISPOSITION_RETRY_TOAST_ID);
        } catch (error: unknown) {
          // The runtime looked at this gesture and refused it, so retrying
          // would collect the same refusal forever. Dropping it is what takes
          // the unrecorded acceptance back off the screen.
          if (isTerminalReviewRuntimeRefusal(error)) {
            queue.current = queue.current.filter((entry) => entry !== head);
            setPending([...queue.current]);
            failures = 0;
            toast.dismiss(DISPOSITION_RETRY_TOAST_ID);
            toast.error("Change acceptance not saved", {
              id: DISPOSITION_REFUSED_TOAST_ID,
              description:
                error instanceof Error
                  ? error.message
                  : "The review runtime refused this change.",
              duration: Infinity,
            });
            continue;
          }
          failures += 1;
          if (failures === FAILURES_BEFORE_NOTICE) {
            toast.error("Change acceptance not saved yet", {
              id: DISPOSITION_RETRY_TOAST_ID,
              description:
                "Big Plan will keep retrying. Keep this review open until the change set says it is accepted.",
              duration: Infinity,
            });
          }
          await sleep(RETRY_DELAY_MS);
        }
      }
    } finally {
      isFlushing.current = false;
    }
  }, [applyResponse, identity]);

  const disposeOfChanges = useCallback(
    (input: PendingDisposition): void => {
      if (input.placeIds.length === 0) return;
      // One gesture can name more places than a single mutation may carry, so
      // it is queued as successive batches. The overlay reads the whole queue,
      // so every place stays shown while its own batch is still in flight, and
      // a refusal takes back only the batch the runtime refused.
      queue.current = [
        ...queue.current,
        ...changeDispositionBatches(input.placeIds).map((placeIds) => ({
          op: input.op,
          from: input.from,
          to: input.to,
          placeIds,
        })),
      ];
      setPending([...queue.current]);
      void flush();
    },
    [flush],
  );

  useEffect(() => {
    if (identity === null) return;
    void requestJson({ path: DISPOSITIONS_PATH, identity })
      .then(applyResponse)
      .catch(() => undefined);
  }, [applyResponse, articleVersion, identity]);

  const accepted = useMemo(
    () => overlay({ stored, pending }),
    [pending, stored],
  );
  return useMemo(
    () => ({ accepted, canRecord, disposeOfChanges }),
    [accepted, canRecord, disposeOfChanges],
  );
};

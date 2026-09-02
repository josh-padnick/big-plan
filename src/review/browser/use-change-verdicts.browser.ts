// Owns the browser's copy of the change verdicts the review has recorded:
// reading the record, applying the reviewer's gesture to it, and keeping what
// the page shows equal to what the runtime stored.
//
// A gesture is one of three - accept, reject, undo - and they queue through one
// path because they are one record. A reject also moves the plan source, so the
// runtime answers it with the record that write produced; the page still learns
// what happened the same way it learns about an acceptance, from the revision
// on the response.
//
// The record is also polled, because this page is not the only writer. Auto-
// accept records from the agent process, approval closes what is still open,
// and a second window decides changes of its own - and an acceptance moves no
// bytes at all, so nothing about the plan changes to announce it. Waiting for
// a replaced article would leave every one of those invisible until something
// unrelated happened to redraw the page.
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
  changeVerdictBatches,
  changeVerdictKey,
  rejectedChangeKeys,
  type ChangeVerdictState,
} from "../shared/change-verdict.js";
import { decodeChangeVerdicts } from "../shared/review-wire.js";
import { REVIEW_POLL_INTERVAL_MS } from "../shared/review-polling.js";
import {
  isReadOnlyReview,
  requestJson,
  runtimeIdentity,
  type RuntimeIdentity,
} from "./review-runtime-client.browser.js";
import { isTerminalReviewRuntimeRefusal } from "./review-runtime-request.js";
import { useArticleVersion } from "./use-article-version.browser.js";
import { toast } from "./ui.browser.js";

const VERDICTS_PATH = "/api/change-verdicts";
const RETRY_DELAY_MS = 2_000;
// The first failure is usually the runtime being briefly busy and is not worth
// interrupting a reader over. A second one has outlived that explanation.
const FAILURES_BEFORE_NOTICE = 2;
// The two notices say different things and are dismissed by different events:
// a retry notice is resolved by the write finally landing, while a refusal is
// the only surviving evidence that an acceptance was dropped and outlives every
// later gesture.
const VERDICT_RETRY_TOAST_ID = "big-plan-change-verdict-retry";
const VERDICT_REFUSED_TOAST_ID = "big-plan-change-verdict-refused";
// The read has its own notice: it says what the page may be under-reporting,
// which is a different fact from a gesture that did not reach the record.
const VERDICT_READ_TOAST_ID = "big-plan-change-verdict-read";

/** One gesture on its way to the record. */
export type PendingVerdict = {
  readonly op: "accept" | "reject" | "undo";
  readonly from: string;
  readonly to: string;
  readonly placeIds: ReadonlyArray<string>;
  readonly onlyUndecided?: boolean;
};

/** What every surface that shows a change set's standing reads. */
export type ChangeVerdictsValue = {
  /** The accepted change keys, including gestures still being written. */
  readonly accepted: ReadonlySet<string>;
  /** The rejected change keys, read the same way the accepted ones are. */
  readonly rejected: ReadonlySet<string>;
  /** Stored acceptances made by the session's auto-accept mode. */
  readonly autoAccepted: ReadonlySet<string>;
  /** False while the runtime has told this page it may not record anything. */
  readonly canRecord: boolean;
  readonly recordChangeVerdicts: (input: PendingVerdict) => void;
  /** Re-read after a server-side operation records verdicts outside this hook. */
  readonly refresh: () => void;
};

// Every gesture clears the address it names before recording its own answer,
// exactly as the record does, so re-deciding a change never leaves the page
// showing both verdicts at once while the write is still on its way.
const overlay = ({
  stored,
  pending,
  op,
}: {
  readonly stored: ChangeVerdictState;
  readonly pending: ReadonlyArray<PendingVerdict>;
  readonly op: "accept" | "reject";
}): ReadonlySet<string> => {
  const keys = new Set(
    op === "accept" ? acceptedChangeKeys(stored) : rejectedChangeKeys(stored),
  );
  for (const mutation of pending) {
    for (const placeId of mutation.placeIds) {
      const key = changeVerdictKey({
        from: mutation.from,
        to: mutation.to,
        placeId,
      });
      if (mutation.op === op) keys.add(key);
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
 * Keeps one review's verdict record in step with the runtime.
 *
 * The record is re-read after an article replacement for the same reason the
 * answers record is: a replaced article hands back freshly rendered change
 * attachments, and the standing they show has to come from the store rather
 * than from whatever the previous DOM happened to hold.
 */
export const useChangeVerdicts = (): ChangeVerdictsValue => {
  const articleVersion = useArticleVersion();
  const [identity] = useState<RuntimeIdentity | null>(runtimeIdentity);
  const [stored, setStored] = useState<ChangeVerdictState>({
    decided: [],
    revision: -1,
  });
  const [pending, setPending] = useState<ReadonlyArray<PendingVerdict>>([]);
  const [canRecord, setCanRecord] = useState(
    () => identity !== null && !isReadOnlyReview(),
  );
  const [refreshVersion, setRefreshVersion] = useState(0);
  const queue = useRef<Array<PendingVerdict>>([]);
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

  // Every response from the verdict store carries the whole current record
  // and the revision that produced it, so applying one is the only way this
  // page learns what is stored. A strictly older revision lost a race with a
  // write that has already been applied and is dropped without comment.
  const applyResponse = useCallback((value: unknown): void => {
    const state = decodeChangeVerdicts(value);
    if (state.revision < appliedRevision.current) return;
    appliedRevision.current = state.revision;
    setStored(state);
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
              path: VERDICTS_PATH,
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
          toast.dismiss(VERDICT_RETRY_TOAST_ID);
        } catch (error: unknown) {
          // The runtime looked at this gesture and refused it, so retrying
          // would collect the same refusal forever. Dropping it is what takes
          // the unrecorded acceptance back off the screen.
          if (isTerminalReviewRuntimeRefusal(error)) {
            queue.current = queue.current.filter((entry) => entry !== head);
            setPending([...queue.current]);
            failures = 0;
            toast.dismiss(VERDICT_RETRY_TOAST_ID);
            toast.error("Change verdict not saved", {
              id: VERDICT_REFUSED_TOAST_ID,
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
            toast.error("Change verdict not saved yet", {
              id: VERDICT_RETRY_TOAST_ID,
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

  const recordChangeVerdicts = useCallback(
    (input: PendingVerdict): void => {
      if (input.placeIds.length === 0) return;
      // One gesture can name more places than a single mutation may carry, so
      // it is queued as successive batches. The overlay reads the whole queue,
      // so every place stays shown while its own batch is still in flight, and
      // a refusal takes back only the batch the runtime refused.
      queue.current = [
        ...queue.current,
        ...changeVerdictBatches(input.placeIds).map((placeIds) => ({
          op: input.op,
          from: input.from,
          to: input.to,
          placeIds,
          ...(input.onlyUndecided === undefined
            ? {}
            : { onlyUndecided: input.onlyUndecided }),
        })),
      ];
      setPending([...queue.current]);
      void flush();
    },
    [flush],
  );

  useEffect(() => {
    if (identity === null) return;
    // The read is retried for the same reason the write is: a swallowed failure
    // would leave every surface reporting nothing decided for the life of the
    // page while the record holds verdicts. Once it succeeds the same read
    // keeps running on the shared cadence, which is what makes a verdict this
    // page did not make appear without anything else having to happen.
    let reading = true;
    void (async () => {
      let failures = 0;
      while (reading && isMounted.current) {
        try {
          applyResponse(await requestJson({ path: VERDICTS_PATH, identity }));
          toast.dismiss(VERDICT_READ_TOAST_ID);
          failures = 0;
          await sleep(REVIEW_POLL_INTERVAL_MS);
          continue;
        } catch (error: unknown) {
          // A refused read is the runtime's answer, not a lost one, so it is
          // reported once instead of collected forever.
          if (isTerminalReviewRuntimeRefusal(error)) {
            toast.error("Recorded change verdicts could not be read", {
              id: VERDICT_READ_TOAST_ID,
              description:
                error instanceof Error
                  ? error.message
                  : "The review runtime refused this read.",
              duration: Infinity,
            });
            return;
          }
          failures += 1;
          if (failures === FAILURES_BEFORE_NOTICE) {
            toast.error("Recorded change verdicts not read yet", {
              id: VERDICT_READ_TOAST_ID,
              description:
                "Big Plan will keep retrying. What this page shows as accepted may be incomplete until it succeeds.",
              duration: Infinity,
            });
          }
          await sleep(RETRY_DELAY_MS);
        }
      }
    })();
    return () => {
      reading = false;
    };
  }, [applyResponse, articleVersion, identity, refreshVersion]);

  const accepted = useMemo(
    () => overlay({ stored, pending, op: "accept" }),
    [pending, stored],
  );
  const rejected = useMemo(
    () => overlay({ stored, pending, op: "reject" }),
    [pending, stored],
  );
  const autoAccepted = useMemo(
    () =>
      new Set(
        stored.decided
          .filter(
            (entry) =>
              entry.verdict === "accepted" && entry.actor === "auto-accept",
          )
          .map((entry) => changeVerdictKey(entry)),
      ),
    [stored],
  );
  const refresh = useCallback(
    () => setRefreshVersion((value) => value + 1),
    [],
  );
  return useMemo(
    () => ({
      accepted,
      rejected,
      autoAccepted,
      canRecord,
      recordChangeVerdicts,
      refresh,
    }),
    [
      accepted,
      autoAccepted,
      canRecord,
      recordChangeVerdicts,
      refresh,
      rejected,
    ],
  );
};

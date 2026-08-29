// Owns the browser's copy of the committed change-set fold: one thread, one
// evolving change set, baseline where the thread's first committed revision
// put it and result wherever its latest reply left it.
//
// The fold is read once per page and re-read when a revision lands, because a
// revision is the only event that can change it and the reading surface
// already announces one by replacing the article. It is held in a module-level
// store rather than per component: a thread can be on screen twice at once -
// inline and in the rail - and every open thread asks the same question, so
// per-hook state would mean one request per card and two cards disagreeing
// about what the thread is currently proposing.
//
// A read that fails leaves the previous fold in place rather than reporting an
// empty one, because the two mean opposite things: no fold yet is a thread
// whose diff has to come from somewhere else, while an empty fold is a review
// where nothing has changed the plan.

import { useEffect, useSyncExternalStore } from "react";
import { decodeCommittedChangeSets } from "../shared/review-wire.js";
import type { CommittedChangeSet } from "../shared/review-wire.js";
import {
  requestJson,
  runtimeIdentity,
  type RuntimeIdentity,
} from "./review-runtime-client.browser.js";
import { isTerminalReviewRuntimeRefusal } from "./review-runtime-request.js";
import { useArticleVersion } from "./use-article-version.browser.js";

const CHANGE_SETS_PATH = "/api/change-sets";
const RETRY_DELAY_MS = 2_000;
const READ_ATTEMPTS = 3;

/** What every surface that shows a thread's proposal reads. */
export type ChangeSetsValue = {
  /** The committed change sets, empty until the first read lands. */
  readonly changeSets: ReadonlyArray<CommittedChangeSet>;
  /** False while no read has succeeded, so an empty list is not yet a fact. */
  readonly isRead: boolean;
};

const EMPTY: ChangeSetsValue = { changeSets: [], isRead: false };

let value: ChangeSetsValue = EMPTY;
const listeners = new Set<() => void>();
// The article version the store has read for, so a second card mounting
// against the same article joins the read the first one started.
let readVersion = -1;

const publish = (next: ChangeSetsValue): void => {
  value = next;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

/**
 * Reads the fold once for one article version, retrying a read that failed for
 * a reason the runtime did not state.
 *
 * A refusal is the runtime's answer and is not retried; a transport failure is
 * not an answer, and giving up on the first one would leave every thread on the
 * page showing a per-response fallback for the life of the article.
 */
const readChangeSets = async ({
  identity,
  version,
}: {
  readonly identity: RuntimeIdentity;
  readonly version: number;
}): Promise<void> => {
  if (readVersion >= version) return;
  readVersion = version;
  for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt += 1) {
    // A newer article landed while this read was in flight, so its own read
    // now owns the store and this one must not publish a stale fold over it.
    if (readVersion > version) return;
    try {
      const state = decodeCommittedChangeSets(
        await requestJson({ path: CHANGE_SETS_PATH, identity }),
      );
      if (readVersion > version) return;
      if (state !== undefined) {
        publish({ changeSets: state.changeSets, isRead: true });
      }
      return;
    } catch (error: unknown) {
      if (isTerminalReviewRuntimeRefusal(error)) return;
      if (attempt === READ_ATTEMPTS) return;
      await sleep(RETRY_DELAY_MS);
    }
  }
};

/**
 * The committed change sets this review has folded, re-read whenever a
 * revision replaces the reading surface.
 */
export const useChangeSets = (): ChangeSetsValue => {
  const articleVersion = useArticleVersion();
  const state = useSyncExternalStore(
    subscribe,
    () => value,
    () => EMPTY,
  );
  useEffect(() => {
    const identity = runtimeIdentity();
    if (identity === null) return;
    void readChangeSets({ identity, version: articleVersion });
  }, [articleVersion]);
  return state;
};

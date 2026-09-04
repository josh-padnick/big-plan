// Owns closing committed change-set transactions with verdict rows. It builds
// the same snapshot diff the reader counts, then appends only places that are
// still open so terminal-commit recovery is idempotent.
//
// Two callers close changes without the reviewer stepping through them - an
// armed push arriving, and a thread the reviewer resolves - and they differ
// only in which places each one owns. The place selection is therefore the
// argument and the ledger write is shared: one lock, one revision, one actor,
// so nothing can grow a second way to record an acceptance.

import { basename, extname } from "node:path";
import { renderDocument } from "../render/render-document.js";
import {
  applyChangeVerdictMutation,
  updateStoredChangeVerdicts,
  type StoredChangeVerdicts,
} from "./change-verdicts-store.js";
import { buildSnapshotDiff } from "./snapshot-diff.js";
import { readChangeOwnership } from "./change-ownership.js";
import type { SnapshotDiff } from "./shared/review-wire.js";
import { readSnapshot, type ReviewStore } from "./store.js";
import {
  acceptedChangeKeys,
  changeVerdictBatches,
  changeVerdictKey,
  rejectedChangeKeys,
  type ChangeVerdictPlace,
} from "./shared/change-verdict.js";

export type ChangeSetTransaction = {
  /** The change set being closed, which is what its verdicts are addressed to. */
  readonly changeSetId: string;
  readonly from: string;
  readonly to: string;
};

export type ChangeSetClosure = ChangeSetTransaction & {
  readonly places: ReadonlyArray<ChangeVerdictPlace>;
};

export type AcceptedOpenPlaces = {
  readonly previous: StoredChangeVerdicts;
  readonly verdicts: StoredChangeVerdicts;
};

/**
 * Builds the diff the reader counts for one transaction, or nothing when the
 * transaction moved the plan nowhere.
 *
 * "The diff the reader counts" includes how the reader groups it, so the
 * ownership partition is read here too. Minting places without it would close
 * a set at addresses no surface ever asks about, leaving it open in front of
 * the reviewer.
 */
export const transactionSnapshotDiff = async ({
  store,
  sessionId,
  planId,
  planPath,
  from,
  to,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly planId: string;
  readonly planPath: string;
  readonly from: string;
  readonly to: string;
}): Promise<SnapshotDiff | undefined> => {
  if (from === to) return undefined;
  const fallbackTitle = basename(planPath, extname(planPath));
  const [beforeSource, afterSource] = await Promise.all([
    readSnapshot({ store, snapshot: from }),
    readSnapshot({ store, snapshot: to }),
  ]);
  const before = renderDocument({
    markdown: beforeSource,
    fallbackTitle,
    identity: {},
  });
  const after = renderDocument({
    markdown: afterSource,
    fallbackTitle,
    identity: {},
  });
  const ownership = await readChangeOwnership({
    store,
    sessionId,
    planId,
    from,
    to,
  });
  return buildSnapshotDiff({
    from,
    to,
    before: before.blocks,
    after: after.blocks,
    ...(ownership === undefined ? {} : { ownership }),
  });
};

/** Builds the reader's place addresses for each arriving transaction. */
const closuresFor = async ({
  store,
  sessionId,
  planId,
  planPath,
  transactions,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly planId: string;
  readonly planPath: string;
  readonly transactions: ReadonlyArray<ChangeSetTransaction>;
}): Promise<ReadonlyArray<ChangeSetClosure>> => {
  return Promise.all(
    transactions.map(async ({ changeSetId, from, to }) => {
      const diff = await transactionSnapshotDiff({
        store,
        sessionId,
        planId,
        planPath,
        from,
        to,
      });
      return {
        changeSetId,
        from,
        to,
        // The closure records what it closed over as well as which place, so a
        // later round can tell a change it left alone from one it rewrote.
        places:
          diff === undefined
            ? []
            : diff.places.map((place) => ({
                placeId: place.placeId,
                contentDigest: place.contentDigest,
              })),
      };
    }),
  );
};

/**
 * Records auto-accept verdicts for every still-open place the closures name.
 *
 * The read, open-place selection, and write share the verdict lock because a
 * reviewer can accept a different place from the runtime while an agent CLI is
 * committing. An already closed place keeps its original actor, which both
 * preserves the reviewer's act and makes a crash replay a no-op - and it is
 * what leaves a rejected change rejected when its thread is closed around it.
 *
 * Every closure lands in one locked read-modify-write, so a caller closing
 * several at once records them as one ledger revision rather than a run of
 * them a reader could catch halfway through.
 */
export const acceptOpenPlaces = async ({
  store,
  closures,
  decidedAt,
}: {
  readonly store: ReviewStore;
  readonly closures: ReadonlyArray<ChangeSetClosure>;
  readonly decidedAt: string;
}): Promise<AcceptedOpenPlaces> => {
  let previous: StoredChangeVerdicts | undefined;
  const verdicts = await updateStoredChangeVerdicts({
    store,
    change: (current) => {
      previous = current;
      let next = current;
      const accepted = new Set(acceptedChangeKeys(current));
      const rejected = rejectedChangeKeys(current);
      for (const closure of closures) {
        const open = closure.places.filter((place) => {
          const key = changeVerdictKey({
            changeSetId: closure.changeSetId,
            from: closure.from,
            to: closure.to,
            placeId: place.placeId,
          });
          return !accepted.has(key) && !rejected.has(key);
        });
        for (const batch of changeVerdictBatches(open)) {
          next = applyChangeVerdictMutation({
            verdicts: next,
            mutation: {
              op: "accept",
              changeSetId: closure.changeSetId,
              from: closure.from,
              to: closure.to,
              places: batch,
              decidedAt,
              actor: "auto-accept",
            },
          });
          for (const place of batch) {
            accepted.add(
              changeVerdictKey({
                changeSetId: closure.changeSetId,
                from: closure.from,
                to: closure.to,
                placeId: place.placeId,
              }),
            );
          }
        }
      }
      return next;
    },
  });
  if (previous === undefined) {
    throw new Error("The verdict update did not inspect the stored record");
  }
  return { previous, verdicts };
};

/** Takes back only rows that one open-place acceptance added and still owns. */
export const restoreOpenPlaces = async ({
  store,
  acceptance,
}: {
  readonly store: ReviewStore;
  readonly acceptance: AcceptedOpenPlaces;
}): Promise<StoredChangeVerdicts> =>
  updateStoredChangeVerdicts({
    store,
    change: (current) => {
      const previousByKey = new Map(
        acceptance.previous.decided.map((entry) => [
          changeVerdictKey(entry),
          entry,
        ]),
      );
      const resultByKey = new Map(
        acceptance.verdicts.decided.map((entry) => [
          changeVerdictKey(entry),
          entry,
        ]),
      );
      const same = (
        left: (typeof current.decided)[number] | undefined,
        right: (typeof current.decided)[number] | undefined,
      ): boolean =>
        left?.verdict === right?.verdict &&
        left?.decidedAt === right?.decidedAt &&
        left?.actor === right?.actor;
      const restored = current.decided.filter((entry) => {
        const key = changeVerdictKey(entry);
        return previousByKey.has(key) || !same(entry, resultByKey.get(key));
      });
      return restored.length === current.decided.length
        ? current
        : { ...current, revision: current.revision + 1, decided: restored };
    },
  });

/**
 * Records auto-accept verdicts for every still-open place in the transactions,
 * which for an arriving push is every place the transaction touched.
 */
export const autoAcceptChangeSets = async ({
  store,
  sessionId,
  planId,
  planPath,
  transactions,
  decidedAt,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly planId: string;
  readonly planPath: string;
  readonly transactions: ReadonlyArray<ChangeSetTransaction>;
  readonly decidedAt: string;
}): Promise<{
  readonly verdicts: StoredChangeVerdicts;
  readonly closures: ReadonlyArray<ChangeSetClosure>;
}> => {
  const closures = await closuresFor({
    store,
    sessionId,
    planId,
    planPath,
    transactions,
  });
  const acceptance = await acceptOpenPlaces({ store, closures, decidedAt });
  return {
    verdicts: acceptance.verdicts,
    closures,
  };
};

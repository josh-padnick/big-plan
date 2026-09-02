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
import type { SnapshotDiff } from "./shared/review-wire.js";
import { readSnapshot, type ReviewStore } from "./store.js";
import {
  acceptedChangeKeys,
  changeVerdictBatches,
  changeVerdictKey,
  rejectedChangeKeys,
} from "./shared/change-verdict.js";

export type ChangeSetTransaction = {
  readonly from: string;
  readonly to: string;
};

export type ChangeSetClosure = ChangeSetTransaction & {
  readonly placeIds: ReadonlyArray<string>;
};

/**
 * Builds the diff the reader counts for one transaction, or nothing when the
 * transaction moved the plan nowhere.
 */
export const transactionSnapshotDiff = async ({
  store,
  planPath,
  from,
  to,
}: {
  readonly store: ReviewStore;
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
  return buildSnapshotDiff({
    from,
    to,
    before: before.blocks,
    after: after.blocks,
  });
};

/** Builds the reader's place addresses for each arriving transaction. */
const closuresFor = async ({
  store,
  planPath,
  transactions,
}: {
  readonly store: ReviewStore;
  readonly planPath: string;
  readonly transactions: ReadonlyArray<ChangeSetTransaction>;
}): Promise<ReadonlyArray<ChangeSetClosure>> => {
  return Promise.all(
    transactions.map(async ({ from, to }) => {
      const diff = await transactionSnapshotDiff({ store, planPath, from, to });
      return {
        from,
        to,
        placeIds:
          diff === undefined ? [] : diff.places.map((place) => place.placeId),
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
}): Promise<StoredChangeVerdicts> =>
  updateStoredChangeVerdicts({
    store,
    change: (current) => {
      let next = current;
      const accepted = new Set(acceptedChangeKeys(current));
      const rejected = rejectedChangeKeys(current);
      for (const closure of closures) {
        const open = closure.placeIds.filter((placeId) => {
          const key = changeVerdictKey({
            from: closure.from,
            to: closure.to,
            placeId,
          });
          return !accepted.has(key) && !rejected.has(key);
        });
        for (const batch of changeVerdictBatches(open)) {
          next = applyChangeVerdictMutation({
            verdicts: next,
            mutation: {
              op: "accept",
              from: closure.from,
              to: closure.to,
              placeIds: batch,
              decidedAt,
              actor: "auto-accept",
            },
          });
          for (const placeId of batch) {
            accepted.add(
              changeVerdictKey({
                from: closure.from,
                to: closure.to,
                placeId,
              }),
            );
          }
        }
      }
      return next;
    },
  });

/**
 * Records auto-accept verdicts for every still-open place in the transactions,
 * which for an arriving push is every place the transaction touched.
 */
export const autoAcceptChangeSets = async ({
  store,
  planPath,
  transactions,
  decidedAt,
}: {
  readonly store: ReviewStore;
  readonly planPath: string;
  readonly transactions: ReadonlyArray<ChangeSetTransaction>;
  readonly decidedAt: string;
}): Promise<{
  readonly verdicts: StoredChangeVerdicts;
  readonly closures: ReadonlyArray<ChangeSetClosure>;
}> => {
  const closures = await closuresFor({ store, planPath, transactions });
  return {
    verdicts: await acceptOpenPlaces({ store, closures, decidedAt }),
    closures,
  };
};

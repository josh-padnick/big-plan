// Owns closing committed change-set transactions with verdict rows. It builds
// the same snapshot diff the reader counts, then appends only places that are
// still open so terminal-commit recovery is idempotent.

import { basename, extname } from "node:path";
import { renderDocument } from "../render/render-document.js";
import {
  applyChangeVerdictMutation,
  updateStoredChangeVerdicts,
  type StoredChangeVerdicts,
} from "./change-verdicts-store.js";
import { buildSnapshotDiff } from "./snapshot-diff.js";
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
  const fallbackTitle = basename(planPath, extname(planPath));
  return Promise.all(
    transactions.map(async ({ from, to }) => {
      if (from === to) return { from, to, placeIds: [] };
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
      const diff = buildSnapshotDiff({
        from,
        to,
        before: before.blocks,
        after: after.blocks,
      });
      return {
        from,
        to,
        placeIds: diff.places.map((place) => place.placeId),
      };
    }),
  );
};

/**
 * Records auto-accept verdicts for every still-open place in the transactions.
 *
 * The read, open-place selection, and write share the verdict lock because a
 * reviewer can accept a different place from the runtime while an agent CLI is
 * committing. An already closed place keeps its original actor, which both
 * preserves the reviewer's act and makes a crash replay a no-op.
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
  const verdicts = await updateStoredChangeVerdicts({
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
  return { verdicts, closures };
};

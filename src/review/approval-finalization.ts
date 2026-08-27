// Owns the recoverable commit that turns one approve decision into accepted
// change sets, canceled leftover work, and an approval record.

import { readFile, unlink } from "node:fs/promises";
import { deriveSnapshotDigest } from "./agent-exchange.js";
import { validateApprovalRecord } from "./approval-record.js";
import {
  validateChangeDispositions,
  type StoredChangeDispositions,
} from "./change-dispositions-store.js";
import {
  AgentRequestAlreadyAnswered,
  cancelAgentRequest,
} from "./request-mailbox.js";
import type { ApprovalRecord } from "./shared/approval.js";
import { SNAPSHOT_DIGEST } from "./shared/change-disposition.js";
import {
  readStoreJson,
  writeApprovalRecord,
  writeChangeDispositions,
  writeStoreJson,
  type ReviewStore,
} from "./store.js";
import { withPlanMutationLock } from "./staged-plan-mutation.js";

const REQUEST_ID = /^[a-f0-9]{16}$/u;

type ApprovalFinalization = {
  readonly version: 1;
  readonly expectedSnapshot: string;
  readonly canceledAt: string;
  readonly requestIds: ReadonlyArray<string>;
  readonly approval: ApprovalRecord;
  readonly dispositions: StoredChangeDispositions;
};

const validateFinalization = (value: unknown): ApprovalFinalization => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("version" in value) ||
    value.version !== 1 ||
    !("expectedSnapshot" in value) ||
    typeof value.expectedSnapshot !== "string" ||
    !SNAPSHOT_DIGEST.test(value.expectedSnapshot) ||
    !("canceledAt" in value) ||
    typeof value.canceledAt !== "string" ||
    new Date(value.canceledAt).toISOString() !== value.canceledAt ||
    !("requestIds" in value) ||
    !Array.isArray(value.requestIds) ||
    !value.requestIds.every(
      (requestId) =>
        typeof requestId === "string" && REQUEST_ID.test(requestId),
    ) ||
    !("approval" in value) ||
    !("dispositions" in value)
  ) {
    throw new Error("The interrupted approval finalization is invalid");
  }
  return {
    version: 1,
    expectedSnapshot: value.expectedSnapshot,
    canceledAt: value.canceledAt,
    requestIds: value.requestIds,
    approval: validateApprovalRecord(value.approval),
    dispositions: validateChangeDispositions(value.dispositions),
  };
};

const withCanceledCount = ({
  record,
  requestsCanceled,
}: {
  readonly record: ApprovalRecord;
  readonly requestsCanceled: number;
}): ApprovalRecord => {
  const last = record.entries.at(-1);
  if (last?.kind !== "approval") {
    throw new Error("The approval finalization carries no approval entry");
  }
  return {
    version: 1,
    entries: [
      ...record.entries.slice(0, -1),
      {
        ...last,
        openItemCounts: { ...last.openItemCounts, requestsCanceled },
      },
    ],
  };
};

const settleLocked = async ({
  store,
  planPath,
  finalization,
}: {
  readonly store: ReviewStore;
  readonly planPath: string;
  readonly finalization: ApprovalFinalization;
}): Promise<ReadonlyArray<string>> => {
  const currentSnapshot = deriveSnapshotDigest(
    await readFile(planPath, "utf8"),
  );
  if (currentSnapshot !== finalization.expectedSnapshot) {
    throw new Error(
      "The plan changed during an interrupted approval finalization",
    );
  }
  const canceledRequestIds: string[] = [];
  for (const requestId of finalization.requestIds) {
    try {
      const request = await cancelAgentRequest({
        store,
        requestId,
        now: finalization.canceledAt,
      });
      if (request.canceledAt === finalization.canceledAt) {
        canceledRequestIds.push(requestId);
      }
    } catch (error: unknown) {
      if (!(error instanceof AgentRequestAlreadyAnswered)) throw error;
    }
  }
  await writeChangeDispositions({
    store,
    dispositions: finalization.dispositions,
  });
  await writeApprovalRecord({
    store,
    record: withCanceledCount({
      record: finalization.approval,
      requestsCanceled: canceledRequestIds.length,
    }),
  });
  await unlink(store.approvalFinalizationPath);
  return canceledRequestIds;
};

export const commitApprovalFinalization = async ({
  store,
  planPath,
  finalization,
}: {
  readonly store: ReviewStore;
  readonly planPath: string;
  readonly finalization: ApprovalFinalization;
}): Promise<ReadonlyArray<string>> =>
  withPlanMutationLock({
    store,
    change: async (lockedStore) => {
      const currentSnapshot = deriveSnapshotDigest(
        await readFile(planPath, "utf8"),
      );
      if (currentSnapshot !== finalization.expectedSnapshot) {
        throw new Error("The plan changed before approval could be finalized");
      }
      await writeStoreJson({
        path: lockedStore.approvalFinalizationPath,
        value: finalization,
      });
      return settleLocked({ store: lockedStore, planPath, finalization });
    },
  });

export const recoverApprovalFinalization = async ({
  store,
  planPath,
}: {
  readonly store: ReviewStore;
  readonly planPath: string;
}): Promise<void> => {
  const stored = await readStoreJson(store.approvalFinalizationPath);
  if (stored === undefined) return;
  const finalization = validateFinalization(stored);
  await withPlanMutationLock({
    store,
    change: (lockedStore) =>
      settleLocked({ store: lockedStore, planPath, finalization }),
  });
};

export type { ApprovalFinalization };

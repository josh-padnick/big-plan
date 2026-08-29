// Owns the recoverable commit that turns one approve decision into accepted
// change sets, canceled leftover work, and an approval record.

import { readFile, unlink } from "node:fs/promises";
import {
  deriveSnapshotDigest,
  validateAgentRequest,
  type AgentApprovalRequest,
} from "./agent-exchange.js";
import { validateApprovalRecord } from "./approval-record.js";
import {
  mergeFinalizedChangeVerdicts,
  updateStoredChangeVerdicts,
  validateChangeVerdicts,
  type StoredChangeVerdicts,
} from "./change-verdicts-store.js";
import {
  AgentRequestAlreadyAnswered,
  cancelAgentRequest,
  writeAgentRequestWhen,
} from "./request-mailbox.js";
import {
  inForceApproval,
  type ApprovalRecord,
} from "./shared/approval.js";
import { SNAPSHOT_DIGEST } from "./shared/change-verdict.js";
import {
  readApprovalRecord,
  readStoreJson,
  writeApprovalBrief,
  writeApprovalRecord,
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
  readonly verdicts: StoredChangeVerdicts;
  readonly handoff: AgentApprovalRequest;
  readonly brief: string;
};

type ApprovalFinalizationResult = {
  readonly canceledRequestIds: ReadonlyArray<string>;
  readonly delivered: boolean;
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
    !("verdicts" in value) ||
    !("handoff" in value) ||
    !("brief" in value) ||
    typeof value.brief !== "string"
  ) {
    throw new Error("The interrupted approval finalization is invalid");
  }
  const handoff = validateAgentRequest(value.handoff);
  if (handoff.kind !== "approval") {
    throw new Error("The interrupted approval finalization handoff is invalid");
  }
  return {
    version: 1,
    expectedSnapshot: value.expectedSnapshot,
    canceledAt: value.canceledAt,
    requestIds: value.requestIds,
    approval: validateApprovalRecord(value.approval),
    verdicts: validateChangeVerdicts(value.verdicts),
    handoff,
    brief: value.brief,
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
}): Promise<ApprovalFinalizationResult> => {
  const journaledEntry = finalization.approval.entries.at(-1);
  if (journaledEntry?.kind !== "approval") {
    throw new Error("The approval finalization carries no approval entry");
  }
  const { record: storedApproval } = await readApprovalRecord({
    store,
    validate: validateApprovalRecord,
  });
  const hasJournaledApproval = storedApproval.entries.some(
    (entry) =>
      entry.kind === "approval" &&
      entry.approvalId === journaledEntry.approvalId,
  );
  if (!hasJournaledApproval) {
    const currentSnapshot = deriveSnapshotDigest(
      await readFile(planPath, "utf8"),
    );
    if (currentSnapshot !== finalization.expectedSnapshot) {
      throw new Error(
        "The plan changed during an interrupted approval finalization",
      );
    }
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
  await updateStoredChangeVerdicts({
    store,
    change: (current) =>
      mergeFinalizedChangeVerdicts({
        current,
        finalized: finalization.verdicts,
      }),
  });
  const approvalWithCanceledCount = withCanceledCount({
    record: finalization.approval,
    requestsCanceled: canceledRequestIds.length,
  });
  const currentApproval = hasJournaledApproval
    ? storedApproval
    : approvalWithCanceledCount;
  if (!hasJournaledApproval) {
    await writeApprovalRecord({ store, record: currentApproval });
  }
  await writeApprovalBrief({
    store,
    approvalId: journaledEntry.approvalId,
    createdAt: journaledEntry.at,
    brief: finalization.brief,
  });
  if (
    inForceApproval(currentApproval)?.approvalId !== journaledEntry.approvalId
  ) {
    await unlink(store.approvalFinalizationPath);
    return { canceledRequestIds, delivered: false };
  }
  let delivered = false;
  try {
    delivered = await writeAgentRequestWhen({
      store,
      request: finalization.handoff,
      permitted: async () => {
        const { record } = await readApprovalRecord({
          store,
          validate: validateApprovalRecord,
        });
        return (
          inForceApproval(record)?.approvalId === journaledEntry.approvalId
        );
      },
    });
  } catch {
    // Approval is already durable. Retain the journal so restart recovery can
    // retry the required handoff without asking the reviewer to approve again.
  }
  if (delivered) await unlink(store.approvalFinalizationPath);
  return { canceledRequestIds, delivered };
};

export const commitApprovalFinalization = async ({
  store,
  planPath,
  finalization,
}: {
  readonly store: ReviewStore;
  readonly planPath: string;
  readonly finalization: ApprovalFinalization;
}): Promise<ApprovalFinalizationResult> =>
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

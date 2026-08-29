// Proves the one decision a static export makes about the stamp: it marks a
// plan whose bytes still match the approval in force, and marks nothing else.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveSnapshotDigest } from "../../review/agent-exchange.js";
import type {
  ApprovalEntry,
  ApprovalRecord,
} from "../../review/shared/approval.js";
import {
  deriveReviewPlanId,
  prepareStore,
  reviewStoreFor,
  writeApprovalRecord,
} from "../../review/store.js";
import { approvalDecorationFor } from "./approval-decoration.js";

const PLAN = "# Release plan\n\nThe body a digest is taken over.\n";
const APPROVAL_ID = "a1b2c3d4e5f60718";
const AT = "2026-08-19T17:41:00.000Z";

let tempDirectory = "";
let planPath = "";

const entryPinning = (pinnedSnapshot: string): ApprovalEntry => ({
  kind: "approval",
  approvalId: APPROVAL_ID,
  at: AT,
  pinnedSnapshot,
  agentConnected: true,
  message: "Approved.",
  recordedAnswers: [],
  alreadyDecided: [],
  unansweredDecisions: [],
  openItemCounts: {
    changeSetsAccepted: 0,
    changeSetsTotal: 0,
    decisionsAnswered: 0,
    decisionsTotal: 0,
    requestsCanceled: 0,
  },
});

const writeRecord = async (record: ApprovalRecord): Promise<void> => {
  const store = reviewStoreFor({
    planPath,
    planId: deriveReviewPlanId({ planPath }),
  });
  await prepareStore(store);
  await writeApprovalRecord({ store, record });
};

beforeEach(async () => {
  tempDirectory = await mkdtemp(
    join(tmpdir(), "big-plan-approval-decoration-"),
  );
  planPath = join(tempDirectory, "plan.mdx");
  await writeFile(planPath, PLAN, "utf8");
});

afterEach(async () => {
  await rm(tempDirectory, { recursive: true, force: true });
});

describe("approvalDecorationFor", () => {
  it("stamps nothing when no review store sits beside the plan", async () => {
    await expect(
      approvalDecorationFor({ planPath, markdown: PLAN }),
    ).resolves.toBeUndefined();
  });

  it("stamps an approval pinned to the bytes being rendered", async () => {
    const pinnedSnapshot = deriveSnapshotDigest(PLAN);
    await writeRecord({ version: 1, entries: [entryPinning(pinnedSnapshot)] });
    await expect(
      approvalDecorationFor({ planPath, markdown: PLAN }),
    ).resolves.toEqual({ at: AT, pinnedSnapshot });
  });

  it("stamps nothing when the plan changed after the approval", async () => {
    await writeRecord({
      version: 1,
      entries: [entryPinning(deriveSnapshotDigest(PLAN))],
    });
    await expect(
      approvalDecorationFor({ planPath, markdown: `${PLAN}One more line.\n` }),
    ).resolves.toBeUndefined();
  });

  it("stamps nothing once the approval is revoked", async () => {
    await writeRecord({
      version: 1,
      entries: [
        entryPinning(deriveSnapshotDigest(PLAN)),
        {
          kind: "revocation",
          approvalId: APPROVAL_ID,
          at: "2026-08-19T18:00:00.000Z",
        },
      ],
    });
    await expect(
      approvalDecorationFor({ planPath, markdown: PLAN }),
    ).resolves.toBeUndefined();
  });
});

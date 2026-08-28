// Proves the one fact the approval record cannot answer: whether the agent was
// handed the approval, and what a store that cannot be read is allowed to say
// about it.

import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readApprovalSummary } from "./approval-view.js";
import { approvalAgentRequest, writeAgentRequest } from "./agent-exchange.js";
import { appendApproval } from "./approval-record.js";
import { emptyApprovalRecord } from "./shared/approval.js";
import type { ApprovalEntry } from "./shared/approval.js";
import { prepareStore, reviewStoreFor } from "./store.js";

const APPROVAL_ID = "a1b2c3d4e5f60718";
const SNAPSHOT = "db1b466eeecbc416";
const SESSION_ID = "1111111111111111";
const PLAN_ID = "2222222222222222";

const entry: ApprovalEntry = {
  kind: "approval",
  approvalId: APPROVAL_ID,
  at: "2026-08-19T17:41:00.000Z",
  pinnedSnapshot: SNAPSHOT,
  agentConnected: false,
  message: "Start on it now.",
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
};

const record = appendApproval({ record: emptyApprovalRecord(), entry });

let opened: Array<{ directory: string; requestDirectory: string }> = [];

const preparedStore = async () => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-approval-view-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, "# Plan\n");
  const store = reviewStoreFor({ planPath, planId: PLAN_ID });
  await prepareStore(store);
  opened.push({ directory, requestDirectory: store.agentRequestDirectory });
  return { planPath, store };
};

afterEach(async () => {
  for (const { directory, requestDirectory } of opened) {
    await chmod(requestDirectory, 0o700).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
  opened = [];
});

describe("the approval a reviewer is shown", () => {
  it("should report an approval the mailbox never received", async () => {
    const { store } = await preparedStore();
    await expect(
      readApprovalSummary({ store, record, currentSnapshot: SNAPSHOT }),
    ).resolves.toMatchObject({ approvalId: APPROVAL_ID, delivered: false });
  });

  it("should report an approval the mailbox holds", async () => {
    const { planPath, store } = await preparedStore();
    await writeAgentRequest({
      store,
      request: approvalAgentRequest({
        approvalId: APPROVAL_ID,
        sessionId: SESSION_ID,
        planId: PLAN_ID,
        planPath,
        pinnedSnapshot: SNAPSHOT,
        createdAt: entry.at,
        recordedAnswers: [],
        unansweredDecisions: [],
        message: entry.message,
      }),
    });
    await expect(
      readApprovalSummary({ store, record, currentSnapshot: SNAPSHOT }),
    ).resolves.toMatchObject({ delivered: true });
  });

  // Telling the reviewer the agent never got the approval sends them to revoke
  // it. A store Big Plan could not look in is no evidence for that.
  it("should not call a mailbox it cannot read an undelivered approval", async () => {
    const { planPath, store } = await preparedStore();
    await writeAgentRequest({
      store,
      request: approvalAgentRequest({
        approvalId: APPROVAL_ID,
        sessionId: SESSION_ID,
        planId: PLAN_ID,
        planPath,
        pinnedSnapshot: SNAPSHOT,
        createdAt: entry.at,
        recordedAnswers: [],
        unansweredDecisions: [],
        message: entry.message,
      }),
    });
    await chmod(store.agentRequestDirectory, 0o000);
    await expect(
      readApprovalSummary({ store, record, currentSnapshot: SNAPSHOT }),
    ).resolves.toMatchObject({ delivered: true });
  });
});

// Proves that separate browser and agent processes can change one stored
// request without replacing each other's fields.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReviewComment } from "./comment.js";
import {
  deriveSourceRevision,
  feedbackAgentRequest,
  readAgentExchange,
  writeAgentRequest,
} from "./agent-exchange.js";
import { buildFeedbackPackage } from "./feedback-package.js";
import {
  cancelAgentRequest,
  claimAgentRequest,
  removeCommentFromQueuedFeedbackRequest,
} from "./request-mailbox.js";
import { prepareStore, reviewStoreFor } from "./store.js";

const sessionId = "1111111111111111";
const planId = "2222222222222222";
const packageId = "3333333333333333";
const revision = deriveSourceRevision("# Plan\n");

const reviewComment = ({
  id,
  body,
}: {
  id: string;
  body: string;
}): ReviewComment => ({
  id,
  body,
  createdAt: "2026-08-10T12:00:00.000Z",
  target: { type: "document" },
});

const requestWith = (comments: ReadonlyArray<ReviewComment>) =>
  feedbackAgentRequest({
    feedback: buildFeedbackPackage({
      sessionId,
      packageId,
      planId,
      planPath: "/tmp/plan.mdx",
      createdAt: "2026-08-10T12:00:00.000Z",
      comments,
    }),
    sourceRevision: revision,
  });

const preparedStore = async () => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-mailbox-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, "# Plan\n");
  const store = reviewStoreFor({ planPath, planId });
  await prepareStore(store);
  return store;
};

describe("request mailbox", () => {
  it("should preserve claim and cancel fields when processes race", async () => {
    const store = await preparedStore();
    const request = requestWith([
      reviewComment({ id: "4444444444444444", body: "Revise this." }),
    ]);
    await writeAgentRequest({ store, request });

    await Promise.all([
      claimAgentRequest({
        store,
        requestId: request.requestId,
        sourceRevision: "aaaaaaaaaaaaaaaa",
        now: "2026-08-10T12:00:01.000Z",
      }),
      cancelAgentRequest({
        store,
        requestId: request.requestId,
        now: "2026-08-10T12:00:02.000Z",
      }),
    ]);

    await expect(
      readAgentExchange({ store, sessionId, planId }),
    ).resolves.toMatchObject({
      requests: [
        {
          claimedFromRevision: "aaaaaaaaaaaaaaaa",
          claimedAt: "2026-08-10T12:00:01.000Z",
          canceledAt: "2026-08-10T12:00:02.000Z",
        },
      ],
    });
  });

  it("should keep a valid request when removal races with pickup", async () => {
    const store = await preparedStore();
    const removedId = "4444444444444444";
    const keptId = "5555555555555555";
    const request = requestWith([
      reviewComment({ id: removedId, body: "Remove this." }),
      reviewComment({ id: keptId, body: "Keep this." }),
    ]);
    await writeAgentRequest({ store, request });

    const results = await Promise.allSettled([
      claimAgentRequest({
        store,
        requestId: request.requestId,
        sourceRevision: "aaaaaaaaaaaaaaaa",
        now: "2026-08-10T12:00:01.000Z",
      }),
      removeCommentFromQueuedFeedbackRequest({
        store,
        requestId: request.requestId,
        commentId: removedId,
        now: "2026-08-10T12:00:02.000Z",
      }),
    ]);

    const exchange = await readAgentExchange({ store, sessionId, planId });
    const stored = exchange.requests[0];
    expect(stored).toMatchObject({
      kind: "feedback",
      claimedFromRevision: "aaaaaaaaaaaaaaaa",
    });
    if (stored?.kind !== "feedback") {
      throw new Error("The stored request must remain feedback");
    }
    const storedIds = stored.comments.map((comment) => comment.id);
    expect(storedIds).toContain(keptId);
    if (results[1].status === "fulfilled") {
      expect(storedIds).not.toContain(removedId);
    } else {
      expect(storedIds).toContain(removedId);
      expect(results[1].reason).toMatchObject({
        message: "The agent has already picked up this feedback request",
      });
    }
  });
});

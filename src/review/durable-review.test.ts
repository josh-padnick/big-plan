// Exercises durable reviewer snapshots through conflict, corruption, and
// reconciliation boundaries without involving the HTTP or browser adapters.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveSourceRevision,
  feedbackAgentRequests,
  writeAgentRequest,
} from "./agent-exchange.js";
import { validateComments } from "./comment.js";
import type { ReviewComment } from "./comment.js";
import {
  commitFeedback,
  loadDurableReview,
  loadReviewerState,
  ReviewerStateCorrupt,
  saveReviewerState,
} from "./durable-review.js";
import type {
  CommitFeedbackCheckpoint,
  ReviewEvent,
} from "./durable-review.js";
import { buildFeedbackPackage } from "./feedback-package.js";
import { prepareStore, reviewStoreFor } from "./store.js";

const blockId = "section/approach/paragraph-1";
const comment: ReviewComment = {
  id: "4444444444444444",
  body: "Keep this reviewer note.",
  createdAt: "2026-08-04T12:00:00.000Z",
  target: {
    type: "block",
    blockId,
    kind: "paragraph",
    label: "Original paragraph.",
    section: "Approach",
  },
};
const validators = {
  drafts: (value: unknown) =>
    validateComments({
      value,
      blocks: new Map([
        [
          blockId,
          {
            id: blockId,
            kind: "paragraph",
            label: "Original paragraph.",
            section: "Approach",
          },
        ],
      ]),
      now: "2026-08-04T12:00:00.000Z",
    }),
  activeDraft: (value: unknown) => (typeof value === "string" ? value : ""),
  resolvedCommentIds: (value: unknown) =>
    Array.isArray(value)
      ? value.filter((entry) => typeof entry === "string")
      : [],
};

const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-durable-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, "# Plan\n");
  const store = reviewStoreFor({ planPath, planId: "2222222222222222" });
  await prepareStore(store);
  return store;
};

const feedbackCommit = () => {
  const feedback = buildFeedbackPackage({
    sessionId: "1111111111111111",
    packageId: "3333333333333333",
    planId: "2222222222222222",
    planPath: "/tmp/plan.mdx",
    createdAt: "2026-08-04T12:00:00.000Z",
    comments: [comment],
  });
  const source = "# Plan\n";
  const sourceRevision = deriveSourceRevision(source);
  const [request] = feedbackAgentRequests({
    feedback,
    sourceRevision,
    requestIds: ["3333333333333333"],
  });
  if (request === undefined) {
    throw new Error("The fixture feedback request was not created");
  }
  const event: ReviewEvent = {
    eventId: "5555555555555555",
    sessionId: feedback.sessionId,
    step: "Feedback package received",
    state: "done",
    requestId: request.requestId,
    at: "2026-08-04T12:00:01.000Z",
  };
  return {
    feedback,
    source,
    sourceRevision,
    requests: [request],
    event,
  };
};

describe("durable reviewer state", () => {
  it("should begin at revision zero when the snapshot is missing", async () => {
    const store = await fixture();
    await expect(
      loadReviewerState({ store, validators }),
    ).resolves.toMatchObject({ revision: 0, schemaVersion: 1 });
  });

  it("should reject a stale save when newer reviewer state exists", async () => {
    const store = await fixture();
    const first = await saveReviewerState({
      store,
      expectedRevision: 0,
      validators,
      next: { drafts: [], activeDraft: "new", resolvedCommentIds: [] },
    });
    expect(first.ok).toBe(true);
    const stale = await saveReviewerState({
      store,
      expectedRevision: 0,
      validators,
      next: { drafts: [], activeDraft: "stale", resolvedCommentIds: [] },
    });
    expect(stale).toMatchObject({
      ok: false,
      current: { revision: 1, activeDraft: "new" },
    });
  });

  it("should preserve and surface authoritative state when it is corrupt", async () => {
    const store = await fixture();
    await writeFile(store.reviewerStatePath, "{truncated");
    await expect(
      loadDurableReview({
        store,
        sessionId: "1111111111111111",
        planId: "2222222222222222",
        validators,
      }),
    ).rejects.toBeInstanceOf(ReviewerStateCorrupt);
  });

  it("should derive sent ownership when a feedback request is committed", async () => {
    const store = await fixture();
    await saveReviewerState({
      store,
      expectedRevision: 0,
      validators,
      next: {
        drafts: [comment],
        activeDraft: "",
        resolvedCommentIds: [],
      },
    });
    const {
      requests: [request],
    } = feedbackCommit();
    if (request === undefined) throw new Error("The request is required");
    await writeAgentRequest({ store, request });

    const durable = await loadDurableReview({
      store,
      sessionId: "1111111111111111",
      planId: "2222222222222222",
      validators,
    });

    expect(durable.reviewer.drafts).toEqual([]);
    expect(durable.sent).toEqual([comment]);
  });

  it("should recover exact ownership when feedback commit is interrupted", async () => {
    const checkpoints: ReadonlyArray<CommitFeedbackCheckpoint> = [
      "feedback-package",
      "source-revision",
      "agent-requests",
      "reviewer-state",
      "review-event",
    ];
    for (const interruptedAt of checkpoints) {
      const store = await fixture();
      await saveReviewerState({
        store,
        expectedRevision: 0,
        validators,
        next: {
          drafts: [comment],
          activeDraft: "",
          resolvedCommentIds: [],
        },
      });
      const commit = feedbackCommit();
      await expect(
        commitFeedback({
          store,
          expectedRevision: 1,
          ...commit,
          brief: "# Feedback\n",
          submittedCommentIds: [comment.id],
          validators,
          testingCheckpoint: async (checkpoint) => {
            if (checkpoint === interruptedAt) {
              throw new Error(`Interrupted after ${checkpoint}`);
            }
          },
        }),
      ).rejects.toThrow(`Interrupted after ${interruptedAt}`);

      const recovered = await loadDurableReview({
        store,
        sessionId: commit.feedback.sessionId,
        planId: commit.feedback.planId,
        validators,
      });
      expect(
        recovered.reviewer.drafts.filter(({ id }) => id === comment.id).length +
          recovered.sent.filter(({ id }) => id === comment.id).length,
      ).toBe(1);
      expect(recovered.exchange.requests).toHaveLength(
        checkpoints.indexOf(interruptedAt) >=
          checkpoints.indexOf("agent-requests")
          ? 1
          : 0,
      );

      const retried = await commitFeedback({
        store,
        expectedRevision: 1,
        ...commit,
        brief: "# Feedback\n",
        submittedCommentIds: [comment.id],
        validators,
      });
      expect(retried.ok).toBe(true);
      const complete = await loadDurableReview({
        store,
        sessionId: commit.feedback.sessionId,
        planId: commit.feedback.planId,
        validators,
      });
      expect(complete.reviewer.drafts).toEqual([]);
      expect(complete.sent).toEqual([comment]);
      expect(complete.exchange.requests).toHaveLength(1);
    }
  });
});

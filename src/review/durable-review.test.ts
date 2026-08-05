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
  loadDurableReview,
  loadReviewerState,
  ReviewerStateCorrupt,
  saveReviewerState,
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

describe("durable reviewer state", () => {
  it("should begin at revision zero when the snapshot is missing", async () => {
    const store = await fixture();
    await expect(
      loadReviewerState({ store, validators }),
    ).resolves.toMatchObject({ revision: 0, schemaVersion: 1 });
  });

  it("should reject a stale save without replacing newer state", async () => {
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

  it("should surface corrupt authoritative reviewer state", async () => {
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

  it("should derive sent ownership from immutable feedback requests", async () => {
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
    const feedback = buildFeedbackPackage({
      sessionId: "1111111111111111",
      packageId: "3333333333333333",
      planId: "2222222222222222",
      planPath: "/tmp/plan.mdx",
      createdAt: "2026-08-04T12:00:00.000Z",
      comments: [comment],
    });
    const [request] = feedbackAgentRequests({
      feedback,
      sourceRevision: deriveSourceRevision("# Plan\n"),
      requestIds: ["3333333333333333"],
    });
    if (request === undefined) {
      throw new Error("The fixture feedback request was not created");
    }
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
});

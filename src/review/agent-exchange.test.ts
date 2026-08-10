// Covers the coding-agent exchange through its public seam: real feedback and
// replies become pending work, and only complete source-consistent responses
// can become viewer state.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReviewComment } from "./comment.js";
import {
  AgentExchangeRejected,
  commentsFromExchange,
  deriveSourceRevision,
  feedbackAgentRequest,
  messageAgentRequest,
  nextPendingAgentRequest,
  readAgentExchange,
  requestBaselineRevision,
  validateAgentResponseDraft,
  writeAgentRequest,
  writeAgentResponse,
} from "./agent-exchange.js";
import type { AgentExchangeSnapshot } from "./agent-exchange.js";
import { buildFeedbackPackage } from "./feedback-package.js";
import { cancelAgentRequest, claimAgentRequest } from "./request-mailbox.js";
import { prepareStore, reviewStoreFor } from "./store.js";

const sessionId = "1111111111111111";
const planId = "2222222222222222";
const packageId = "3333333333333333";
const commentId = "4444444444444444";
const blockId = "section/approach/paragraph-1";
const before = "# Plan\n\n## Approach\n\nKeep the first version.\n";
const after = "# Plan\n\n## Approach\n\nUse the revised version.\n";

const comment: ReviewComment = {
  id: commentId,
  body: "Use the revised version.",
  createdAt: "2026-08-02T12:00:00.000Z",
  target: {
    type: "block",
    blockId,
    kind: "paragraph",
    label: "Keep the first version.",
    section: "Approach",
  },
};

const feedback = buildFeedbackPackage({
  sessionId,
  packageId,
  planId,
  planPath: "/tmp/plan.mdx",
  createdAt: "2026-08-02T12:00:00.000Z",
  comments: [comment],
});

const request = feedbackAgentRequest({
  feedback,
  sourceRevision: deriveSourceRevision(before),
});

const snapshot = (): AgentExchangeSnapshot => ({
  requests: [request],
  responses: [],
});

describe("agent exchange response contract", () => {
  it("should require one outcome for every comment in a feedback request", () => {
    expect(() =>
      validateAgentResponseDraft({
        value: { requestId: packageId, outcomes: [] },
        request,
        commentsById: new Map([[commentId, comment]]),
        changedBlocks: new Set([blockId]),
        currentRevision: deriveSourceRevision(after),
        now: "2026-08-02T12:01:00.000Z",
      }),
    ).toThrow(AgentExchangeRejected);
  });

  it("should refuse Changed when the plan source did not change", () => {
    expect(() =>
      validateAgentResponseDraft({
        value: {
          requestId: packageId,
          outcomes: [
            {
              commentId,
              state: "changed",
              message: "Revised the approach.",
              changeTargets: [blockId],
            },
          ],
        },
        request,
        commentsById: new Map([[commentId, comment]]),
        changedBlocks: new Set([blockId]),
        currentRevision: deriveSourceRevision(before),
        now: "2026-08-02T12:01:00.000Z",
      }),
    ).toThrow(/requires a revision/);
  });

  it("should canonicalize a real Changed response against the revised render", () => {
    expect(
      validateAgentResponseDraft({
        value: {
          requestId: packageId,
          outcomes: [
            {
              commentId,
              state: "changed",
              message: "Revised the approach.",
              changeTargets: [blockId],
            },
          ],
        },
        request,
        commentsById: new Map([[commentId, comment]]),
        changedBlocks: new Set([blockId]),
        currentRevision: deriveSourceRevision(after),
        now: "2026-08-02T12:01:00.000Z",
      }),
    ).toMatchObject({
      requestId: packageId,
      sessionId,
      planId,
      outcomes: [
        {
          commentId,
          state: "changed",
          changeTargets: [blockId],
        },
      ],
    });
  });

  it("should reject an unchanged block attributed as a change target", () => {
    expect(() =>
      validateAgentResponseDraft({
        value: {
          requestId: packageId,
          outcomes: [
            {
              commentId,
              state: "changed",
              message: "Revised the approach.",
              changeTargets: ["section/approach/paragraph-2"],
            },
          ],
        },
        request,
        commentsById: new Map([[commentId, comment]]),
        changedBlocks: new Set([blockId]),
        currentRevision: deriveSourceRevision(after),
        now: "2026-08-02T12:01:00.000Z",
      }),
    ).toThrow(/block changed by this revision/);
  });

  it("should preserve several attributed changes in presentation order", () => {
    const secondBlock = "section/approach/paragraph-2";
    expect(
      validateAgentResponseDraft({
        value: {
          requestId: packageId,
          outcomes: [
            {
              commentId,
              state: "changed",
              message: "Revised both places.",
              changeTargets: [blockId, secondBlock],
            },
          ],
        },
        request,
        commentsById: new Map([[commentId, comment]]),
        changedBlocks: new Set([blockId, secondBlock]),
        currentRevision: deriveSourceRevision(after),
        now: "2026-08-02T12:01:00.000Z",
      }).outcomes[0],
    ).toMatchObject({ changeTargets: [blockId, secondBlock] });
  });

  it("should make a reviewer reply the next pending request", () => {
    const reply = messageAgentRequest({
      kind: "reply",
      requestId: "5555555555555555",
      sessionId,
      planId,
      sourceRevision: deriveSourceRevision(after),
      createdAt: "2026-08-02T12:02:00.000Z",
      body: "Keep the shorter wording.",
      commentId,
    });
    expect(
      nextPendingAgentRequest({
        requests: [request, reply],
        responses: [
          {
            version: 1,
            requestId: packageId,
            sessionId,
            planId,
            sourceRevision: deriveSourceRevision(after),
            createdAt: "2026-08-02T12:01:00.000Z",
            kind: "feedback",
            outcomes: [
              {
                commentId,
                state: "changed",
                message: "Revised the approach.",
                changeTargets: [blockId],
              },
            ],
          },
        ],
      }),
    ).toEqual(reply);
  });

  it("should collect original comments as reply validation context", () => {
    expect(commentsFromExchange(snapshot()).get(commentId)).toEqual(comment);
  });
});

describe("agent exchange filesystem", () => {
  it("freezes the first claim revision when work is picked up again", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-claim-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, before);
    const store = reviewStoreFor({ planPath, planId });
    await prepareStore(store);
    await writeAgentRequest({ store, request });
    const firstClaim = await claimAgentRequest({
      store,
      requestId: request.requestId,
      sourceRevision: "aaaaaaaaaaaaaaaa",
      now: "2026-08-02T12:00:30.000Z",
    });
    const repeatedClaim = await claimAgentRequest({
      store,
      requestId: firstClaim.requestId,
      sourceRevision: "bbbbbbbbbbbbbbbb",
      now: "2026-08-02T12:01:00.000Z",
    });
    expect(requestBaselineRevision(repeatedClaim)).toBe("aaaaaaaaaaaaaaaa");
    await expect(
      readAgentExchange({ store, sessionId, planId }),
    ).resolves.toMatchObject({
      requests: [
        {
          claimedFromRevision: "aaaaaaaaaaaaaaaa",
          claimedAt: "2026-08-02T12:00:30.000Z",
        },
      ],
    });
  });

  it("should round-trip validated requests and responses under the plan store", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, after);
    const store = reviewStoreFor({ planPath, planId });
    await prepareStore(store);
    await writeAgentRequest({ store, request });
    const response = validateAgentResponseDraft({
      value: {
        requestId: packageId,
        outcomes: [
          {
            commentId,
            state: "changed",
            message: "Revised the approach.",
            changeTargets: [blockId],
          },
        ],
      },
      request,
      commentsById: new Map([[commentId, comment]]),
      changedBlocks: new Set([blockId]),
      currentRevision: deriveSourceRevision(after),
      now: "2026-08-02T12:01:00.000Z",
    });
    await writeAgentResponse({ store, response });
    expect(
      await readAgentExchange({
        store,
        sessionId: "bbbbbbbbbbbbbbbb",
        planId,
      }),
    ).toEqual({
      requests: [request],
      responses: [response],
    });
  });

  it("makes canceled work terminal for pickup and response", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-cancel-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, before);
    const store = reviewStoreFor({ planPath, planId });
    await prepareStore(store);
    await writeAgentRequest({ store, request });
    const canceled = await cancelAgentRequest({
      store,
      requestId: request.requestId,
      now: "2026-08-02T12:00:45.000Z",
    });
    const canceledSnapshot = await readAgentExchange({
      store,
      sessionId,
      planId,
    });
    expect(canceled.canceledAt).toBe("2026-08-02T12:00:45.000Z");
    expect(nextPendingAgentRequest(canceledSnapshot)).toBeUndefined();
    expect(() =>
      validateAgentResponseDraft({
        value: {
          requestId: packageId,
          outcomes: [
            {
              commentId,
              state: "outside",
              message: "This should never publish.",
            },
          ],
        },
        request: canceled,
        commentsById: new Map([[commentId, comment]]),
        changedBlocks: new Set(),
        currentRevision: deriveSourceRevision(before),
        now: "2026-08-02T12:01:00.000Z",
      }),
    ).toThrow(/canceled by the reviewer/);
  });
});

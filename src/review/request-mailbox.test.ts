// Proves stored request mutations serialize safely across processes and
// request-lifecycle invariants reject contradictory review state.

import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type { ReviewComment } from "./shared/comment.js";
import {
  deriveSnapshotDigest,
  feedbackAgentRequest,
  messageAgentRequest,
  readAgentExchange,
  validateAgentResponseDraft,
  writeAgentRequest,
} from "./agent-exchange.js";
import { buildFeedbackPackage } from "./feedback-package.js";
import {
  appendProgressEvent,
  assertResolvableComment,
  cancelAgentRequest,
  claimAgentRequest,
  deleteQueuedRequest,
  publishAgentResponse,
  recordAgentConnectionState,
  removeCommentFromQueuedFeedbackRequest,
  reviseQueuedRequest,
} from "./request-mailbox.js";
import {
  prepareStore,
  readAgentConnectionEvents,
  readProgress,
  reviewStoreFor,
  writeAgentResponseValue,
} from "./store.js";

const sessionId = "1111111111111111";
const planId = "2222222222222222";
const packageId = "3333333333333333";
const snapshot = deriveSnapshotDigest("# Plan\n");
const execFileAsync = promisify(execFile);
const mailboxModule = new URL("./request-mailbox.ts", import.meta.url).href;
const storeModule = new URL("./store.ts", import.meta.url).href;

const WORKER_SCRIPT = `
const { reviewStoreFor } = await import(process.env.BP_STORE_MODULE);
const { claimAgentRequest, cancelAgentRequest } = await import(process.env.BP_MAILBOX_MODULE);
const store = reviewStoreFor({ planPath: process.env.BP_PLAN_PATH, planId: process.env.BP_PLAN_ID });
const delay = Number(process.env.BP_START_AT) - Date.now();
if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
const common = { store, requestId: process.env.BP_REQUEST_ID, now: process.env.BP_NOW };
if (process.env.BP_OPERATION === "claim") {
  await claimAgentRequest({ ...common, baselineSnapshot: "aaaaaaaaaaaaaaaa" });
} else {
  await cancelAgentRequest(common);
}
`;

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
  premiseSnapshot: snapshot,
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
    premiseSnapshot: snapshot,
  });

const chatRequest = (body: string) =>
  messageAgentRequest({
    kind: "chat",
    requestId: "6666666666666666",
    sessionId,
    planId,
    premiseSnapshot: snapshot,
    createdAt: "2026-08-10T12:00:00.000Z",
    body,
  });

const preparedReview = async () => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-mailbox-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, "# Plan\n");
  const store = reviewStoreFor({ planPath, planId });
  await prepareStore(store);
  return { planPath, store };
};

const runRequestWorker = async ({
  operation,
  planPath,
  requestId,
  startAt,
  now,
}: {
  readonly operation: "claim" | "cancel";
  readonly planPath: string;
  readonly requestId: string;
  readonly startAt: number;
  readonly now: string;
}): Promise<void> => {
  await execFileAsync("bun", ["-e", WORKER_SCRIPT], {
    env: {
      ...process.env,
      BP_STORE_MODULE: storeModule,
      BP_MAILBOX_MODULE: mailboxModule,
      BP_OPERATION: operation,
      BP_PLAN_PATH: planPath,
      BP_PLAN_ID: planId,
      BP_REQUEST_ID: requestId,
      BP_START_AT: String(startAt),
      BP_NOW: now,
    },
  });
};

describe("request mailbox", () => {
  it("should preserve claim and cancel fields when two processes race", async () => {
    const { planPath, store } = await preparedReview();
    const request = requestWith([
      reviewComment({ id: "4444444444444444", body: "Revise this." }),
    ]);
    await writeAgentRequest({ store, request });

    const startAt = Date.now() + 400;
    const results = await Promise.allSettled([
      runRequestWorker({
        operation: "claim",
        planPath,
        requestId: request.requestId,
        startAt,
        now: "2026-08-10T12:00:01.000Z",
      }),
      runRequestWorker({
        operation: "cancel",
        planPath,
        requestId: request.requestId,
        startAt,
        now: "2026-08-10T12:00:02.000Z",
      }),
    ]);

    expect(results[1]?.status).toBe("fulfilled");
    const exchange = await readAgentExchange({ store, sessionId, planId });
    expect(exchange.requests[0]).toMatchObject({
      canceledAt: "2026-08-10T12:00:02.000Z",
    });
    if (results[0]?.status === "fulfilled") {
      expect(exchange.requests[0]).toMatchObject({
        baselineSnapshot: "aaaaaaaaaaaaaaaa",
        claimedAt: "2026-08-10T12:00:01.000Z",
      });
    } else {
      expect(exchange.requests[0]).not.toHaveProperty("claimedAt");
    }
  });

  it("should commit either cancellation or response when they race", async () => {
    const { store } = await preparedReview();
    const comment = reviewComment({
      id: "4444444444444444",
      body: "Resolve this race.",
    });
    const request = requestWith([comment]);
    await writeAgentRequest({ store, request });
    const claimed = await claimAgentRequest({
      store,
      requestId: request.requestId,
      baselineSnapshot: snapshot,
      now: "2026-08-10T12:00:01.000Z",
    });
    const response = validateAgentResponseDraft({
      value: {
        requestId: request.requestId,
        outcomes: [
          {
            commentId: comment.id,
            state: "declined",
            message: "No plan revision is needed.",
          },
        ],
      },
      request: claimed,
      commentsById: new Map([[comment.id, comment]]),
      changedBlocks: new Set(),
      currentSnapshot: snapshot,
      now: "2026-08-10T12:00:02.000Z",
    });

    const results = await Promise.allSettled([
      publishAgentResponse({ store, response }),
      cancelAgentRequest({
        store,
        requestId: request.requestId,
        now: "2026-08-10T12:00:03.000Z",
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const exchange = await readAgentExchange({ store, sessionId, planId });
    expect(
      Number(exchange.requests[0]?.canceledAt !== undefined) +
        Number(exchange.responses.length > 0),
    ).toBe(1);
  });

  it("should reject a response until its request is claimed", async () => {
    const { store } = await preparedReview();
    const comment = reviewComment({
      id: "4444444444444444",
      body: "Claim this before answering.",
    });
    const request = requestWith([comment]);
    await writeAgentRequest({ store, request });
    const response = validateAgentResponseDraft({
      value: {
        requestId: request.requestId,
        outcomes: [
          {
            commentId: comment.id,
            state: "declined",
            message: "No plan revision is needed.",
          },
        ],
      },
      request,
      commentsById: new Map([[comment.id, comment]]),
      changedBlocks: new Set(),
      currentSnapshot: snapshot,
      now: "2026-08-10T12:00:02.000Z",
    });

    await expect(publishAgentResponse({ store, response })).rejects.toThrow(
      /must be claimed/,
    );
  });

  it("should replace a malformed stored response after claim", async () => {
    const { store } = await preparedReview();
    const comment = reviewComment({
      id: "4444444444444444",
      body: "Answer despite the malformed file.",
    });
    const request = requestWith([comment]);
    await writeAgentRequest({ store, request });
    const claimed = await claimAgentRequest({
      store,
      requestId: request.requestId,
      baselineSnapshot: snapshot,
      now: "2026-08-10T12:00:01.000Z",
    });
    await writeAgentResponseValue({
      store,
      requestId: request.requestId,
      value: {
        version: 2,
        requestId: request.requestId,
        sessionId,
        planId,
        kind: "feedback",
      },
    });
    const response = validateAgentResponseDraft({
      value: {
        requestId: request.requestId,
        outcomes: [
          {
            commentId: comment.id,
            state: "declined",
            message: "No plan revision is needed.",
          },
        ],
      },
      request: claimed,
      commentsById: new Map([[comment.id, comment]]),
      changedBlocks: new Set(),
      currentSnapshot: snapshot,
      now: "2026-08-10T12:00:02.000Z",
    });

    await publishAgentResponse({ store, response });
    await expect(
      readAgentExchange({ store, sessionId, planId }),
    ).resolves.toMatchObject({ responses: [response] });
  });

  it("should cancel despite a malformed stored response", async () => {
    const { store } = await preparedReview();
    const request = requestWith([
      reviewComment({
        id: "4444444444444444",
        body: "Cancel despite the malformed file.",
      }),
    ]);
    await writeAgentRequest({ store, request });
    await writeAgentResponseValue({
      store,
      requestId: request.requestId,
      value: {
        version: 2,
        requestId: request.requestId,
        sessionId,
        planId,
        kind: "feedback",
      },
    });

    await expect(
      cancelAgentRequest({
        store,
        requestId: request.requestId,
        now: "2026-08-10T12:00:02.000Z",
      }),
    ).resolves.toMatchObject({ canceledAt: "2026-08-10T12:00:02.000Z" });
  });

  it("should keep a valid request when removal races with pickup", async () => {
    const { store } = await preparedReview();
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
        baselineSnapshot: "aaaaaaaaaaaaaaaa",
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
      baselineSnapshot: "aaaaaaaaaaaaaaaa",
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

  it("should refuse to resolve a comment with an unanswered request", async () => {
    const { store } = await preparedReview();
    const commentId = "4444444444444444";
    const request = requestWith([
      reviewComment({ id: commentId, body: "Answer this before resolving." }),
    ]);
    await writeAgentRequest({ store, request });

    await expect(
      assertResolvableComment({ store, sessionId, planId, commentId }),
    ).rejects.toThrow(/waiting for the coding agent/);
  });

  it("should refuse to resolve a comment with an unanswered reply", async () => {
    const { store } = await preparedReview();
    const commentId = "4444444444444444";
    await writeAgentRequest({
      store,
      request: messageAgentRequest({
        kind: "reply",
        requestId: "6666666666666666",
        sessionId,
        planId,
        premiseSnapshot: snapshot,
        createdAt: "2026-08-10T12:00:00.000Z",
        body: "One more question about this.",
        commentId,
      }),
    });

    await expect(
      assertResolvableComment({ store, sessionId, planId, commentId }),
    ).rejects.toThrow(/waiting for the coding agent/);
  });

  it("should allow resolving once the request is cancelled", async () => {
    const { store } = await preparedReview();
    const commentId = "4444444444444444";
    const request = requestWith([
      reviewComment({ id: commentId, body: "Cancel this before resolving." }),
    ]);
    await writeAgentRequest({ store, request });
    await cancelAgentRequest({
      store,
      requestId: request.requestId,
      now: "2026-08-10T12:00:01.000Z",
    });

    await expect(
      assertResolvableComment({ store, sessionId, planId, commentId }),
    ).resolves.toBeUndefined();
  });

  it("should allow resolving once the agent has answered", async () => {
    const { store } = await preparedReview();
    const comment = reviewComment({
      id: "4444444444444444",
      body: "Answer this, then resolve.",
    });
    const request = requestWith([comment]);
    await writeAgentRequest({ store, request });
    const claimed = await claimAgentRequest({
      store,
      requestId: request.requestId,
      baselineSnapshot: snapshot,
      now: "2026-08-10T12:00:01.000Z",
    });
    await publishAgentResponse({
      store,
      response: validateAgentResponseDraft({
        value: {
          requestId: request.requestId,
          outcomes: [
            {
              commentId: comment.id,
              state: "declined",
              message: "No plan revision is needed.",
            },
          ],
        },
        request: claimed,
        commentsById: new Map([[comment.id, comment]]),
        changedBlocks: new Set(),
        currentSnapshot: snapshot,
        now: "2026-08-10T12:00:02.000Z",
      }),
    });

    await expect(
      assertResolvableComment({
        store,
        sessionId,
        planId,
        commentId: comment.id,
      }),
    ).resolves.toBeUndefined();
  });

  it("should allow resolving a comment no request names", async () => {
    const { store } = await preparedReview();
    const request = requestWith([
      reviewComment({ id: "4444444444444444", body: "A different thread." }),
    ]);
    await writeAgentRequest({ store, request });

    await expect(
      assertResolvableComment({
        store,
        sessionId,
        planId,
        commentId: "5555555555555555",
      }),
    ).resolves.toBeUndefined();
  });

  it("should revise a queued request", async () => {
    const { store } = await preparedReview();
    const request = chatRequest("Waht is the retry boundary?");
    await writeAgentRequest({ store, request });

    await expect(
      reviseQueuedRequest({
        store,
        requestId: request.requestId,
        body: "What is the retry boundary?",
      }),
    ).resolves.toMatchObject({
      kind: "chat",
      body: "What is the retry boundary?",
    });
    const exchange = await readAgentExchange({ store, sessionId, planId });
    expect(exchange.requests).toMatchObject([
      { requestId: request.requestId, body: "What is the retry boundary?" },
    ]);
  });

  it("should refuse to revise a claimed request", async () => {
    const { store } = await preparedReview();
    const request = chatRequest("Waht is the retry boundary?");
    await writeAgentRequest({ store, request });
    await claimAgentRequest({
      store,
      requestId: request.requestId,
      baselineSnapshot: snapshot,
      now: "2026-08-10T12:00:01.000Z",
    });

    await expect(
      reviseQueuedRequest({
        store,
        requestId: request.requestId,
        body: "What is the retry boundary?",
      }),
    ).rejects.toThrow(/already started/);
    const exchange = await readAgentExchange({ store, sessionId, planId });
    expect(exchange.requests[0]).toMatchObject({
      body: "Waht is the retry boundary?",
    });
  });

  it("should refuse to revise a canceled request", async () => {
    const { store } = await preparedReview();
    const request = chatRequest("Waht is the retry boundary?");
    await writeAgentRequest({ store, request });
    await cancelAgentRequest({
      store,
      requestId: request.requestId,
      now: "2026-08-10T12:00:01.000Z",
    });

    await expect(
      reviseQueuedRequest({
        store,
        requestId: request.requestId,
        body: "What is the retry boundary?",
      }),
    ).rejects.toThrow(/canceled/);
  });

  it("should refuse to revise a feedback request", async () => {
    const { store } = await preparedReview();
    const request = requestWith([
      reviewComment({ id: "4444444444444444", body: "Revise this." }),
    ]);
    await writeAgentRequest({ store, request });

    await expect(
      reviseQueuedRequest({
        store,
        requestId: request.requestId,
        body: "A different body.",
      }),
    ).rejects.toThrow(/Only a reply or plan question/);
  });

  it("should either revise or refuse when an edit races pickup", async () => {
    const { store } = await preparedReview();
    const request = chatRequest("Waht is the retry boundary?");
    await writeAgentRequest({ store, request });

    const results = await Promise.allSettled([
      claimAgentRequest({
        store,
        requestId: request.requestId,
        baselineSnapshot: snapshot,
        now: "2026-08-10T12:00:01.000Z",
      }),
      reviseQueuedRequest({
        store,
        requestId: request.requestId,
        body: "What is the retry boundary?",
      }),
    ]);

    const exchange = await readAgentExchange({ store, sessionId, planId });
    const stored = exchange.requests[0];
    expect(stored).toMatchObject({ baselineSnapshot: snapshot });
    if (results[1].status === "fulfilled") {
      expect(stored).toMatchObject({ body: "What is the retry boundary?" });
    } else {
      expect(stored).toMatchObject({ body: "Waht is the retry boundary?" });
      expect(results[1].reason).toMatchObject({
        message: "The agent already started on this message",
      });
    }
  });

  it("should delete a queued request", async () => {
    const { store } = await preparedReview();
    const request = chatRequest("Never mind this question.");
    await writeAgentRequest({ store, request });

    await deleteQueuedRequest({ store, requestId: request.requestId });

    await expect(
      readAgentExchange({ store, sessionId, planId }),
    ).resolves.toMatchObject({ requests: [] });
  });

  it("should refuse to delete a claimed request", async () => {
    const { store } = await preparedReview();
    const request = chatRequest("Never mind this question.");
    await writeAgentRequest({ store, request });
    await claimAgentRequest({
      store,
      requestId: request.requestId,
      baselineSnapshot: snapshot,
      now: "2026-08-10T12:00:01.000Z",
    });

    await expect(
      deleteQueuedRequest({ store, requestId: request.requestId }),
    ).rejects.toThrow(/already started/);
    const exchange = await readAgentExchange({ store, sessionId, planId });
    expect(exchange.requests).toHaveLength(1);
  });

  it("should either delete or refuse when a delete races pickup", async () => {
    const { store } = await preparedReview();
    const request = chatRequest("Never mind this question.");
    await writeAgentRequest({ store, request });

    const results = await Promise.allSettled([
      claimAgentRequest({
        store,
        requestId: request.requestId,
        baselineSnapshot: snapshot,
        now: "2026-08-10T12:00:01.000Z",
      }),
      deleteQueuedRequest({ store, requestId: request.requestId }),
    ]);

    const exchange = await readAgentExchange({ store, sessionId, planId });
    if (results[1].status === "fulfilled") {
      expect(exchange.requests).toHaveLength(0);
    } else {
      expect(exchange.requests[0]).toMatchObject({
        baselineSnapshot: snapshot,
      });
      expect(results[1].reason).toMatchObject({
        message: "The agent already started on this message",
      });
    }
  });

  it("should allocate unique progress sequences when writers overlap", async () => {
    const { store } = await preparedReview();
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        appendProgressEvent({
          store,
          event: {
            sessionId,
            requestId: packageId,
            atMs: 10_000 + index,
            stepCode: "agent-note",
            step: `Step ${index + 1}`,
            state: "live",
          },
        }),
      ),
    );

    const events = await readProgress({ store, sessionId });
    expect(events.map((event) => event.seq)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
  });

  it("should append one connection event for each real state edge", async () => {
    const { store } = await preparedReview();
    const state = (connected: boolean, at: string) =>
      recordAgentConnectionState({
        store,
        sessionId,
        connected,
        at,
        disconnectReason: "Heartbeat timed out",
      });

    await Promise.all([
      state(false, "2026-08-10T12:00:00.000Z"),
      state(false, "2026-08-10T12:00:00.000Z"),
    ]);
    await Promise.all([
      state(true, "2026-08-10T12:00:01.000Z"),
      state(true, "2026-08-10T12:00:01.000Z"),
    ]);
    await state(false, "2026-08-10T12:00:02.000Z");

    await expect(
      readAgentConnectionEvents({ store, sessionId }),
    ).resolves.toMatchObject([
      { connected: false },
      { connected: true },
      { connected: false, reason: "Heartbeat timed out" },
    ]);
  });
});

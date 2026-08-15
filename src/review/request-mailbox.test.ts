// Proves stored request mutations serialize safely across processes and
// request-lifecycle invariants reject contradictory review state.

import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type { ReviewComment } from "./shared/comment.js";
import {
  deriveSnapshotDigest,
  feedbackAgentRequest,
  messageAgentRequest,
  nextPendingAgentRequest,
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
  commitRequestTerminal,
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
import {
  buildReviewImageReference,
  reviewImageId,
  type ReviewImageAttachment,
} from "./shared/review-image.js";

const sessionId = "1111111111111111";
const planId = "2222222222222222";
const packageId = "3333333333333333";
const agentA = "aaaa0000aaaa0000";
const agentB = "bbbb1111bbbb1111";
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
  await claimAgentRequest({ ...common, claimedBy: process.env.BP_CLAIMED_BY, baselineSnapshot: "aaaaaaaaaaaaaaaa" });
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

const chatRequest = (
  body: string,
  attachments: ReadonlyArray<ReviewImageAttachment> = [],
) =>
  messageAgentRequest({
    kind: "chat",
    requestId: "6666666666666666",
    sessionId,
    planId,
    premiseSnapshot: snapshot,
    createdAt: "2026-08-10T12:00:00.000Z",
    body,
    attachments,
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
  claimedBy = agentA,
}: {
  readonly operation: "claim" | "cancel";
  readonly planPath: string;
  readonly requestId: string;
  readonly startAt: number;
  readonly now: string;
  readonly claimedBy?: string;
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
      BP_CLAIMED_BY: claimedBy,
    },
  });
};

describe("request mailbox", () => {
  it("should refuse a symlinked request mailbox before touching its lock", async () => {
    const { store } = await preparedReview();
    const request = chatRequest("Do not touch an outside lock.");
    const displacedDirectory = `${store.agentRequestDirectory}.displaced`;
    const outsideDirectory = join(store.planDirectory, "outside-requests");
    const outsideLockDirectory = join(
      outsideDirectory,
      `.${request.requestId}.lock`,
    );
    const sentinelPath = join(outsideLockDirectory, "sentinel.txt");
    await rename(store.agentRequestDirectory, displacedDirectory);
    await mkdir(outsideLockDirectory, { recursive: true });
    await writeFile(sentinelPath, "untouched\n");
    await symlink(outsideDirectory, store.agentRequestDirectory);

    try {
      await expect(
        claimAgentRequest({
          store,
          requestId: request.requestId,
          baselineSnapshot: snapshot,
          now: "2026-08-10T12:00:01.000Z",
        }),
      ).rejects.toMatchObject({
        name: "AgentExchangeRejected",
        message: "The request mailbox is unavailable",
      });
      await expect(readFile(sentinelPath, "utf8")).resolves.toBe("untouched\n");
      await expect(readdir(outsideLockDirectory)).resolves.toEqual([
        "sentinel.txt",
      ]);
    } finally {
      await rm(store.agentRequestDirectory, { force: true });
      await rename(displacedDirectory, store.agentRequestDirectory);
    }
  });

  it("should refuse a symlinked request lock before touching its target", async () => {
    const { store } = await preparedReview();
    const request = chatRequest("Do not touch the lock target.");
    await writeAgentRequest({ store, request });
    const outsideDirectory = join(store.planDirectory, "outside-lock");
    const sentinelPath = join(outsideDirectory, "sentinel.txt");
    const lockPath = join(
      store.agentRequestDirectory,
      `.${request.requestId}.lock`,
    );
    await mkdir(outsideDirectory);
    await writeFile(sentinelPath, "untouched\n");
    await symlink(outsideDirectory, lockPath);

    try {
      await expect(
        claimAgentRequest({
          store,
          requestId: request.requestId,
          baselineSnapshot: snapshot,
          now: "2026-08-10T12:00:01.000Z",
        }),
      ).rejects.toMatchObject({
        name: "AgentExchangeRejected",
        message: "The request mailbox is unavailable",
      });
      await expect(readFile(sentinelPath, "utf8")).resolves.toBe("untouched\n");
      await expect(readdir(outsideDirectory)).resolves.toEqual([
        "sentinel.txt",
      ]);
    } finally {
      await rm(lockPath, { force: true });
      await rm(outsideDirectory, { recursive: true, force: true });
    }
  });

  it("should refuse a symlinked response mailbox before publishing", async () => {
    const { store } = await preparedReview();
    const comment = reviewComment({
      id: "4444444444444444",
      body: "Keep the response inside the review store.",
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
    const displacedDirectory = `${store.agentResponseDirectory}.displaced`;
    const outsideDirectory = join(store.planDirectory, "outside-responses");
    const sentinelPath = join(outsideDirectory, "sentinel.txt");
    await rename(store.agentResponseDirectory, displacedDirectory);
    await mkdir(outsideDirectory);
    await writeFile(sentinelPath, "untouched\n");
    await symlink(outsideDirectory, store.agentResponseDirectory);

    try {
      await expect(
        commitRequestTerminal({
          store,
          response,
          claimedBy: agentA,
          now: "2026-08-10T12:00:02.500Z",
        }),
      ).rejects.toMatchObject({
        name: "AgentExchangeRejected",
        message: "The request mailbox is unavailable",
      });
      await expect(readFile(sentinelPath, "utf8")).resolves.toBe("untouched\n");
      await expect(readdir(outsideDirectory)).resolves.toEqual([
        "sentinel.txt",
      ]);
    } finally {
      await rm(store.agentResponseDirectory, { force: true });
      await rename(displacedDirectory, store.agentResponseDirectory);
    }
  });

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

  it("should refuse a second session's claim on a leased request", async () => {
    const { store } = await preparedReview();
    const request = requestWith([
      reviewComment({ id: "4444444444444444", body: "Only one agent." }),
    ]);
    await writeAgentRequest({ store, request });
    await claimAgentRequest({
      store,
      requestId: request.requestId,
      claimedBy: agentA,
      baselineSnapshot: snapshot,
      now: "2026-08-10T12:00:00.000Z",
    });

    await expect(
      claimAgentRequest({
        store,
        requestId: request.requestId,
        claimedBy: agentB,
        baselineSnapshot: snapshot,
        // Well inside the lease agent A just took.
        now: "2026-08-10T12:00:10.000Z",
      }),
    ).rejects.toThrow(/Another agent session is working on this request/);

    const exchange = await readAgentExchange({ store, sessionId, planId });
    expect(exchange.requests[0]).toMatchObject({ claimedBy: agentA });
  });

  it("should let the same session refresh its own claim", async () => {
    const { store } = await preparedReview();
    const request = requestWith([
      reviewComment({ id: "4444444444444444", body: "Keep working." }),
    ]);
    await writeAgentRequest({ store, request });
    const claimed = await claimAgentRequest({
      store,
      requestId: request.requestId,
      claimedBy: agentA,
      baselineSnapshot: snapshot,
      now: "2026-08-10T12:00:00.000Z",
    });

    const renewed = await claimAgentRequest({
      store,
      requestId: request.requestId,
      claimedBy: agentA,
      // A renewal must never move the frozen baseline, even when the caller
      // offers a newer one, or the request's diff would lose the work so far.
      baselineSnapshot: deriveSnapshotDigest("# Plan\n\nRewritten.\n"),
      now: "2026-08-10T12:00:30.000Z",
    });

    expect(renewed).toMatchObject({
      claimedBy: agentA,
      claimedAt: claimed.claimedAt,
      baselineSnapshot: claimed.baselineSnapshot,
    });
    expect(renewed.claimExpiresAtMs).toBeGreaterThan(
      claimed.claimExpiresAtMs ?? 0,
    );
  });

  it("should let a new session take an expired claim", async () => {
    const { store } = await preparedReview();
    const request = requestWith([
      reviewComment({ id: "4444444444444444", body: "The first agent died." }),
    ]);
    await writeAgentRequest({ store, request });
    await claimAgentRequest({
      store,
      requestId: request.requestId,
      claimedBy: agentA,
      baselineSnapshot: snapshot,
      now: "2026-08-10T12:00:00.000Z",
    });

    const takenOver = await claimAgentRequest({
      store,
      requestId: request.requestId,
      claimedBy: agentB,
      baselineSnapshot: snapshot,
      // Past the 75-second lease the reviewer has already been shown as stalled.
      now: "2026-08-10T12:01:20.000Z",
    });

    expect(takenOver).toMatchObject({
      claimedBy: agentB,
      claimedAt: "2026-08-10T12:01:20.000Z",
    });
    const events = await readProgress({ store, sessionId });
    expect(events.map((event) => event.stepCode)).toContain(
      "request-reclaimed",
    );
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
      claimedBy: agentA,
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
      commitRequestTerminal({
        store,
        response,
        claimedBy: agentA,
        now: "2026-08-10T12:00:02.500Z",
      }),
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

  it("should mark a request terminal in the same commit as its response", async () => {
    const { store } = await preparedReview();
    const comment = reviewComment({
      id: "4444444444444444",
      body: "Answer this once.",
    });
    const request = requestWith([comment]);
    await writeAgentRequest({ store, request });
    const claimed = await claimAgentRequest({
      store,
      requestId: request.requestId,
      claimedBy: agentA,
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

    await commitRequestTerminal({
      store,
      response,
      claimedBy: agentA,
      now: "2026-08-10T12:00:02.500Z",
    });

    const exchange = await readAgentExchange({ store, sessionId, planId });
    expect(exchange.requests[0]).toMatchObject({
      answeredAt: "2026-08-10T12:00:02.500Z",
    });
    expect(exchange.responses).toHaveLength(1);
    expect(
      nextPendingAgentRequest(exchange, {
        claimedBy: agentA,
        nowMs: Date.parse("2026-08-10T12:00:03.000Z"),
      }),
    ).toBeUndefined();
    await expect(
      commitRequestTerminal({
        store,
        response,
        claimedBy: agentA,
        now: "2026-08-10T12:00:04.000Z",
      }),
    ).rejects.toThrow(/already answered/);
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

    await expect(
      commitRequestTerminal({
        store,
        response,
        claimedBy: agentA,
        now: "2026-08-10T12:00:02.500Z",
      }),
    ).rejects.toThrow(/must be claimed/);
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
      claimedBy: agentA,
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

    await commitRequestTerminal({
      store,
      response,
      claimedBy: agentA,
      now: "2026-08-10T12:00:02.500Z",
    });
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
        claimedBy: agentA,
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
      claimedBy: agentA,
      baselineSnapshot: snapshot,
      now: "2026-08-10T12:00:01.000Z",
    });
    await commitRequestTerminal({
      store,
      claimedBy: agentA,
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
      now: "2026-08-10T12:00:02.500Z",
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

  it("should derive active attachments from every queued revision", async () => {
    const { store } = await preparedReview();
    const keptId = reviewImageId("a".repeat(64));
    const droppedId = reviewImageId("b".repeat(64));
    const neverFrozenId = reviewImageId("c".repeat(64));
    const attachment = (
      id: typeof keptId,
      alt: string,
    ): ReviewImageAttachment => ({
      id,
      sha256: id,
      alt,
      mimeType: "image/png",
      byteLength: 1,
      width: 1,
      height: 1,
      path: join(
        store.requestAttachmentsDirectory,
        "6666666666666666",
        `image-${id}.png`,
      ),
    });
    const kept = attachment(keptId, "Old retry graph");
    const dropped = attachment(droppedId, "Timeout graph");
    const request = chatRequest(
      [
        buildReviewImageReference({ alt: kept.alt, id: keptId }),
        buildReviewImageReference({ alt: dropped.alt, id: droppedId }),
      ].join("\n"),
      [kept, dropped],
    );
    await writeAgentRequest({ store, request });

    const revised = await reviseQueuedRequest({
      store,
      requestId: request.requestId,
      body: [
        buildReviewImageReference({
          alt: "Updated retry graph",
          id: keptId,
        }),
        buildReviewImageReference({
          alt: "Ignored duplicate graph",
          id: keptId,
        }),
      ].join("\n"),
    });

    expect(revised.attachments).toEqual([
      { ...kept, alt: "Updated retry graph" },
    ]);
    const restored = await reviseQueuedRequest({
      store,
      requestId: request.requestId,
      body: buildReviewImageReference({
        alt: "Restored timeout graph",
        id: droppedId,
      }),
    });

    expect(restored.attachments).toEqual([
      { ...dropped, alt: "Restored timeout graph" },
    ]);
    expect(restored.attachmentManifest).toEqual([kept, dropped]);
    await expect(
      reviseQueuedRequest({
        store,
        requestId: request.requestId,
        body: buildReviewImageReference({
          alt: "New graph",
          id: neverFrozenId,
        }),
      }),
    ).rejects.toThrow(/cannot gain a new image/);
    const exchange = await readAgentExchange({ store, sessionId, planId });
    expect(exchange.requests[0]?.attachments).toEqual(restored.attachments);
    expect(exchange.requests[0]?.attachmentManifest).toEqual([kept, dropped]);
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

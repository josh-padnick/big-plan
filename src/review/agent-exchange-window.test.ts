// The exchange read paths used to read every response file on disk before
// deciding which ones the caller would keep, on routes the browser polls
// (BIG-44). These tests hold them to reading only what they keep, and to
// keeping every request that could still be outstanding.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const counters = vi.hoisted(() => ({
  responseReads: [] as Array<string>,
  revisionReads: [] as Array<string>,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      const [path] = args;
      if (typeof path === "string" && path.includes("/agent/responses/")) {
        counters.responseReads.push(path);
      }
      if (typeof path === "string" && path.includes("/committed-revisions/")) {
        counters.revisionReads.push(path);
      }
      return actual.readFile(...args);
    },
  };
});

const { prepareStore, reviewStoreFor, writeAgentResponseValue } =
  await import("./store.js");
const {
  commentsFromExchange,
  feedbackAgentRequest,
  messageAgentRequest,
  outstandingAgentRequests,
  readAgentCommentHistory,
  readAgentExchange,
  validateAgentRequest,
  validateAgentResponseDraft,
  writeAgentRequest,
} = await import("./agent-exchange.js");
const { buildFeedbackPackage } = await import("./feedback-package.js");
const { claimAgentRequest, commitRequestTerminal } =
  await import("./request-mailbox.js");
const { AGENT_CLAIM_LEASE_MS } = await import("./shared/agent-claim.js");
const { recordCommittedRevision } = await import("./change-set-commit.js");
const { createReaderProgress } = await import("./review-route-context.js");
const { readAgentSnapshot } = await import("./routes-agent-exchange.js");
type ReviewRouteContext = Parameters<typeof readAgentSnapshot>[0];

const SESSION = "a".repeat(16);
const PLAN_ID = "0123456789abcdef";
const SNAPSHOT = "f".repeat(16);

const directories: Array<string> = [];

afterEach(async () => {
  counters.responseReads = [];
  counters.revisionReads = [];
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const temporaryStore = async () => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-exchange-window-"));
  directories.push(directory);
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, "# Plan\n");
  const store = reviewStoreFor({ planPath, planId: PLAN_ID });
  await prepareStore(store);
  return store;
};

const requestId = (index: number): string =>
  index.toString(16).padStart(16, "0");

/** Sends one feedback package carrying one comment, as the runtime does. */
const sendFeedback = async ({
  store,
  index,
  commentId,
}: {
  readonly store: Awaited<ReturnType<typeof temporaryStore>>;
  readonly index: number;
  readonly commentId: string;
}): Promise<string> => {
  const id = requestId(index);
  const createdAt = new Date(1_800_000_000_000 + index * 1_000).toISOString();
  await writeAgentRequest({
    store,
    request: feedbackAgentRequest({
      feedback: buildFeedbackPackage({
        sessionId: SESSION,
        packageId: id,
        planId: PLAN_ID,
        planPath: "/tmp/plan.mdx",
        createdAt,
        comments: [
          {
            id: commentId,
            body: `Question ${index}`,
            createdAt,
            premiseSnapshot: SNAPSHOT,
            target: { type: "document" },
          },
        ],
      }),
      premiseSnapshot: SNAPSHOT,
    }),
  });
  return id;
};

const answer = async ({
  store,
  id,
  commentId,
}: {
  readonly store: Awaited<ReturnType<typeof temporaryStore>>;
  readonly id: string;
  readonly commentId: string;
}): Promise<void> => {
  const claimMs = 1_800_000_500_000;
  const answerMs = claimMs + 1_000;
  const claimed = await claimAgentRequest({
    store,
    activeSessionId: SESSION,
    requestId: id,
    claimedBy: SESSION,
    baselineSnapshot: SNAPSHOT,
    now: new Date(claimMs).toISOString(),
    clock: () => claimMs,
  });
  const exchange = await readAgentExchange({
    store,
    sessionId: SESSION,
    planId: PLAN_ID,
  });
  await commitRequestTerminal({
    store,
    response: validateAgentResponseDraft({
      value: {
        requestId: id,
        outcomes: [
          { commentId, state: "answered", message: `Answer for ${id}` },
        ],
      },
      request: claimed,
      commentsById: commentsFromExchange(exchange),
      changedBlocks: new Set<string>(),
      currentSnapshot: SNAPSHOT,
      now: new Date(answerMs).toISOString(),
    }),
    claimedBy: SESSION,
    now: new Date(answerMs).toISOString(),
    clock: () => answerMs,
  });
};

const answeredChat = async ({
  store,
  index,
}: {
  readonly store: Awaited<ReturnType<typeof temporaryStore>>;
  readonly index: number;
}): Promise<string> => {
  const id = requestId(index);
  const createdAtMs = 1_800_000_000_000 + index * 1_000;
  const answeredAtMs = createdAtMs + 1_000;
  const createdAt = new Date(createdAtMs).toISOString();
  const request = {
    ...messageAgentRequest({
      kind: "chat",
      requestId: id,
      sessionId: SESSION,
      planId: PLAN_ID,
      premiseSnapshot: SNAPSHOT,
      createdAt,
      body: `Question ${index}`,
    }),
    baselineSnapshot: SNAPSHOT,
    claimedAt: createdAt,
    claimedBy: SESSION,
    claimExpiresAtMs: createdAtMs + AGENT_CLAIM_LEASE_MS,
    claimGeneration: 1,
    answeredAt: new Date(answeredAtMs).toISOString(),
  };
  await writeAgentResponseValue({
    store,
    requestId: id,
    value: validateAgentResponseDraft({
      value: { requestId: id, message: `Answer ${index}` },
      request,
      commentsById: new Map(),
      changedBlocks: new Set(),
      currentSnapshot: SNAPSHOT,
      now: new Date(answeredAtMs).toISOString(),
    }),
  });
  await writeAgentRequest({ store, request });
  return id;
};

const canceledPush = async ({
  store,
  index,
  threadId,
  origin,
  body,
}: {
  readonly store: Awaited<ReturnType<typeof temporaryStore>>;
  readonly index: number;
  readonly threadId: string;
  readonly origin: "prompt" | "about";
  readonly body: string;
}): Promise<string> => {
  const id = requestId(index);
  const createdAt = new Date(1_800_000_000_000 + index * 1_000).toISOString();
  await writeAgentRequest({
    store,
    request: validateAgentRequest({
      version: 3,
      requestId: id,
      sessionId: SESSION,
      planId: PLAN_ID,
      premiseSnapshot: SNAPSHOT,
      createdAt,
      attachmentManifest: [],
      attachments: [],
      kind: "push",
      origin,
      body,
      threadId,
      canceledAt: createdAt,
    }),
  });
  return id;
};

describe("the agent exchange read window", () => {
  it("should read only the responses of the comment it was asked about", async () => {
    const store = await temporaryStore();
    const mine = await sendFeedback({ store, index: 1, commentId: "c0ffee01" });
    await answer({ store, id: mine, commentId: "c0ffee01" });
    for (const index of [2, 3, 4]) {
      const other = await sendFeedback({
        store,
        index,
        commentId: "c0ffee99",
      });
      await answer({ store, id: other, commentId: "c0ffee99" });
    }

    counters.responseReads = [];
    const history = await readAgentCommentHistory({
      store,
      sessionId: SESSION,
      planId: PLAN_ID,
      commentId: "c0ffee01",
    });

    expect(history.responses.map((response) => response.requestId)).toEqual([
      mine,
    ]);
    // Four responses exist; the other three belong to another comment and this
    // question never needed them.
    expect(counters.responseReads).toHaveLength(1);
    expect(counters.responseReads.at(0)).toContain(mine);
  });

  it("should keep an unanswered request outstanding however many answers follow it", async () => {
    const store = await temporaryStore();
    const forgotten = await sendFeedback({
      store,
      index: 1,
      commentId: "c0ffee01",
    });
    for (const index of [2, 3, 4]) {
      const answered = await sendFeedback({
        store,
        index,
        commentId: "c0ffee02",
      });
      await answer({ store, id: answered, commentId: "c0ffee02" });
    }

    const snapshot = await readAgentExchange({
      store,
      sessionId: SESSION,
      planId: PLAN_ID,
    });

    expect(
      outstandingAgentRequests(snapshot).map((request) => request.requestId),
    ).toEqual([forgotten]);
    expect(snapshot.responses).toHaveLength(3);
  });

  it("should not resurrect an answered request outside the response window", async () => {
    const store = await temporaryStore();
    const answered: Array<string> = [];
    for (let index = 1; index <= 401; index += 1) {
      answered.push(await answeredChat({ store, index }));
    }

    counters.responseReads = [];
    const snapshot = await readAgentExchange({
      store,
      sessionId: SESSION,
      planId: PLAN_ID,
    });

    expect(snapshot.requests.map((request) => request.requestId)).toEqual(
      answered.slice(-400),
    );
    expect(snapshot.responses.map((response) => response.requestId)).toEqual(
      answered.slice(-400),
    );
    expect(outstandingAgentRequests(snapshot)).toEqual([]);
    expect(counters.responseReads).toHaveLength(400);
  });

  it("should not read a response whose request the snapshot never keeps", async () => {
    const store = await temporaryStore();
    const answered = await sendFeedback({
      store,
      index: 1,
      commentId: "c0ffee01",
    });
    await answer({ store, id: answered, commentId: "c0ffee01" });
    // A response file left behind by a request that is no longer on disk: the
    // exchange has no reason to open it, before or after this change.
    await writeFile(
      join(store.agentResponseDirectory, `${requestId(99)}.json`),
      "{}\n",
    );

    counters.responseReads = [];
    const snapshot = await readAgentExchange({
      store,
      sessionId: SESSION,
      planId: PLAN_ID,
    });

    expect(snapshot.responses).toHaveLength(1);
    expect(counters.responseReads).toHaveLength(1);
  });

  it("should retain a pushed thread opener outside the terminal window", async () => {
    const store = await temporaryStore();
    const threadId = requestId(1);
    const opener = await canceledPush({
      store,
      index: 1,
      threadId,
      origin: "about",
      body: "Canonical opener",
    });
    for (let index = 2; index <= 401; index += 1) {
      await answeredChat({ store, index });
    }
    const continuation = await canceledPush({
      store,
      index: 402,
      threadId,
      origin: "prompt",
      body: "Retained continuation",
    });

    const snapshot = await readAgentExchange({
      store,
      sessionId: SESSION,
      planId: PLAN_ID,
    });

    expect(snapshot.requests[0]?.requestId).toBe(opener);
    expect(snapshot.requests.at(-1)?.requestId).toBe(continuation);
    expect(
      snapshot.requests.filter(
        (request) => request.kind === "push" && request.threadId === threadId,
      ),
    ).toMatchObject([
      { requestId: opener, origin: "about", body: "Canonical opener" },
      {
        requestId: continuation,
        origin: "prompt",
        body: "Retained continuation",
      },
    ]);
  });
});

/**
 * The browser polls the exchange for the life of the review, and the committed
 * revision log grows by one file per answered request and is never pruned. It
 * is the same directory-shaped hazard as the response window, so it is held to
 * the same rule: read only what the reader can act on right now.
 */
describe("the polled agent snapshot", () => {
  const revisionAt = ({
    index,
    resultSnapshot,
    committedAt,
  }: {
    readonly index: number;
    readonly resultSnapshot: string;
    readonly committedAt: string;
  }) => ({
    requestId: requestId(index),
    changeSetIds: [requestId(index)],
    baseSnapshot: SNAPSHOT,
    resultSnapshot,
    provenance: "chat" as const,
    committedAt,
  });

  /** One request the exchange reports as answered, and the revision it published. */
  const publishedRevision = async ({
    store,
    index,
    resultSnapshot,
    committedAt,
  }: {
    readonly store: Awaited<ReturnType<typeof temporaryStore>>;
    readonly index: number;
    readonly resultSnapshot: string;
    readonly committedAt: string;
  }): Promise<void> => {
    await answeredChat({ store, index });
    await recordCommittedRevision({
      store,
      revision: revisionAt({ index, resultSnapshot, committedAt }),
    });
  };

  // Only the fields the polled read touches; the rest of the runtime's shared
  // state has no part in what this route reads from disk.
  const pollContext = ({
    store,
    readerProgress,
  }: {
    readonly store: Awaited<ReturnType<typeof temporaryStore>>;
    readonly readerProgress: ReturnType<typeof createReaderProgress>;
  }): ReviewRouteContext =>
    ({
      store,
      planId: PLAN_ID,
      sessionId: SESSION,
      resolvedPlanPath: "/tmp/plan.mdx",
      agentCommand: "big-plan agent next /tmp/plan.mdx",
      recoveryPrompt: "",
      readerProgress,
    }) as unknown as ReviewRouteContext;

  const currentSnapshotOf = (response: { readonly value: unknown }): unknown =>
    (response.value as { readonly currentSnapshot: unknown }).currentSnapshot;

  const freshProgress = () =>
    createReaderProgress({
      initialSnapshot: SNAPSHOT,
      observedResponseIds: [],
    });

  it("should not read a committed revision it has already moved the reader onto", async () => {
    const store = await temporaryStore();
    const published = "b".repeat(16);
    await publishedRevision({
      store,
      index: 1,
      resultSnapshot: published,
      committedAt: "2026-08-17T12:00:00.000Z",
    });
    const context = pollContext({ store, readerProgress: freshProgress() });

    counters.revisionReads = [];
    expect(currentSnapshotOf(await readAgentSnapshot(context))).toBe(published);
    expect(counters.revisionReads).toHaveLength(1);

    counters.revisionReads = [];
    expect(currentSnapshotOf(await readAgentSnapshot(context))).toBe(published);
    expect(counters.revisionReads).toEqual([]);
  });

  it("should still read a revision published since the last poll", async () => {
    const store = await temporaryStore();
    const first = "b".repeat(16);
    await publishedRevision({
      store,
      index: 1,
      resultSnapshot: first,
      committedAt: "2026-08-17T12:00:00.000Z",
    });
    const context = pollContext({ store, readerProgress: freshProgress() });
    await readAgentSnapshot(context);

    const second = "c".repeat(16);
    await publishedRevision({
      store,
      index: 2,
      resultSnapshot: second,
      committedAt: "2026-08-17T12:00:10.000Z",
    });

    counters.revisionReads = [];
    expect(currentSnapshotOf(await readAgentSnapshot(context))).toBe(second);
    expect(counters.revisionReads).toHaveLength(1);
  });

  it("should read nothing at all from a log the runtime seeded it with", async () => {
    const store = await temporaryStore();
    await publishedRevision({
      store,
      index: 1,
      resultSnapshot: "b".repeat(16),
      committedAt: "2026-08-17T12:00:00.000Z",
    });
    const context = pollContext({
      store,
      // What `startReviewRuntime` builds: the revisions already on disk are
      // history the reader opened on, never revisions to be moved onto.
      readerProgress: createReaderProgress({
        initialSnapshot: SNAPSHOT,
        observedResponseIds: [requestId(1)],
      }),
    });

    counters.revisionReads = [];
    expect(currentSnapshotOf(await readAgentSnapshot(context))).toBe(SNAPSHOT);
    expect(counters.revisionReads).toEqual([]);
  });

  it("should defer a revision the same payload still calls pending", async () => {
    const store = await temporaryStore();
    const published = "b".repeat(16);
    // The commit records its revision before it marks the request answered, so
    // a poll can land between the two. Sending the new snapshot now would hand
    // the browser an article whose response is absent from the same payload.
    await writeAgentRequest({
      store,
      request: messageAgentRequest({
        kind: "chat",
        requestId: requestId(1),
        sessionId: SESSION,
        planId: PLAN_ID,
        premiseSnapshot: SNAPSHOT,
        createdAt: "2026-08-17T11:59:00.000Z",
        body: "Question 1",
      }),
    });
    await recordCommittedRevision({
      store,
      revision: revisionAt({
        index: 1,
        resultSnapshot: published,
        committedAt: "2026-08-17T12:00:00.000Z",
      }),
    });
    const context = pollContext({ store, readerProgress: freshProgress() });

    counters.revisionReads = [];
    expect(currentSnapshotOf(await readAgentSnapshot(context))).toBe(SNAPSHOT);
    expect(counters.revisionReads).toEqual([]);

    // The commit finishes, and the very next poll moves the reader.
    await answeredChat({ store, index: 1 });
    expect(currentSnapshotOf(await readAgentSnapshot(context))).toBe(published);
  });
});

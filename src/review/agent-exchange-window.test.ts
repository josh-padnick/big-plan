// The exchange read paths used to read every response file on disk before
// deciding which ones the caller would keep, on routes the browser polls
// (BIG-44). These tests hold them to reading only what they keep, and to
// keeping every request that could still be outstanding.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const counters = vi.hoisted(() => ({ responseReads: [] as Array<string> }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      const [path] = args;
      if (typeof path === "string" && path.includes("/agent/responses/")) {
        counters.responseReads.push(path);
      }
      return actual.readFile(...args);
    },
  };
});

const { prepareStore, reviewStoreFor } = await import("./store.js");
const {
  commentsFromExchange,
  feedbackAgentRequest,
  outstandingAgentRequests,
  readAgentCommentHistory,
  readAgentExchange,
  validateAgentResponseDraft,
  writeAgentRequest,
} = await import("./agent-exchange.js");
const { buildFeedbackPackage } = await import("./feedback-package.js");
const { claimAgentRequest, publishAgentResponse } =
  await import("./request-mailbox.js");

const SESSION = "a".repeat(16);
const PLAN_ID = "0123456789abcdef";
const SNAPSHOT = "f".repeat(16);

const directories: Array<string> = [];

afterEach(async () => {
  counters.responseReads = [];
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
  const claimed = await claimAgentRequest({
    store,
    requestId: id,
    baselineSnapshot: SNAPSHOT,
    now: new Date(1_800_000_500_000).toISOString(),
  });
  const exchange = await readAgentExchange({
    store,
    sessionId: SESSION,
    planId: PLAN_ID,
  });
  await publishAgentResponse({
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
      now: new Date(1_800_000_600_000).toISOString(),
    }),
  });
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
});

// Covers the coding-agent exchange through its public seam: real feedback and
// replies become pending work, and only complete source-consistent responses
// can become viewer state.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_CLAIM_LEASE_MS } from "./shared/agent-claim.js";
import type { ReviewComment } from "./shared/comment.js";
import { projectCommentThread } from "./shared/thread-projection.js";
import {
  AgentExchangeRejected,
  approvalAgentRequest,
  commentsFromExchange,
  deriveSnapshotDigest,
  feedbackAgentRequest,
  messageAgentRequest,
  nextPendingAgentRequest,
  readAgentExchange,
  requestBaselineSnapshot,
  responseTemplateFor,
  validateAgentResponseDraft,
  validateAgentRequest,
  writeAgentRequest,
} from "./agent-exchange.js";
import type { AgentExchangeSnapshot } from "./agent-exchange.js";
import { buildFeedbackPackage } from "./feedback-package.js";
import { readCommittedRevision } from "./change-set-commit.js";
import {
  cancelAgentRequest,
  claimAgentRequest,
  commitRequestTerminal,
} from "./request-mailbox.js";
import { prepareStore, reviewStoreFor } from "./store.js";

const sessionId = "1111111111111111";
const planId = "2222222222222222";
const packageId = "3333333333333333";
const agentSessionId = "aaaa0000aaaa0000";
// The agent asking what to work next, at a time when nothing else holds a lease.
const viewer = () => ({ claimedBy: agentSessionId, nowMs: Date.now() });
const commentId = "4444444444444444";
const blockId = "section/approach/paragraph-1";
const before = "# Plan\n\n## Approach\n\nKeep the first version.\n";
const after = "# Plan\n\n## Approach\n\nUse the revised version.\n";

const comment: ReviewComment = {
  id: commentId,
  body: "Use the revised version.",
  createdAt: "2026-08-02T12:00:00.000Z",
  premiseSnapshot: deriveSnapshotDigest(before),
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
  premiseSnapshot: deriveSnapshotDigest(before),
});

// A response answers a claim, so drafting one needs the claim it answers for.
const claimedRequest = validateAgentRequest({
  ...request,
  baselineSnapshot: deriveSnapshotDigest(before),
  claimedAt: "2026-08-02T12:00:30.000Z",
  claimedBy: "cccc0000cccc0000",
  claimExpiresAtMs: 1_775_000_000_000,
  claimGeneration: 1,
});

const snapshot = (): AgentExchangeSnapshot => ({
  requests: [request],
  responses: [],
});

const pushRequest = ({
  requestId = "5555555555555555",
  threadId = "5555555555555555",
  origin = "about",
  body = "Tightened the retry boundary.",
}: {
  readonly requestId?: string;
  readonly threadId?: string;
  readonly origin?: "prompt" | "about";
  readonly body?: string;
} = {}) =>
  validateAgentRequest({
    version: 3,
    requestId,
    sessionId,
    planId,
    premiseSnapshot: deriveSnapshotDigest(before),
    createdAt: "2026-08-02T12:00:00.000Z",
    attachmentManifest: [],
    attachments: [],
    kind: "push",
    origin,
    body,
    threadId,
  });

describe("agent exchange response contract", () => {
  it.each(["prompt", "about"] as const)(
    "should validate a push opened with %s origin",
    (origin) => {
      expect(pushRequest({ origin })).toMatchObject({
        kind: "push",
        origin,
        threadId: "5555555555555555",
      });
    },
  );

  it.each([
    ["unknown origin", { origin: "invented" }, /origin/],
    ["empty body", { body: "   " }, /body.*empty/],
    ["malformed thread id", { threadId: "thread" }, /threadId/],
    [
      "attachments",
      {
        attachmentManifest: [
          {
            id: "a".repeat(64),
            sha256: "a".repeat(64),
            mimeType: "image/png",
            byteLength: 1,
            width: 1,
            height: 1,
            path: "/tmp/.big-plan/review/plan/agent/attachments/image.png",
            alt: "Evidence",
          },
        ],
        attachments: [
          {
            id: "a".repeat(64),
            sha256: "a".repeat(64),
            mimeType: "image/png",
            byteLength: 1,
            width: 1,
            height: 1,
            path: "/tmp/.big-plan/review/plan/agent/attachments/image.png",
            alt: "Evidence",
          },
        ],
      },
      /cannot contain attachments/,
    ],
  ])("should reject a push with %s", (_name, override, message) => {
    expect(() =>
      validateAgentRequest({ ...pushRequest(), ...override }),
    ).toThrow(message);
  });

  it("should validate one thread outcome and prefill its response template for a push", () => {
    const claimed = validateAgentRequest({
      ...pushRequest(),
      baselineSnapshot: deriveSnapshotDigest(before),
      claimedAt: "2026-08-02T12:00:30.000Z",
      claimedBy: "cccc0000cccc0000",
      claimExpiresAtMs: 1_775_000_000_000,
      claimGeneration: 1,
    });
    expect(responseTemplateFor(claimed)).toMatchObject({
      requestId: claimed.requestId,
      outcomes: [{ commentId: claimed.threadId, state: "changed" }],
    });
    expect(
      validateAgentResponseDraft({
        value: {
          requestId: claimed.requestId,
          outcomes: [
            {
              commentId: claimed.threadId,
              state: "answered",
              message: "No plan revision remained to publish.",
            },
          ],
        },
        request: claimed,
        commentsById: commentsFromExchange({
          requests: [claimed],
          responses: [],
        }),
        changedBlocks: new Set(),
        currentSnapshot: claimed.premiseSnapshot,
        now: "2026-08-02T12:01:00.000Z",
      }),
    ).toMatchObject({
      kind: "push",
      outcomes: [{ commentId: claimed.threadId, state: "answered" }],
    });
  });

  it.each([
    ["answered", {}],
    ["warning", { summary: "Would cross a review boundary" }],
    ["needs-input", {}],
    ["declined", {}],
  ] as const)(
    "should refuse a plan revision from a push settled as %s",
    (state, extra) => {
      const claimed = validateAgentRequest({
        ...pushRequest(),
        baselineSnapshot: deriveSnapshotDigest(before),
        claimedAt: "2026-08-02T12:00:30.000Z",
        claimedBy: "cccc0000cccc0000",
        claimExpiresAtMs: 1_775_000_000_000,
        claimGeneration: 1,
      });
      expect(() =>
        validateAgentResponseDraft({
          value: {
            requestId: claimed.requestId,
            outcomes: [
              {
                commentId: claimed.threadId,
                state,
                message: "No plan revision should be published.",
                ...extra,
              },
            ],
          },
          request: claimed,
          commentsById: commentsFromExchange({
            requests: [claimed],
            responses: [],
          }),
          changedBlocks: new Set(),
          currentSnapshot: deriveSnapshotDigest(after),
          now: "2026-08-02T12:01:00.000Z",
        }),
      ).toThrow(
        'A push with no "changed" outcome cannot revise the plan source',
      );
    },
  );

  it("should require one outcome for every comment in a feedback request", () => {
    expect(() =>
      validateAgentResponseDraft({
        value: { requestId: packageId, outcomes: [] },
        request: claimedRequest,
        commentsById: new Map([[commentId, comment]]),
        changedBlocks: new Set([blockId]),
        currentSnapshot: deriveSnapshotDigest(after),
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
        request: claimedRequest,
        commentsById: new Map([[commentId, comment]]),
        changedBlocks: new Set([blockId]),
        currentSnapshot: deriveSnapshotDigest(before),
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
        request: claimedRequest,
        commentsById: new Map([[commentId, comment]]),
        changedBlocks: new Set([blockId]),
        currentSnapshot: deriveSnapshotDigest(after),
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
        request: claimedRequest,
        commentsById: new Map([[commentId, comment]]),
        changedBlocks: new Set([blockId]),
        currentSnapshot: deriveSnapshotDigest(after),
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
        request: claimedRequest,
        commentsById: new Map([[commentId, comment]]),
        changedBlocks: new Set([blockId, secondBlock]),
        currentSnapshot: deriveSnapshotDigest(after),
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
      premiseSnapshot: deriveSnapshotDigest(after),
      createdAt: "2026-08-02T12:02:00.000Z",
      body: "Keep the shorter wording.",
      commentId,
    });
    expect(
      nextPendingAgentRequest(
        {
          // The first request carries its own terminal mark. A reader never
          // infers that from the response beside it.
          requests: [
            {
              ...request,
              baselineSnapshot: request.premiseSnapshot,
              claimedAt: "2026-08-02T12:00:30.000Z",
              claimedBy: agentSessionId,
              claimExpiresAtMs: 1_775_000_000_000,
              claimGeneration: 1,
              answeredAt: "2026-08-02T12:01:00.000Z",
            },
            reply,
          ],
          responses: [
            {
              version: 2,
              requestId: packageId,
              sessionId,
              planId,
              resultSnapshot: deriveSnapshotDigest(after),
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
        },
        viewer(),
      ),
    ).toEqual(reply);
  });

  it("should keep queued work unavailable while another claim is live", () => {
    const nowMs = Date.parse("2026-08-02T12:00:30.000Z");
    const active = validateAgentRequest({
      ...messageAgentRequest({
        kind: "chat",
        requestId: "5555555555555555",
        sessionId,
        planId,
        premiseSnapshot: deriveSnapshotDigest(before),
        createdAt: "2026-08-02T11:59:00.000Z",
        body: "What is already being handled?",
      }),
      baselineSnapshot: deriveSnapshotDigest(before),
      claimedAt: new Date(nowMs).toISOString(),
      claimedBy: "bbbb0000bbbb0000",
      claimExpiresAtMs: nowMs + AGENT_CLAIM_LEASE_MS,
      claimGeneration: 1,
    });
    const exchange = { requests: [active, request], responses: [] };

    expect(
      projectCommentThread({
        comment,
        ...exchange,
        progressEvents: [],
        presence: { connected: true, state: "working" },
        runtime: "online",
        nowMs,
        cancelPendingRequestIds: new Set(),
      }).latestStatus,
    ).toMatchObject({
      stage: "waiting",
      headline: "Waiting for an agent",
    });
    expect(
      nextPendingAgentRequest(exchange, {
        claimedBy: "cccc0000cccc0000",
        nowMs,
      }),
    ).toBeUndefined();
    // Cancellation is terminal: the commit boundary refuses a canceled
    // request, so its holder cannot reach the plan and the queue advances at
    // once rather than waiting out the lease (BIG-159).
    expect(
      nextPendingAgentRequest(
        {
          requests: [
            { ...active, canceledAt: "2026-08-02T12:00:31.000Z" },
            request,
          ],
          responses: [],
        },
        { claimedBy: "cccc0000cccc0000", nowMs },
      ),
    ).toBe(request);
    expect(
      nextPendingAgentRequest(
        {
          requests: [
            { ...active, answeredAt: "2026-08-02T12:00:31.000Z" },
            request,
          ],
          responses: [],
        },
        { claimedBy: "cccc0000cccc0000", nowMs },
      ),
    ).toBe(request);
  });

  it("should reject an answered request without a complete claim", () => {
    expect(() =>
      validateAgentRequest({
        ...request,
        answeredAt: "2026-08-02T12:01:00.000Z",
      }),
    ).toThrow(/answered request must carry a complete claim/);
  });

  it("should reject claim model identity without a complete claim", () => {
    expect(() =>
      validateAgentRequest({
        ...request,
        claimedModel: { name: "Grok 4.6" },
      }),
    ).toThrow(/claimedModel.*complete claim/);
  });

  it("should collect original comments as reply validation context", () => {
    expect(commentsFromExchange(snapshot()).get(commentId)).toEqual(comment);
  });

  it("should reject a warning when its scannable summary is missing", () => {
    expect(() =>
      validateAgentResponseDraft({
        value: {
          requestId: packageId,
          outcomes: [
            {
              commentId,
              state: "warning",
              message: "This request would cross the standard template.",
            },
          ],
        },
        request: claimedRequest,
        commentsById: new Map([[commentId, comment]]),
        changedBlocks: new Set(),
        currentSnapshot: request.premiseSnapshot,
        now: "2026-08-02T12:01:00.000Z",
      }),
    ).toThrow(/one short line naming the boundary/);
  });

  it("should reject a warning when its summary is only whitespace", () => {
    expect(() =>
      validateAgentResponseDraft({
        value: {
          requestId: packageId,
          outcomes: [
            {
              commentId,
              state: "warning",
              summary: "   ",
              message: "This request would cross the standard template.",
            },
          ],
        },
        request: claimedRequest,
        commentsById: new Map([[commentId, comment]]),
        changedBlocks: new Set(),
        currentSnapshot: request.premiseSnapshot,
        now: "2026-08-02T12:01:00.000Z",
      }),
    ).toThrow(/one short line naming the boundary/);
  });

  it("should reject a warning when its summary exceeds one scannable line", () => {
    expect(() =>
      validateAgentResponseDraft({
        value: {
          requestId: packageId,
          outcomes: [
            {
              commentId,
              state: "warning",
              summary: "x".repeat(81),
              message: "This request would cross the standard template.",
            },
          ],
        },
        request: claimedRequest,
        commentsById: new Map([[commentId, comment]]),
        changedBlocks: new Set(),
        currentSnapshot: request.premiseSnapshot,
        now: "2026-08-02T12:01:00.000Z",
      }),
    ).toThrow(/longer than 80 characters/);
  });
});

describe("agent exchange filesystem", () => {
  it("should commit a reply in a pushed thread as its own transaction", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "big-plan-pushed-thread-reply-"),
    );
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, before);
    const store = reviewStoreFor({ planPath, planId });
    await prepareStore(store);
    const threadId = "7777777777777777";
    const opener = validateAgentRequest({
      ...pushRequest(),
      threadId,
      baselineSnapshot: deriveSnapshotDigest(before),
      claimedAt: "2026-08-02T12:00:01.000Z",
      claimedBy: agentSessionId,
      claimExpiresAtMs: 1_775_000_000_000,
      claimGeneration: 1,
      answeredAt: "2026-08-02T12:00:02.000Z",
    });
    await writeAgentRequest({ store, request: opener });
    const reply = messageAgentRequest({
      kind: "reply",
      requestId: "6666666666666666",
      sessionId,
      planId,
      premiseSnapshot: opener.premiseSnapshot,
      createdAt: "2026-08-02T12:01:00.000Z",
      body: "Also clarify why the publish is atomic.",
      commentId: threadId,
    });
    await writeAgentRequest({ store, request: reply });

    try {
      const claimed = await claimAgentRequest({
        store,
        activeSessionId: sessionId,
        requestId: reply.requestId,
        claimedBy: agentSessionId,
        baselineSnapshot: reply.premiseSnapshot,
        now: "2026-08-02T12:01:01.000Z",
      });
      const response = validateAgentResponseDraft({
        value: {
          requestId: claimed.requestId,
          outcomes: [
            {
              commentId: threadId,
              state: "answered",
              message: "The guarded rename is the publication point.",
            },
          ],
        },
        request: claimed,
        commentsById: commentsFromExchange({
          requests: [opener, claimed],
          responses: [],
        }),
        changedBlocks: new Set(),
        currentSnapshot: claimed.premiseSnapshot,
        now: "2026-08-02T12:01:02.000Z",
      });
      await commitRequestTerminal({
        store,
        response,
        claimedBy: agentSessionId,
        now: "2026-08-02T12:01:03.000Z",
      });
      await expect(
        readCommittedRevision({ store, requestId: reply.requestId }),
      ).resolves.toMatchObject({
        requestId: reply.requestId,
        changeSetIds: [reply.requestId],
        provenance: "reply",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should read a hand-written push as a projected thread and ignore unknown stored kinds", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-push-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, before);
    const store = reviewStoreFor({ planPath, planId });
    await prepareStore(store);
    const push = validateAgentRequest({
      ...pushRequest({ threadId: "7777777777777777" }),
      baselineSnapshot: deriveSnapshotDigest(before),
      claimedAt: "2026-08-02T12:00:30.000Z",
      claimedBy: agentSessionId,
      claimExpiresAtMs: 1_775_000_000_000,
      claimGeneration: 1,
      answeredAt: "2026-08-02T12:01:00.000Z",
    });
    await writeFile(
      join(store.agentRequestDirectory, `${push.requestId}.json`),
      JSON.stringify(push),
    );
    await writeFile(
      join(store.agentRequestDirectory, "6666666666666666.json"),
      JSON.stringify({
        ...push,
        requestId: "6666666666666666",
        kind: "future",
      }),
    );
    await writeFile(
      join(store.agentResponseDirectory, `${push.requestId}.json`),
      JSON.stringify({
        version: 3,
        requestId: push.requestId,
        sessionId: push.sessionId,
        planId: push.planId,
        claimGeneration: push.claimGeneration,
        resultSnapshot: push.baselineSnapshot,
        createdAt: "2026-08-02T12:01:00.000Z",
        kind: "future",
        outcomes: [],
      }),
    );

    try {
      const exchange = await readAgentExchange({ store, sessionId, planId });
      expect(exchange.requests).toEqual([push]);
      expect(exchange.responses).toEqual([]);
      const opener = commentsFromExchange(exchange).get(push.threadId);
      expect(opener).toEqual({
        id: push.threadId,
        body: push.body,
        createdAt: push.createdAt,
        premiseSnapshot: push.premiseSnapshot,
        target: { type: "document" },
      });
      if (opener === undefined) {
        throw new Error("The push opener did not project as a comment");
      }
      const thread = projectCommentThread({
        comment: opener,
        requests: exchange.requests,
        responses: exchange.responses,
        progressEvents: [],
        presence: { connected: false, state: "waiting" },
        runtime: "online",
        nowMs: Date.parse(push.createdAt),
        cancelPendingRequestIds: new Set(),
      });
      expect(thread.comment).toEqual(opener);
      expect(thread.exchanges).toHaveLength(1);
      expect(thread.latestExchange?.request).toEqual(push);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("freezes the first claim revision when work is picked up again", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-claim-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, before);
    const store = reviewStoreFor({ planPath, planId });
    await prepareStore(store);
    await writeAgentRequest({ store, request });
    const firstClaim = await claimAgentRequest({
      store,
      activeSessionId: sessionId,
      requestId: request.requestId,
      claimedBy: agentSessionId,
      baselineSnapshot: "aaaaaaaaaaaaaaaa",
      now: "2026-08-02T12:00:30.000Z",
    });
    const repeatedClaim = await claimAgentRequest({
      store,
      activeSessionId: sessionId,
      requestId: firstClaim.requestId,
      claimedBy: agentSessionId,
      baselineSnapshot: "bbbbbbbbbbbbbbbb",
      now: "2026-08-02T12:01:00.000Z",
    });
    expect(requestBaselineSnapshot(repeatedClaim)).toBe("aaaaaaaaaaaaaaaa");
    await expect(
      readAgentExchange({ store, sessionId, planId }),
    ).resolves.toMatchObject({
      requests: [
        {
          baselineSnapshot: "aaaaaaaaaaaaaaaa",
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
    const claimed = await claimAgentRequest({
      store,
      activeSessionId: sessionId,
      requestId: request.requestId,
      claimedBy: agentSessionId,
      baselineSnapshot: request.premiseSnapshot,
      now: "2026-08-02T12:00:30.000Z",
    });
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
      request: claimed,
      commentsById: new Map([[commentId, comment]]),
      changedBlocks: new Set([blockId]),
      currentSnapshot: deriveSnapshotDigest(after),
      now: "2026-08-02T12:01:00.000Z",
    });
    const answered = await commitRequestTerminal({
      store,
      response,
      claimedBy: agentSessionId,
      now: "2026-08-02T12:01:01.000Z",
    });
    expect(answered).toMatchObject({ answeredAt: "2026-08-02T12:01:01.000Z" });
    expect(
      await readAgentExchange({
        store,
        sessionId: "bbbbbbbbbbbbbbbb",
        planId,
      }),
    ).toEqual({
      requests: [answered],
      responses: [response],
    });
  });

  // The agent reads its work from the store, so the slide a slide comment
  // addresses has to survive the round trip. Losing it here hands the agent the
  // slide's heading and nothing else, which is the whole defect this carries.
  it("should hand the agent back the slide a slide comment addresses", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-slide-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, before);
    const store = reviewStoreFor({ planPath, planId });
    await prepareStore(store);
    const slideComment: ReviewComment = {
      ...comment,
      body: "rewrite this in Spanish",
      target: {
        type: "block",
        blockId: "section/http-endpoints/heading-1",
        kind: "slide",
        label: "HTTP endpoints",
        section: "HTTP endpoints",
        slideText: "HTTP endpoints\n\nEvery job arrives here.",
        isSlideTextExcerpt: false,
        slideSubHeadings: ["The queueing endpoint", "The status endpoint"],
      },
    };
    await writeAgentRequest({
      store,
      request: feedbackAgentRequest({
        feedback: buildFeedbackPackage({
          sessionId,
          packageId,
          planId,
          planPath: "/tmp/plan.mdx",
          createdAt: "2026-08-02T12:00:00.000Z",
          comments: [slideComment],
        }),
        premiseSnapshot: deriveSnapshotDigest(before),
      }),
    });

    const exchange = await readAgentExchange({ store, sessionId, planId });
    expect(exchange.requests[0]?.comments[0]?.target).toMatchObject({
      kind: "slide",
      slideText: "HTTP endpoints\n\nEvery job arrives here.",
      slideSubHeadings: ["The queueing endpoint", "The status endpoint"],
    });
  });

  it("should accept a warning without inventing a changed snapshot", () => {
    expect(
      validateAgentResponseDraft({
        value: {
          requestId: packageId,
          outcomes: [
            {
              commentId,
              state: "warning",
              summary: "Would depart from the standard template",
              message:
                "Fulfilling this request would deviate from the standard template.",
            },
          ],
        },
        request: claimedRequest,
        commentsById: new Map([[commentId, comment]]),
        changedBlocks: new Set(),
        currentSnapshot: request.premiseSnapshot,
        now: "2026-08-02T12:01:00.000Z",
      }),
    ).toMatchObject({
      outcomes: [
        {
          state: "warning",
          summary: "Would depart from the standard template",
          message:
            "Fulfilling this request would deviate from the standard template.",
        },
      ],
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
    expect(nextPendingAgentRequest(canceledSnapshot, viewer())).toBeUndefined();
    await expect(
      claimAgentRequest({
        store,
        activeSessionId: sessionId,
        requestId: request.requestId,
        claimedBy: agentSessionId,
        baselineSnapshot: "aaaaaaaaaaaaaaaa",
        now: "2026-08-02T12:00:50.000Z",
      }),
    ).rejects.toThrow(/canceled by the reviewer/);
    expect(() =>
      validateAgentResponseDraft({
        value: {
          requestId: packageId,
          outcomes: [
            {
              commentId,
              state: "declined",
              message: "This should never publish.",
            },
          ],
        },
        request: canceled,
        commentsById: new Map([[commentId, comment]]),
        changedBlocks: new Set(),
        currentSnapshot: deriveSnapshotDigest(before),
        now: "2026-08-02T12:01:00.000Z",
      }),
    ).toThrow(/canceled by the reviewer/);
  });

  it("should retain pending requests beside bounded terminal history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-limit-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, before);
    const store = reviewStoreFor({ planPath, planId });
    await prepareStore(store);
    const startedAt = Date.parse("2026-08-02T12:00:00.000Z");
    for (let index = 1; index < 400; index += 1) {
      await writeAgentRequest({
        store,
        request: {
          ...messageAgentRequest({
            kind: "chat",
            requestId: index.toString(16).padStart(16, "0"),
            sessionId,
            planId,
            premiseSnapshot: deriveSnapshotDigest(before),
            createdAt: new Date(startedAt + index).toISOString(),
            body: `Question ${index}`,
          }),
          canceledAt: new Date(startedAt + index).toISOString(),
        },
      });
    }
    const reply = messageAgentRequest({
      kind: "reply",
      requestId: "ffffffffffffffff",
      sessionId,
      planId,
      premiseSnapshot: deriveSnapshotDigest(before),
      createdAt: new Date(startedAt + 400).toISOString(),
      body: "Does the original feedback need a plan change?",
      commentId,
    });
    await writeAgentRequest({ store, request: reply });
    const claimed = await claimAgentRequest({
      store,
      activeSessionId: sessionId,
      requestId: reply.requestId,
      claimedBy: agentSessionId,
      baselineSnapshot: reply.premiseSnapshot,
      now: new Date(startedAt + 401).toISOString(),
    });
    const response = validateAgentResponseDraft({
      value: {
        requestId: claimed.requestId,
        outcomes: [
          {
            commentId,
            state: "declined",
            message: "No plan revision is needed.",
          },
        ],
      },
      request: claimed,
      commentsById: new Map([[commentId, comment]]),
      changedBlocks: new Set(),
      currentSnapshot: claimed.premiseSnapshot,
      now: new Date(startedAt + 402).toISOString(),
    });
    await commitRequestTerminal({
      claimedBy: agentSessionId,
      store,
      response,
      now: new Date(startedAt + 403).toISOString(),
    });
    const nowMs = Date.now();
    const blocker = validateAgentRequest({
      ...request,
      baselineSnapshot: request.premiseSnapshot,
      claimedAt: new Date(nowMs - 1_000).toISOString(),
      claimedBy: agentSessionId,
      claimExpiresAtMs: nowMs + AGENT_CLAIM_LEASE_MS,
      claimGeneration: 1,
    });
    const queued = messageAgentRequest({
      kind: "chat",
      requestId: "eeeeeeeeeeeeeeee",
      sessionId,
      planId,
      premiseSnapshot: deriveSnapshotDigest(before),
      createdAt: new Date(startedAt + 404).toISOString(),
      body: "Wait for the working writer to leave.",
    });
    await writeAgentRequest({ store, request: blocker });
    await writeAgentRequest({ store, request: queued });

    const bounded = await readAgentExchange({
      store,
      sessionId,
      planId,
      nowMs,
    });
    expect(bounded.requests).toHaveLength(402);
    expect(bounded.requests[0]?.requestId).toBe(blocker.requestId);
    expect(bounded.requests[1]?.requestId).toBe("0000000000000001");
    expect(bounded.requests.at(-1)?.requestId).toBe(queued.requestId);
    expect(bounded.responses).toEqual([response]);
    // Without retaining live blockers outside the presentation cap, the queue
    // offers `queued` while the mailbox still rejects it. That counterfactual
    // was verified before this test passed.
    expect(
      nextPendingAgentRequest(bounded, {
        claimedBy: "cccc0000cccc0000",
        nowMs,
      }),
    ).toBeUndefined();
    expect(
      nextPendingAgentRequest(bounded, {
        claimedBy: "cccc0000cccc0000",
        nowMs: (blocker.claimExpiresAtMs ?? nowMs) + 1,
      }),
    ).toEqual(blocker);
  });
});

describe("approval request contract", () => {
  const pinned = deriveSnapshotDigest(before);
  const approvalRequest = () =>
    approvalAgentRequest({
      approvalId: "a1b2c3d4e5f60718",
      sessionId,
      planId,
      planPath: "/tmp/plan.mdx",
      pinnedSnapshot: pinned,
      createdAt: "2026-08-13T17:41:00.000Z",
      recordedAnswers: [
        {
          decisionId: "decision-which-release-path",
          optionId: "decision-which-release-path-option-gradual-rollout",
        },
      ],
      unansweredDecisions: ["decision-what-should-trigger-rollback"],
      message: "This plan is approved and we are ready to begin.",
    });

  const claimedApproval = () =>
    validateAgentRequest({
      ...approvalRequest(),
      baselineSnapshot: pinned,
      claimedAt: "2026-08-13T17:41:30.000Z",
      claimedBy: "cccc0000cccc0000",
      claimExpiresAtMs: 1_775_000_000_000,
      claimGeneration: 1,
    });

  it("should validate an approval request and prefill its acknowledgment template", () => {
    const request = approvalRequest();
    expect(request).toMatchObject({
      kind: "approval",
      requestId: "a1b2c3d4e5f60718",
      approvalId: "a1b2c3d4e5f60718",
      planPath: "/tmp/plan.mdx",
      pinnedSnapshot: pinned,
      premiseSnapshot: pinned,
    });
    expect(responseTemplateFor(request)).toEqual({
      requestId: request.requestId,
    });
  });

  it("should refuse an approval request whose approvalId does not match requestId", () => {
    expect(() =>
      validateAgentRequest({
        ...approvalRequest(),
        approvalId: "b2c3d4e5f6071819",
      }),
    ).toThrow(/approvalId.*requestId/u);
  });

  it("should refuse an approval request with a relative planPath", () => {
    expect(() =>
      validateAgentRequest({
        ...approvalRequest(),
        planPath: "plans/retry-queue.mdx",
      }),
    ).toThrow(/absolute path/u);
  });

  it("should refuse an approval request that carries attachments", () => {
    const image = {
      id: "a".repeat(64),
      sha256: "a".repeat(64),
      mimeType: "image/png",
      byteLength: 1,
      width: 1,
      height: 1,
      path: "/tmp/.big-plan/review/plan/agent/attachments/image.png",
      alt: "Evidence",
    };
    expect(() =>
      validateAgentRequest({
        ...approvalRequest(),
        attachmentManifest: [image],
        attachments: [image],
      }),
    ).toThrow(/cannot contain attachments/u);
  });

  it("should accept an acknowledgment that leaves the pinned snapshot unchanged", () => {
    const claimed = claimedApproval();
    expect(
      validateAgentResponseDraft({
        value: { requestId: claimed.requestId },
        request: claimed,
        commentsById: new Map(),
        changedBlocks: new Set(),
        currentSnapshot: pinned,
        now: "2026-08-13T17:42:00.000Z",
      }),
    ).toMatchObject({
      kind: "approval",
      requestId: claimed.requestId,
      resultSnapshot: pinned,
    });
  });

  it("should refuse an acknowledgment whose result snapshot differs from the pin", () => {
    const claimed = claimedApproval();
    expect(() =>
      validateAgentResponseDraft({
        value: { requestId: claimed.requestId },
        request: claimed,
        commentsById: new Map(),
        changedBlocks: new Set(),
        currentSnapshot: deriveSnapshotDigest(after),
        now: "2026-08-13T17:42:00.000Z",
      }),
    ).toThrow(
      "An approval acknowledgment must not change the plan. Restore the source so its digest equals the pinned snapshot, then respond again.",
    );
  });
});

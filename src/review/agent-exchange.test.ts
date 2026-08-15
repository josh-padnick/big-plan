// Covers the coding-agent exchange through its public seam: real feedback and
// replies become pending work, and only complete source-consistent responses
// can become viewer state.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReviewComment } from "./shared/comment.js";
import {
  AgentExchangeRejected,
  commentsFromExchange,
  deriveSnapshotDigest,
  feedbackAgentRequest,
  messageAgentRequest,
  nextPendingAgentRequest,
  readAgentExchange,
  requestBaselineSnapshot,
  validateAgentResponseDraft,
  validateAgentRequest,
  writeAgentRequest,
} from "./agent-exchange.js";
import type { AgentExchangeSnapshot } from "./agent-exchange.js";
import { buildFeedbackPackage } from "./feedback-package.js";
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
        request,
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
        request,
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
        request,
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
        request,
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
        request,
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
        request,
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
        request,
        commentsById: new Map([[commentId, comment]]),
        changedBlocks: new Set(),
        currentSnapshot: request.premiseSnapshot,
        now: "2026-08-02T12:01:00.000Z",
      }),
    ).toThrow(/longer than 80 characters/);
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

  it("should accept a warning without inventing a changed snapshot", () => {
    const claimed = {
      ...request,
      claimedAt: "2026-08-02T12:00:30.000Z",
      baselineSnapshot: request.premiseSnapshot,
    };
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
        request: claimed,
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
    await writeAgentRequest({ store, request });
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

    const bounded = await readAgentExchange({ store, sessionId, planId });
    expect(bounded.requests).toHaveLength(401);
    expect(bounded.requests[0]?.requestId).toBe(request.requestId);
    expect(bounded.requests[1]?.requestId).toBe("0000000000000001");
    expect(bounded.requests.at(-1)?.requestId).toBe(reply.requestId);
    expect(bounded.responses).toEqual([response]);
    expect(nextPendingAgentRequest(bounded, viewer())).toEqual(request);
  });
});

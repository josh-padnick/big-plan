import { describe, expect, it } from "vitest";
import type { ReviewComment } from "./comment.js";
import { AGENT_CLAIM_LEASE_MS } from "./agent-claim.js";
import {
  projectCommentThread,
  projectConversationHistory,
  projectLatestAgentStatus,
  projectRequestDelivery,
  projectRequestStatus,
  queuedRequestsAhead,
  requestCommentIds,
  selectActiveFeedbackBatch,
  type ThreadRequest,
  type ThreadResponse,
} from "./thread-projection.js";

const NOW = Date.parse("2026-08-10T20:00:00Z");
const comment: ReviewComment = {
  id: "bbbbbbbbbbbbbbbb",
  body: "Clarify the retry boundary.",
  createdAt: "2026-08-10T19:00:00Z",
  premiseSnapshot: "1111111111111111",
  target: { type: "document" },
};
const presence = {
  connected: true,
  state: "waiting" as const,
  updatedAtMs: NOW,
};
const liveClaim = (atMs = NOW) => ({
  claimedAt: new Date(atMs).toISOString(),
  claimedBy: "aaaa0000aaaa0000",
  claimExpiresAtMs: atMs + AGENT_CLAIM_LEASE_MS,
});
const request = (overrides: Partial<ThreadRequest> = {}): ThreadRequest => ({
  requestId: "aaaaaaaaaaaaaaaa",
  premiseSnapshot: "1111111111111111",
  createdAt: "2026-08-10T19:01:00Z",
  kind: "feedback",
  commentIds: [comment.id],
  ...overrides,
});
const answeredRequest = (
  overrides: Partial<ThreadRequest> = {},
): ThreadRequest =>
  request({
    ...liveClaim(NOW - 1_000),
    answeredAt: new Date(NOW).toISOString(),
    ...overrides,
  });
const response = (
  state: "answered" | "changed" | "warning" | "needs-input" | "declined",
): ThreadResponse => ({
  requestId: "aaaaaaaaaaaaaaaa",
  resultSnapshot: "2222222222222222",
  createdAt: "2026-08-10T19:02:00Z",
  kind: "feedback",
  outcomes: [
    {
      commentId: comment.id,
      state,
      message: "A precise answer.",
    },
  ],
});

describe("thread projection", () => {
  it("should normalize comment ids from browser and stored requests", () => {
    expect(requestCommentIds(request())).toEqual([comment.id]);
    expect(
      requestCommentIds(
        request({ commentIds: undefined, comments: [comment] }),
      ),
    ).toEqual([comment.id]);
  });

  it("should group queued, working, response, and ready work", () => {
    const base = {
      comment,
      responses: [],
      progressEvents: [],
      presence,
      runtime: "online" as const,
      nowMs: NOW,
      cancelPendingRequestIds: new Set<string>(),
    };
    expect(projectCommentThread({ ...base, requests: [request()] }).group).toBe(
      "queued",
    );
    expect(
      projectCommentThread({
        ...base,
        requests: [request(liveClaim())],
        progressEvents: [
          {
            requestId: "aaaaaaaaaaaaaaaa",
            seq: 1,
            stepCode: "agent-note",
            step: "Reading the plan",
            state: "live" as const,
            atMs: NOW,
          },
        ],
      }).group,
    ).toBe("working");
    expect(
      projectCommentThread({
        ...base,
        requests: [answeredRequest()],
        responses: [response("needs-input")],
      }).group,
    ).toBe("needs-input");
    expect(
      projectCommentThread({
        ...base,
        requests: [answeredRequest()],
        responses: [response("warning")],
      }).group,
    ).toBe("needs-input");
    expect(
      projectCommentThread({
        ...base,
        requests: [answeredRequest()],
        responses: [response("changed")],
      }).group,
    ).toBe("ready");
  });

  it("should mark an exchange reopened when the request reopened the thread", () => {
    const projection = projectCommentThread({
      comment,
      requests: [request({ reopenedCommentIds: [comment.id] })],
      responses: [],
      progressEvents: [],
      presence,
      runtime: "online",
      nowMs: NOW,
      cancelPendingRequestIds: new Set<string>(),
    });
    expect(projection.latestExchange?.reopenedByNewWork).toBe(true);
  });

  it("should preserve baseline and pending cancel facts", () => {
    const projection = projectCommentThread({
      comment,
      requests: [request({ baselineSnapshot: "3333333333333333" })],
      responses: [],
      progressEvents: [],
      presence,
      runtime: "online",
      nowMs: NOW,
      cancelPendingRequestIds: new Set(["aaaaaaaaaaaaaaaa"]),
    });
    expect(projection.latestExchange?.baselineSnapshot).toBe(
      "3333333333333333",
    );
    expect(projection).toMatchObject({
      latestCanceled: true,
      latestPending: false,
      group: "queued",
    });
  });

  it("should only offer canceled-comment deletion before any agent answer or pickup", () => {
    const base = {
      comment,
      progressEvents: [],
      presence,
      runtime: "online" as const,
      nowMs: NOW,
      cancelPendingRequestIds: new Set<string>(),
    };
    const canceled = request({ canceledAt: "2026-08-10T19:02:00Z" });
    expect(
      projectCommentThread({
        ...base,
        requests: [canceled],
        responses: [],
      }),
    ).toMatchObject({
      group: "ready",
      latestCanceled: true,
      latestStatus: {
        label: "Canceled",
        headline: "Request canceled",
      },
      canDeleteCanceled: true,
    });

    const canceledReply = request({
      requestId: "cccccccccccccccc",
      kind: "reply",
      commentId: comment.id,
      commentIds: undefined,
      createdAt: "2026-08-10T19:03:00Z",
      canceledAt: "2026-08-10T19:04:00Z",
    });
    expect(
      projectCommentThread({
        ...base,
        requests: [answeredRequest(), canceledReply],
        responses: [response("changed")],
      }),
    ).toMatchObject({
      latestCanceled: true,
      canDeleteCanceled: false,
    });
  });

  it("should allow editing and deleting a queued follow-up in an answered thread", () => {
    const queuedReply = request({
      requestId: "cccccccccccccccc",
      kind: "reply",
      commentId: comment.id,
      commentIds: undefined,
      createdAt: "2026-08-10T19:03:00Z",
    });
    const projection = projectCommentThread({
      comment,
      requests: [request(), queuedReply],
      responses: [response("changed")],
      progressEvents: [],
      presence,
      runtime: "online",
      nowMs: NOW,
      cancelPendingRequestIds: new Set<string>(),
    });
    expect(projection.latestExchange).toMatchObject({
      canReviseMessage: true,
      canDeleteMessage: true,
    });
    // The answered comment itself stays history; only its follow-up goes.
    expect(projection.canDeleteQueued).toBe(false);
  });

  it("should stop offering edit and delete once the agent picks a message up", () => {
    const claimedReply = request({
      requestId: "cccccccccccccccc",
      kind: "reply",
      commentId: comment.id,
      commentIds: undefined,
      createdAt: "2026-08-10T19:03:00Z",
      ...liveClaim(Date.parse("2026-08-10T19:03:30Z")),
    });
    expect(
      projectCommentThread({
        comment,
        requests: [request(), claimedReply],
        responses: [response("changed")],
        progressEvents: [],
        presence,
        runtime: "online",
        nowMs: NOW,
        cancelPendingRequestIds: new Set<string>(),
      }).latestExchange,
    ).toMatchObject({ canReviseMessage: false, canDeleteMessage: false });
  });

  it("should keep a canceled message deletable but no longer editable", () => {
    const canceledReply = request({
      requestId: "cccccccccccccccc",
      kind: "reply",
      commentId: comment.id,
      commentIds: undefined,
      createdAt: "2026-08-10T19:03:00Z",
      canceledAt: "2026-08-10T19:03:30Z",
    });
    expect(
      projectCommentThread({
        comment,
        requests: [canceledReply],
        responses: [],
        progressEvents: [],
        presence,
        runtime: "online",
        nowMs: NOW,
        cancelPendingRequestIds: new Set<string>(),
      }).latestExchange,
    ).toMatchObject({ canReviseMessage: false, canDeleteMessage: true });
  });

  it("should never offer message edit or delete on a feedback request", () => {
    expect(
      projectCommentThread({
        comment,
        requests: [request()],
        responses: [],
        progressEvents: [],
        presence,
        runtime: "online",
        nowMs: NOW,
        cancelPendingRequestIds: new Set<string>(),
      }).latestExchange,
    ).toMatchObject({ canReviseMessage: false, canDeleteMessage: false });
  });

  it("should count only the pending work delivered before one request", () => {
    const first = request({ requestId: "1111111111111111" });
    const second = request({ requestId: "2222222222222222" });
    const third = request({ requestId: "3333333333333333" });
    const canceled = request({
      requestId: "4444444444444444",
      canceledAt: "2026-08-10T19:01:30Z",
    });
    expect(
      queuedRequestsAhead({
        request: third,
        requests: [first, canceled, second, third],
        responses: [{ ...response("changed"), requestId: first.requestId }],
        cancelPendingRequestIds: new Set<string>(),
      }),
    ).toBe(1);
    expect(
      queuedRequestsAhead({
        request: first,
        requests: [first, second, third],
        responses: [],
        cancelPendingRequestIds: new Set<string>(),
      }),
    ).toBe(0);
  });

  it("should tell a queued thread how many messages are ahead of it", () => {
    const ahead = request({ requestId: "1111111111111111" });
    const queued = request({
      requestId: "cccccccccccccccc",
      kind: "reply",
      commentId: comment.id,
      commentIds: undefined,
      createdAt: "2026-08-10T19:03:00Z",
    });
    expect(
      projectCommentThread({
        comment,
        requests: [ahead, queued],
        responses: [],
        progressEvents: [],
        presence: { ...presence, state: "working", requestId: ahead.requestId },
        runtime: "online",
        nowMs: NOW,
        cancelPendingRequestIds: new Set<string>(),
      }).latestStatus,
    ).toMatchObject({
      stage: "waiting",
      label: "Queued, 1 ahead",
      tone: "neutral",
    });
  });

  it("should not offer queued deletion after an earlier pickup", () => {
    const expiredClaim = liveClaim(NOW - AGENT_CLAIM_LEASE_MS - 1);
    const projection = projectCommentThread({
      comment,
      requests: [request(expiredClaim)],
      responses: [],
      progressEvents: [],
      presence,
      runtime: "online",
      nowMs: NOW,
      cancelPendingRequestIds: new Set(),
    });
    expect(projection).toMatchObject({
      group: "queued",
      canDeleteQueued: false,
    });
    expect(projection.latestExchange).toMatchObject({ delivery: "Queued" });
    expect(
      projectRequestDelivery({
        request: request(liveClaim()),
        nowMs: NOW,
      }),
    ).toBe("Sent");
    expect(
      projectRequestDelivery({
        request: request({
          ...expiredClaim,
          answeredAt: "2026-08-10T20:00:01Z",
        }),
        nowMs: NOW,
      }),
    ).toBe("Sent");
  });

  it("should exclude terminal feedback from the active batch", () => {
    const pending = request({
      commentIds: [comment.id, "cccccccccccccccc"],
    });
    const answered = request({
      commentIds: [comment.id, "cccccccccccccccc"],
      ...liveClaim(),
      answeredAt: "2026-08-10T20:00:01Z",
    });
    expect(
      selectActiveFeedbackBatch({
        requests: [pending],
        cancelPendingRequestIds: new Set(),
      }),
    ).toBe(pending);
    expect(
      selectActiveFeedbackBatch({
        requests: [answered],
        cancelPendingRequestIds: new Set(),
      }),
    ).toBeUndefined();
  });

  it.each(["thread", "chat"] as const)(
    "should treat an answered %s request as terminal without its response",
    (surface) => {
      const answered = request({
        ...liveClaim(),
        answeredAt: "2026-08-10T20:00:01Z",
      });
      expect(
        projectRequestStatus({
          request: answered,
          progressEvents: [],
          presence,
          runtime: "online",
          surface,
          nowMs: NOW,
          cancelPendingRequestIds: new Set(),
        }),
      ).toMatchObject({
        stage: "answered",
        headline: "The agent has answered",
      });
    },
  );

  it("should keep an answered thread out of the queued group without its response", () => {
    expect(
      projectCommentThread({
        comment,
        requests: [
          request({
            ...liveClaim(),
            answeredAt: "2026-08-10T20:00:01Z",
          }),
        ],
        responses: [],
        progressEvents: [],
        presence,
        runtime: "online",
        nowMs: NOW,
        cancelPendingRequestIds: new Set(),
      }),
    ).toMatchObject({
      group: "ready",
      latestPending: false,
      canDeleteQueued: false,
    });
  });

  it("should derive one request status from its live claim", () => {
    expect(
      projectRequestStatus({
        request: request(liveClaim()),
        progressEvents: [
          {
            requestId: "aaaaaaaaaaaaaaaa",
            seq: 1,
            stepCode: "agent-note",
            step: "Checking the retry state",
            state: "live",
            atMs: NOW,
          },
        ],
        presence: { ...presence, state: "working" },
        runtime: "online",
        surface: "thread",
        nowMs: NOW,
        cancelPendingRequestIds: new Set(),
      }).stage,
    ).toBe("working");
  });

  it("should keep a reviewer queue edit waiting before agent pickup", () => {
    expect(
      projectRequestStatus({
        request: request({ kind: "chat", commentIds: undefined }),
        response: undefined,
        progressEvents: [
          {
            requestId: "aaaaaaaaaaaaaaaa",
            seq: 1,
            stepCode: "queued-message-revised",
            step: "Queued message edited by reviewer",
            state: "waiting",
            atMs: NOW,
          },
        ],
        presence,
        runtime: "online",
        surface: "chat",
        nowMs: NOW,
        cancelPendingRequestIds: new Set(),
      }),
    ).toMatchObject({ stage: "waiting", tone: "neutral" });
  });

  it("should not report a request as picked up from progress events alone", () => {
    expect(
      projectRequestStatus({
        request: request(),
        progressEvents: [
          {
            requestId: "aaaaaaaaaaaaaaaa",
            seq: 1,
            step: "Checking the retry state",
            state: "live",
            atMs: NOW,
          },
        ],
        presence: { ...presence, state: "working" },
        runtime: "online",
        surface: "thread",
        nowMs: NOW,
        cancelPendingRequestIds: new Set(),
      }).stage,
    ).toBe("waiting");
  });

  it("should stop reporting a request as picked up once its lease lapses", () => {
    expect(
      projectRequestStatus({
        request: request(liveClaim()),
        progressEvents: [],
        presence: { ...presence, state: "working" },
        runtime: "online",
        surface: "thread",
        nowMs: NOW + AGENT_CLAIM_LEASE_MS + 1,
        cancelPendingRequestIds: new Set(),
      }).stage,
    ).toBe("waiting");
  });

  it("should ignore an invalid claimed timestamp when its lease is live", () => {
    expect(
      projectRequestStatus({
        request: request({ ...liveClaim(), claimedAt: "not-a-timestamp" }),
        progressEvents: [
          {
            requestId: "aaaaaaaaaaaaaaaa",
            seq: 1,
            stepCode: "agent-note",
            step: "Checking the retry state",
            state: "live",
            atMs: NOW,
          },
        ],
        presence: { ...presence, state: "working", updatedAtMs: undefined },
        runtime: "online",
        surface: "thread",
        nowMs: NOW,
        cancelPendingRequestIds: new Set(),
      }).stage,
    ).toBe("working");
  });

  it("should derive work recency from the renewed claim", () => {
    expect(
      projectRequestStatus({
        request: request({
          claimedAt: new Date(NOW - AGENT_CLAIM_LEASE_MS * 2).toISOString(),
          claimedBy: "aaaa0000aaaa0000",
          claimExpiresAtMs: NOW + AGENT_CLAIM_LEASE_MS,
        }),
        progressEvents: [],
        presence: {
          connected: false,
          state: "working",
          requestId: "aaaaaaaaaaaaaaaa",
          updatedAtMs: NOW - AGENT_CLAIM_LEASE_MS - 1,
        },
        runtime: "online",
        surface: "thread",
        nowMs: NOW,
        cancelPendingRequestIds: new Set(),
      }),
    ).toMatchObject({ stage: "working" });
  });

  it("should not treat terminal heartbeat work as session busy", () => {
    expect(
      projectRequestStatus({
        request: request(),
        progressEvents: [],
        presence: {
          connected: true,
          state: "working",
          requestId: "bbbbbbbbbbbbbbbb",
          updatedAtMs: NOW,
        },
        runtime: "online",
        surface: "thread",
        nowMs: NOW,
        cancelPendingRequestIds: new Set(),
      }),
    ).toMatchObject({
      stage: "waiting",
      headline: "Waiting for an agent",
    });
  });
});

describe("conversation history", () => {
  it("should project prior chat turns", () => {
    const earlier = answeredRequest({
      requestId: "1111111111111111",
      kind: "chat",
      body: "What changes?",
      commentIds: undefined,
      createdAt: "2026-08-10T18:00:00Z",
    });
    const current = request({
      requestId: "2222222222222222",
      kind: "chat",
      body: "Why?",
      commentIds: undefined,
      createdAt: "2026-08-10T19:00:00Z",
    });
    expect(
      projectConversationHistory({
        request: current,
        requests: [earlier, current],
        responses: [
          {
            requestId: earlier.requestId,
            resultSnapshot: earlier.premiseSnapshot,
            createdAt: "2026-08-10T18:01:00Z",
            kind: "chat",
            message: "The retry boundary changes.",
          },
        ],
      }),
    ).toEqual([
      {
        role: "reviewer",
        body: "What changes?",
        createdAt: "2026-08-10T18:00:00Z",
      },
      {
        role: "agent",
        body: "The retry boundary changes.",
        createdAt: "2026-08-10T18:01:00Z",
      },
    ]);
  });

  it("should project the original comment before a thread reply", () => {
    const original = answeredRequest({
      comments: [comment],
      commentIds: undefined,
      createdAt: "2026-08-10T18:00:00Z",
    });
    const reply = request({
      requestId: "2222222222222222",
      kind: "reply",
      commentId: comment.id,
      body: "Use 95%.",
      commentIds: undefined,
      createdAt: "2026-08-10T19:00:00Z",
    });
    expect(
      projectConversationHistory({
        request: reply,
        requests: [original, reply],
        responses: [response("needs-input")],
      }),
    ).toEqual([
      {
        role: "reviewer",
        body: comment.body,
        target: comment.target,
        createdAt: comment.createdAt,
      },
      {
        role: "agent",
        body: "A precise answer.",
        state: "needs-input",
        createdAt: "2026-08-10T19:02:00Z",
      },
    ]);
  });
});

describe("review-wide agent status", () => {
  const base = {
    responses: [],
    presence,
    runtime: "online" as const,
    agentConnected: true,
    nowMs: NOW,
    cancelPendingRequestIds: new Set<string>(),
  };

  it("should keep an edited queued message out of the working state", () => {
    const queued = request({ claimedAt: undefined });
    expect(
      projectLatestAgentStatus({
        ...base,
        requests: [queued],
        progressEvents: [
          {
            requestId: queued.requestId,
            seq: 1,
            stepCode: "queued-message-revised",
            step: "Queued message edited by reviewer",
            state: "waiting",
            atMs: NOW,
          },
        ],
      }),
    ).toMatchObject({ stage: "waiting", tone: "neutral" });
  });

  it("should report working once the agent owns the message", () => {
    const claimed = request(liveClaim());
    expect(
      projectLatestAgentStatus({
        ...base,
        requests: [claimed],
        progressEvents: [
          {
            requestId: claimed.requestId,
            seq: 1,
            stepCode: "request-picked-up",
            step: "Picked up by the agent",
            state: "live",
            atMs: NOW,
          },
        ],
      }).stage,
    ).toBe("working");
  });

  it("should ignore a reviewer queue event when timing agent silence", () => {
    const queued = request({ claimedAt: undefined });
    expect(
      projectLatestAgentStatus({
        ...base,
        requests: [queued],
        progressEvents: [
          {
            requestId: queued.requestId,
            seq: 1,
            stepCode: "queued-message-deleted",
            step: "Queued message deleted",
            state: "done",
            atMs: NOW,
          },
        ],
      }).stage,
    ).not.toBe("stalled");
  });
});

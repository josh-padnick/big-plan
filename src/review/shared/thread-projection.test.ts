import { describe, expect, it } from "vitest";
import type { ReviewComment } from "./comment.js";
import { AGENT_CLAIM_LEASE_MS } from "./agent-claim.js";
import { AGENT_RECOVERY_HORIZON_MS } from "./agent-timing.js";
import {
  projectCommentThread,
  projectConversationHistory,
  projectLatestAgentStatus,
  projectPushedThreadOpeners,
  projectRequestDelivery,
  projectRequestStatus,
  queuedRequestsAhead,
  requestCommentIds,
  selectOpenFeedbackBatches,
  selectThreadsAwaitingAgent,
  type ThreadGroup,
  type ThreadRequest,
  type ThreadResponse,
} from "./thread-projection.js";
import type { AgentStatus } from "./agent-status.js";

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
// Each of these exercises one request in isolation, so the plan's request list
// is that request alone; the list exists to answer whether some other request
// is being held.
const statusForOneRequest = (
  input: Omit<Parameters<typeof projectRequestStatus>[0], "requests">,
): AgentStatus => projectRequestStatus({ ...input, requests: [input.request] });

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
    expect(
      requestCommentIds(
        request({
          kind: "push",
          threadId: comment.id,
          commentIds: undefined,
        }),
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

  it("should return a message to the reviewer once its claim is proven abandoned", () => {
    const abandoned = request({
      requestId: "cccccccccccccccc",
      kind: "reply",
      commentId: comment.id,
      commentIds: undefined,
      createdAt: "2026-08-10T19:03:00Z",
      ...liveClaim(NOW - AGENT_RECOVERY_HORIZON_MS - 1),
    });
    const base = {
      comment,
      requests: [abandoned],
      responses: [],
      progressEvents: [],
      runtime: "online" as const,
      nowMs: NOW,
      cancelPendingRequestIds: new Set<string>(),
    };
    expect(
      projectCommentThread({
        ...base,
        presence: { ...presence, connected: false },
      }).latestExchange,
    ).toMatchObject({
      canReviseMessage: true,
      canDeleteMessage: true,
      claimAbandoned: true,
    });
    // An attached agent is the other half of the proof. Without it the same
    // silence may be the holder's own turn, so the message stays held.
    expect(
      projectCommentThread({ ...base, presence }).latestExchange,
    ).toMatchObject({
      canReviseMessage: false,
      canDeleteMessage: false,
      claimAbandoned: false,
    });
    // A lapsed lease inside the recovery horizon is the ordinary quiet turn.
    expect(
      projectCommentThread({
        ...base,
        requests: [
          request({
            ...abandoned,
            ...liveClaim(NOW - AGENT_CLAIM_LEASE_MS * 2),
          }),
        ],
        presence: { ...presence, connected: false },
      }).latestExchange,
    ).toMatchObject({
      canReviseMessage: false,
      canDeleteMessage: false,
      claimAbandoned: false,
    });
  });

  it("should say why a comment held by an abandoned claim is deletable again", () => {
    const base = {
      comment,
      responses: [],
      progressEvents: [],
      runtime: "online" as const,
      nowMs: NOW,
      cancelPendingRequestIds: new Set<string>(),
    };
    expect(
      projectCommentThread({
        ...base,
        requests: [request(liveClaim(NOW - AGENT_RECOVERY_HORIZON_MS - 1))],
        presence: { ...presence, connected: false },
      }),
    ).toMatchObject({
      group: "queued",
      canDeleteQueued: true,
      deleteUnlockedByAbandonedClaim: true,
    });
    // A comment nobody ever picked up was always deletable, so it has nothing
    // to explain.
    expect(
      projectCommentThread({
        ...base,
        requests: [request()],
        presence: { ...presence, connected: false },
      }),
    ).toMatchObject({
      canDeleteQueued: true,
      deleteUnlockedByAbandonedClaim: false,
    });
    expect(
      projectCommentThread({
        ...base,
        requests: [request(liveClaim())],
        presence,
      }),
    ).toMatchObject({
      canDeleteQueued: false,
      deleteUnlockedByAbandonedClaim: false,
    });
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
      group: "working",
      canDeleteQueued: false,
    });
    // Delivery happened, and the lease lapsing since does not unsend it.
    expect(projection.latestExchange).toMatchObject({ delivery: "Sent" });
    expect(projectRequestDelivery({ request: request(liveClaim()) })).toBe(
      "Sent",
    );
    expect(
      projectRequestDelivery({
        request: request({
          ...expiredClaim,
          answeredAt: "2026-08-10T20:00:01Z",
        }),
      }),
    ).toBe("Sent");
    expect(projectRequestDelivery({ request: request() })).toBe("Queued");
  });

  // BIG-147. A turn longer than the claim lease is the ordinary path, not an
  // anomaly: `agent next` hands the work over and its process exits, so nothing
  // renews the claim between progress notes. Reporting that as "Queued, N
  // ahead" described started work as still waiting in line, and left the amber
  // stalled state with no producer on this surface.
  it("should report a quiet claimed request as stalled rather than queued", () => {
    const quiet = request(liveClaim(NOW - AGENT_CLAIM_LEASE_MS - 60_000));
    const status = statusForOneRequest({
      request: quiet,
      progressEvents: [],
      presence,
      runtime: "online",
      surface: "thread",
      nowMs: NOW,
      cancelPendingRequestIds: new Set(),
      queuedAhead: 1,
    });
    expect(status).toMatchObject({
      stage: "stalled",
      label: "Working",
      headline: "No progress for 2m",
      tone: "warning",
    });
    // The same silence is the only evidence there is, so the detail must not
    // assert that the agent session is still connected.
    expect(status.detail).not.toContain("still connected");
    expect(status.detail).toContain("Check the agent terminal");
  });

  // BIG-147. An abandoned claim used to sit under a "Working" heading promising
  // to resolve itself forever, beside a message that correctly said no agent
  // was connected. Past the horizon the pickup stops explaining anything, so
  // this surface has to stop promising a resumption nothing will deliver.
  it("should drop the resume promise once its own claim goes stale", () => {
    const statusAfter = (quietForMs: number) =>
      statusForOneRequest({
        request: request(liveClaim(NOW - quietForMs)),
        progressEvents: [],
        presence,
        runtime: "online",
        surface: "thread",
        nowMs: NOW,
        cancelPendingRequestIds: new Set(),
      });
    const held = statusAfter(AGENT_RECOVERY_HORIZON_MS);
    expect(held).toMatchObject({ stage: "stalled", tone: "warning" });
    expect(held.detail).toContain("updates by itself once the agent resumes");

    const stale = statusAfter(AGENT_RECOVERY_HORIZON_MS + 60_000);
    expect(stale).toMatchObject({ stage: "stalled", tone: "danger" });
    expect(stale.detail).not.toContain("updates by itself");
    expect(stale.detail).toContain("takes the work over");
  });

  it("should stop grouping an abandoned request as working", () => {
    const grouped = (quietForMs: number) =>
      projectCommentThread({
        comment,
        requests: [request(liveClaim(NOW - quietForMs))],
        responses: [],
        progressEvents: [],
        presence,
        runtime: "online",
        nowMs: NOW,
        cancelPendingRequestIds: new Set(),
      }).group;
    expect(grouped(AGENT_RECOVERY_HORIZON_MS)).toBe("working");
    expect(grouped(AGENT_RECOVERY_HORIZON_MS + 60_000)).toBe("queued");
  });

  // BIG-147. Nothing renews the plan-wide heartbeat while a turn runs, so a
  // second message sent during one used to read "Blocked - no agent connected"
  // while Agent Status correctly said an agent was holding work. That told the
  // reviewer their message was undeliverable when it was merely behind a turn.
  it("should queue a message sent during a quiet turn rather than call it blocked", () => {
    const held = request({
      requestId: "1111111111111111",
      ...liveClaim(NOW - AGENT_CLAIM_LEASE_MS - 60_000),
    });
    const sentDuringTheTurn = request({
      requestId: "cccccccccccccccc",
      kind: "reply",
      commentId: comment.id,
      commentIds: undefined,
      createdAt: "2026-08-10T19:58:00Z",
    });
    const quietPresence = { ...presence, connected: false };
    expect(
      projectRequestStatus({
        request: sentDuringTheTurn,
        requests: [held, sentDuringTheTurn],
        progressEvents: [],
        presence: quietPresence,
        runtime: "online",
        surface: "thread",
        nowMs: NOW,
        cancelPendingRequestIds: new Set(),
        queuedAhead: 1,
      }),
    ).toMatchObject({
      stage: "waiting",
      label: "Queued, 1 ahead",
      tone: "neutral",
    });
    // With nothing held, the same silence is all the evidence there is, and the
    // blocked reading is the honest one.
    expect(
      projectRequestStatus({
        request: sentDuringTheTurn,
        requests: [sentDuringTheTurn],
        progressEvents: [],
        presence: quietPresence,
        runtime: "online",
        surface: "thread",
        nowMs: NOW,
        cancelPendingRequestIds: new Set(),
        queuedAhead: 1,
      }),
    ).toMatchObject({
      stage: "blocked",
      headline: "Blocked - no agent connected",
    });
  });

  // BIG-147. Nothing reaps a claim, so once the holding request has been quiet
  // past the recovery horizon it stops accounting for the plan's silence and
  // the reviewer is owed the honest reading again.
  it("should report a message as blocked once the holding claim goes stale", () => {
    const abandoned = request({
      requestId: "1111111111111111",
      ...liveClaim(NOW - AGENT_RECOVERY_HORIZON_MS - 1),
    });
    const sentAfterwards = request({
      requestId: "cccccccccccccccc",
      kind: "reply",
      commentId: comment.id,
      commentIds: undefined,
      createdAt: "2026-08-10T19:58:00Z",
    });
    const quietPresence = { ...presence, connected: false };
    const statusWith = (holder: ThreadRequest) =>
      projectRequestStatus({
        request: sentAfterwards,
        requests: [holder, sentAfterwards],
        progressEvents: [],
        presence: quietPresence,
        runtime: "online",
        surface: "thread",
        nowMs: NOW,
        cancelPendingRequestIds: new Set(),
        queuedAhead: 1,
      });
    expect(statusWith(abandoned)).toMatchObject({
      stage: "blocked",
      headline: "Blocked - no agent connected",
    });
    expect(
      statusWith(
        request({
          requestId: "1111111111111111",
          ...liveClaim(NOW - AGENT_RECOVERY_HORIZON_MS),
        }),
      ),
    ).toMatchObject({ stage: "waiting", label: "Queued, 1 ahead" });
  });

  it("should keep a renewed claim working rather than stalled", () => {
    expect(
      statusForOneRequest({
        request: request(liveClaim(NOW - 1_000)),
        progressEvents: [],
        presence,
        runtime: "online",
        surface: "thread",
        nowMs: NOW,
        cancelPendingRequestIds: new Set(),
      }),
    ).toMatchObject({ stage: "working", label: "Agent working" });
  });

  it("should list every open batch in delivery order when several are waiting", () => {
    const working = request({
      requestId: "1111111111111111",
      commentIds: [comment.id, "cccccccccccccccc"],
      ...liveClaim(),
    });
    const queued = request({
      requestId: "2222222222222222",
      commentIds: ["dddddddddddddddd", "eeeeeeeeeeeeeeee"],
    });
    const requests = [working, queued];
    expect(
      selectOpenFeedbackBatches({
        requests,
        cancelPendingRequestIds: new Set(),
      }),
    ).toEqual([working, queued]);
  });

  it("should exclude answered, canceled, and single-comment work from the open batches", () => {
    const open = request({
      requestId: "1111111111111111",
      commentIds: [comment.id, "cccccccccccccccc"],
    });
    const answered = request({
      requestId: "2222222222222222",
      commentIds: ["dddddddddddddddd", "eeeeeeeeeeeeeeee"],
      ...liveClaim(),
      answeredAt: "2026-08-10T20:00:01Z",
    });
    const canceled = request({
      requestId: "3333333333333333",
      commentIds: ["ffffffffffffffff", "0000000000000000"],
    });
    const single = request({ requestId: "4444444444444444" });
    expect(
      selectOpenFeedbackBatches({
        requests: [open, answered, canceled, single],
        cancelPendingRequestIds: new Set([canceled.requestId]),
      }),
    ).toEqual([open]);
  });

  it.each(["thread", "chat"] as const)(
    "should treat an answered %s request as terminal without its response",
    (surface) => {
      const answered = request({
        ...liveClaim(),
        answeredAt: "2026-08-10T20:00:01Z",
      });
      expect(
        statusForOneRequest({
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
      statusForOneRequest({
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
      statusForOneRequest({
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
      statusForOneRequest({
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

  // Replaces an assertion that a lapsed lease returned the request to waiting.
  // Pickup is a past event; the clock running past the lease reports it as
  // quiet, never as never-started (BIG-147).
  it("should keep reporting a request as picked up once its lease lapses", () => {
    expect(
      statusForOneRequest({
        request: request(liveClaim()),
        progressEvents: [],
        presence: { ...presence, state: "working" },
        runtime: "online",
        surface: "thread",
        nowMs: NOW + AGENT_CLAIM_LEASE_MS + 1,
        cancelPendingRequestIds: new Set(),
      }).stage,
    ).toBe("stalled");
  });

  it("should ignore an invalid claimed timestamp when its lease is live", () => {
    expect(
      statusForOneRequest({
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
      statusForOneRequest({
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
      statusForOneRequest({
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
  it("should select a pushed thread opener by its canonical request id", () => {
    const threadId = "1111111111111111";
    const continuation = answeredRequest({
      requestId: "2222222222222222",
      kind: "push",
      origin: "about",
      threadId,
      body: "Continuation sorted first.",
      createdAt: "2026-08-10T16:00:00Z",
    });
    const opener = answeredRequest({
      requestId: threadId,
      kind: "push",
      origin: "prompt",
      threadId,
      body: "Canonical opener.",
      createdAt: "2026-08-10T17:00:00Z",
    });

    expect(projectPushedThreadOpeners([continuation, opener])).toEqual([
      {
        origin: "prompt",
        comment: {
          id: threadId,
          body: "Canonical opener.",
          createdAt: "2026-08-10T17:00:00Z",
          premiseSnapshot: "1111111111111111",
          target: { type: "document" },
        },
      },
    ]);
  });

  it("should project pushed-thread turns by opener origin and include reviewer replies", () => {
    const threadId = "1111111111111111";
    const opener = answeredRequest({
      requestId: threadId,
      kind: "push",
      origin: "prompt",
      threadId,
      body: "Tighten the retry boundary.",
      commentIds: [threadId],
      createdAt: "2026-08-10T17:00:00Z",
    });
    const followUp = answeredRequest({
      requestId: "2222222222222222",
      kind: "push",
      origin: "about",
      threadId,
      body: "Also corrected the cap.",
      commentIds: [threadId],
      createdAt: "2026-08-10T18:00:00Z",
    });
    const reviewerReply = answeredRequest({
      requestId: "3333333333333333",
      kind: "reply",
      commentId: threadId,
      body: "Why twelve attempts?",
      commentIds: [threadId],
      createdAt: "2026-08-10T18:30:00Z",
    });
    const current = request({
      requestId: "4444444444444444",
      kind: "push",
      origin: "about",
      threadId,
      body: "Documented the reason for twelve attempts.",
      commentIds: [threadId],
      createdAt: "2026-08-10T19:00:00Z",
    });
    const pushedResponse = (
      requestId: string,
      message: string,
      createdAt: string,
    ): ThreadResponse => ({
      requestId,
      resultSnapshot: "2222222222222222",
      createdAt,
      kind: "push",
      outcomes: [{ commentId: threadId, state: "changed", message }],
    });

    expect(
      projectConversationHistory({
        request: current,
        requests: [opener, followUp, reviewerReply, current],
        responses: [
          pushedResponse(
            opener.requestId,
            "Tightened the boundary.",
            "2026-08-10T17:01:00Z",
          ),
          pushedResponse(
            followUp.requestId,
            "Corrected the cap.",
            "2026-08-10T18:01:00Z",
          ),
          {
            requestId: reviewerReply.requestId,
            resultSnapshot: "2222222222222222",
            createdAt: "2026-08-10T18:31:00Z",
            kind: "reply",
            outcomes: [
              {
                commentId: threadId,
                state: "answered",
                message: "Twelve covers the longest recovery window.",
              },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        role: "reviewer",
        body: "Tighten the retry boundary.",
        createdAt: "2026-08-10T17:00:00Z",
      },
      {
        role: "agent",
        body: "Tightened the boundary.",
        state: "changed",
        createdAt: "2026-08-10T17:01:00Z",
      },
      {
        role: "agent",
        body: "Also corrected the cap.",
        createdAt: "2026-08-10T18:00:00Z",
      },
      {
        role: "agent",
        body: "Corrected the cap.",
        state: "changed",
        createdAt: "2026-08-10T18:01:00Z",
      },
      {
        role: "reviewer",
        body: "Why twelve attempts?",
        createdAt: "2026-08-10T18:30:00Z",
      },
      {
        role: "agent",
        body: "Twelve covers the longest recovery window.",
        state: "answered",
        createdAt: "2026-08-10T18:31:00Z",
      },
    ]);
  });

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

  // The two ISO spellings of one instant sort the wrong way as strings: "Z"
  // (0x5A) is above "." (0x2E), so a second-precision earlier turn compared
  // lexically looks later than a millisecond-precision current one and drops
  // out of the history.
  it("should order turns by instant when the two timestamps are spelled differently", () => {
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
      createdAt: "2026-08-10T18:00:00.500Z",
    });

    expect(
      projectConversationHistory({
        request: current,
        requests: [earlier, current],
        responses: [
          {
            requestId: earlier.requestId,
            resultSnapshot: earlier.premiseSnapshot,
            createdAt: "2026-08-10T18:00:00.100Z",
            kind: "chat",
            message: "The retry boundary changes.",
          },
        ],
      }).map((entry) => entry.role),
    ).toEqual(["reviewer", "agent"]);
  });

  it("should retain a completed chat preceding the current chat at the same instant", () => {
    const earlier = answeredRequest({
      requestId: "1111111111111111",
      kind: "chat",
      body: "What changes?",
      commentIds: undefined,
      createdAt: "2026-08-10T18:00:00.000Z",
    });
    const current = request({
      requestId: "2222222222222222",
      kind: "chat",
      body: "Why?",
      commentIds: undefined,
      createdAt: "2026-08-10T18:00:00.000Z",
    });

    expect(
      projectConversationHistory({
        request: current,
        requests: [earlier, current],
        responses: [
          {
            requestId: earlier.requestId,
            resultSnapshot: earlier.premiseSnapshot,
            createdAt: "2026-08-10T18:01:00.000Z",
            kind: "chat",
            message: "The retry boundary changes.",
          },
        ],
      }).map((entry) => entry.role),
    ).toEqual(["reviewer", "agent"]);
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

// BIG-162. A batch header stands for work the agent still owes an answer on.
// Reply on one of an open package's comments and cancel that reply and the
// thread reaches an outcome while its package is still open; a header that
// kept heading it would be the only place it rendered, hiding it from the
// Ready for review section that owns its state.
describe("the threads a batch header still speaks for", () => {
  const threads = (
    ...ids: ReadonlyArray<string>
  ): ReadonlyArray<ReviewComment> => ids.map((id) => ({ ...comment, id }));
  const groups = new Map<string, ThreadGroup>([
    ["working0000000a", "working"],
    ["queued00000000a", "queued"],
    ["ready000000000a", "ready"],
    ["needsinput0000a", "needs-input"],
  ]);
  const awaiting = (ids: ReadonlyArray<string>): ReadonlyArray<string> =>
    selectThreadsAwaitingAgent({
      comments: threads(...ids),
      groupOf: (commentId) => groups.get(commentId),
    }).map((entry) => entry.id);

  it("should keep the threads still waiting on the agent", () => {
    expect(awaiting(["working0000000a", "queued00000000a"])).toEqual([
      "working0000000a",
      "queued00000000a",
    ]);
  });

  it("should release a thread that has reached an outcome", () => {
    expect(awaiting(["ready000000000a", "needsinput0000a"])).toEqual([]);
  });

  it("should release a thread it knows nothing about", () => {
    expect(awaiting(["unprojected0000"])).toEqual([]);
  });

  // The step that narrates a refusal is written best-effort after the answer
  // commits, so the answer itself has to be able to say it refused.
  it("should read a refused approval from the answer when its step is lost", () => {
    const request = answeredRequest({
      kind: "approval",
      commentIds: undefined,
      commentId: undefined,
    });
    const status = statusForOneRequest({
      request,
      response: {
        requestId: request.requestId,
        resultSnapshot: "2222222222222222",
        createdAt: "2026-08-10T19:02:00Z",
        kind: "approval",
        hardStop: "The plan no longer matches the pinned snapshot.",
      },
      progressEvents: [],
      presence,
      runtime: "online",
      surface: "chat",
      nowMs: NOW,
      cancelPendingRequestIds: new Set(),
    });
    expect(status).toMatchObject({
      stage: "failed",
      detail: "The plan no longer matches the pinned snapshot.",
    });
    expect(status.headline).not.toBe("Approval acknowledged");
  });

  it("should not offer a response to review when an approval is acknowledged", () => {
    // An acknowledgment publishes nothing and opens no thread, so the settled
    // reading for a question would point the reviewer at neither.
    expect(
      statusForOneRequest({
        request: answeredRequest({
          kind: "approval",
          commentIds: undefined,
          commentId: undefined,
        }),
        progressEvents: [],
        presence,
        runtime: "online",
        surface: "chat",
        nowMs: NOW,
        cancelPendingRequestIds: new Set(),
      }),
    ).toMatchObject({
      stage: "answered",
      headline: "Approval acknowledged",
      detail:
        "The agent has the approved plan and the decisions recorded with it.",
    });
  });
});

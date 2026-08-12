import { describe, expect, it } from "vitest";
import type { ReviewComment } from "./comment.js";
import {
  projectCommentThread,
  projectConversationHistory,
  projectRequestStatus,
  requestCommentIds,
  type ThreadRequest,
  type ThreadResponse,
} from "./thread-projection.js";

const NOW = Date.parse("2026-08-10T20:00:00Z");
const comment: ReviewComment = {
  id: "bbbbbbbbbbbbbbbb",
  body: "Clarify the retry boundary.",
  createdAt: "2026-08-10T19:00:00Z",
  target: { type: "document" },
};
const presence = {
  connected: true,
  state: "waiting" as const,
  updatedAtMs: NOW,
};
const request = (overrides: Partial<ThreadRequest> = {}): ThreadRequest => ({
  requestId: "aaaaaaaaaaaaaaaa",
  sourceRevision: "1111111111111111",
  createdAt: "2026-08-10T19:01:00Z",
  kind: "feedback",
  commentIds: [comment.id],
  ...overrides,
});
const response = (
  state: "changed" | "question" | "outside",
): ThreadResponse => ({
  requestId: "aaaaaaaaaaaaaaaa",
  sourceRevision: "2222222222222222",
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
        requests: [request({ claimedAt: new Date(NOW).toISOString() })],
        progressEvents: [
          {
            requestId: "aaaaaaaaaaaaaaaa",
            seq: 1,
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
        requests: [request()],
        responses: [response("question")],
      }).group,
    ).toBe("needs-input");
    expect(
      projectCommentThread({
        ...base,
        requests: [request()],
        responses: [response("changed")],
      }).group,
    ).toBe("ready");
  });

  it("should preserve baseline and pending cancel facts", () => {
    const projection = projectCommentThread({
      comment,
      requests: [request({ claimedFromRevision: "3333333333333333" })],
      responses: [],
      progressEvents: [],
      presence,
      runtime: "online",
      nowMs: NOW,
      cancelPendingRequestIds: new Set(["aaaaaaaaaaaaaaaa"]),
    });
    expect(projection.latestExchange?.baselineRevision).toBe(
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
      }).canDeleteCanceled,
    ).toBe(true);

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
        requests: [request(), canceledReply],
        responses: [response("changed")],
      }),
    ).toMatchObject({
      latestCanceled: true,
      canDeleteCanceled: false,
    });
  });

  it("should derive one request status from progress and presence", () => {
    expect(
      projectRequestStatus({
        request: request({ claimedAt: new Date(NOW).toISOString() }),
        response: undefined,
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
    ).toBe("working");
  });

  it("should ignore an invalid claimed timestamp when valid activity exists", () => {
    expect(
      projectRequestStatus({
        request: request({ claimedAt: "not-a-timestamp" }),
        response: undefined,
        progressEvents: [
          {
            requestId: "aaaaaaaaaaaaaaaa",
            seq: 1,
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
});

describe("conversation history", () => {
  it("should project prior chat turns", () => {
    const earlier = request({
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
            sourceRevision: earlier.sourceRevision,
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
    const original = request({
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
        responses: [response("question")],
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
        state: "question",
        createdAt: "2026-08-10T19:02:00Z",
      },
    ]);
  });
});

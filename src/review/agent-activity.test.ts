// Covers the current-agent projection independently of browser rendering so
// queue identity and lifecycle language cannot drift between UI surfaces.

import { describe, expect, it } from "vitest";
import type { AgentExchangeSnapshot, AgentRequest } from "./agent-exchange.js";
import {
  AGENT_ACTIVITY_STALL_MS,
  deriveCurrentAgentActivity,
} from "./agent-activity.js";
import type { ProgressEvent } from "./store.js";

const now = Date.parse("2026-08-04T20:00:00.000Z");

const request = ({
  kind = "feedback",
  claimed = false,
}: {
  readonly kind?: AgentRequest["kind"];
  readonly claimed?: boolean;
} = {}): AgentRequest => {
  const base = {
    version: 1 as const,
    requestId: "1111111111111111",
    sessionId: "2222222222222222",
    planId: "plan",
    sourceRevision: "3333333333333333",
    createdAt: "2026-08-04T19:59:00.000Z",
    ...(claimed ? { claimedFromRevision: "4444444444444444" } : {}),
  };
  if (kind === "chat") return { ...base, kind, body: "What is the risk?" };
  if (kind === "reply") {
    return {
      ...base,
      kind,
      commentId: "aaaaaaaaaaaaaaaa",
      body: "Please clarify.",
    };
  }
  return {
    ...base,
    kind,
    packageId: "5555555555555555",
    batchIndex: 0,
    batchSize: 1,
    comments: [
      {
        id: "aaaaaaaaaaaaaaaa",
        body: "Restore the text.",
        createdAt: base.createdAt,
        target: {
          type: "selection",
          blockId: "section/background/paragraph-1",
          kind: "paragraph",
          label: "Opening context",
          section: "Background",
          start: 0,
          end: 12,
          quote: "Spanish text",
        },
      },
    ],
  };
};

const snapshot = (
  requests: ReadonlyArray<AgentRequest>,
): AgentExchangeSnapshot => ({
  requests,
  responses: [],
  cancelledIds: [],
});

const progress = ({
  step,
  state = "live",
  at = now - 12_000,
}: {
  readonly step: string;
  readonly state?: string;
  readonly at?: number;
}): ProgressEvent => ({
  eventId: "6666666666666666",
  sessionId: "2222222222222222",
  seq: 1,
  requestId: "1111111111111111",
  step,
  state,
  at: new Date(at).toISOString(),
});

describe("current agent activity", () => {
  it("should show honest idle copy when no unanswered request exists", () => {
    expect(
      deriveCurrentAgentActivity({
        snapshot: snapshot([]),
        progressEvents: [],
        agentConnected: true,
        runtimeOffline: false,
        now,
        heartbeatAt: now,
      }),
    ).toMatchObject({
      state: "idle",
      headline: "No agent work in progress",
      supporting: "The agent is connected and waiting for feedback.",
    });
  });

  it("should wait without inventing work before pickup", () => {
    expect(
      deriveCurrentAgentActivity({
        snapshot: snapshot([request()]),
        progressEvents: [],
        agentConnected: false,
        runtimeOffline: false,
        now,
        heartbeatAt: 0,
      }),
    ).toMatchObject({
      state: "waiting",
      headline: "Waiting for agent",
      targetLabel: "Background",
    });
  });

  it.each([
    ["feedback", "Responding to a comment"],
    ["reply", "Responding in a comment thread"],
    ["chat", "Answering a plan question"],
  ] as const)(
    "should name %s work and keep only the newest meaningful step",
    (kind, headline) => {
      const activity = deriveCurrentAgentActivity({
        snapshot: snapshot([request({ kind, claimed: true })]),
        progressEvents: [
          progress({ step: "Reading the request", at: now - 20_000 }),
          progress({ step: "Reading the request", at: now - 19_000 }),
          progress({ step: "Restoring the Spanish sentences" }),
        ],
        agentConnected: true,
        runtimeOffline: false,
        now,
        heartbeatAt: now - 12_000,
      });
      expect(activity).toMatchObject({
        state: "working",
        headline,
        latestStep: "Restoring the Spanish sentences",
        updatedAtMs: now - 12_000,
      });
    },
  );

  it("should report a stalled picked-up request after the shared threshold", () => {
    expect(
      deriveCurrentAgentActivity({
        snapshot: snapshot([request({ claimed: true })]),
        progressEvents: [
          progress({
            step: "Reading the request",
            at: now - AGENT_ACTIVITY_STALL_MS - 1,
          }),
        ],
        agentConnected: true,
        runtimeOffline: false,
        now,
        heartbeatAt: now - AGENT_ACTIVITY_STALL_MS - 1,
        requestSeenAt: now - AGENT_ACTIVITY_STALL_MS - 1,
      }),
    ).toMatchObject({
      state: "stalled",
      headline: "Agent may be stalled",
    });
  });

  it("should let an attributed failure and runtime outage take precedence", () => {
    expect(
      deriveCurrentAgentActivity({
        snapshot: snapshot([request({ claimed: true })]),
        progressEvents: [
          progress({ step: "Validation failed", state: "failed" }),
        ],
        agentConnected: true,
        runtimeOffline: false,
        now,
        heartbeatAt: now,
      }),
    ).toMatchObject({
      state: "errored",
      headline: "The agent reported a problem",
    });
    expect(
      deriveCurrentAgentActivity({
        snapshot: snapshot([request({ claimed: true })]),
        progressEvents: [],
        agentConnected: false,
        runtimeOffline: true,
        now,
        heartbeatAt: 0,
      }),
    ).toMatchObject({
      state: "offline",
      headline: "The review server is unreachable",
    });
  });

  it("should skip answered and cancelled requests using serialized queue order", () => {
    const first = request();
    const second = {
      ...request({ kind: "chat" }),
      requestId: "7777777777777777",
    };
    const activity = deriveCurrentAgentActivity({
      snapshot: {
        requests: [first, second],
        responses: [],
        cancelledIds: [first.requestId],
      },
      progressEvents: [],
      agentConnected: true,
      runtimeOffline: false,
      now,
      heartbeatAt: now,
    });
    expect(activity).toMatchObject({
      state: "waiting",
      requestId: second.requestId,
      requestKind: "chat",
    });
  });
});

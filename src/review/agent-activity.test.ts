import { describe, expect, it } from "vitest";
import {
  AGENT_ACTIVITY_STALL_MS,
  deriveAgentHealthLabel,
  deriveCurrentAgentActivity,
  type AgentActivityRequest,
} from "./agent-activity.js";

const NOW = Date.parse("2026-08-08T20:00:00.000Z");
const request = (
  kind: AgentActivityRequest["kind"] = "feedback",
): AgentActivityRequest => ({
  requestId: "1111111111111111",
  kind,
  createdAt: "2026-08-08T19:59:00.000Z",
  targetLabel: "Background",
});

describe("current agent activity", () => {
  it("should prioritize disconnected status even without queued work", () => {
    expect(
      deriveCurrentAgentActivity({
        requests: [],
        responseRequestIds: new Set(),
        progressEvents: [],
        agentConnected: false,
        runtimeOffline: false,
        now: NOW,
        heartbeatAt: 0,
      }),
    ).toMatchObject({
      state: "disconnected",
      headline: "The agent is disconnected",
      supporting:
        "Reconnect the coding agent to continue. All comments are safe.",
    });
  });

  it("should report an idle connected agent as healthy", () => {
    expect(
      deriveCurrentAgentActivity({
        requests: [],
        responseRequestIds: new Set(),
        progressEvents: [],
        agentConnected: true,
        runtimeOffline: false,
        now: NOW,
        heartbeatAt: NOW,
      }),
    ).toMatchObject({
      state: "idle",
      headline: "Agent connected",
      supporting: "The agent is connected and waiting for feedback.",
    });
  });

  it("should distinguish a disconnected agent from an ordinary wait", () => {
    const activity = deriveCurrentAgentActivity({
      requests: [request()],
      responseRequestIds: new Set(),
      progressEvents: [],
      agentConnected: false,
      runtimeOffline: false,
      now: NOW,
      heartbeatAt: 0,
    });
    expect(activity).toMatchObject({
      state: "disconnected",
      tone: "danger",
      headline: "The agent is disconnected",
      supporting:
        "Reconnect the coding agent to continue. All comments are safe.",
    });
    expect(activity).not.toHaveProperty("requestId");
  });

  it("should keep fresh claimed work active between agent commands", () => {
    const activity = deriveCurrentAgentActivity({
      requests: [{ ...request(), claimedAt: new Date(NOW).toISOString() }],
      responseRequestIds: new Set(),
      progressEvents: [
        {
          requestId: "1111111111111111",
          step: "Reading the current plan",
          state: "live",
          atMs: NOW,
        },
      ],
      agentConnected: false,
      runtimeOffline: false,
      now: NOW,
      heartbeatAt: 0,
    });
    expect(activity).toMatchObject({
      state: "working",
      headline: "Responding to a comment",
      latestStep: "Reading the current plan",
    });
    expect(
      deriveAgentHealthLabel({
        activity,
        hasAgentRuntime: true,
        isReadOnly: false,
      }),
    ).toBeNull();
  });

  it.each([
    ["feedback", "Responding to a comment"],
    ["reply", "Responding in a comment thread"],
    ["chat", "Answering a plan question"],
  ] as const)("should name %s work", (kind, headline) => {
    expect(
      deriveCurrentAgentActivity({
        requests: [
          { ...request(kind), claimedAt: new Date(NOW).toISOString() },
        ],
        responseRequestIds: new Set(),
        progressEvents: [
          {
            requestId: "1111111111111111",
            step: "Reading the current plan",
            state: "live",
            atMs: NOW,
          },
        ],
        agentConnected: true,
        runtimeOffline: false,
        now: NOW,
        heartbeatAt: NOW,
      }),
    ).toMatchObject({ state: "working", headline });
  });

  it("should report stalled work after the legacy threshold", () => {
    expect(
      deriveCurrentAgentActivity({
        requests: [
          {
            ...request(),
            claimedAt: new Date(
              NOW - AGENT_ACTIVITY_STALL_MS - 1,
            ).toISOString(),
          },
        ],
        responseRequestIds: new Set(),
        progressEvents: [],
        agentConnected: true,
        runtimeOffline: false,
        now: NOW,
        heartbeatAt: NOW - AGENT_ACTIVITY_STALL_MS - 1,
      }),
    ).toMatchObject({ state: "stalled", headline: "Agent may be stalled" });
  });
});

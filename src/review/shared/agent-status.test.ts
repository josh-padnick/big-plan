import { describe, expect, it } from "vitest";
import {
  AGENT_STALL_MS,
  agentPresenceIsFresh,
  deriveAgentStatus,
  deriveAgentHealthLabel,
  deriveCurrentAgentActivity,
  projectAgentConnectionEvents,
  type AgentActivityRequest,
} from "./agent-status.js";

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

  it("should expire a previously connected agent when its heartbeat is stale", () => {
    expect(
      agentPresenceIsFresh({
        connected: true,
        heartbeatAt: NOW - 75_000,
        now: NOW,
      }),
    ).toBe(true);
    expect(
      agentPresenceIsFresh({
        connected: true,
        heartbeatAt: NOW - 75_001,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      deriveCurrentAgentActivity({
        requests: [],
        responseRequestIds: new Set(),
        progressEvents: [],
        agentConnected: true,
        runtimeOffline: false,
        now: NOW,
        heartbeatAt: NOW - AGENT_STALL_MS - 1,
      }),
    ).toMatchObject({
      state: "disconnected",
      headline: "The agent is disconnected",
      supporting: expect.stringContaining("disconnect threshold: 75 seconds"),
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

  it("should let disconnection override fresh claimed work", () => {
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
      state: "disconnected",
      headline: "The agent is disconnected",
    });
    expect(
      deriveAgentHealthLabel({
        activity,
        hasAgentRuntime: true,
        isReadOnly: false,
      }),
    ).toBe("Agent disconnected");
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
            claimedAt: new Date(NOW - AGENT_STALL_MS - 1).toISOString(),
          },
        ],
        responseRequestIds: new Set(),
        progressEvents: [],
        agentConnected: true,
        runtimeOffline: false,
        now: NOW,
        heartbeatAt: NOW,
      }),
    ).toMatchObject({ state: "stalled", headline: "Agent may be stalled" });
  });
});

describe("agent connection events", () => {
  const connectedEvent = {
    eventId: "event-1",
    connected: true,
    at: new Date(NOW - 80_000).toISOString(),
  };

  it("should keep the connected event current when the heartbeat is exactly 75 seconds old", () => {
    expect(
      projectAgentConnectionEvents({
        connected: true,
        heartbeatAt: NOW - 75_000,
        now: NOW,
        events: [connectedEvent],
      }),
    ).toEqual([connectedEvent]);
  });

  it("should project disconnection when the heartbeat is 75,001 milliseconds old", () => {
    expect(
      projectAgentConnectionEvents({
        connected: false,
        heartbeatAt: NOW - 75_001,
        now: NOW,
        events: [connectedEvent],
      }),
    ).toEqual([
      connectedEvent,
      {
        eventId: `lease-expired-${NOW}`,
        connected: false,
        at: new Date(NOW).toISOString(),
        reason: "No agent signal within 75 seconds",
      },
    ]);
  });
});

describe("agent request status", () => {
  it("should never call queued work working before pickup", () => {
    const status = deriveAgentStatus({
      runtime: "online",
      request: "pending",
      agentConnected: true,
      pickedUp: false,
      nowMs: NOW,
    });
    expect(status.stage).toBe("waiting");
    expect(status.headline).toBe("Waiting for an agent");
  });

  it("should show disconnected pending work as blocked", () => {
    const status = deriveAgentStatus({
      runtime: "online",
      request: "pending",
      agentConnected: false,
      pickedUp: false,
      nowMs: NOW,
    });
    expect(status.stage).toBe("blocked");
    expect(status.headline).toBe("Blocked - no agent connected");
    expect(status.detail).toContain("Nothing is lost");
  });

  it("should show disconnected claimed work as blocked", () => {
    const status = deriveAgentStatus({
      runtime: "online",
      request: "pending",
      agentConnected: false,
      pickedUp: true,
      lastAgentSignalAtMs: NOW,
      nowMs: NOW,
    });
    expect(status.stage).toBe("blocked");
    expect(status.headline).toBe("Blocked - no agent connected");
  });

  it("should heal stalled work when a fresh agent signal arrives", () => {
    const input = {
      runtime: "online" as const,
      request: "pending" as const,
      agentConnected: true,
      pickedUp: true,
      nowMs: NOW,
    };
    const stalled = deriveAgentStatus({
      ...input,
      lastAgentSignalAtMs: NOW - AGENT_STALL_MS - 1,
    });
    expect(stalled.stage).toBe("stalled");
    expect(stalled.headline).toBe("No progress for 1m");
    expect(stalled.detail).toContain("agent session is still connected");
    expect(
      deriveAgentStatus({
        ...input,
        surface: "chat",
        lastAgentSignalAtMs: NOW,
      }).headline,
    ).toBe("Agent is working on your feedback");
  });

  it("should describe picked-up work before the first progress signal", () => {
    const status = deriveAgentStatus({
      runtime: "online",
      request: "pending",
      agentConnected: true,
      pickedUp: true,
      nowMs: NOW,
    });
    expect(status.stage).toBe("stalled");
    expect(status.headline).toBe("No progress reported yet");
  });

  it("should keep runtime failure language distinct from agent work", () => {
    const status = deriveAgentStatus({
      runtime: "offline",
      request: "pending",
      agentConnected: true,
      pickedUp: true,
      lastAgentSignalAtMs: NOW,
      nowMs: NOW,
    });
    expect(status.stage).toBe("offline");
    expect(status.label).not.toContain("Working");
    expect(status.detail).toContain("All comments are safe");
  });
});

import { describe, expect, it } from "vitest";
import {
  AGENT_STALL_MS,
  agentPresenceIsFresh,
  deriveAgentStatus,
  deriveAgentHealthLabel,
  deriveCurrentAgentActivity,
  projectAgentConnectionState,
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
const liveClaim = (claimedAtMs = NOW) => ({
  claimedAt: new Date(claimedAtMs).toISOString(),
  claimedBy: "aaaa0000aaaa0000",
  claimExpiresAtMs: claimedAtMs + AGENT_STALL_MS,
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

  it("should keep progress-only work waiting for a durable claim", () => {
    expect(
      deriveCurrentAgentActivity({
        requests: [request()],
        responseRequestIds: new Set(),
        progressEvents: [
          {
            requestId: "1111111111111111",
            stepCode: "agent-note",
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
    ).toMatchObject({
      state: "waiting",
      headline: "Waiting for agent",
    });
  });

  it("should let disconnection override fresh claimed work", () => {
    const activity = deriveCurrentAgentActivity({
      requests: [{ ...request(), ...liveClaim() }],
      responseRequestIds: new Set(),
      progressEvents: [
        {
          requestId: "1111111111111111",
          stepCode: "agent-note",
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
        requests: [{ ...request(kind), ...liveClaim() }],
        responseRequestIds: new Set(),
        progressEvents: [
          {
            requestId: "1111111111111111",
            stepCode: "agent-note",
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

  it("should present an ordinary queue wait without a warning tone", () => {
    expect(
      deriveCurrentAgentActivity({
        requests: [request()],
        responseRequestIds: new Set(),
        progressEvents: [],
        agentConnected: true,
        runtimeOffline: false,
        now: NOW,
        heartbeatAt: NOW,
      }),
    ).toMatchObject({
      state: "waiting",
      tone: "neutral",
      headline: "Waiting for agent",
    });
  });

  it("should keep a reviewer queue edit waiting before agent pickup", () => {
    expect(
      deriveCurrentAgentActivity({
        requests: [request("chat")],
        responseRequestIds: new Set(),
        progressEvents: [
          {
            requestId: "1111111111111111",
            stepCode: "queued-message-revised",
            step: "Queued message edited by reviewer",
            state: "waiting",
            atMs: NOW,
          },
        ],
        agentConnected: true,
        runtimeOffline: false,
        now: NOW,
        heartbeatAt: NOW,
      }),
    ).toMatchObject({
      state: "waiting",
      tone: "neutral",
      headline: "Waiting for agent",
    });
  });

  it("should return work to waiting after its claim lapses", () => {
    expect(
      deriveCurrentAgentActivity({
        requests: [
          {
            ...request(),
            ...liveClaim(NOW - AGENT_STALL_MS - 1),
          },
        ],
        responseRequestIds: new Set(),
        progressEvents: [],
        agentConnected: true,
        runtimeOffline: false,
        now: NOW,
        heartbeatAt: NOW,
      }),
    ).toMatchObject({ state: "waiting", headline: "Waiting for agent" });
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
      projectAgentConnectionState({
        presenceConnected: true,
        heartbeatAt: NOW - 75_000,
        now: NOW,
        events: [connectedEvent],
      }),
    ).toEqual({ connected: true, events: [connectedEvent] });
  });

  it("should project disconnection when the heartbeat is 75,001 milliseconds old", () => {
    expect(
      projectAgentConnectionState({
        presenceConnected: true,
        heartbeatAt: NOW - 75_001,
        now: NOW,
        events: [connectedEvent],
      }),
    ).toEqual({
      connected: false,
      events: [
        connectedEvent,
        {
          eventId: `presence-disconnected-${NOW}`,
          connected: false,
          at: new Date(NOW).toISOString(),
          reason: "No agent signal within 75 seconds",
        },
      ],
    });
  });

  it("should keep disconnection current when a reconnect event races after stale presence", () => {
    const reconnectAt = NOW - 500;
    const projection = projectAgentConnectionState({
      presenceConnected: false,
      heartbeatAt: NOW - 76_000,
      now: NOW,
      events: [
        connectedEvent,
        {
          eventId: "event-2",
          connected: true,
          at: new Date(reconnectAt).toISOString(),
        },
      ],
    });
    expect(projection.connected).toBe(false);
    expect(projection.events.at(-1)).toMatchObject({
      connected: false,
      at: new Date(reconnectAt + 1).toISOString(),
    });
  });

  it("should keep connection current when a disconnect event races after fresh presence", () => {
    const disconnectAt = NOW - 500;
    const projection = projectAgentConnectionState({
      presenceConnected: true,
      heartbeatAt: NOW - 1_000,
      now: NOW,
      events: [
        connectedEvent,
        {
          eventId: "event-2",
          connected: false,
          at: new Date(disconnectAt).toISOString(),
        },
      ],
    });
    expect(projection.connected).toBe(true);
    expect(projection.events.at(-1)).toMatchObject({
      connected: true,
      at: new Date(disconnectAt + 1).toISOString(),
    });
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

  it("should report a busy queue neutrally and with its position", () => {
    expect(
      deriveAgentStatus({
        runtime: "online",
        request: "pending",
        agentConnected: true,
        pickedUp: false,
        sessionBusy: true,
        queuedAhead: 2,
        nowMs: NOW,
      }),
    ).toMatchObject({
      stage: "waiting",
      label: "Queued, 2 ahead",
      headline: "Waiting - the agent is working on another request",
      tone: "neutral",
    });
  });

  it("should keep the plain waiting label when nothing is ahead", () => {
    expect(
      deriveAgentStatus({
        runtime: "online",
        request: "pending",
        agentConnected: true,
        pickedUp: false,
        sessionBusy: true,
        queuedAhead: 0,
        nowMs: NOW,
      }).label,
    ).toBe("Waiting");
  });

  it("should count one queued message ahead in the singular", () => {
    expect(
      deriveAgentStatus({
        runtime: "online",
        request: "pending",
        agentConnected: true,
        pickedUp: false,
        sessionBusy: true,
        queuedAhead: 1,
        nowMs: NOW,
      }).label,
    ).toBe("Queued, 1 ahead");
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

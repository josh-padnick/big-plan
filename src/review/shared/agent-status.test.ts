import { describe, expect, it } from "vitest";
import {
  AGENT_RECOVERY_HORIZON_MS,
  AGENT_STALL_MS,
  agentConnectionEdgeAtMs,
  agentDisconnectReason,
  agentHoldsClaimedWork,
  heldWorkQuiet,
  AGENT_NO_SIGNAL_REASON,
  AGENT_SESSION_ENDED_REASON,
  agentPresenceIsFresh,
  deriveAgentStatus,
  deriveAgentHealthLabel,
  deriveCurrentAgentActivity,
  projectAgentConnectionState,
  selectActiveAgentRequest,
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
        cancelPendingRequestIds: new Set(),
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
        cancelPendingRequestIds: new Set(),
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
        cancelPendingRequestIds: new Set(),
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
      cancelPendingRequestIds: new Set(),
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
        cancelPendingRequestIds: new Set(),
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

  it("should ignore an answered request when its response is unavailable", () => {
    expect(
      deriveCurrentAgentActivity({
        requests: [
          {
            ...request(),
            ...liveClaim(),
            answeredAt: "2026-08-08T20:00:01.000Z",
          },
        ],
        cancelPendingRequestIds: new Set(),
        progressEvents: [],
        agentConnected: true,
        runtimeOffline: false,
        now: NOW,
        heartbeatAt: NOW,
      }),
    ).toMatchObject({
      state: "idle",
      headline: "Agent connected",
    });
  });

  it("should keep fresh claimed work visible when presence is stale", () => {
    const activity = deriveCurrentAgentActivity({
      requests: [{ ...request(), ...liveClaim() }],
      cancelPendingRequestIds: new Set(),
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
      state: "working",
      headline: "Responding to a comment",
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
        requests: [{ ...request(kind), ...liveClaim() }],
        cancelPendingRequestIds: new Set(),
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
        cancelPendingRequestIds: new Set(),
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
        cancelPendingRequestIds: new Set(),
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

  it("should report picked-up work as stalled rather than queued after its claim lapses", () => {
    expect(
      deriveCurrentAgentActivity({
        requests: [
          {
            ...request(),
            ...liveClaim(NOW - AGENT_STALL_MS - 1),
          },
        ],
        cancelPendingRequestIds: new Set(),
        progressEvents: [],
        agentConnected: true,
        runtimeOffline: false,
        now: NOW,
        heartbeatAt: NOW,
      }),
    ).toMatchObject({
      state: "stalled",
      tone: "warning",
      headline: "Agent may be stalled",
    });
  });

  // BIG-147. `agent next` hands the work over and its process exits, so a turn
  // longer than the lease renews nothing. Reading that silence as a lost agent
  // told the reviewer the session had ended while the agent was working, and
  // invited them to reconnect - which under adr/0002 lets a second agent take
  // the plan from the one still editing it.
  it("should not call a working agent disconnected while it holds quiet work", () => {
    const activity = deriveCurrentAgentActivity({
      requests: [
        {
          ...request(),
          ...liveClaim(NOW - AGENT_STALL_MS - 60_000),
        },
      ],
      cancelPendingRequestIds: new Set(),
      progressEvents: [],
      agentConnected: false,
      runtimeOffline: false,
      now: NOW,
      heartbeatAt: NOW - AGENT_STALL_MS - 60_000,
    });
    expect(activity).toMatchObject({
      state: "stalled",
      tone: "warning",
      headline: "Agent may be stalled",
      requestId: "1111111111111111",
    });
    expect(activity).toHaveProperty(
      "supporting",
      expect.stringContaining("reported nothing for 2m 15s"),
    );
    expect(activity).not.toHaveProperty(
      "supporting",
      expect.stringContaining("Reconnect"),
    );
    expect(
      deriveAgentHealthLabel({
        activity,
        hasAgentRuntime: true,
        isReadOnly: false,
      }),
    ).toBe("Agent not responding");
  });

  it("should still report disconnection once no agent holds any work", () => {
    expect(
      deriveCurrentAgentActivity({
        requests: [
          {
            ...request(),
            ...liveClaim(NOW - AGENT_STALL_MS - 1),
            answeredAt: "2026-08-08T19:59:30.000Z",
          },
        ],
        cancelPendingRequestIds: new Set(),
        progressEvents: [],
        agentConnected: false,
        runtimeOffline: false,
        now: NOW,
        heartbeatAt: NOW - AGENT_STALL_MS - 1,
      }),
    ).toMatchObject({
      state: "disconnected",
      headline: "The agent is disconnected",
    });
  });

  it("should keep a failed step ahead of the silence that follows it", () => {
    expect(
      deriveCurrentAgentActivity({
        requests: [
          {
            ...request(),
            ...liveClaim(NOW - AGENT_STALL_MS - 1),
          },
        ],
        cancelPendingRequestIds: new Set(),
        progressEvents: [
          {
            requestId: "1111111111111111",
            stepCode: "agent-note",
            step: "Reading the plan",
            state: "failed",
            detail: "Out of usage",
          },
        ],
        agentConnected: false,
        runtimeOffline: false,
        now: NOW,
        heartbeatAt: 0,
      }),
    ).toMatchObject({
      state: "errored",
      headline: "The agent reported a problem",
    });
  });

  it("should prefer live claimed work over an older lapsed request", () => {
    expect(
      deriveCurrentAgentActivity({
        requests: [
          {
            ...request(),
            ...liveClaim(NOW - AGENT_STALL_MS - 1),
          },
          {
            ...request("chat"),
            requestId: "2222222222222222",
            createdAt: "2026-08-08T19:59:30.000Z",
            ...liveClaim(),
          },
        ],
        cancelPendingRequestIds: new Set(),
        progressEvents: [],
        agentConnected: true,
        runtimeOffline: false,
        now: NOW,
        heartbeatAt: NOW,
      }),
    ).toMatchObject({
      state: "working",
      requestId: "2222222222222222",
      headline: "Answering a plan question",
    });
  });

  it("should keep renewed claimed work current when side channels are stale", () => {
    expect(
      deriveCurrentAgentActivity({
        requests: [
          {
            ...request(),
            claimedAt: new Date(NOW - AGENT_STALL_MS * 2).toISOString(),
            claimedBy: "aaaa0000aaaa0000",
            claimExpiresAtMs: NOW + AGENT_STALL_MS,
          },
        ],
        cancelPendingRequestIds: new Set(),
        progressEvents: [],
        agentConnected: false,
        runtimeOffline: false,
        now: NOW,
        heartbeatAt: NOW - AGENT_STALL_MS - 1,
      }),
    ).toMatchObject({
      state: "working",
      requestId: "1111111111111111",
      updatedAtMs: NOW,
    });
  });

  it("should select only live nonterminal claims as active work", () => {
    expect(
      selectActiveAgentRequest({
        requests: [
          {
            ...request(),
            ...liveClaim(),
            answeredAt: new Date(NOW).toISOString(),
          },
          {
            ...request("reply"),
            requestId: "2222222222222222",
            ...liveClaim(NOW - AGENT_STALL_MS - 1),
          },
          {
            ...request("chat"),
            requestId: "3333333333333333",
            ...liveClaim(),
          },
        ],
        cancelPendingRequestIds: new Set(),
        now: NOW,
      }),
    ).toMatchObject({ requestId: "3333333333333333" });
  });
});

describe("held work", () => {
  const held = {
    requests: [{ ...request(), ...liveClaim(NOW) }],
    now: NOW,
  };

  // BIG-147. The lease has by definition already lapsed during the quiet turn
  // this answers for, so a lease test here would answer "no" exactly when the
  // question matters.
  it("should still hold work whose lease lapsed long ago", () => {
    expect(
      agentHoldsClaimedWork({
        requests: [{ ...request(), ...liveClaim(NOW - AGENT_STALL_MS * 10) }],
        cancelPendingRequestIds: new Set(),
        now: NOW,
      }),
    ).toBe(true);
  });

  it.each([
    ["answered", { answeredAt: "2026-08-08T19:59:30.000Z" }],
    ["canceled", { canceledAt: "2026-08-08T19:59:30.000Z" }],
  ])("should release the plan once the request is %s", (_name, terminal) => {
    expect(
      agentHoldsClaimedWork({
        requests: [{ ...request(), ...liveClaim(), ...terminal }],
        cancelPendingRequestIds: new Set(),
        now: NOW,
      }),
    ).toBe(false);
  });

  it("should release the plan while a cancel is in flight", () => {
    expect(
      agentHoldsClaimedWork({
        ...held,
        cancelPendingRequestIds: new Set(["1111111111111111"]),
      }),
    ).toBe(false);
  });

  it("should not treat a request nobody picked up as held work", () => {
    expect(
      agentHoldsClaimedWork({
        requests: [request()],
        cancelPendingRequestIds: new Set(),
        now: NOW,
      }),
    ).toBe(false);
  });

  // BIG-147. Nothing reaps a claim, so an explanation with no upper bound would
  // account for silence forever on a plan no agent is attached to.
  it("should stop explaining the quiet once the claim passes the recovery horizon", () => {
    const quietFor = (ms: number) => ({
      requests: [{ ...request(), ...liveClaim(NOW - ms) }],
      cancelPendingRequestIds: new Set<string>(),
      now: NOW,
    });
    expect(heldWorkQuiet(quietFor(AGENT_RECOVERY_HORIZON_MS))).toBe(
      "explained",
    );
    expect(heldWorkQuiet(quietFor(AGENT_RECOVERY_HORIZON_MS + 1))).toBe(
      "stale",
    );
    expect(agentHoldsClaimedWork(quietFor(AGENT_RECOVERY_HORIZON_MS))).toBe(
      true,
    );
    expect(agentHoldsClaimedWork(quietFor(AGENT_RECOVERY_HORIZON_MS + 1))).toBe(
      false,
    );
  });

  it("should keep explaining the quiet while any one claim is inside the horizon", () => {
    expect(
      heldWorkQuiet({
        requests: [
          { ...request(), ...liveClaim(NOW - AGENT_RECOVERY_HORIZON_MS - 1) },
          {
            ...request(),
            requestId: "2222222222222222",
            ...liveClaim(NOW - AGENT_STALL_MS * 2),
          },
        ],
        cancelPendingRequestIds: new Set(),
        now: NOW,
      }),
    ).toBe("explained");
  });

  it("should report no held work when nobody has picked anything up", () => {
    expect(
      heldWorkQuiet({
        requests: [request()],
        cancelPendingRequestIds: new Set(),
        now: NOW,
      }),
    ).toBe("none");
  });
});

describe("claimed work attribution", () => {
  const claimedAt = (requestId: string, quietForMs: number) => ({
    ...request(),
    requestId,
    ...liveClaim(NOW - quietForMs),
  });

  // BIG-147. Requests arrive oldest-first, so list order described an abandoned
  // claim's age and linked its thread while a later turn was the one in flight.
  it("should describe the most recent pickup rather than the oldest claim", () => {
    const abandoned = claimedAt("1111111111111111", AGENT_STALL_MS * 12);
    const working = claimedAt("2222222222222222", AGENT_STALL_MS * 2);
    const activity = deriveCurrentAgentActivity({
      requests: [abandoned, working],
      cancelPendingRequestIds: new Set(),
      progressEvents: [],
      agentConnected: false,
      runtimeOffline: false,
      now: NOW,
      heartbeatAt: 0,
    });
    expect(activity).toMatchObject({
      state: "stalled",
      requestId: "2222222222222222",
      updatedAtMs: NOW - AGENT_STALL_MS * 2,
    });
    expect(activity).toHaveProperty(
      "supporting",
      expect.stringContaining("2m 30s"),
    );
  });

  // BIG-147. In this state a claim genuinely is still open and the recovery
  // section directly below the card names what connecting a session costs, so
  // the card must not end on a bare invitation to reconnect.
  it("should name the takeover when a stale claim is still open", () => {
    const supporting = (requests: ReadonlyArray<AgentActivityRequest>) => {
      const activity = deriveCurrentAgentActivity({
        requests,
        cancelPendingRequestIds: new Set<string>(),
        progressEvents: [],
        agentConnected: false,
        runtimeOffline: false,
        now: NOW,
        heartbeatAt: NOW - AGENT_STALL_MS - 1,
      });
      expect(activity).toMatchObject({ state: "disconnected" });
      return "supporting" in activity ? activity.supporting : "";
    };
    expect(
      supporting([
        claimedAt("1111111111111111", AGENT_RECOVERY_HORIZON_MS + 1),
      ]),
    ).toContain("takes that work over");
    expect(supporting([])).not.toContain("takes that work over");
  });

  it("should stop claiming a stall once every claim passes the horizon", () => {
    const activity = deriveCurrentAgentActivity({
      requests: [claimedAt("1111111111111111", AGENT_RECOVERY_HORIZON_MS + 1)],
      cancelPendingRequestIds: new Set(),
      progressEvents: [],
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

  // BIG-147. A killed agent leaves its claim behind, and that claim outlives
  // the review session that saw it: restart `big-plan review` and the abandoned
  // request is still open on a runtime no agent has ever attached to. Held work
  // may name a stall on the activity card, but it must never let a connection
  // surface assert a connection nobody observed.
  it("should report no connection on a fresh session holding an abandoned claim", () => {
    const abandoned = {
      ...request(),
      ...liveClaim(NOW - AGENT_STALL_MS * 10),
    };
    expect(
      projectAgentConnectionState({
        presenceConnected: false,
        heartbeatAt: 0,
        now: NOW,
        events: [],
      }),
    ).toEqual({ connected: false, events: [] });
    expect(
      deriveCurrentAgentActivity({
        requests: [abandoned],
        cancelPendingRequestIds: new Set(),
        progressEvents: [],
        agentConnected: false,
        runtimeOffline: false,
        now: NOW,
        heartbeatAt: 0,
      }),
    ).toMatchObject({ state: "stalled", headline: "Agent may be stalled" });
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

  it("should report a positioned queue neutrally", () => {
    expect(
      deriveAgentStatus({
        runtime: "online",
        request: "pending",
        agentConnected: true,
        pickedUp: false,
        queuedAhead: 2,
        nowMs: NOW,
      }),
    ).toMatchObject({
      stage: "waiting",
      label: "Queued, 2 ahead",
      headline: "Waiting for an agent",
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

  it("should keep claimed work active when presence is disconnected", () => {
    const status = deriveAgentStatus({
      runtime: "online",
      request: "pending",
      agentConnected: false,
      pickedUp: true,
      lastAgentSignalAtMs: NOW,
      nowMs: NOW,
    });
    expect(status.stage).toBe("working");
    expect(status.headline).toBe("Agent is working on this");
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
    // The silence that reaches this branch is the only evidence there is, so
    // the detail must not assert anything about the session (BIG-147).
    expect(stalled.detail).not.toContain("still connected");
    expect(stalled.detail).toContain("Check the agent terminal");
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

// BIG-156: an end the agent's own loop reported is a fact, and everything the
// reviewer reads about it has to stop guessing.
describe("observed session end", () => {
  it("should name a reported end apart from an inferred silence", () => {
    expect(agentDisconnectReason({})).toBe(AGENT_NO_SIGNAL_REASON);
    expect(agentDisconnectReason({ endedAtMs: NOW })).toBe(
      AGENT_SESSION_ENDED_REASON,
    );
    expect(AGENT_SESSION_ENDED_REASON).toBe("The agent session ended");
  });

  it("should date a stored edge from the report rather than the poll", () => {
    // The runtime's checker polls every 750ms, so dating a reported end from
    // the poll would put the durable log behind the fact by up to an interval.
    expect(agentConnectionEdgeAtMs({ endedAtMs: NOW - 700, nowMs: NOW })).toBe(
      NOW - 700,
    );
    expect(agentConnectionEdgeAtMs({ nowMs: NOW })).toBe(NOW);
    expect(agentConnectionEdgeAtMs({ endedAtMs: Number.NaN, nowMs: NOW })).toBe(
      NOW,
    );
  });

  it("should replace the threshold sentence with the reported end", () => {
    const activity = deriveCurrentAgentActivity({
      requests: [],
      cancelPendingRequestIds: new Set(),
      progressEvents: [],
      agentConnected: false,
      runtimeOffline: false,
      now: NOW,
      heartbeatAt: NOW - 4_000,
      endedAtMs: NOW - 4_000,
    });
    expect(activity.state).toBe("disconnected");
    expect(activity.headline).toBe("The agent is disconnected");
    expect(activity.supporting).toBe(
      "The agent session ended 4s ago. Reconnect the coding agent to continue. All comments are safe.",
    );
    // Nothing is being inferred any more, so nothing may state a threshold.
    expect(activity.supporting).not.toContain("disconnect threshold");
  });

  it("should keep the threshold sentence for a silence nobody reported", () => {
    const activity = deriveCurrentAgentActivity({
      requests: [],
      cancelPendingRequestIds: new Set(),
      progressEvents: [],
      agentConnected: false,
      runtimeOffline: false,
      now: NOW,
      heartbeatAt: NOW - AGENT_STALL_MS - 1_000,
    });
    expect(activity.supporting).toContain("disconnect threshold");
    expect(activity.supporting).not.toContain("session ended");
  });

  it("should date a projected end edge from the report, not the lease", () => {
    const endedAtMs = NOW - 4_000;
    const projected = projectAgentConnectionState({
      presenceConnected: false,
      heartbeatAt: NOW - 4_500,
      endedAtMs,
      now: NOW,
      events: [
        {
          eventId: "connected-1",
          connected: true,
          at: new Date(NOW - 60_000).toISOString(),
        },
      ],
    });
    expect(projected.connected).toBe(false);
    const edge = projected.events.at(-1);
    expect(edge?.connected).toBe(false);
    expect(edge?.reason).toBe(AGENT_SESSION_ENDED_REASON);
    // The lease has not expired, so aging alone would have recorded nothing
    // and dated it now; the reported instant is what the log must carry.
    expect(Date.parse(edge?.at ?? "")).toBe(endedAtMs);
  });
});

import { describe, expect, it } from "vitest";
import { AGENT_DISCONNECTED_REASON } from "./agent-disconnect.js";
import {
  AGENT_RECOVERY_HORIZON_MS,
  AGENT_STALL_MS,
  agentActivityIsAttached,
  agentConnectionEdgeAtMs,
  agentDisconnectDropsWork,
  agentDisconnectReason,
  agentHasEverConnected,
  agentHoldsClaimedWork,
  heldWorkQuiet,
  AGENT_NO_SIGNAL_REASON,
  AGENT_SESSION_ENDED_REASON,
  agentPresenceIsFresh,
  deriveAgentStatus,
  deriveAgentHealth,
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

describe("agent health", () => {
  const idle = (heartbeatAt: number, now: number) =>
    deriveCurrentAgentActivity({
      everConnected: true,
      requests: [],
      cancelPendingRequestIds: new Set(),
      progressEvents: [],
      agentConnected: true,
      runtimeOffline: false,
      now,
      heartbeatAt,
    });

  // Presence is read on one window, the narration window, because nothing
  // renews the plan-wide heartbeat while a turn runs (BIG-147). Detecting a
  // cancelled agent sooner is real and wanted, but it belongs to the loop layer
  // that would keep the heartbeat fresh while a turn is in flight (BIG-156);
  // narrowing this window instead would call working agents disconnected.
  it("should stop calling a silent agent connected once its signal ages out", () => {
    const stillAttached = deriveAgentHealth({
      activity: idle(NOW - AGENT_STALL_MS + 1, NOW),
      hasAgentRuntime: true,
      isReadOnly: false,
      isObservable: true,
    });
    expect(stillAttached).toEqual({
      indicator: "healthy",
      label: "Agent connected",
    });
    const gone = deriveAgentHealth({
      activity: idle(NOW - AGENT_STALL_MS - 1, NOW),
      hasAgentRuntime: true,
      isReadOnly: false,
      isObservable: true,
    });
    expect(gone).toEqual({ indicator: "error", label: "Agent disconnected" });
  });

  it("should read a queued request as connected rather than as a fault", () => {
    const queued = deriveCurrentAgentActivity({
      everConnected: true,
      requests: [request()],
      cancelPendingRequestIds: new Set(),
      progressEvents: [],
      agentConnected: true,
      runtimeOffline: false,
      now: NOW,
      heartbeatAt: NOW,
    });
    expect(queued).toMatchObject({ state: "waiting", tone: "neutral" });
    expect(
      deriveAgentHealth({
        activity: queued,
        hasAgentRuntime: true,
        isReadOnly: false,
        isObservable: true,
      }),
    ).toEqual({ indicator: "healthy", label: "Agent connected" });
  });

  it("should rank a superseded session above every observable agent state", () => {
    expect(
      deriveAgentHealth({
        activity: idle(NOW, NOW),
        hasAgentRuntime: true,
        isReadOnly: true,
        isObservable: true,
      }),
    ).toEqual({ indicator: "read-only", label: "Using read-only session" });
  });

  it("should report an unobservable review session as unknown, never as bad", () => {
    expect(
      deriveAgentHealth({
        activity: idle(NOW, NOW),
        hasAgentRuntime: true,
        isReadOnly: false,
        isObservable: false,
      }),
    ).toEqual({ indicator: "unavailable", label: "Agent status unavailable" });
    expect(
      deriveAgentHealth({
        activity: idle(NOW, NOW),
        hasAgentRuntime: false,
        isReadOnly: false,
        isObservable: true,
      }),
    ).toEqual({ indicator: "unavailable", label: "No agent session" });
  });
});

describe("current agent activity", () => {
  it("should prioritize disconnected status even without queued work", () => {
    expect(
      deriveCurrentAgentActivity({
        everConnected: true,
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
      headline: "The agent has disconnected.",
      supporting:
        "Reconnect the coding agent to continue. All comments are safe.",
    });
  });

  it("should report an idle connected agent as healthy", () => {
    expect(
      deriveCurrentAgentActivity({
        everConnected: true,
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

  // Presence answers "is an agent attached", which the waiting loop proves
  // twice a second. Its silence expires on the shared window; held work may
  // explain activity during that silence, but never extends presence.
  it("should expire a previously connected agent when its heartbeat is stale", () => {
    expect(
      agentPresenceIsFresh({
        connected: true,
        heartbeatAt: NOW - AGENT_STALL_MS,
        now: NOW,
      }),
    ).toBe(true);
    expect(
      agentPresenceIsFresh({
        connected: true,
        heartbeatAt: NOW - AGENT_STALL_MS - 1,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      deriveCurrentAgentActivity({
        everConnected: true,
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
      headline: "The agent has disconnected.",
      supporting:
        "No agent signal for 1m 15s (disconnect threshold: 75 seconds); the session may have ended or gone idle. Reconnect to continue. All comments are safe.",
    });
  });

  it("should distinguish a disconnected agent from an ordinary wait", () => {
    const activity = deriveCurrentAgentActivity({
      everConnected: true,
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
      headline: "The agent has disconnected.",
      supporting:
        "Reconnect the coding agent to continue. All comments are safe.",
    });
    expect(activity).not.toHaveProperty("requestId");
  });

  it("should not claim a connection ended when none ever began", () => {
    const activity = deriveCurrentAgentActivity({
      everConnected: false,
      requests: [],
      cancelPendingRequestIds: new Set(),
      progressEvents: [],
      agentConnected: false,
      runtimeOffline: false,
      now: NOW,
      heartbeatAt: 0,
    });
    expect(activity).toMatchObject({
      state: "never-connected",
      tone: "neutral",
      headline: "No agent has connected to this session yet.",
      supporting: "Connect one to continue. All comments are safe.",
    });
    // The distinction is the whole point: a fresh session must not inherit the
    // account of a connection that ended, nor its alarm.
    expect(
      deriveAgentHealth({
        activity,
        hasAgentRuntime: true,
        isReadOnly: false,
        isObservable: true,
      }),
    ).toEqual({ indicator: "unavailable", label: "No agent connected yet" });
  });

  it("should read the connection log, not the lease, for a first connection", () => {
    const at = new Date(NOW).toISOString();
    expect(agentHasEverConnected({ events: [] })).toBe(false);
    expect(
      agentHasEverConnected({
        events: [{ eventId: "a", connected: false, at }],
      }),
    ).toBe(false);
    expect(
      agentHasEverConnected({
        events: [
          { eventId: "a", connected: true, at },
          { eventId: "b", connected: false, at },
        ],
      }),
    ).toBe(true);
  });

  it("should keep progress-only work waiting for a durable claim", () => {
    expect(
      deriveCurrentAgentActivity({
        everConnected: true,
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
        everConnected: true,
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
      everConnected: true,
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
    // Live claimed work outranks stale presence, and the control says so.
    expect(
      deriveAgentHealth({
        activity,
        hasAgentRuntime: true,
        isReadOnly: false,
        isObservable: true,
      }),
    ).toEqual({ indicator: "working", label: "Agent working" });
  });

  it.each([
    ["feedback", "Responding to a comment"],
    ["reply", "Responding in a comment thread"],
    ["chat", "Answering a plan question"],
    ["push", "Preparing a pushed plan change"],
  ] as const)("should name %s work", (kind, headline) => {
    expect(
      deriveCurrentAgentActivity({
        everConnected: true,
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
        everConnected: true,
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
        everConnected: true,
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
        everConnected: true,
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
      everConnected: true,
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
      deriveAgentHealth({
        activity,
        hasAgentRuntime: true,
        isReadOnly: false,
        isObservable: true,
      }),
    ).toEqual({ indicator: "stalled", label: "Agent not responding" });
  });

  it("should still report disconnection once no agent holds any work", () => {
    expect(
      deriveCurrentAgentActivity({
        everConnected: true,
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
      headline: "The agent has disconnected.",
    });
  });

  it("should keep a failed step ahead of the silence that follows it", () => {
    expect(
      deriveCurrentAgentActivity({
        everConnected: true,
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
        everConnected: true,
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
        everConnected: true,
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
      everConnected: true,
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
        everConnected: true,
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

  /*
  BIG-171: an end the reviewer performed is never explained as one Big Plan
  inferred.

  The threshold sentence, the "may have gone idle" hedge and the invitation to
  reconnect all exist to account for an absence nobody witnessed. Said to a
  reviewer who has just disconnected the agent on purpose, they read as the
  product failing to notice what they did.
  */
  it("should state the reviewer's own disconnect rather than a lapsed signal", () => {
    const activity = deriveCurrentAgentActivity({
      everConnected: true,
      requests: [],
      cancelPendingRequestIds: new Set<string>(),
      progressEvents: [],
      agentConnected: false,
      runtimeOffline: false,
      now: NOW,
      heartbeatAt: NOW - AGENT_STALL_MS - 1,
      endedAtMs: NOW - 1_000,
      disconnectRequestedAtMs: NOW - 2_000,
    });
    expect(activity).toMatchObject({
      state: "disconnected",
      headline: "Agent disconnected",
    });
    const supporting = "supporting" in activity ? activity.supporting : "";
    expect(supporting).toContain("You disconnected this agent");
    expect(supporting).not.toContain("disconnect threshold");
    expect(supporting).not.toContain("Reconnect the coding agent");
    expect(supporting).toContain("All comments are safe");
  });

  it("should stop claiming a stall once every claim passes the horizon", () => {
    const activity = deriveCurrentAgentActivity({
      everConnected: true,
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
      headline: "The agent has disconnected.",
    });
    expect(
      deriveAgentHealth({
        activity,
        hasAgentRuntime: true,
        isReadOnly: false,
        isObservable: true,
      }),
    ).toEqual({ indicator: "error", label: "Agent disconnected" });
  });
});

describe("agent connection events", () => {
  const connectedEvent = {
    eventId: "event-1",
    connected: true,
    at: new Date(NOW - 80_000).toISOString(),
  };

  it("should keep the connected event current at the attachment boundary", () => {
    expect(
      projectAgentConnectionState({
        presenceConnected: true,
        heartbeatAt: NOW - AGENT_STALL_MS,
        now: NOW,
        events: [connectedEvent],
      }),
    ).toEqual({ connected: true, events: [connectedEvent] });
  });

  it("should project disconnection one millisecond past the signal window", () => {
    expect(
      projectAgentConnectionState({
        presenceConnected: true,
        heartbeatAt: NOW - AGENT_STALL_MS - 1,
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
        everConnected: true,
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

  it("should name a disconnect the reviewer asked for ahead of both defaults", () => {
    // The reviewer's act is a fact whether or not the agent lived long enough
    // to acknowledge it, so it outranks a silence and outranks the agent's own
    // report of the same end (BIG-190).
    expect(agentDisconnectReason({ disconnectRequestedAtMs: NOW })).toBe(
      AGENT_DISCONNECTED_REASON,
    );
    expect(
      agentDisconnectReason({
        endedAtMs: NOW,
        disconnectRequestedAtMs: NOW,
      }),
    ).toBe(AGENT_DISCONNECTED_REASON);
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
      everConnected: true,
    });
    expect(activity.state).toBe("disconnected");
    expect(activity.headline).toBe("The agent has disconnected.");
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
      everConnected: true,
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

// BIG-190: the two questions the Disconnect control asks about the card it sits
// on - is there anyone to disconnect, and would disconnecting cost an answer.
describe("disconnecting the attached agent", () => {
  it("should offer a disconnect wherever an agent is attached", () => {
    for (const state of [
      "working",
      "waiting",
      "stalled",
      "errored",
      "handoff",
      "handoff-blocked",
      "idle",
    ] as const) {
      expect(agentActivityIsAttached({ state })).toBe(true);
    }
  });

  it("should offer no disconnect when nobody is on the other end", () => {
    for (const state of [
      "never-connected",
      "disconnected",
      "offline",
    ] as const) {
      expect(agentActivityIsAttached({ state })).toBe(false);
    }
  });

  it("should warn about dropped work whenever a claim is held", () => {
    // A stalled or errored turn is still a turn: it is the live claim that
    // costs something, not how well the agent holding it is doing.
    for (const state of ["working", "stalled", "errored"] as const) {
      expect(agentDisconnectDropsWork({ state })).toBe(true);
    }
  });

  it("should not warn about dropped work when the queue is merely waiting", () => {
    // A request nobody picked up stays queued for the next agent.
    for (const state of [
      "waiting",
      "handoff",
      "handoff-blocked",
      "idle",
      "disconnected",
    ] as const) {
      expect(agentDisconnectDropsWork({ state })).toBe(false);
    }
  });
});

// BIG-131: the approval is the one item whose whole life is settled steps, so
// the card that names the agent's state has to read them directly or say
// nothing at all about the decision the reviewer just handed over.
describe("the approval handoff on the status card", () => {
  const approvalRequest = (
    overrides: Partial<AgentActivityRequest> = {},
  ): AgentActivityRequest => ({
    requestId: "dddddddddddddddd",
    kind: "approval",
    createdAt: "2026-08-08T19:59:00.000Z",
    ...overrides,
  });
  const STEP_TEXT = {
    "plan-approved": "Plan approved",
    "approval-acknowledged": "Approval acknowledged",
    "approval-revoked": "Approval revoked",
    "approval-blocked": "Approval not acknowledged",
    "response-ready": "Agent response ready",
    "request-canceled": "Request canceled",
  } as const;
  const step = (
    stepCode: keyof typeof STEP_TEXT,
    atMs: number,
    requestId = "dddddddddddddddd",
  ) => ({
    requestId,
    atMs,
    stepCode,
    step: STEP_TEXT[stepCode],
    state: "done",
  });
  const activityFor = ({
    requests,
    progressEvents,
  }: {
    readonly requests: ReadonlyArray<AgentActivityRequest>;
    readonly progressEvents: ReadonlyArray<ReturnType<typeof step>>;
  }) =>
    deriveCurrentAgentActivity({
      everConnected: true,
      requests,
      cancelPendingRequestIds: new Set<string>(),
      progressEvents,
      agentConnected: true,
      runtimeOffline: false,
      now: NOW,
      heartbeatAt: NOW,
    });

  it("should report an approved plan still waiting to be acknowledged", () => {
    expect(
      activityFor({
        requests: [approvalRequest()],
        progressEvents: [step("plan-approved", NOW - 2_000)],
      }),
    ).toMatchObject({
      state: "handoff",
      headline: "Plan approved",
      supporting: "Waiting for the agent to acknowledge the approval.",
      requestId: "dddddddddddddddd",
      requestKind: "approval",
      updatedAtMs: NOW - 2_000,
    });
  });

  it("should report the acknowledgment the answer ends the request with", () => {
    const activity = activityFor({
      requests: [approvalRequest({ answeredAt: "2026-08-08T20:00:00.000Z" })],
      progressEvents: [
        step("plan-approved", NOW - 2_000),
        step("approval-acknowledged", NOW - 1_000),
      ],
    });
    expect(activity).toMatchObject({
      state: "handoff",
      headline: "Plan approved",
      updatedAtMs: NOW - 1_000,
    });
    expect("supporting" in activity ? activity.supporting : "").toContain(
      "Approval acknowledged",
    );
  });

  it("should stop reporting a handoff the reviewer revoked", () => {
    expect(
      activityFor({
        requests: [approvalRequest({ canceledAt: "2026-08-08T20:00:00.000Z" })],
        progressEvents: [
          step("plan-approved", NOW - 2_000),
          step("approval-revoked", NOW - 1_000),
        ],
      }),
    ).toMatchObject({ state: "idle" });
  });

  it("should keep queued work ahead of a settled handoff", () => {
    expect(
      activityFor({
        requests: [
          approvalRequest({ answeredAt: "2026-08-08T20:00:00.000Z" }),
          request(),
        ],
        progressEvents: [
          step("plan-approved", NOW - 2_000),
          step("approval-acknowledged", NOW - 1_000),
        ],
      }),
    ).toMatchObject({ state: "waiting", requestId: "1111111111111111" });
  });

  it("should lead with the stop when the agent refuses the handoff", () => {
    const activity = activityFor({
      requests: [approvalRequest({ answeredAt: "2026-08-08T20:00:00.000Z" })],
      progressEvents: [
        step("plan-approved", NOW - 2_000),
        step("approval-blocked", NOW - 1_000),
      ],
    });
    expect(activity).toMatchObject({
      state: "handoff-blocked",
      tone: "warning",
      headline: "Approval not acknowledged",
    });
    // The card asks the reviewer to act rather than reading as connected.
    expect(
      deriveAgentHealth({
        activity,
        hasAgentRuntime: true,
        isReadOnly: false,
        isObservable: true,
      }),
    ).toMatchObject({ indicator: "stalled" });
  });

  it("should hand the card back once the agent answers later work", () => {
    expect(
      activityFor({
        requests: [
          approvalRequest({ answeredAt: "2026-08-08T20:00:00.000Z" }),
          { ...request("chat"), answeredAt: "2026-08-08T20:00:00.000Z" },
        ],
        progressEvents: [
          step("plan-approved", NOW - 3_000),
          step("approval-acknowledged", NOW - 2_000),
          step("response-ready", NOW - 1_000, "1111111111111111"),
        ],
      }),
    ).toMatchObject({
      state: "idle",
      headline: "Agent connected",
    });
  });

  it("should keep the handoff through the reviewer's own queue bookkeeping", () => {
    // Canceling a message queued behind the approval says nothing about where
    // the agent is, so it must not retire the reading the approval owns.
    expect(
      activityFor({
        requests: [approvalRequest()],
        progressEvents: [
          step("plan-approved", NOW - 3_000),
          step("request-canceled", NOW - 1_000, "1111111111111111"),
        ],
      }),
    ).toMatchObject({
      state: "handoff",
      supporting: "Waiting for the agent to acknowledge the approval.",
    });
  });

  it("should narrate the approval while the agent holds the claim", () => {
    expect(
      activityFor({
        requests: [approvalRequest({ ...liveClaim() })],
        progressEvents: [step("plan-approved", NOW - 2_000)],
      }),
    ).toMatchObject({
      state: "working",
      headline: "Acknowledging a plan approval",
      latestStep: "Plan approved",
    });
  });
});

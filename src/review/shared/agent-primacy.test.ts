// Proves the primacy authority: what counts as contention, who is primary,
// and what a reviewer's answer does to the roster.

import { describe, expect, it } from "vitest";
import { AGENT_RECOVERY_HORIZON_MS } from "./agent-timing.js";
import {
  AGENT_CONTENTION_WINDOW_MS,
  agentIsAttached,
  agentIsLive,
  agentPrimacyHealth,
  applyPrimacyDeclined,
  applyPrimacyHandoff,
  orderAttachedAgents,
  pendingPrimacyRequest,
  roleForArrivingAgent,
  selectObserverAgents,
  selectPrimaryAgent,
  writersAreContending,
  type AttachedAgent,
} from "./agent-primacy.js";

const NOW = 1_787_115_000_000;

const agent = (overrides: Partial<AttachedAgent> = {}): AttachedAgent => ({
  writerId: "aaaaaaaa",
  role: "primary",
  attachedAtMs: NOW - 10_000,
  signalAtMs: NOW,
  ...overrides,
});

describe("writersAreContending", () => {
  it("should report a return trip inside the window as contention", () => {
    expect(
      writersAreContending({
        stored: {
          writerId: "second",
          displacedWriterId: "first",
          updatedAtMs: NOW - 20,
        },
        writerId: "first",
        nowMs: NOW,
      }),
    ).toBe(true);
  });

  it("should not report a first handover, which is an ordinary reconnect", () => {
    expect(
      writersAreContending({
        stored: { writerId: "first", updatedAtMs: NOW - 20 },
        writerId: "second",
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("should not report a writer refreshing its own record", () => {
    expect(
      writersAreContending({
        stored: {
          writerId: "first",
          displacedWriterId: "older",
          updatedAtMs: NOW - 20,
        },
        writerId: "first",
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("should not report a third writer arriving after a handover", () => {
    expect(
      writersAreContending({
        stored: {
          writerId: "second",
          displacedWriterId: "first",
          updatedAtMs: NOW - 20,
        },
        writerId: "third",
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("should not report a return trip past the freshness window", () => {
    expect(
      writersAreContending({
        stored: {
          writerId: "second",
          displacedWriterId: "first",
          updatedAtMs: NOW - AGENT_CONTENTION_WINDOW_MS - 1,
        },
        writerId: "first",
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("should report a return trip exactly at the window edge", () => {
    expect(
      writersAreContending({
        stored: {
          writerId: "second",
          displacedWriterId: "first",
          updatedAtMs: NOW - AGENT_CONTENTION_WINDOW_MS,
        },
        writerId: "first",
        nowMs: NOW,
      }),
    ).toBe(true);
  });

  it("should refuse a record whose timestamp is in the future", () => {
    expect(
      writersAreContending({
        stored: {
          writerId: "second",
          displacedWriterId: "first",
          updatedAtMs: NOW + 50,
        },
        writerId: "first",
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("should refuse a record that names no displaced writer", () => {
    expect(
      writersAreContending({
        stored: { writerId: "second", updatedAtMs: NOW - 20 },
        writerId: "first",
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("should refuse a record with no stored timestamp", () => {
    expect(
      writersAreContending({
        stored: { writerId: "second", displacedWriterId: "first" },
        writerId: "first",
        nowMs: NOW,
      }),
    ).toBe(false);
  });
});

describe("agentIsAttached", () => {
  it("should keep counting an agent that holds work through a long turn", () => {
    expect(
      agentIsAttached({
        agent: { signalAtMs: NOW - 90_000, claimToken: "held" },
        nowMs: NOW,
      }),
    ).toBe(true);
  });

  it("should stop counting a holder past the recovery horizon", () => {
    expect(
      agentIsAttached({
        agent: {
          signalAtMs: NOW - AGENT_RECOVERY_HORIZON_MS - 1,
          claimToken: "held",
        },
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("should drop a quiet agent that never held work", () => {
    // It is either running and signalling twice a second, or gone. Nothing is
    // lost by dropping it, and keeping it would let a polling harness pile up
    // one dead record per poll.
    expect(
      agentIsAttached({ agent: { signalAtMs: NOW - 90_000 }, nowMs: NOW }),
    ).toBe(false);
  });
});

describe("agentIsLive", () => {
  it("should count a fresh signal", () => {
    expect(
      agentIsLive({ agent: { signalAtMs: NOW - 1_000 }, nowMs: NOW }),
    ).toBe(true);
  });

  it("should not count a signal older than the stall window", () => {
    expect(
      agentIsLive({ agent: { signalAtMs: NOW - 80_000 }, nowMs: NOW }),
    ).toBe(false);
  });
});

describe("selectPrimaryAgent", () => {
  it("should find the live primary", () => {
    const agents = [
      agent({ writerId: "a", role: "observer" }),
      agent({ writerId: "b", role: "primary" }),
    ];
    expect(selectPrimaryAgent({ agents, nowMs: NOW })?.writerId).toBe("b");
  });

  it("should keep a primary that is quiet because it is mid turn", () => {
    // `agent next` hands its work item over and the process exits, so every
    // working agent looks quiet. Dropping it here would hand the plan to a
    // newcomer exactly while the primary was answering (BIG-147).
    const agents = [
      agent({ writerId: "b", signalAtMs: NOW - 90_000, claimToken: "held" }),
    ];
    expect(selectPrimaryAgent({ agents, nowMs: NOW })?.writerId).toBe("b");
  });

  it("should ignore a primary that has been silent past the recovery horizon", () => {
    const agents = [
      agent({
        writerId: "b",
        signalAtMs: NOW - AGENT_RECOVERY_HORIZON_MS - 1,
        claimToken: "held",
      }),
    ];
    expect(selectPrimaryAgent({ agents, nowMs: NOW })).toBeUndefined();
  });
});

describe("orderAttachedAgents", () => {
  it("should order by attachment time, then by writer id", () => {
    const agents = [
      agent({ writerId: "z", attachedAtMs: NOW - 5 }),
      agent({ writerId: "a", attachedAtMs: NOW - 5 }),
      agent({ writerId: "m", attachedAtMs: NOW - 50 }),
    ];
    expect(orderAttachedAgents(agents).map(({ writerId }) => writerId)).toEqual(
      ["m", "a", "z"],
    );
  });
});

describe("roleForArrivingAgent", () => {
  it("should make the first agent the primary", () => {
    expect(roleForArrivingAgent({ agents: [], nowMs: NOW })).toBe("primary");
  });

  it("should make a later agent an observer", () => {
    expect(
      roleForArrivingAgent({ agents: [agent({ writerId: "a" })], nowMs: NOW }),
    ).toBe("observer");
  });

  it("should not promote an arrival past a primary that is merely mid turn", () => {
    expect(
      roleForArrivingAgent({
        agents: [
          agent({
            writerId: "a",
            signalAtMs: NOW - 90_000,
            claimToken: "held",
          }),
        ],
        nowMs: NOW,
      }),
    ).toBe("observer");
  });

  it("should promote an arrival once the previous primary is past the horizon", () => {
    expect(
      roleForArrivingAgent({
        agents: [
          agent({
            writerId: "a",
            signalAtMs: NOW - AGENT_RECOVERY_HORIZON_MS - 1,
            claimToken: "held",
          }),
        ],
        nowMs: NOW,
      }),
    ).toBe("primary");
  });
});

describe("pendingPrimacyRequest and agentPrimacyHealth", () => {
  const primary = agent({ writerId: "p", role: "primary" });

  it("should stay settled while an observer has asked for nothing", () => {
    const agents = [primary, agent({ writerId: "o", role: "observer" })];
    expect(pendingPrimacyRequest({ agents, nowMs: NOW })).toBeUndefined();
    expect(agentPrimacyHealth({ agents, nowMs: NOW })).toBe("settled");
  });

  it("should owe a decision once an observer asks", () => {
    const agents = [
      primary,
      agent({
        writerId: "o",
        role: "observer",
        requestedPrimacyAtMs: NOW - 100,
      }),
    ];
    expect(pendingPrimacyRequest({ agents, nowMs: NOW })?.writerId).toBe("o");
    expect(agentPrimacyHealth({ agents, nowMs: NOW })).toBe("decision-owed");
  });

  it("should surface only the oldest request when two observers ask", () => {
    const agents = [
      primary,
      agent({
        writerId: "late",
        role: "observer",
        attachedAtMs: NOW - 100,
        requestedPrimacyAtMs: NOW - 10,
      }),
      agent({
        writerId: "early",
        role: "observer",
        attachedAtMs: NOW - 500,
        requestedPrimacyAtMs: NOW - 20,
      }),
    ];
    expect(pendingPrimacyRequest({ agents, nowMs: NOW })?.writerId).toBe(
      "early",
    );
  });

  it("should ignore a request from an observer that is gone for good", () => {
    const agents = [
      primary,
      agent({
        writerId: "gone",
        role: "observer",
        requestedPrimacyAtMs: NOW - 100,
        signalAtMs: NOW - AGENT_RECOVERY_HORIZON_MS - 1,
      }),
    ];
    expect(agentPrimacyHealth({ agents, nowMs: NOW })).toBe("settled");
  });
});

describe("applyPrimacyHandoff", () => {
  const agents = [
    agent({ writerId: "old", role: "primary" }),
    agent({
      writerId: "new",
      role: "observer",
      requestedPrimacyAtMs: NOW - 100,
    }),
  ];

  it("should promote and demote in one step, leaving exactly one primary", () => {
    const next = applyPrimacyHandoff({ agents, writerId: "new" });
    expect(next.filter(({ role }) => role === "primary")).toHaveLength(1);
    expect(selectPrimaryAgent({ agents: next, nowMs: NOW })?.writerId).toBe(
      "new",
    );
    expect(
      selectObserverAgents({ agents: next, nowMs: NOW })[0]?.writerId,
    ).toBe("old");
  });

  it("should clear the request so the toolbar leaves its hazard state", () => {
    const next = applyPrimacyHandoff({ agents, writerId: "new" });
    expect(agentPrimacyHealth({ agents: next, nowMs: NOW })).toBe("settled");
  });
});

describe("applyPrimacyDeclined", () => {
  it("should keep the observer attached and only drop its request", () => {
    const agents = [
      agent({ writerId: "p", role: "primary" }),
      agent({
        writerId: "o",
        role: "observer",
        requestedPrimacyAtMs: NOW - 100,
      }),
    ];
    const next = applyPrimacyDeclined({ agents, writerId: "o" });
    expect(selectPrimaryAgent({ agents: next, nowMs: NOW })?.writerId).toBe(
      "p",
    );
    expect(
      selectObserverAgents({ agents: next, nowMs: NOW })[0]?.writerId,
    ).toBe("o");
    expect(agentPrimacyHealth({ agents: next, nowMs: NOW })).toBe("settled");
  });
});

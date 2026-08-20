// Proves the primacy authority: what counts as contention, who is primary,
// and what a reviewer's answer does to the roster.

import { describe, expect, it } from "vitest";
import { AGENT_RECOVERY_HORIZON_MS, AGENT_STALL_MS } from "./agent-timing.js";
import {
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

  it("should hold the seat for an agent that has just published its turn", () => {
    // The moment the claim closes, the seat looked empty and a waiting
    // observer took it - reversing an answer the reviewer had already given,
    // and locking the answering agent out of its own review (BIG-171). The
    // window is the outgoing agent's return trip with the token `respond`
    // handed it.
    expect(
      agentIsAttached({
        agent: {
          signalAtMs: NOW - 60_000,
          claimToken: "spent",
          claimClosedAtMs: NOW - 1_000,
        },
        nowMs: NOW,
      }),
    ).toBe(true);
  });

  it("should let the seat go once the return window has passed", () => {
    expect(
      agentIsAttached({
        agent: {
          signalAtMs: NOW - AGENT_STALL_MS - 2,
          claimToken: "spent",
          claimClosedAtMs: NOW - AGENT_STALL_MS - 1,
        },
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("should answer with the membership the server already decided", () => {
    // The browser is handed the fact, not the inputs: it holds neither the
    // claim token nor the close time, so deriving this itself is how the rail
    // came to disagree with the roster it was drawing.
    expect(
      agentIsAttached({
        agent: { signalAtMs: NOW - AGENT_RECOVERY_HORIZON_MS, attached: true },
        nowMs: NOW,
      }),
    ).toBe(true);
    expect(
      agentIsAttached({
        agent: { signalAtMs: NOW, attached: false },
        nowMs: NOW,
      }),
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

  it("should leave another observer's pending question standing", () => {
    // The surface asks one question at a time, so a request cleared here is a
    // question the reviewer never gets to answer and an agent that waits for
    // a prompt that never comes.
    const three = [
      ...agents,
      agent({
        writerId: "other",
        role: "observer",
        attachedAtMs: NOW - 50,
        requestedPrimacyAtMs: NOW - 50,
      }),
    ];
    const next = applyPrimacyHandoff({ agents: three, writerId: "new" });
    expect(pendingPrimacyRequest({ agents: next, nowMs: NOW })?.writerId).toBe(
      "other",
    );
    expect(agentPrimacyHealth({ agents: next, nowMs: NOW })).toBe(
      "decision-owed",
    );
  });

  it("should clear the request so the toolbar leaves its hazard state", () => {
    const next = applyPrimacyHandoff({ agents, writerId: "new" });
    expect(agentPrimacyHealth({ agents: next, nowMs: NOW })).toBe("settled");
  });
});

describe("applyPrimacyHandoff when the chosen agent has gone", () => {
  it("should change nothing rather than leave the plan with no primary", () => {
    // The two halves of a hand-off cannot be one write, so the caller does the
    // demotion and the promotion here and frees the incumbent's claim after.
    // If this demoted for a successor that had been reaped in between, the
    // review would be left with nobody able to answer it and nothing that ever
    // notices - the reviewer would simply stop getting replies.
    const incumbent = agent({ writerId: "incumbent", role: "primary" });
    const other = agent({
      writerId: "watching",
      role: "observer",
      requestedPrimacyAtMs: NOW,
    });

    expect(
      applyPrimacyHandoff({
        agents: [incumbent, other],
        writerId: "departed",
      }),
    ).toEqual([incumbent, other]);
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

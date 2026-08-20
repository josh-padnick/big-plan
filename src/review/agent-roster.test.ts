// Proves the durable half of the primacy authority: who the roster says is
// attached, which one of them owns the plan, and that a reviewer's answer
// survives the heartbeats that follow it.
//
// The pure rules live in shared/agent-primacy.test.ts. What is proven here is
// everything that only a real store can answer: locking, reaping, refresh
// semantics, and the contention evidence carried by the shared heartbeat.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentIsAttached,
  agentIsLive,
  pendingPrimacyRequest,
  selectObserverAgents,
  selectPrimaryAgent,
} from "./shared/agent-primacy.js";
import {
  AGENT_RECOVERY_HORIZON_MS,
  AGENT_STALL_MS,
} from "./shared/agent-timing.js";
import {
  AgentDisconnectedByReviewer,
  attachAgentToRoster,
  closeAgentClaim,
  declineAgentPrimacy,
  detachAgentFromRoster,
  detachExitingAgent,
  grantAgentPrimacy,
  prepareStore,
  readAgentRoster,
  recordAgentClaimToken,
  requestAgentPrimacy,
  reviewStoreFor,
} from "./store.js";

const SESSION = "0123456789abcdef";
const created: Array<string> = [];

const temporaryStore = async () => {
  const directory = await mkdtemp(join(tmpdir(), "bp-roster-"));
  created.push(directory);
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, "# Plan\n\nLede.\n", "utf8");
  const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
  await prepareStore(store);
  return store;
};

afterEach(async () => {
  await Promise.all(
    created
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("attachAgentToRoster", () => {
  it("should make the first agent the primary and the second an observer", async () => {
    const store = await temporaryStore();
    await attachAgentToRoster({ store, sessionId: SESSION, writerId: "first" });
    const { agents } = await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "second",
    });
    const nowMs = Date.now();
    expect(selectPrimaryAgent({ agents, nowMs })?.writerId).toBe("first");
    expect(
      selectObserverAgents({ agents, nowMs }).map((a) => a.writerId),
    ).toEqual(["second"]);
  });

  it("should keep the role and attachment time across a refresh", async () => {
    const store = await temporaryStore();
    await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "first",
      now: 1_000,
    });
    await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "second",
      now: 1_500,
    });
    const { agents } = await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "first",
      now: 2_000,
    });
    const first = agents.find((agent) => agent.writerId === "first");
    expect(first?.role).toBe("primary");
    expect(first?.attachedAtMs).toBe(1_000);
    expect(first?.signalAtMs).toBe(2_000);
  });

  it("should never let an arriving agent take primacy from a live one", async () => {
    const store = await temporaryStore();
    await attachAgentToRoster({ store, sessionId: SESSION, writerId: "first" });
    for (const writerId of ["second", "third", "fourth"]) {
      await attachAgentToRoster({ store, sessionId: SESSION, writerId });
    }
    const agents = await readAgentRoster({ store, sessionId: SESSION });
    expect(agents.filter((agent) => agent.role === "primary")).toHaveLength(1);
    expect(selectPrimaryAgent({ agents, nowMs: Date.now() })?.writerId).toBe(
      "first",
    );
  });

  it("should keep a primary that is quiet because it is working", async () => {
    // The bug this pins: `agent next` exits once it hands work to the harness,
    // so a working primary stops signalling. Reaping on the stall window
    // deleted it mid turn and let the next arrival become primary - the same
    // interleaving this change exists to remove, by another route.
    const store = await temporaryStore();
    await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "working",
      now: 1_000,
    });
    // Holding work is what makes silence mean "busy" rather than "gone".
    await recordAgentClaimToken({
      store,
      sessionId: SESSION,
      writerId: "working",
      claimToken: "held",
    });
    const { agents } = await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "arriving",
      now: 1_000 + AGENT_STALL_MS + 1,
    });
    expect(agents.map((agent) => agent.writerId)).toEqual([
      "working",
      "arriving",
    ]);
    expect(
      selectPrimaryAgent({ agents, nowMs: 1_000 + AGENT_STALL_MS + 1 })
        ?.writerId,
    ).toBe("working");
  });

  it("should reap an agent that has been silent past the recovery horizon", async () => {
    const store = await temporaryStore();
    await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "gone",
      now: 1_000,
    });
    await recordAgentClaimToken({
      store,
      sessionId: SESSION,
      writerId: "gone",
      claimToken: "held",
    });
    const { agents } = await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "fresh",
      now: 1_000 + AGENT_RECOVERY_HORIZON_MS + 1,
    });
    expect(agents.map((agent) => agent.writerId)).toEqual(["fresh"]);
    // The departed primary freed the role rather than holding it forever.
    expect(agents[0]?.role).toBe("primary");
  });

  it("should keep one agent's declaration off another agent's record", async () => {
    const store = await temporaryStore();
    await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "first",
      model: { name: "claude-opus-5" },
    });
    const { agents } = await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "second",
    });
    expect(
      agents.find((agent) => agent.writerId === "second")?.model,
    ).toBeUndefined();
    expect(agents.find((agent) => agent.writerId === "first")?.model).toEqual({
      name: "claude-opus-5",
    });
  });

  it("should treat arriving as an observer as the request itself", async () => {
    const store = await temporaryStore();
    await attachAgentToRoster({ store, sessionId: SESSION, writerId: "first" });
    const { agents } = await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "second",
    });
    expect(pendingPrimacyRequest({ agents, nowMs: Date.now() })?.writerId).toBe(
      "second",
    );
  });

  it("should not re-ask a question the reviewer already answered", async () => {
    const store = await temporaryStore();
    await attachAgentToRoster({ store, sessionId: SESSION, writerId: "first" });
    await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "second",
    });
    await declineAgentPrimacy({
      store,
      sessionId: SESSION,
      writerId: "second",
    });
    // The observer keeps heartbeating; that must not reopen the question.
    const { agents } = await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "second",
    });
    expect(
      pendingPrimacyRequest({ agents, nowMs: Date.now() }),
    ).toBeUndefined();
  });

  it("should not raise a request for the agent that owns the plan", async () => {
    const store = await temporaryStore();
    const { agents } = await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "first",
    });
    expect(agents[0]?.requestedPrimacyAtMs).toBeUndefined();
  });

  it("should read an empty roster for a different session", async () => {
    const store = await temporaryStore();
    await attachAgentToRoster({ store, sessionId: SESSION, writerId: "first" });
    expect(
      await readAgentRoster({ store, sessionId: "fedcba9876543210" }),
    ).toEqual([]);
  });
});

describe("the reviewer's answer", () => {
  const twoAgents = async () => {
    const store = await temporaryStore();
    await attachAgentToRoster({ store, sessionId: SESSION, writerId: "first" });
    await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "second",
    });
    await requestAgentPrimacy({
      store,
      sessionId: SESSION,
      writerId: "second",
    });
    return store;
  };

  it("should register a request only for an observer", async () => {
    const store = await twoAgents();
    await requestAgentPrimacy({ store, sessionId: SESSION, writerId: "first" });
    const agents = await readAgentRoster({ store, sessionId: SESSION });
    expect(pendingPrimacyRequest({ agents, nowMs: Date.now() })?.writerId).toBe(
      "second",
    );
    expect(
      agents.find((agent) => agent.writerId === "first")?.requestedPrimacyAtMs,
    ).toBeUndefined();
  });

  it("should move primacy on a grant, leaving exactly one primary", async () => {
    const store = await twoAgents();
    const agents = await grantAgentPrimacy({
      store,
      sessionId: SESSION,
      writerId: "second",
    });
    const nowMs = Date.now();
    expect(agents.filter((agent) => agent.role === "primary")).toHaveLength(1);
    expect(selectPrimaryAgent({ agents, nowMs })?.writerId).toBe("second");
    expect(
      selectObserverAgents({ agents, nowMs }).map((a) => a.writerId),
    ).toEqual(["first"]);
    expect(pendingPrimacyRequest({ agents, nowMs })).toBeUndefined();
  });

  it("should survive the heartbeats that follow it", async () => {
    const store = await twoAgents();
    await grantAgentPrimacy({ store, sessionId: SESSION, writerId: "second" });
    await attachAgentToRoster({ store, sessionId: SESSION, writerId: "first" });
    await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "second",
    });
    const agents = await readAgentRoster({ store, sessionId: SESSION });
    expect(selectPrimaryAgent({ agents, nowMs: Date.now() })?.writerId).toBe(
      "second",
    );
  });

  it("should keep the observer attached when the request is declined", async () => {
    const store = await twoAgents();
    const agents = await declineAgentPrimacy({
      store,
      sessionId: SESSION,
      writerId: "second",
    });
    const nowMs = Date.now();
    expect(selectPrimaryAgent({ agents, nowMs })?.writerId).toBe("first");
    expect(
      selectObserverAgents({ agents, nowMs }).map((a) => a.writerId),
    ).toEqual(["second"]);
    expect(pendingPrimacyRequest({ agents, nowMs })).toBeUndefined();
  });

  it("should hand the outgoing agent's draft over only when asked", async () => {
    const store = await twoAgents();
    const plain = await grantAgentPrimacy({
      store,
      sessionId: SESSION,
      writerId: "second",
    });
    expect(
      plain.find((agent) => agent.writerId === "second")?.inheritedDraftPath,
    ).toBeUndefined();
  });

  it("should record the carried draft against the new primary alone", async () => {
    const store = await twoAgents();
    const agents = await grantAgentPrimacy({
      store,
      sessionId: SESSION,
      writerId: "second",
      inheritedDraftPath: "/stage/1/candidate.mdx",
    });
    expect(
      agents.find((agent) => agent.writerId === "second")?.inheritedDraftPath,
    ).toBe("/stage/1/candidate.mdx");
    // The demoted agent keeps no pointer to a draft it is no longer answering
    // from; the path it wrote is its own and it still has it.
    expect(
      agents.find((agent) => agent.writerId === "first")?.inheritedDraftPath,
    ).toBeUndefined();
  });

  it("should drop a disconnected agent without inventing a successor", async () => {
    const store = await twoAgents();
    const agents = await detachAgentFromRoster({
      store,
      sessionId: SESSION,
      writerId: "first",
    });
    expect(agents.map((agent) => agent.writerId)).toEqual(["second"]);
    // The remaining observer was not promoted: who answers is the reviewer's
    // decision, and a successor chosen here would make it silently.
    expect(selectPrimaryAgent({ agents, nowMs: Date.now() })).toBeUndefined();
    expect(agents[0]?.role).toBe("observer");
  });

  it("should let a detached agent reattach and be given the free role", async () => {
    const store = await twoAgents();
    await detachAgentFromRoster({
      store,
      sessionId: SESSION,
      writerId: "first",
    });
    await detachAgentFromRoster({
      store,
      sessionId: SESSION,
      writerId: "second",
    });
    const { agents } = await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "third",
    });
    expect(selectPrimaryAgent({ agents, nowMs: Date.now() })?.writerId).toBe(
      "third",
    );
  });
});

describe("roster liveness", () => {
  it("should report a quiet agent as not reporting while keeping it attached", async () => {
    const store = await temporaryStore();
    await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "first",
      now: 1_000,
    });
    await recordAgentClaimToken({
      store,
      sessionId: SESSION,
      writerId: "first",
      claimToken: "held",
    });
    const agents = await readAgentRoster({ store, sessionId: SESSION });
    const stalled = { nowMs: 1_000 + AGENT_STALL_MS + 1 };
    const agent = agents[0] ?? { signalAtMs: 0 };
    // Two different questions with two different answers, which is the whole
    // point: the card may say "not reporting" while the plan still has a
    // primary.
    expect(agentIsLive({ agent, ...stalled })).toBe(false);
    expect(agentIsAttached({ agent, ...stalled })).toBe(true);
  });
});

/*
The moment a turn ends, which nothing else in this file can reach.

The seat has to stay with the agent that just answered for exactly as long as
its own return trip takes, and no longer. Held too long, one agent comes back to
find itself an observer of its own last turn and stops answering; released too
early, an observer the reviewer explicitly left as an observer promotes itself
between two turns and the reviewer's answer is reversed without anyone saying so
(BIG-171).
*/
describe("the seat between turns", () => {
  const answeredTurn = async () => {
    const store = await temporaryStore();
    await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "answering",
      now: 1_000,
    });
    await recordAgentClaimToken({
      store,
      sessionId: SESSION,
      writerId: "answering",
      claimToken: "held",
    });
    await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "watching",
      now: 1_000,
    });
    // The reviewer read the question and answered it: leave it as observer.
    await declineAgentPrimacy({
      store,
      sessionId: SESSION,
      writerId: "watching",
    });
    // The turn is published.
    await closeAgentClaim({
      store,
      sessionId: SESSION,
      claimToken: "held",
      now: 2_000,
    });
    return store;
  };

  it("should keep an answered observer where the reviewer put it", async () => {
    const store = await answeredTurn();
    // The observer's own refresh, half a second later, which is how often a
    // waiting loop asks.
    const { agent, agents } = await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "watching",
      now: 2_500,
    });
    expect(agent.role).toBe("observer");
    expect(selectPrimaryAgent({ agents, nowMs: 2_500 })?.writerId).toBe(
      "answering",
    );
  });

  it("should let the agent that answered reclaim its own record", async () => {
    const store = await answeredTurn();
    // The `next` command `respond` returns, run by a fresh process that knows
    // only the token.
    const { agent, agents } = await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "a-new-process",
      adoptClaimToken: "held",
      now: 2_500,
    });
    expect(agent.writerId).toBe("answering");
    expect(agent.role).toBe("primary");
    expect(agent.claimToken).toBeUndefined();
    expect(agents.map((entry) => entry.writerId)).toEqual([
      "answering",
      "watching",
    ]);
  });

  it("should let an observer take a seat that stayed empty past the window", async () => {
    const store = await answeredTurn();
    const nowMs = 2_000 + AGENT_STALL_MS + 1;
    const { agent, agents } = await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "watching",
      now: nowMs,
    });
    expect(agent.role).toBe("primary");
    expect(agents.map((entry) => entry.writerId)).toEqual(["watching"]);
    expect(selectPrimaryAgent({ agents, nowMs })?.writerId).toBe("watching");
  });
});

describe("detachExitingAgent", () => {
  it("should keep a record whose turn is still in flight", async () => {
    const store = await temporaryStore();
    await attachAgentToRoster({ store, sessionId: SESSION, writerId: "first" });
    await recordAgentClaimToken({
      store,
      sessionId: SESSION,
      writerId: "first",
      claimToken: "held",
    });
    const agents = await detachExitingAgent({
      store,
      sessionId: SESSION,
      writerId: "first",
    });
    expect(agents.map((agent) => agent.writerId)).toEqual(["first"]);
  });

  it("should take an exiting observer's question with it", async () => {
    // A poll without --wait attaches, is told it is an observer, and exits.
    // Leaving its question behind offered the reviewer a card that promotes a
    // process that has already gone - demoting the agent actually working, and
    // leaving the plan with a primary nobody is behind.
    const store = await temporaryStore();
    await attachAgentToRoster({ store, sessionId: SESSION, writerId: "first" });
    await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "polling",
    });
    const agents = await detachExitingAgent({
      store,
      sessionId: SESSION,
      writerId: "polling",
    });
    expect(agents.map((agent) => agent.writerId)).toEqual(["first"]);
    expect(
      pendingPrimacyRequest({ agents, nowMs: Date.now() }),
    ).toBeUndefined();
  });
});

/*
What "Disconnect this agent" has to survive: the agent itself.

The record is only half the answer. Every waiting loop refreshes its
registration twice a second, so a removal on its own is undone before the
reviewer has let go of the mouse - the card comes back with its question
re-raised, and no number of clicks can clear it (BIG-171).
*/
describe("the reviewer's disconnect", () => {
  const twoAttached = async () => {
    const store = await temporaryStore();
    await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "answering",
      now: 1_000,
    });
    await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "watching",
      now: 1_000,
    });
    await detachAgentFromRoster({
      store,
      sessionId: SESSION,
      writerId: "watching",
      now: 1_500,
    });
    return store;
  };

  it("should refuse the registration it removed rather than let it return", async () => {
    const store = await twoAttached();
    await expect(
      attachAgentToRoster({
        store,
        sessionId: SESSION,
        writerId: "watching",
        now: 2_000,
      }),
    ).rejects.toBeInstanceOf(AgentDisconnectedByReviewer);
    const agents = await readAgentRoster({ store, sessionId: SESSION });
    expect(agents.map((agent) => agent.writerId)).toEqual(["answering"]);
  });

  it("should answer the disconnected agent's other processes by their token", async () => {
    // `note` and `respond` know their token and not their registration, and so
    // does the `next` that returns after a published turn.
    const store = await temporaryStore();
    await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "answering",
      now: 1_000,
    });
    await recordAgentClaimToken({
      store,
      sessionId: SESSION,
      writerId: "answering",
      claimToken: "held",
    });
    await detachAgentFromRoster({
      store,
      sessionId: SESSION,
      writerId: "answering",
      now: 1_500,
    });
    await expect(
      attachAgentToRoster({
        store,
        sessionId: SESSION,
        writerId: "a-new-process",
        adoptClaimToken: "held",
        now: 2_000,
      }),
    ).rejects.toBeInstanceOf(AgentDisconnectedByReviewer);
  });

  it("should still let a genuinely new connection attach", async () => {
    // The answer was about one running loop, not about the terminal it was
    // running in: a fresh invocation mints a new id and arrives like anyone.
    const store = await twoAttached();
    const { agent } = await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "reconnected",
      now: 2_000,
    });
    expect(agent.role).toBe("observer");
    expect(agent.requestedPrimacyAtMs).toBe(2_000);
  });

  it("should stop refusing once the disconnected loop has had time to end", async () => {
    const store = await twoAttached();
    const { agent } = await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "watching",
      now: 1_500 + AGENT_STALL_MS + 1,
    });
    expect(agent.writerId).toBe("watching");
  });
});

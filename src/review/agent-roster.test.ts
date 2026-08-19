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
  agentIsLive,
  pendingPrimacyRequest,
  selectObserverAgents,
  selectPrimaryAgent,
} from "./shared/agent-primacy.js";
import { AGENT_STALL_MS } from "./shared/agent-timing.js";
import {
  agentPresenceIsContended,
  attachAgentToRoster,
  declineAgentPrimacy,
  detachAgentFromRoster,
  grantAgentPrimacy,
  prepareStore,
  readAgentRoster,
  requestAgentPrimacy,
  reviewStoreFor,
  writeAgentHeartbeat,
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
    const agents = await attachAgentToRoster({
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
    const agents = await attachAgentToRoster({
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

  it("should reap an agent that has been silent past the stall window", async () => {
    const store = await temporaryStore();
    await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "gone",
      now: 1_000,
    });
    const agents = await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "fresh",
      now: 1_000 + AGENT_STALL_MS + 1,
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
    const agents = await attachAgentToRoster({
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
    const agents = await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "third",
    });
    expect(selectPrimaryAgent({ agents, nowMs: Date.now() })?.writerId).toBe(
      "third",
    );
  });
});

describe("agentPresenceIsContended", () => {
  it("should stay quiet while one loop writes on its own", async () => {
    const store = await temporaryStore();
    await writeAgentHeartbeat({
      store,
      sessionId: SESSION,
      state: "waiting",
      writerId: "only",
    });
    expect(
      await agentPresenceIsContended({
        store,
        sessionId: SESSION,
        writerId: "only",
      }),
    ).toBe(false);
  });

  it("should stay quiet for a fresh connector replacing a dead one", async () => {
    const store = await temporaryStore();
    await writeAgentHeartbeat({
      store,
      sessionId: SESSION,
      state: "waiting",
      writerId: "dead",
    });
    expect(
      await agentPresenceIsContended({
        store,
        sessionId: SESSION,
        writerId: "fresh",
      }),
    ).toBe(false);
  });

  it("should report a return trip as contention", async () => {
    const store = await temporaryStore();
    await writeAgentHeartbeat({
      store,
      sessionId: SESSION,
      state: "waiting",
      writerId: "first",
    });
    await writeAgentHeartbeat({
      store,
      sessionId: SESSION,
      state: "waiting",
      writerId: "second",
    });
    expect(
      await agentPresenceIsContended({
        store,
        sessionId: SESSION,
        writerId: "first",
      }),
    ).toBe(true);
  });

  it("should carry the displacement across the displacing writer's own refreshes", async () => {
    const store = await temporaryStore();
    await writeAgentHeartbeat({
      store,
      sessionId: SESSION,
      state: "waiting",
      writerId: "first",
    });
    await writeAgentHeartbeat({
      store,
      sessionId: SESSION,
      state: "waiting",
      writerId: "second",
    });
    // The winner refreshing twice must not erase the evidence before its
    // rival's next write lands.
    await writeAgentHeartbeat({
      store,
      sessionId: SESSION,
      state: "waiting",
      writerId: "second",
    });
    expect(
      await agentPresenceIsContended({
        store,
        sessionId: SESSION,
        writerId: "first",
      }),
    ).toBe(true);
  });

  it("should not report contention against a stale record", async () => {
    const store = await temporaryStore();
    const past = Date.now() - 60_000;
    await writeAgentHeartbeat({
      store,
      sessionId: SESSION,
      state: "waiting",
      writerId: "first",
      now: past,
    });
    await writeAgentHeartbeat({
      store,
      sessionId: SESSION,
      state: "waiting",
      writerId: "second",
      now: past + 10,
    });
    expect(
      await agentPresenceIsContended({
        store,
        sessionId: SESSION,
        writerId: "first",
      }),
    ).toBe(false);
  });
});

describe("roster liveness", () => {
  it("should stop counting an agent whose signal aged out", async () => {
    const store = await temporaryStore();
    await attachAgentToRoster({
      store,
      sessionId: SESSION,
      writerId: "first",
      now: 1_000,
    });
    const agents = await readAgentRoster({ store, sessionId: SESSION });
    expect(
      agentIsLive({
        agent: agents[0] ?? { signalAtMs: 0 },
        nowMs: 1_000 + AGENT_STALL_MS + 1,
      }),
    ).toBe(false);
  });
});

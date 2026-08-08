import { describe, expect, it } from "vitest";
import { AGENT_QUIET_MS, deriveAgentStatus } from "./thread-status.js";

const nowMs = 1_000_000;

describe("deriveAgentStatus", () => {
  it("never calls queued work working before the agent picks it up", () => {
    expect(
      deriveAgentStatus({
        runtime: "online",
        request: "pending",
        agentConnected: true,
        pickedUp: false,
        nowMs,
      }).stage,
    ).toBe("waiting");
  });

  it("shows disconnected pending work as blocked", () => {
    expect(
      deriveAgentStatus({
        runtime: "online",
        request: "pending",
        agentConnected: false,
        pickedUp: false,
        nowMs,
      }).stage,
    ).toBe("blocked");
  });

  it("heals stalled work when a fresh agent signal arrives", () => {
    const input = {
      runtime: "online" as const,
      request: "pending" as const,
      agentConnected: true,
      pickedUp: true,
      nowMs,
    };
    expect(
      deriveAgentStatus({
        ...input,
        lastAgentSignalAtMs: nowMs - AGENT_QUIET_MS - 1,
      }).stage,
    ).toBe("stalled");
    expect(
      deriveAgentStatus({ ...input, lastAgentSignalAtMs: nowMs }).stage,
    ).toBe("working");
  });

  it("keeps runtime failure language distinct from agent work", () => {
    const status = deriveAgentStatus({
      runtime: "offline",
      request: "pending",
      agentConnected: true,
      pickedUp: true,
      lastAgentSignalAtMs: nowMs,
      nowMs,
    });
    expect(status.stage).toBe("offline");
    expect(status.label).not.toContain("Working");
    expect(status.detail).toContain("Drafts are safe");
  });
});

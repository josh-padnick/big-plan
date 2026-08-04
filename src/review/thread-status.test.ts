// Covers the lifecycle decisions shared by every review-thread surface.

import { describe, expect, it } from "vitest";

import { deriveThreadStatus, sessionQuietMs } from "./thread-status.js";

describe("deriveThreadStatus", () => {
  it("should distinguish a connected queue from a recoverable blocked queue", () => {
    expect(
      deriveThreadStatus({
        phase: "pending",
        surface: "thread",
        agentConnected: true,
        sessionBusy: true,
      }),
    ).toMatchObject({
      stage: "waiting",
      headline: "Waiting - the agent is working on another request",
      showsSpinner: false,
      waitingBusy: true,
    });
    expect(
      deriveThreadStatus({
        phase: "pending",
        surface: "thread",
        agentConnected: true,
      }),
    ).toMatchObject({
      stage: "waiting",
      tone: "neutral",
      badge: "Waiting",
      headline: "Waiting for an agent",
      showsSpinner: false,
      showsSetup: false,
    });
    expect(
      deriveThreadStatus({ phase: "pending", surface: "thread" }),
    ).toMatchObject({
      stage: "blocked",
      tone: "warning",
      badge: "Blocked",
      headline: "Blocked - no agent connected",
      showsSpinner: false,
      showsSetup: true,
    });
  });

  it("should measure session quiet from the newest liveness signal", () => {
    expect(
      sessionQuietMs({
        now: 200_000,
        lastProgressAdvanceAt: 20_000,
        heartbeatAt: 150_000,
        seenAt: 10_000,
      }),
    ).toBe(50_000);
    expect(
      sessionQuietMs({
        now: 200_000,
        lastProgressAdvanceAt: 220_000,
        heartbeatAt: 0,
        seenAt: 0,
      }),
    ).toBe(0);
  });

  it("should show one working spinner after live progress arrives", () => {
    expect(
      deriveThreadStatus({
        phase: "pending",
        surface: "chat",
        pickedUp: true,
      }),
    ).toMatchObject({
      stage: "working",
      badge: "Working",
      headline: "Agent is working on your feedback",
      showsSpinner: true,
    });
  });

  it("should distinguish stalled, errored, and offline work", () => {
    expect(
      deriveThreadStatus({
        phase: "pending",
        surface: "thread",
        pickedUp: true,
        agentConnected: true,
        quietForMs: 120_000,
      }),
    ).toMatchObject({
      stage: "stalled",
      hint: expect.stringMatching(/^The agent session is still connected\./u),
    });
    expect(
      deriveThreadStatus({
        phase: "pending",
        surface: "thread",
        failedStep: "Applying feedback",
        failedDetail: "Usage exhausted",
      }).stage,
    ).toBe("errored");
    expect(
      deriveThreadStatus({
        phase: "pending",
        surface: "thread",
        runtimeOffline: true,
      }).stage,
    ).toBe("offline");
  });

  it("should never add status chrome after an outcome or resolution", () => {
    const outcome = deriveThreadStatus({
      phase: "outcome",
      surface: "thread",
    });
    const resolved = deriveThreadStatus({
      phase: "resolved",
      surface: "thread",
    });
    expect(outcome.stage).toBe("outcome");
    expect(outcome.headline).toBeUndefined();
    expect(resolved.stage).toBe("resolved");
    expect(resolved.headline).toBeUndefined();
  });
});

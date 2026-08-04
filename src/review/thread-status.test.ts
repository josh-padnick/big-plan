// Covers the lifecycle decisions shared by every review-thread surface.

import { describe, expect, it } from "vitest";

import { deriveThreadStatus } from "./thread-status.js";

describe("deriveThreadStatus", () => {
  it("should keep a queued request neutral until an agent picks it up", () => {
    expect(
      deriveThreadStatus({ phase: "pending", surface: "thread" }),
    ).toMatchObject({
      stage: "sent",
      tone: "neutral",
      badge: "Sent",
      headline: "Waiting for an agent",
      showsSpinner: false,
      showsSetup: true,
    });
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
        quietForMs: 120_000,
      }).stage,
    ).toBe("stalled");
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

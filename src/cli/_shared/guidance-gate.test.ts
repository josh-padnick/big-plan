// Exercises the guidance gate policy against in-memory storage: unlocking,
// TTL expiry, version mismatch, corruption tolerance, and the degraded
// warning path when no state location accepts writes.

import { describe, expect, it } from "vitest";
import { GUIDANCE_VERSION } from "../guidance/content.generated.js";
import {
  createGuidanceGate,
  createInMemoryGuidanceStorage,
} from "./guidance-gate.js";

const HOUR_MS = 60 * 60 * 1000;

// Rewrites the single acknowledgment marker, so tests can age or corrupt it.
const overwriteMarker = (
  storage: ReturnType<typeof createInMemoryGuidanceStorage>,
  content: string,
): void => {
  const [key] = storage.markers.keys();
  if (key === undefined) {
    throw new Error("expected an acknowledgment marker to exist");
  }
  storage.markers.set(key, content);
};

describe("createGuidanceGate", () => {
  it("should lock with a structured error when nothing was acknowledged", async () => {
    const gate = createGuidanceGate({
      storage: createInMemoryGuidanceStorage(),
    });

    await expect(gate.requireGuidanceAcknowledgment()).rejects.toMatchObject({
      code: "GUIDANCE_REQUIRED",
      message: "Read the plan-writing guidance before working on a plan",
    });
  });

  it("should pass silently when a current acknowledgment exists", async () => {
    const gate = createGuidanceGate({
      storage: createInMemoryGuidanceStorage(),
    });

    await expect(gate.recordGuidanceAcknowledgment()).resolves.toEqual({
      persisted: true,
    });
    await expect(gate.requireGuidanceAcknowledgment()).resolves.toEqual({
      warnings: [],
    });
  });

  it("should expire an acknowledgment older than 24 hours", async () => {
    const storage = createInMemoryGuidanceStorage();
    let nowMs = 0;
    const gate = createGuidanceGate({ storage, now: () => nowMs });
    await gate.recordGuidanceAcknowledgment();

    nowMs = 23 * HOUR_MS;
    await expect(gate.requireGuidanceAcknowledgment()).resolves.toEqual({
      warnings: [],
    });

    nowMs = 25 * HOUR_MS;
    await expect(gate.requireGuidanceAcknowledgment()).rejects.toMatchObject({
      code: "GUIDANCE_REQUIRED",
    });
  });

  it("should expire an acknowledgment recorded for different guidance content", async () => {
    const storage = createInMemoryGuidanceStorage();
    const gate = createGuidanceGate({ storage });
    await gate.recordGuidanceAcknowledgment();
    overwriteMarker(
      storage,
      JSON.stringify({ version: "stale", acknowledgedAtMs: Date.now() }),
    );

    await expect(gate.requireGuidanceAcknowledgment()).rejects.toMatchObject({
      code: "GUIDANCE_REQUIRED",
    });
  });

  it("should treat a corrupt marker as no acknowledgment", async () => {
    const storage = createInMemoryGuidanceStorage();
    const gate = createGuidanceGate({ storage });
    await gate.recordGuidanceAcknowledgment();
    overwriteMarker(storage, "not json");

    await expect(gate.requireGuidanceAcknowledgment()).rejects.toMatchObject({
      code: "GUIDANCE_REQUIRED",
    });
  });

  it("should treat a marker missing its fields as no acknowledgment", async () => {
    const storage = createInMemoryGuidanceStorage();
    const gate = createGuidanceGate({ storage });
    await gate.recordGuidanceAcknowledgment();
    overwriteMarker(storage, JSON.stringify({ version: GUIDANCE_VERSION }));

    await expect(gate.requireGuidanceAcknowledgment()).rejects.toMatchObject({
      code: "GUIDANCE_REQUIRED",
    });
  });

  it("should report an unpersisted acknowledgment when no location accepts writes", async () => {
    const gate = createGuidanceGate({
      storage: createInMemoryGuidanceStorage({ writable: false }),
    });

    await expect(gate.recordGuidanceAcknowledgment()).resolves.toEqual({
      persisted: false,
    });
  });

  it("should warn instead of locking when no state directory is writable", async () => {
    const gate = createGuidanceGate({
      storage: createInMemoryGuidanceStorage({ writable: false }),
    });

    await expect(gate.requireGuidanceAcknowledgment()).resolves.toMatchObject({
      warnings: [
        expect.stringContaining(
          "Guidance acknowledgment could not be verified",
        ),
        expect.stringContaining("BIG_PLAN_STATE_DIR"),
      ],
    });
  });
});

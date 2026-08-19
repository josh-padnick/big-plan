// Proves that a live session survives a heartbeat read that comes back absent.
// A refresh replaces the heartbeat file, so a read landing in that gap sees
// nothing; `readReviewSessionOutcome` classifies an absent read as `unknown`,
// and the service page renders `unknown` as an interruption. Retrying the read
// is what keeps a running session from being described as one that died.
//
// These tests need their own file because the gap has to be injected through a
// mocked store read; the rest of session authority is proved unmocked in
// session-authority.test.ts.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Store from "./store.js";

// How many of the next heartbeat reads report nothing, and how many reads the
// call under test actually made. Hoisted because the mock factory runs first.
const gap = vi.hoisted(() => ({ absentReads: 0, reads: 0 }));

vi.mock("./store.js", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof Store;
  return {
    ...actual,
    readSessionHeartbeatValue: async (
      store: Store.ReviewStore,
    ): Promise<unknown> => {
      gap.reads += 1;
      if (gap.absentReads > 0) {
        gap.absentReads -= 1;
        return undefined;
      }
      return actual.readSessionHeartbeatValue(store);
    },
  };
});

const { prepareStore, reviewStoreFor, writeSessionHeartbeatValue } =
  await import("./store.js");
const { readReviewSessionOutcome } = await import("./session-authority.js");

const sessionId = "2222222222222222";

const storeWithRunningHeartbeat = async () => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-heartbeat-gap-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, "# Plan\n");
  const store = reviewStoreFor({ planPath, planId: "1111111111111111" });
  await prepareStore(store);
  await writeSessionHeartbeatValue({
    store,
    value: { sessionId, running: true, updatedAtMs: 10_000 },
  });
  return store;
};

beforeEach(() => {
  gap.absentReads = 0;
  gap.reads = 0;
});

describe("reading what became of a session", () => {
  it("should still report a running session when one read finds no heartbeat", async () => {
    const store = await storeWithRunningHeartbeat();
    gap.absentReads = 1;
    await expect(
      readReviewSessionOutcome({ store, sessionId, now: 11_000 }),
    ).resolves.toEqual({ kind: "running" });
    expect(gap.reads).toBe(2);
  });

  it("should report unknown once every read finds no heartbeat", async () => {
    const store = await storeWithRunningHeartbeat();
    gap.absentReads = Number.MAX_SAFE_INTEGER;
    await expect(
      readReviewSessionOutcome({ store, sessionId, now: 11_000 }),
    ).resolves.toEqual({ kind: "unknown" });
    expect(gap.reads).toBeGreaterThan(1);
  });
});

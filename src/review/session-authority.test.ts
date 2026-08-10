// Proves that one current review session owns mailbox writes and liveness.
// Replaced pages remain readable but cannot replace the current heartbeat.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  activateReviewSession,
  liveReviewSessionForPlan,
  readCurrentReviewSession,
  refreshReviewSessionHeartbeat,
  reviewSessionIsRunning,
  reviewSessionOwnsMailbox,
  reviewSessionView,
} from "./session-authority.js";
import type {
  ReviewSessionDescriptor,
  SessionAuthorityRejected,
} from "./session-authority.js";
import { prepareStore, reviewStoreFor } from "./store.js";

const planId = "1111111111111111";

const descriptor = ({
  sessionId,
  url,
}: {
  readonly sessionId: string;
  readonly url: string;
}): ReviewSessionDescriptor => ({
  version: 1,
  sessionId,
  planId,
  plan: "/tmp/plan.mdx",
  url,
  port: 61_000,
  pid: 123,
  startedAt: "2026-08-10T12:00:00.000Z",
  token: "A".repeat(43),
});

const preparedStore = async () => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-session-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, "# Plan\n");
  const store = reviewStoreFor({ planPath, planId });
  await prepareStore(store);
  return store;
};

describe("session authority", () => {
  it("should expose the current session as authoritative", async () => {
    const store = await preparedStore();
    const current = descriptor({
      sessionId: "2222222222222222",
      url: "http://127.0.0.1:61000/",
    });
    await activateReviewSession({ store, descriptor: current });

    await expect(readCurrentReviewSession({ store })).resolves.toEqual(current);
    await expect(
      reviewSessionView({
        store,
        sessionId: current.sessionId,
        planId,
        plan: current.plan,
      }),
    ).resolves.toEqual({
      sessionId: current.sessionId,
      planId,
      plan: current.plan,
      authoritative: true,
    });
  });

  it("should fence a replaced session from the current heartbeat", async () => {
    const store = await preparedStore();
    const replaced = descriptor({
      sessionId: "2222222222222222",
      url: "http://127.0.0.1:61000/",
    });
    const current = descriptor({
      sessionId: "3333333333333333",
      url: "http://127.0.0.1:62000/",
    });
    await activateReviewSession({ store, descriptor: replaced });
    await activateReviewSession({ store, descriptor: current });

    await expect(
      reviewSessionView({
        store,
        sessionId: replaced.sessionId,
        planId,
        plan: replaced.plan,
      }),
    ).resolves.toMatchObject({
      authoritative: false,
      latestReviewUrl: current.url,
    });
    await expect(
      refreshReviewSessionHeartbeat({
        store,
        sessionId: replaced.sessionId,
        running: true,
        now: 10_000,
      }),
    ).resolves.toBe(false);
    await expect(
      refreshReviewSessionHeartbeat({
        store,
        sessionId: current.sessionId,
        running: true,
        now: 10_000,
      }),
    ).resolves.toBe(true);
    await expect(
      reviewSessionIsRunning({
        store,
        sessionId: current.sessionId,
        now: 12_000,
      }),
    ).resolves.toBe(true);
    await expect(
      reviewSessionIsRunning({
        store,
        sessionId: replaced.sessionId,
        now: 12_000,
      }),
    ).resolves.toBe(false);
  });

  it("should return a stable reason when no matching live session exists", async () => {
    const store = await preparedStore();
    const current = descriptor({
      sessionId: "2222222222222222",
      url: "http://127.0.0.1:61000/",
    });
    await activateReviewSession({ store, descriptor: current });
    await refreshReviewSessionHeartbeat({
      store,
      sessionId: current.sessionId,
      running: true,
      now: 10_000,
    });

    await expect(
      liveReviewSessionForPlan({
        store,
        planId: "9999999999999999",
        plan: current.plan,
      }),
    ).rejects.toMatchObject<Partial<SessionAuthorityRejected>>({
      code: "wrong-plan",
    });
    await expect(
      liveReviewSessionForPlan({ store, planId, plan: current.plan }),
    ).rejects.toMatchObject<Partial<SessionAuthorityRejected>>({
      code: "stopped",
    });
    await expect(
      reviewSessionOwnsMailbox({ store, sessionId: current.sessionId }),
    ).resolves.toBe(true);
  });
});

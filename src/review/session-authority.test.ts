// Proves that one current review session owns mailbox writes and liveness.
// Replaced pages remain readable but cannot replace the current heartbeat.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  activateReviewSession,
  liveReviewCustody,
  liveReviewSessionForPlan,
  readCurrentReviewSession,
  refreshReviewSessionHeartbeat,
  ReviewCustodyHeld,
  reviewSessionIsRunning,
  reviewSessionOwnsMailbox,
  reviewSessionView,
  stopReviewSessionIfInactive,
  validateReviewSessionDescriptor,
  withRunningReviewSessionAuthority,
  withReviewSessionAuthority,
} from "./session-authority.js";
import type {
  ReviewSessionDescriptor,
  SessionAuthorityRejected,
} from "./session-authority.js";
import {
  prepareStore,
  reviewStoreFor,
  writeSessionDescriptorValue,
} from "./store.js";

const planId = "1111111111111111";

const descriptor = ({
  sessionId,
  url,
  startedAt = "2026-08-10T12:00:00.000Z",
}: {
  readonly sessionId: string;
  readonly url: string;
  readonly startedAt?: string;
}): ReviewSessionDescriptor => ({
  version: 1,
  sessionId,
  planId,
  plan: "/tmp/plan.mdx",
  url,
  port: 61_000,
  pid: 123,
  startedAt,
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
  it("should accept only HTTP(S) review URLs", () => {
    const current = descriptor({
      sessionId: "2222222222222222",
      url: "https://example.test/review",
    });
    expect(validateReviewSessionDescriptor(current)).toEqual(current);
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,hello",
      "file:///tmp/review.html",
      "//example.test/review",
    ]) {
      expect(validateReviewSessionDescriptor({ ...current, url })).toBe(
        undefined,
      );
    }
  });

  it("should distinguish an invalid descriptor from a missing one", async () => {
    const store = await preparedStore();
    await expect(
      activateReviewSession({
        store,
        descriptor: {
          ...descriptor({
            sessionId: "2222222222222222",
            url: "http://127.0.0.1:61000/",
          }),
          url: "file:///tmp/review.html",
        },
      }),
    ).rejects.toMatchObject<Partial<SessionAuthorityRejected>>({
      code: "invalid",
    });

    await writeSessionDescriptorValue({
      store,
      value: { sessionId: "not-a-session" },
    });
    await expect(
      liveReviewSessionForPlan({ store, planId, plan: "/tmp/plan.mdx" }),
    ).rejects.toMatchObject<Partial<SessionAuthorityRejected>>({
      code: "invalid",
    });
  });

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
    ).resolves.toMatchObject({ running: true });
    await expect(
      reviewSessionIsRunning({
        store,
        sessionId: replaced.sessionId,
        now: 12_000,
      }),
    ).resolves.toMatchObject({ running: false });
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

  it("should serialize custody replacement after an authorized mutation", async () => {
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
    await refreshReviewSessionHeartbeat({
      store,
      sessionId: replaced.sessionId,
      running: true,
      now: 10_000,
    });
    let releaseMutation = (): void => undefined;
    const mutationReleased = new Promise<void>((settle) => {
      releaseMutation = settle;
    });
    let mutationStarted = (): void => undefined;
    const started = new Promise<void>((settle) => {
      mutationStarted = settle;
    });
    const order: Array<string> = [];
    const mutation = withReviewSessionAuthority({
      store,
      sessionId: replaced.sessionId,
      clock: () => 11_000,
      change: async () => {
        mutationStarted();
        await mutationReleased;
        order.push("mutation");
      },
    });
    await started;
    const replacement = activateReviewSession({
      store,
      descriptor: current,
    }).then(() => {
      order.push("replacement");
    });
    // Custody replacement does filesystem work, so a single microtask proves
    // nothing. Give it many event-loop turns: without the store lock it has
    // ample time to finish first, and the ordering below then fails.
    for (let turn = 0; turn < 20; turn += 1) {
      await new Promise((settle) => setTimeout(settle, 1));
    }
    expect(order).toEqual([]);
    releaseMutation();
    await Promise.all([mutation, replacement]);

    expect(order).toEqual(["mutation", "replacement"]);
    await expect(readCurrentReviewSession({ store })).resolves.toEqual(current);
  });

  it("should serialize idle stopping after a concurrent live claim", async () => {
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
    let releaseClaim = (): void => undefined;
    const released = new Promise<void>((settle) => {
      releaseClaim = settle;
    });
    let claimStarted = (): void => undefined;
    const started = new Promise<void>((settle) => {
      claimStarted = settle;
    });
    let liveClaim = false;
    const claim = withRunningReviewSessionAuthority({
      store,
      sessionId: current.sessionId,
      clock: () => 11_000,
      change: async () => {
        claimStarted();
        await released;
        liveClaim = true;
      },
    });
    await started;
    const stopping = stopReviewSessionIfInactive({
      store,
      sessionId: current.sessionId,
      stopReason: "Idle",
      now: 11_000,
      inactive: async () => !liveClaim,
    });
    releaseClaim();

    await expect(claim).resolves.toMatchObject({ authoritative: true });
    await expect(stopping).resolves.toEqual({
      authoritative: true,
      stopped: false,
    });
    await expect(
      reviewSessionIsRunning({
        store,
        sessionId: current.sessionId,
        now: 12_000,
      }),
    ).resolves.toMatchObject({ running: true });
  });

  it("should refuse session authority after its heartbeat becomes stale", async () => {
    const store = await preparedStore();
    const current = descriptor({
      sessionId: "3333333333333333",
      url: "http://127.0.0.1:61001/",
    });
    await activateReviewSession({ store, descriptor: current });
    await refreshReviewSessionHeartbeat({
      store,
      sessionId: current.sessionId,
      running: true,
      now: 10_000,
    });
    let changed = false;

    await expect(
      withRunningReviewSessionAuthority({
        store,
        sessionId: current.sessionId,
        clock: () => 13_001,
        change: async () => {
          changed = true;
        },
      }),
    ).resolves.toEqual({ authoritative: false, reason: "stopped" });
    expect(changed).toBe(false);
  });

  it("should refuse custody while a live runtime still serves the plan", async () => {
    const store = await preparedStore();
    const holder = descriptor({
      sessionId: "2222222222222222",
      url: "http://127.0.0.1:61000/",
    });
    const challenger = descriptor({
      sessionId: "3333333333333333",
      url: "http://127.0.0.1:62000/",
    });
    await activateReviewSession({ store, descriptor: holder });
    await refreshReviewSessionHeartbeat({
      store,
      sessionId: holder.sessionId,
      running: true,
      now: 10_000,
    });

    await expect(
      activateReviewSession({ store, descriptor: challenger, now: 11_000 }),
    ).resolves.toEqual({ activated: false, live: holder });
    await expect(readCurrentReviewSession({ store })).resolves.toEqual(holder);
  });

  // The agent that reused a serving executable (e.g. a preview's serve.mjs)
  // lands here with an opaque refusal. The message must name the real agent
  // CLI and the connect command, so the reader recovers without reading source.
  it("should name the agent connect command when custody is held", () => {
    const held = new ReviewCustodyHeld(
      descriptor({
        sessionId: "2222222222222222",
        url: "http://127.0.0.1:61000/",
      }),
    );

    expect(held.message).toContain("agent connect");
    expect(held.message).toContain("/tmp/plan.mdx");
    expect(held.message).toContain("bin/big-plan.mjs");
    expect(held.message).toContain("http://127.0.0.1:61000/");
  });

  it("should take custody once the holder's heartbeat has gone stale", async () => {
    const store = await preparedStore();
    const holder = descriptor({
      sessionId: "2222222222222222",
      url: "http://127.0.0.1:61000/",
    });
    const challenger = descriptor({
      sessionId: "3333333333333333",
      url: "http://127.0.0.1:62000/",
    });
    await activateReviewSession({ store, descriptor: holder });
    await refreshReviewSessionHeartbeat({
      store,
      sessionId: holder.sessionId,
      running: true,
      now: 10_000,
    });

    await expect(
      activateReviewSession({ store, descriptor: challenger, now: 20_000 }),
    ).resolves.toEqual({ activated: true });
    await expect(readCurrentReviewSession({ store })).resolves.toEqual(
      challenger,
    );
  });

  it("should take custody from a live holder only when takeover is explicit", async () => {
    const store = await preparedStore();
    const holder = descriptor({
      sessionId: "2222222222222222",
      url: "http://127.0.0.1:61000/",
    });
    const challenger = descriptor({
      sessionId: "3333333333333333",
      url: "http://127.0.0.1:62000/",
    });
    await activateReviewSession({ store, descriptor: holder });
    await refreshReviewSessionHeartbeat({
      store,
      sessionId: holder.sessionId,
      running: true,
      now: 10_000,
    });

    await expect(
      activateReviewSession({
        store,
        descriptor: challenger,
        takeover: true,
        now: 11_000,
      }),
    ).resolves.toEqual({ activated: true, displaced: holder });
    await expect(readCurrentReviewSession({ store })).resolves.toEqual(
      challenger,
    );
    await expect(
      reviewSessionOwnsMailbox({ store, sessionId: holder.sessionId }),
    ).resolves.toBe(false);
  });

  it("should report no displacement when a takeover finds no live holder", async () => {
    const store = await preparedStore();
    const holder = descriptor({
      sessionId: "2222222222222222",
      url: "http://127.0.0.1:61000/",
    });
    const challenger = descriptor({
      sessionId: "3333333333333333",
      url: "http://127.0.0.1:62000/",
    });
    await activateReviewSession({ store, descriptor: holder });
    await refreshReviewSessionHeartbeat({
      store,
      sessionId: holder.sessionId,
      running: true,
      now: 10_000,
    });

    const activation = await activateReviewSession({
      store,
      descriptor: challenger,
      takeover: true,
      now: 20_000,
    });

    expect(activation).toEqual({ activated: true });
    expect(
      activation.activated ? activation.displaced : undefined,
    ).toBeUndefined();
    await expect(readCurrentReviewSession({ store })).resolves.toEqual(
      challenger,
    );
  });

  it("should treat a just-written descriptor as live before its first heartbeat", async () => {
    const store = await preparedStore();
    const holder = descriptor({
      sessionId: "2222222222222222",
      url: "http://127.0.0.1:61000/",
      startedAt: new Date(9_000).toISOString(),
    });
    const challenger = descriptor({
      sessionId: "3333333333333333",
      url: "http://127.0.0.1:62000/",
    });
    await activateReviewSession({ store, descriptor: holder });

    await expect(
      liveReviewCustody({
        store,
        planId,
        plan: holder.plan,
        now: 10_000,
      }),
    ).resolves.toEqual(holder);
    await expect(
      activateReviewSession({ store, descriptor: challenger, now: 10_000 }),
    ).resolves.toEqual({ activated: false, live: holder });
    // The grace lasts one freshness window, not forever: a runtime that died
    // before its first heartbeat must not hold the plan hostage.
    await expect(
      activateReviewSession({ store, descriptor: challenger, now: 20_000 }),
    ).resolves.toEqual({ activated: true });
  });

  it("should not grant start-up grace to a session that reported stopping", async () => {
    const store = await preparedStore();
    const holder = descriptor({
      sessionId: "2222222222222222",
      url: "http://127.0.0.1:61000/",
      startedAt: new Date(9_000).toISOString(),
    });
    const challenger = descriptor({
      sessionId: "3333333333333333",
      url: "http://127.0.0.1:62000/",
    });
    await activateReviewSession({ store, descriptor: holder });
    await refreshReviewSessionHeartbeat({
      store,
      sessionId: holder.sessionId,
      running: false,
      stopReason: "The review session was stopped by the reviewer.",
      now: 9_500,
    });

    await expect(
      activateReviewSession({ store, descriptor: challenger, now: 10_000 }),
    ).resolves.toEqual({ activated: true });
  });

  it("should keep reviewer authority until shutdown is durably committed", async () => {
    const store = await preparedStore();
    const current = descriptor({
      sessionId: "3333333333333333",
      url: "http://127.0.0.1:61001/",
    });
    await activateReviewSession({ store, descriptor: current });
    await refreshReviewSessionHeartbeat({
      store,
      sessionId: current.sessionId,
      running: true,
      now: 10_000,
    });
    let changed = false;

    await expect(
      withReviewSessionAuthority({
        store,
        sessionId: current.sessionId,
        change: async () => {
          changed = true;
        },
      }),
    ).resolves.toMatchObject({ authoritative: true });
    expect(changed).toBe(true);
  });
});

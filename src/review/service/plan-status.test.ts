// Proves every answer a saved link can get is read from real files on disk,
// and that the four non-live answers each come from a distinct real state
// rather than from a branch nobody ever exercises.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  prepareStore,
  reviewStoreFor,
  writeSessionDescriptorValue,
  writeSessionHeartbeatValue,
} from "../store.js";
import type { ReviewStore } from "../store.js";
import { answerForPlan } from "./plan-status.js";
import { rememberPlan } from "./registry.js";

const planId = "1111111111111111";
const sessionId = "abcdef0123456789";
const nowMs = Date.parse("2026-08-17T14:00:00.000Z");

let stateDirectory: string;
let planDirectory: string;
let planPath: string;
let store: ReviewStore;
let previousStateDirectory: string | undefined;

const activate = async ({
  url = "http://127.0.0.1:41922/",
  startedAt = "2026-08-17T13:00:00.000Z",
}: {
  readonly url?: string;
  readonly startedAt?: string;
} = {}): Promise<void> => {
  await writeSessionDescriptorValue({
    store,
    value: {
      version: 1,
      sessionId,
      planId,
      plan: planPath,
      url,
      port: 41_922,
      pid: 4242,
      startedAt,
      token: "A".repeat(43),
    },
  });
};

beforeEach(async () => {
  stateDirectory = await mkdtemp(join(tmpdir(), "big-plan-status-state-"));
  previousStateDirectory = process.env["BIG_PLAN_STATE_DIR"];
  process.env["BIG_PLAN_STATE_DIR"] = stateDirectory;

  planDirectory = await mkdtemp(join(tmpdir(), "big-plan-status-plan-"));
  planPath = join(planDirectory, "plan.mdx");
  await writeFile(planPath, "# Plan\n");
  store = reviewStoreFor({ planPath, planId });
  await prepareStore(store);
  await rememberPlan({ planId, planPath });
});

afterEach(async () => {
  if (previousStateDirectory === undefined) {
    delete process.env["BIG_PLAN_STATE_DIR"];
  } else {
    process.env["BIG_PLAN_STATE_DIR"] = previousStateDirectory;
  }
  await rm(stateDirectory, { recursive: true, force: true });
  await rm(planDirectory, { recursive: true, force: true });
});

describe("the answer a saved link gets", () => {
  it("should redirect to the session's own address while the heartbeat is fresh", async () => {
    await activate({ url: "http://127.0.0.1:41922/" });
    await writeSessionHeartbeatValue({
      store,
      value: { sessionId, running: true, updatedAtMs: nowMs },
    });
    expect(await answerForPlan({ planId, now: nowMs })).toEqual({
      kind: "live",
      planPath,
      url: "http://127.0.0.1:41922/",
    });
  });

  it("should refuse to point a saved link anywhere but this machine", async () => {
    // A poisoned descriptor must not turn the one stable address on this
    // machine into a redirector to somewhere else, so a live session claiming
    // a non-loopback address is answered as if no review were running.
    await activate({ url: "http://plans.evil.example.com/" });
    await writeSessionHeartbeatValue({
      store,
      value: { sessionId, running: true, updatedAtMs: nowMs },
    });
    expect(await answerForPlan({ planId, now: nowMs })).toEqual({
      kind: "never-started",
      planPath,
    });
  });

  it("should quote the recorded reason when a session stopped on purpose", async () => {
    await activate();
    await writeSessionHeartbeatValue({
      store,
      value: {
        sessionId,
        running: false,
        updatedAtMs: nowMs - 60_000,
        stopReason: "The review session was stopped by the reviewer.",
      },
    });
    expect(await answerForPlan({ planId, now: nowMs })).toEqual({
      kind: "ended",
      planPath,
      reason: "The review session was stopped by the reviewer.",
      atMs: nowMs - 60_000,
    });
  });

  it("should call a stale heartbeat that still claims to run interrupted", async () => {
    // This is what a crash leaves behind: nothing wrote an ending, so the only
    // honest claim is that it stopped and when it was last seen.
    await activate();
    await writeSessionHeartbeatValue({
      store,
      value: { sessionId, running: true, updatedAtMs: nowMs - 30_000 },
    });
    expect(await answerForPlan({ planId, now: nowMs })).toEqual({
      kind: "interrupted",
      planPath,
      lastSeenAtMs: nowMs - 30_000,
    });
  });

  it("should treat a descriptor with no heartbeat as interrupted at its start", async () => {
    await activate({ startedAt: "2026-08-17T13:30:00.000Z" });
    expect(await answerForPlan({ planId, now: nowMs })).toEqual({
      kind: "interrupted",
      planPath,
      lastSeenAtMs: Date.parse("2026-08-17T13:30:00.000Z"),
    });
  });

  it("should say no review has run when the plan has no session at all", async () => {
    expect(await answerForPlan({ planId, now: nowMs })).toEqual({
      kind: "never-started",
      planPath,
    });
  });

  it("should know nothing about a plan the registry has never seen", async () => {
    expect(
      await answerForPlan({ planId: "9999999999999999", now: nowMs }),
    ).toEqual({ kind: "unknown" });
  });

  it("should ignore a session descriptor that belongs to another plan", async () => {
    await writeSessionDescriptorValue({
      store,
      value: {
        version: 1,
        sessionId,
        planId: "8888888888888888",
        plan: planPath,
        url: "http://127.0.0.1:41922/",
        port: 41_922,
        pid: 4242,
        startedAt: "2026-08-17T13:00:00.000Z",
        token: "A".repeat(43),
      },
    });
    expect(await answerForPlan({ planId, now: nowMs })).toEqual({
      kind: "never-started",
      planPath,
    });
  });
});

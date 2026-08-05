import {
  mkdir,
  mkdtemp,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentHeartbeatIsFresh,
  appendAgentCancellation,
  appendAgentConnectionEvent,
  appendProgress,
  prepareStore,
  readActiveDraft,
  readAgentHeartbeat,
  readAgentCancellations,
  readAgentConnectionEvents,
  readProgress,
  readResolvedCommentIds,
  readRevisionSnapshot,
  reviewStoreFor,
  sessionHeartbeatIsFresh,
  writeActiveDraft,
  writeAgentHeartbeat,
  writeResolvedCommentIds,
  writeRevisionSnapshot,
  writeSessionDescriptor,
  writeSessionHeartbeat,
} from "./store.js";

const created: Array<string> = [];

const temporaryPlan = async () => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-store-"));
  created.push(directory);
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, "# Plan\n");
  return { directory, planPath };
};

afterEach(() => {
  created.length = 0;
});

describe("review store placement", () => {
  it("should put every artifact under one .big-plan beside the plan", async () => {
    const { directory, planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    for (const path of [
      store.reviewDirectory,
      store.feedbackDirectory,
      store.agentRequestDirectory,
      store.agentResponseDirectory,
      store.agentDraftDirectory,
      store.agentPromptPath,
      store.revisionDirectory,
      store.draftsPath,
      store.activeDraftPath,
      store.sentPath,
      store.progressPath,
      store.resolvedPath,
      store.sessionPath,
      store.heartbeatPath,
      store.agentHeartbeatPath,
      store.agentCancellationsPath,
      store.agentConnectionEventsPath,
    ]) {
      expect(path.startsWith(join(directory, ".big-plan"))).toBe(true);
    }
  });

  it("should namespace review state by the plan id and nothing else", async () => {
    const { planPath } = await temporaryPlan();
    const one = reviewStoreFor({ planPath, planId: "aaaaaaaaaaaaaaaa" });
    const other = reviewStoreFor({ planPath, planId: "bbbbbbbbbbbbbbbb" });
    expect(one.draftsPath).not.toBe(other.draftsPath);
  });

  it("should refuse a plan id that would climb out of the review directory", async () => {
    const { planPath } = await temporaryPlan();
    expect(() =>
      reviewStoreFor({ planPath, planId: "../../../../etc" }),
    ).toThrow(/outside/);
  });

  it("should refuse an existing directory symlink that escapes the review root", async () => {
    const { directory, planPath } = await temporaryPlan();
    const outside = await mkdtemp(join(tmpdir(), "big-plan-outside-"));
    await mkdir(join(directory, ".big-plan"), { recursive: true });
    await symlink(outside, join(directory, ".big-plan", "feedback"));

    expect(() =>
      reviewStoreFor({ planPath, planId: "0123456789abcdef" }),
    ).toThrow(/symbolic link/);
  });

  it("should refuse a generated leaf replaced by a symlink before writing", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    const outside = join(
      await mkdtemp(join(tmpdir(), "big-plan-outside-")),
      "descriptor.json",
    );
    await writeFile(outside, "outside stays unchanged\n");
    await symlink(outside, store.sessionPath);

    await expect(
      writeSessionDescriptor({
        store,
        descriptor: { token: "must-not-escape" },
      }),
    ).rejects.toThrow(/symbolic link/);
    await expect(readFile(outside, "utf8")).resolves.toBe(
      "outside stays unchanged\n",
    );
  });
});

describe("review store request cancellations", () => {
  it("should append a cancellation once and ignore malformed disk entries", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    const cancellation = {
      requestId: "1111111111111111",
      at: "2026-08-04T12:00:00.000Z",
    };
    await appendAgentCancellation({ store, cancellation });
    await appendAgentCancellation({ store, cancellation });
    await expect(readAgentCancellations({ store })).resolves.toEqual([
      cancellation,
    ]);
    await writeFile(
      store.agentCancellationsPath,
      JSON.stringify([cancellation, { requestId: "../../bad", at: "never" }]),
    );
    await expect(readAgentCancellations({ store })).resolves.toEqual([
      cancellation,
    ]);
  });
});

describe("review store revision history", () => {
  it("should retain an immutable source snapshot by revision digest", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    const revision = "1111111111111111";
    await writeRevisionSnapshot({ store, revision, source: "# First\n" });
    await writeRevisionSnapshot({ store, revision, source: "# Second\n" });
    await expect(readRevisionSnapshot({ store, revision })).resolves.toBe(
      "# First\n",
    );
  });

  it("should persist resolved threads independently of browser storage", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeResolvedCommentIds({
      store,
      ids: ["aabbccdd", "11223344"],
    });
    await expect(
      readResolvedCommentIds({
        store,
        validate: (value) =>
          Array.isArray(value)
            ? value.filter((entry) => typeof entry === "string")
            : [],
      }),
    ).resolves.toEqual(["aabbccdd", "11223344"]);
  });
});

describe("review store active draft", () => {
  it("should round-trip the unfinished whole-plan field without trimming", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeActiveDraft({
      path: store.activeDraftPath,
      value: "  Unfinished thought.\n",
    });
    expect(
      await readActiveDraft({
        path: store.activeDraftPath,
        validate: (value) => (typeof value === "string" ? value : ""),
      }),
    ).toBe("  Unfinished thought.\n");
  });
});

describe("review store creation", () => {
  it("should create the review directories readable only by their owner", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    const mode = (await stat(store.reviewDirectory)).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it("should keep review state out of version control by default", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    expect(await readFile(join(store.root, ".gitignore"), "utf8")).toContain(
      "*",
    );
  });
});

describe("review store session heartbeat", () => {
  it("should accept only a fresh running heartbeat from the matching session", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeSessionHeartbeat({
      store,
      sessionId: "aaaaaaaaaaaaaaaa",
      running: true,
      now: 10_000,
    });
    await expect(
      sessionHeartbeatIsFresh({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        now: 12_000,
      }),
    ).resolves.toBe(true);
    await expect(
      sessionHeartbeatIsFresh({
        store,
        sessionId: "bbbbbbbbbbbbbbbb",
        now: 12_000,
      }),
    ).resolves.toBe(false);
    await expect(
      sessionHeartbeatIsFresh({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        now: 14_000,
      }),
    ).resolves.toBe(false);
    await writeSessionHeartbeat({
      store,
      sessionId: "aaaaaaaaaaaaaaaa",
      running: false,
      now: 14_000,
    });
    await expect(
      sessionHeartbeatIsFresh({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        now: 14_000,
      }),
    ).resolves.toBe(false);
  });
});

describe("review store agent heartbeat", () => {
  it("should use a short waiting lease and a longer claimed-work lease", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeAgentHeartbeat({
      store,
      sessionId: "agent-session",
      state: "waiting",
      now: 1_000,
    });
    await expect(
      readAgentHeartbeat({ store, sessionId: "agent-session" }),
    ).resolves.toEqual({ state: "waiting", updatedAtMs: 1_000 });
    await expect(
      readAgentHeartbeat({ store, sessionId: "another-session" }),
    ).resolves.toBeUndefined();
    await expect(
      agentHeartbeatIsFresh({
        store,
        sessionId: "agent-session",
        now: 3_999,
      }),
    ).resolves.toBe(true);
    await expect(
      agentHeartbeatIsFresh({
        store,
        sessionId: "agent-session",
        now: 4_001,
      }),
    ).resolves.toBe(false);
    await writeAgentHeartbeat({
      store,
      sessionId: "agent-session",
      state: "working",
      now: 1_000,
    });
    await expect(
      agentHeartbeatIsFresh({
        store,
        sessionId: "agent-session",
        now: 91_000,
      }),
    ).resolves.toBe(true);
  });
});

describe("review store connection events", () => {
  it("should append an immutable timestamped timeline for one session", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await appendAgentConnectionEvent({
      store,
      event: {
        sessionId: "agent-session",
        connected: false,
        at: "2026-08-04T17:00:00.000Z",
      },
    });
    await appendAgentConnectionEvent({
      store,
      event: {
        sessionId: "agent-session",
        connected: true,
        at: "2026-08-04T17:00:01.000Z",
      },
    });
    await appendAgentConnectionEvent({
      store,
      event: {
        sessionId: "another-session",
        connected: true,
        at: "2026-08-04T17:00:02.000Z",
      },
    });
    await expect(
      readAgentConnectionEvents({ store, sessionId: "agent-session" }),
    ).resolves.toEqual([
      {
        sessionId: "agent-session",
        connected: false,
        at: "2026-08-04T17:00:00.000Z",
      },
      {
        sessionId: "agent-session",
        connected: true,
        at: "2026-08-04T17:00:01.000Z",
      },
    ]);
    expect(
      (await readFile(store.agentConnectionEventsPath, "utf8"))
        .trim()
        .split("\n"),
    ).toHaveLength(3);
  });
});

describe("review store progress relay", () => {
  const line = (value: unknown) => `${JSON.stringify(value)}\n`;

  const storeWithProgress = async (contents: string) => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeFile(store.progressPath, contents);
    return store;
  };

  it("should relay an event that belongs to the running session", async () => {
    const store = await storeWithProgress(
      line({ sessionId: "s1", seq: 1, step: "Revising", state: "live" }),
    );
    expect(await readProgress({ store, sessionId: "s1" })).toEqual([
      { sessionId: "s1", seq: 1, step: "Revising", state: "live" },
    ]);
  });

  it("should drop an event written for another session", async () => {
    const store = await storeWithProgress(
      line({ sessionId: "other", seq: 1, step: "Ready", state: "done" }),
    );
    expect(await readProgress({ store, sessionId: "s1" })).toEqual([]);
  });

  it("should drop an event that does not advance the sequence", async () => {
    const store = await storeWithProgress(
      line({ sessionId: "s1", seq: 2, step: "Revising", state: "live" }) +
        line({ sessionId: "s1", seq: 1, step: "Replayed", state: "done" }),
    );
    const events = await readProgress({ store, sessionId: "s1" });
    expect(events.map((event) => event.step)).toEqual(["Revising"]);
  });

  it("should drop an event carrying a state the surface cannot show", async () => {
    const store = await storeWithProgress(
      line({
        sessionId: "s1",
        seq: 1,
        step: "Redirect",
        state: "navigate:https://evil.example.com",
      }),
    );
    expect(await readProgress({ store, sessionId: "s1" })).toEqual([]);
  });

  it("should survive a hand-edited status file rather than failing the session", async () => {
    const store = await storeWithProgress(
      "not json at all\n" +
        line({ sessionId: "s1", seq: 1, step: "Revising", state: "live" }),
    );
    expect(await readProgress({ store, sessionId: "s1" })).toHaveLength(1);
  });

  it("should bound the text a relayed event can carry", async () => {
    const store = await storeWithProgress(
      line({
        sessionId: "s1",
        seq: 1,
        step: "x".repeat(500),
        state: "live",
      }),
    );
    const [event] = await readProgress({ store, sessionId: "s1" });
    expect(event?.step.length).toBe(160);
  });

  it("should read back an event the runtime itself appended", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await appendProgress({
      store,
      event: {
        sessionId: "s1",
        seq: 1,
        step: "Feedback package received",
        state: "done",
        requestId: "request-1",
        at: "2026-08-03T12:00:00.000Z",
      },
    });
    expect(await readProgress({ store, sessionId: "s1" })).toEqual([
      expect.objectContaining({
        requestId: "request-1",
        at: "2026-08-03T12:00:00.000Z",
      }),
    ]);
  });
});

import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_STALL_MS } from "./shared/agent-status.js";
import {
  appendAgentConnectionEvent,
  appendProgressValue,
  deriveReviewPlanId,
  prepareStore,
  readActiveDraft,
  readAgentConnectionEvents,
  readAgentPresence,
  readProgress,
  readResolvedCommentIds,
  readRevisionSnapshot,
  reviewStoreFor,
  writeActiveDraft,
  writeAgentHeartbeat,
  writeResolvedCommentIds,
  writeRevisionSnapshot,
  writeSessionHeartbeatValue,
  withReviewStoreLock,
} from "./store.js";

const created: Array<string> = [];

const temporaryPlan = async () => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-store-"));
  created.push(directory);
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, "# Plan\n");
  return { directory, planPath };
};

afterEach(async () => {
  await Promise.all(
    created
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("review store placement", () => {
  it("should keep one review namespace across revisions at the same path", () => {
    expect(deriveReviewPlanId({ planPath: "/plans/plan.mdx" })).toBe(
      deriveReviewPlanId({ planPath: "/plans/nested/../plan.mdx" }),
    );
  });

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
      store.agentConnectionDirectory,
      store.resolvedPath,
      store.sessionPath,
      store.heartbeatPath,
      store.sessionLockPath,
      store.agentHeartbeatPath,
    ]) {
      expect(path.startsWith(join(directory, ".big-plan"))).toBe(true);
    }
  });

  it("should namespace review state by the plan id and nothing else", async () => {
    const { planPath } = await temporaryPlan();
    const one = reviewStoreFor({ planPath, planId: "aaaaaaaaaaaaaaaa" });
    const other = reviewStoreFor({ planPath, planId: "bbbbbbbbbbbbbbbb" });
    expect(one.draftsPath).not.toBe(other.draftsPath);
    expect(one.sessionPath).not.toBe(other.sessionPath);
    expect(one.heartbeatPath).not.toBe(other.heartbeatPath);
  });

  it("should refuse a plan id that would climb out of the review directory", async () => {
    const { planPath } = await temporaryPlan();
    expect(() =>
      reviewStoreFor({ planPath, planId: "../../../../etc" }),
    ).toThrow(/outside/);
  });
});

describe("review store locking", () => {
  it("should recover an ownerless lock generation", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await mkdir(store.sessionLockPath);

    let active = 0;
    let mostActive = 0;
    const change = (result: string) =>
      withReviewStoreLock({
        lockPath: store.sessionLockPath,
        change: async () => {
          active += 1;
          mostActive = Math.max(mostActive, active);
          await new Promise((settle) => setTimeout(settle, 5));
          active -= 1;
          return result;
        },
        timeoutError: () => new Error("lock timed out"),
      });

    await expect(
      Promise.all([change("first"), change("second")]),
    ).resolves.toEqual(["first", "second"]);
    expect(mostActive).toBe(1);
    await expect(stat(store.sessionLockPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("agent connection history", () => {
  it("should preserve ordered transitions for only the running session", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await appendAgentConnectionEvent({
      store,
      event: {
        sessionId: "session-a",
        connected: false,
        at: "2026-08-08T20:00:02.000Z",
        reason: "Heartbeat timed out",
      },
    });
    await appendAgentConnectionEvent({
      store,
      event: {
        sessionId: "session-a",
        connected: true,
        at: "2026-08-08T20:00:01.000Z",
      },
    });
    await appendAgentConnectionEvent({
      store,
      event: {
        sessionId: "other-session",
        connected: true,
        at: "2026-08-08T20:00:00.000Z",
      },
    });

    expect(
      await readAgentConnectionEvents({ store, sessionId: "session-a" }),
    ).toMatchObject([
      { connected: true, at: "2026-08-08T20:00:01.000Z" },
      {
        connected: false,
        at: "2026-08-08T20:00:02.000Z",
        reason: "Heartbeat timed out",
      },
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

  it("should restore owner-only mode when rewriting existing state", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeFile(store.activeDraftPath, '"exposed"\n');
    await chmod(store.activeDraftPath, 0o644);
    await writeActiveDraft({ path: store.activeDraftPath, value: "private" });
    expect((await stat(store.activeDraftPath)).mode & 0o777).toBe(0o600);
  });
});

describe("review store session files", () => {
  it("should replace heartbeat snapshots without mutating an open reader", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeSessionHeartbeatValue({
      store,
      value: {
        sessionId: "aaaaaaaaaaaaaaaa",
        running: true,
        updatedAtMs: 10_000,
      },
    });
    const previousSnapshot = await open(store.heartbeatPath, "r");
    try {
      await writeSessionHeartbeatValue({
        store,
        value: {
          sessionId: "aaaaaaaaaaaaaaaa",
          running: true,
          updatedAtMs: 11_000,
        },
      });
      expect(JSON.parse(await previousSnapshot.readFile("utf8"))).toMatchObject(
        {
          updatedAtMs: 10_000,
        },
      );
    } finally {
      await previousSnapshot.close();
    }
  });
});

describe("review store agent presence", () => {
  it("reports only a fresh heartbeat from the matching agent session", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeAgentHeartbeat({
      store,
      sessionId: "aaaaaaaaaaaaaaaa",
      state: "working",
      requestId: "bbbbbbbbbbbbbbbb",
      now: 10_000,
    });
    await expect(
      readAgentPresence({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        now: 12_000,
      }),
    ).resolves.toEqual({
      connected: true,
      state: "working",
      requestId: "bbbbbbbbbbbbbbbb",
      updatedAtMs: 10_000,
    });
    await expect(
      readAgentPresence({
        store,
        sessionId: "cccccccccccccccc",
        now: 12_000,
      }),
    ).resolves.toEqual({ connected: false, state: "waiting" });
    await expect(
      readAgentPresence({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        now: 10_000 + AGENT_STALL_MS - 1,
      }),
    ).resolves.toEqual({
      connected: true,
      state: "working",
      requestId: "bbbbbbbbbbbbbbbb",
      updatedAtMs: 10_000,
    });
    await expect(
      readAgentPresence({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        now: 10_000 + AGENT_STALL_MS + 1,
      }),
    ).resolves.toEqual({ connected: false, state: "waiting" });
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
      line({
        sessionId: "s1",
        seq: 1,
        stepCode: "agent-note",
        step: "Revising",
        state: "live",
      }),
    );
    expect(await readProgress({ store, sessionId: "s1" })).toEqual([
      {
        sessionId: "s1",
        seq: 1,
        stepCode: "agent-note",
        step: "Revising",
        state: "live",
      },
    ]);
  });

  it("should drop an event written for another session", async () => {
    const store = await storeWithProgress(
      line({
        sessionId: "other",
        seq: 1,
        stepCode: "agent-note",
        step: "Ready",
        state: "done",
      }),
    );
    expect(await readProgress({ store, sessionId: "s1" })).toEqual([]);
  });

  it("should drop an event that does not advance the sequence", async () => {
    const store = await storeWithProgress(
      line({
        sessionId: "s1",
        seq: 2,
        stepCode: "agent-note",
        step: "Revising",
        state: "live",
      }) +
        line({
          sessionId: "s1",
          seq: 1,
          stepCode: "agent-note",
          step: "Replayed",
          state: "done",
        }),
    );
    const events = await readProgress({ store, sessionId: "s1" });
    expect(events.map((event) => event.step)).toEqual(["Revising"]);
  });

  it("should drop an event carrying a state the surface cannot show", async () => {
    const store = await storeWithProgress(
      line({
        sessionId: "s1",
        seq: 1,
        stepCode: "agent-note",
        step: "Redirect",
        state: "navigate:https://evil.example.com",
      }),
    );
    expect(await readProgress({ store, sessionId: "s1" })).toEqual([]);
  });

  it("should survive a hand-edited status file rather than failing the session", async () => {
    const store = await storeWithProgress(
      "not json at all\n" +
        line({
          sessionId: "s1",
          seq: 1,
          stepCode: "agent-note",
          step: "Revising",
          state: "live",
        }),
    );
    expect(await readProgress({ store, sessionId: "s1" })).toHaveLength(1);
  });

  it("should bound the text a relayed event can carry", async () => {
    const store = await storeWithProgress(
      line({
        sessionId: "s1",
        seq: 1,
        stepCode: "agent-note",
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
    await appendProgressValue({
      store,
      event: {
        sessionId: "s1",
        seq: 1,
        stepCode: "agent-note",
        step: "Feedback package received",
        state: "done",
      },
    });
    await appendProgressValue({
      store,
      event: {
        sessionId: "s1",
        seq: 2,
        stepCode: "agent-note",
        step: "Agent started",
        state: "live",
      },
    });
    expect(
      (await readProgress({ store, sessionId: "s1" })).map(
        (event) => event.step,
      ),
    ).toEqual(["Feedback package received", "Agent started"]);
  });

  it("should relay the latest 200 events", async () => {
    const store = await storeWithProgress(
      Array.from({ length: 205 }, (_, index) =>
        line({
          sessionId: "s1",
          seq: index + 1,
          stepCode: "agent-note",
          step: `Step ${index + 1}`,
          state: "live",
        }),
      ).join(""),
    );
    const events = await readProgress({ store, sessionId: "s1" });
    expect(events).toHaveLength(200);
    expect(events[0]?.seq).toBe(6);
    expect(events.at(-1)?.seq).toBe(205);
  });
});

import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_STALL_MS } from "./shared/agent-status.js";
import { MAX_IMAGE_BYTES } from "./shared/review-image.js";
import {
  appendAgentConnectionEvent,
  appendProgressValue,
  anchorReviewStore,
  deriveReviewPlanId,
  prepareStore,
  readAgentConnectionEvents,
  readAgentPresence,
  readProgress,
  readResolvedCommentIds,
  readSnapshot,
  reviewStoreFor,
  writeAgentHeartbeat,
  writeResolvedCommentIds,
  writeSnapshot,
  writeSessionHeartbeatValue,
  withReviewStoreLock,
  freezeRequestAttachments,
  publishReviewImage,
  readReviewImage,
} from "./store.js";

const created: Array<string> = [];

const temporaryPlan = async () => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-store-"));
  created.push(directory);
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, "# Plan\n");
  return { directory, planPath };
};

const tinyPng = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44,
  0x52, 0, 0, 0, 2, 0, 0, 0, 3,
]);

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
    const canonicalDirectory = await realpath(directory);
    for (const path of [
      store.reviewDirectory,
      store.feedbackDirectory,
      store.feedbackSubmissionDirectory,
      store.agentRequestDirectory,
      store.agentResponseDirectory,
      store.agentMutationDirectory,
      store.agentMutationJournalDirectory,
      store.agentPromptPath,
      store.snapshotDirectory,
      store.draftsPath,
      store.sentPath,
      store.progressPath,
      store.agentConnectionDirectory,
      store.resolvedPath,
      store.sessionPath,
      store.heartbeatPath,
      store.sessionLockPath,
      store.agentHeartbeatPath,
    ]) {
      expect(path.startsWith(join(canonicalDirectory, ".big-plan"))).toBe(true);
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

  it("should reject a symlinked review directory below the plan anchor", async () => {
    const { directory, planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    const outsideDirectory = join(directory, "outside-review");
    await rename(store.reviewDirectory, outsideDirectory);
    await symlink(outsideDirectory, store.reviewDirectory, "dir");
    try {
      await expect(anchorReviewStore(store)).rejects.toMatchObject({
        reason: "outside",
      });
    } finally {
      await rm(store.reviewDirectory, { force: true });
      await rename(outsideDirectory, store.reviewDirectory);
    }
  });
});

describe("review image store", () => {
  it("should publish, deduplicate, read, and freeze an image atomically", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    const first = await publishReviewImage({
      store,
      bytes: tinyPng,
      alt: "Capture",
    });
    const second = await publishReviewImage({
      store,
      bytes: tinyPng,
      alt: "Other alt",
    });
    expect(second.id).toBe(first.id);
    await expect(
      readReviewImage({ store, id: first.id }),
    ).resolves.toMatchObject({
      descriptor: { id: first.id, width: 2, height: 3 },
      bytes: tinyPng,
    });
    const frozen = await freezeRequestAttachments({
      store,
      requestId: "1111111111111111",
      references: [{ id: first.id, alt: "Frozen capture" }],
    });
    expect(frozen[0]).toMatchObject({ id: first.id, alt: "Frozen capture" });
    await expect(readFile(frozen[0].path)).resolves.toEqual(
      Buffer.from(tinyPng),
    );
  });

  it("should refuse a foreign reference without creating request copies", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await expect(
      freezeRequestAttachments({
        store,
        requestId: "2222222222222222",
        references: [{ id: "a".repeat(64), alt: "Missing" }],
      }),
    ).rejects.toThrow(/Unknown or corrupt/);
    await expect(
      stat(join(store.requestAttachmentsDirectory, "2222222222222222")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("should refuse oversized and non-regular stored image files", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    const descriptor = await publishReviewImage({
      store,
      bytes: tinyPng,
      alt: "Capture",
    });
    const directory = join(store.imagesDirectory, descriptor.id);
    const imagePath = join(directory, "image.png");
    const metadataPath = join(directory, "metadata.json");

    await writeFile(imagePath, new Uint8Array(MAX_IMAGE_BYTES + 1));
    await expect(
      readReviewImage({ store, id: descriptor.id }),
    ).resolves.toBeUndefined();

    await rm(imagePath);
    await mkdir(imagePath);
    await expect(
      readReviewImage({ store, id: descriptor.id }),
    ).resolves.toBeUndefined();

    await rm(imagePath, { recursive: true });
    await writeFile(imagePath, tinyPng);
    await rm(metadataPath);
    await mkdir(metadataPath);
    await expect(
      readReviewImage({ store, id: descriptor.id }),
    ).resolves.toBeUndefined();
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

  it("should return a completed change after another process retired the lock", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);

    await expect(
      withReviewStoreLock({
        lockPath: store.sessionLockPath,
        change: async () => {
          await rm(store.sessionLockPath, { recursive: true, force: true });
          return "written";
        },
        timeoutError: () => new Error("lock timed out"),
      }),
    ).resolves.toBe("written");
  });

  it("should keep the change error when the lock changed owners", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);

    await expect(
      withReviewStoreLock({
        lockPath: store.sessionLockPath,
        change: async () => {
          await writeFile(
            join(store.sessionLockPath, "owner.json"),
            `${JSON.stringify({ pid: process.pid, token: "0".repeat(32) })}\n`,
          );
          throw new Error("the change itself failed");
        },
        timeoutError: () => new Error("lock timed out"),
      }),
    ).rejects.toThrow("the change itself failed");
  });

  it("should leave a generation it no longer owns in place", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    const successor = { pid: process.pid, token: "f".repeat(32) };

    await withReviewStoreLock({
      lockPath: store.sessionLockPath,
      change: async () => {
        await writeFile(
          join(store.sessionLockPath, "owner.json"),
          `${JSON.stringify(successor)}\n`,
        );
      },
      timeoutError: () => new Error("lock timed out"),
    });

    expect(
      JSON.parse(
        await readFile(join(store.sessionLockPath, "owner.json"), "utf8"),
      ),
    ).toEqual(successor);
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
    const snapshot = "1111111111111111";
    await writeSnapshot({ store, snapshot, source: "# First\n" });
    await writeSnapshot({ store, snapshot, source: "# Second\n" });
    await expect(readSnapshot({ store, snapshot })).resolves.toBe("# First\n");
  });

  it("should migrate legacy revisions into snapshots without overwriting them", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    const snapshot = "2222222222222222";
    const legacyDirectory = join(store.reviewDirectory, "revisions");
    await mkdir(legacyDirectory, { recursive: true });
    await writeFile(join(legacyDirectory, `${snapshot}.mdx`), "# Legacy\n");

    await prepareStore(store);
    await expect(readSnapshot({ store, snapshot })).resolves.toBe("# Legacy\n");
    await writeFile(
      join(store.snapshotDirectory, `${snapshot}.mdx`),
      "# Current\n",
    );
    await prepareStore(store);
    await expect(readSnapshot({ store, snapshot })).resolves.toBe(
      "# Current\n",
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
    await writeFile(store.resolvedPath, '["exposed"]\n');
    await chmod(store.resolvedPath, 0o644);
    await writeResolvedCommentIds({ store, ids: ["aabbccdd"] });
    expect((await stat(store.resolvedPath)).mode & 0o777).toBe(0o600);
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
    ).resolves.toEqual({
      connected: false,
      state: "waiting",
      updatedAtMs: 10_000,
    });
  });

  it("ignores request-specific metadata in the presence record", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeFile(
      store.agentHeartbeatPath,
      JSON.stringify({
        sessionId: "aaaaaaaaaaaaaaaa",
        state: "waiting",
        model: { name: "Grok 4.6" },
        updatedAtMs: 10_000,
      }),
    );
    await expect(
      readAgentPresence({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        now: 12_000,
      }),
    ).resolves.toEqual({
      connected: true,
      state: "waiting",
      updatedAtMs: 10_000,
    });
    await expect(
      readAgentPresence({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        now: 10_000 + AGENT_STALL_MS + 1,
      }),
    ).resolves.toEqual({
      connected: false,
      state: "waiting",
      updatedAtMs: 10_000,
    });
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

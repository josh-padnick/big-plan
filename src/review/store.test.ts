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
import { AGENT_STALL_MS } from "./shared/agent-timing.js";
import { MAX_IMAGE_BYTES } from "./shared/review-image.js";
import {
  appendAgentConnectionEvent,
  appendProgressValue,
  attachAgentToRoster,
  anchorReviewStore,
  deriveReviewPlanId,
  prepareStore,
  readAgentConnectionEvents,
  readAgentDisconnectRequestFor,
  readAgentDisconnectRequests,
  readAgentPresence,
  readProgress,
  readResolvedCommentIds,
  readSnapshot,
  reviewStoreFor,
  writeAgentDisconnectRequest,
  writeAgentHeartbeat,
  writeAgentHeartbeatEnded,
  writeResolvedCommentIds,
  writeStoreJson,
  writeSnapshot,
  writeSessionHeartbeatValue,
  withReviewStoreLock,
  freezeRequestAttachments,
  highestAgentMutationStageGeneration,
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
      store.inputsPath,
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

describe("agent mutation stage generations", () => {
  const requestId = "cccc3333cccc3333";

  it("should read no stage generation for a request that has none", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);

    await expect(
      highestAgentMutationStageGeneration({ store, requestId }),
    ).resolves.toBe(0);
  });

  it("should read the highest generation on disk, ignoring other names", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    const stages = join(store.agentMutationDirectory, requestId);
    await mkdir(join(stages, "1"), { recursive: true });
    await mkdir(join(stages, "7"), { recursive: true });
    await mkdir(join(stages, "notageneration"), { recursive: true });

    await expect(
      highestAgentMutationStageGeneration({ store, requestId }),
    ).resolves.toBe(7);
  });

  it("should refuse to read stages it cannot list rather than answer none", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    // Anything but a missing directory hides generations that exist, and
    // answering 0 would hand a new claim a generation whose stage is still
    // there. A file standing where the stage directory belongs is the
    // deterministic form of that failure.
    await mkdir(store.agentMutationDirectory, { recursive: true });
    await writeFile(join(store.agentMutationDirectory, requestId), "");

    await expect(
      highestAgentMutationStageGeneration({ store, requestId }),
    ).rejects.toMatchObject({ code: "ENOTDIR" });
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
      totalByteLimit: MAX_IMAGE_BYTES,
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
        totalByteLimit: MAX_IMAGE_BYTES,
      }),
    ).rejects.toThrow(/Unknown or corrupt/);
    await expect(
      stat(join(store.requestAttachmentsDirectory, "2222222222222222")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("should validate the total before creating a request attachment directory", async () => {
    const { directory, planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    const descriptor = await publishReviewImage({
      store,
      bytes: tinyPng,
      alt: "Capture",
    });
    const blockedDirectory = join(directory, "not-a-directory");
    await writeFile(blockedDirectory, "blocks request attachment writes");

    await expect(
      freezeRequestAttachments({
        store: { ...store, requestAttachmentsDirectory: blockedDirectory },
        requestId: "3333333333333333",
        references: Array.from({ length: 3 }, () => ({
          id: descriptor.id,
          alt: "Capture",
        })),
        totalByteLimit: tinyPng.byteLength * 2,
      }),
    ).rejects.toThrow(/must total/);
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
  // Which agent is attached is a fact about the session, so a reviewer can ask
  // it while no request is being worked on at all.
  it("preserves connector identity until another declaration replaces it", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeAgentHeartbeat({
      store,
      sessionId: "aaaaaaaaaaaaaaaa",
      state: "waiting",
      model: { name: "Claude Opus 5" },
      now: 10_000,
    });
    await expect(
      readAgentPresence({ store, sessionId: "aaaaaaaaaaaaaaaa", now: 12_000 }),
    ).resolves.toEqual({
      connected: true,
      state: "waiting",
      model: { name: "Claude Opus 5" },
      updatedAtMs: 10_000,
    });
    await writeAgentHeartbeat({
      store,
      sessionId: "aaaaaaaaaaaaaaaa",
      state: "waiting",
      now: 10_000,
    });
    await expect(
      readAgentPresence({ store, sessionId: "aaaaaaaaaaaaaaaa", now: 12_000 }),
    ).resolves.toEqual({
      connected: true,
      state: "waiting",
      model: { name: "Claude Opus 5" },
      updatedAtMs: 10_000,
    });
    await writeAgentHeartbeat({
      store,
      sessionId: "aaaaaaaaaaaaaaaa",
      state: "waiting",
      model: { client: "grok-cli 0.2.99" },
      now: 11_000,
    });
    await expect(
      readAgentPresence({ store, sessionId: "aaaaaaaaaaaaaaaa", now: 12_000 }),
    ).resolves.toEqual({
      connected: true,
      state: "waiting",
      model: { client: "grok-cli 0.2.99" },
      updatedAtMs: 11_000,
    });
  });

  it("refuses a heartbeat from a writer the roster has never seen", async () => {
    /*
    There is one presence record per review and it is replaced whole, so
    whoever writes it becomes, to every reviewer-facing surface, the agent
    attached to this plan. Every shipped path registers before it heartbeats,
    but that was a property of the call sites and nothing enforced it - and the
    failure it left open was silent, which is the shape of failure this
    subsystem exists to remove (BIG-171).
    */
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await attachAgentToRoster({
      store,
      sessionId: "aaaaaaaaaaaaaaaa",
      writerId: "0123456789abcdef",
      now: 10_000,
    });
    await expect(
      writeAgentHeartbeat({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        state: "waiting",
        writerId: "0123456789abcdef",
        now: 10_000,
      }),
    ).resolves.toBe(true);
    await expect(
      writeAgentHeartbeat({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        state: "working",
        requestId: "bbbbbbbbbbbbbbbb",
        writerId: "feedfeedfeedfeed",
        now: 11_000,
      }),
    ).resolves.toBe(false);
    // The refused write left the record exactly as the registered agent wrote
    // it, rather than half-applying and renaming the review's agent.
    await expect(
      readAgentPresence({ store, sessionId: "aaaaaaaaaaaaaaaa", now: 12_000 }),
    ).resolves.toEqual({
      connected: true,
      state: "waiting",
      writerId: "0123456789abcdef",
      updatedAtMs: 10_000,
    });
  });

  it("lets a review nobody has attached to yet record its first heartbeat", async () => {
    // An empty roster is not evidence of an unregistered writer, only of a
    // review no agent has reached; there is nobody there to be spoken over.
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await expect(
      writeAgentHeartbeat({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        state: "waiting",
        writerId: "0123456789abcdef",
        now: 10_000,
      }),
    ).resolves.toBe(true);
  });

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

  it("does not carry identity into another review session", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeAgentHeartbeat({
      store,
      sessionId: "aaaaaaaaaaaaaaaa",
      state: "waiting",
      model: { name: "claude-fable-5" },
      now: 10_000,
    });
    await writeAgentHeartbeat({
      store,
      sessionId: "bbbbbbbbbbbbbbbb",
      state: "waiting",
      now: 11_000,
    });
    await expect(
      readAgentPresence({ store, sessionId: "bbbbbbbbbbbbbbbb", now: 12_000 }),
    ).resolves.toEqual({
      connected: true,
      state: "waiting",
      updatedAtMs: 11_000,
    });
  });

  it("keeps connector identity when the heartbeat ages out", async () => {
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
      model: { name: "Grok 4.6" },
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
      model: { name: "Grok 4.6" },
      updatedAtMs: 10_000,
    });
  });

  it("keeps the connector's identity through a lapsed working turn", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    // The sequence the captain hit: an agent connects and declares itself, then
    // works long enough that nothing renews the plan-wide heartbeat. Who it is
    // must not expire with the proof that it is still there.
    await writeFile(
      store.agentHeartbeatPath,
      JSON.stringify({
        sessionId: "aaaaaaaaaaaaaaaa",
        state: "working",
        requestId: "bbbbbbbbbbbbbbbb",
        model: {
          name: "grok-4.6",
          effort: "high",
          client: "grok-cli 0.2.99",
          sessionUrl: "https://grok.example/chat/42",
        },
        updatedAtMs: 10_000,
      }),
    );
    const declared = {
      name: "grok-4.6",
      effort: "high",
      client: "grok-cli 0.2.99",
      sessionUrl: "https://grok.example/chat/42",
    };
    await expect(
      readAgentPresence({ store, sessionId: "aaaaaaaaaaaaaaaa", now: 12_000 }),
    ).resolves.toMatchObject({ connected: true, model: declared });
    // Ten minutes into one turn, with no heartbeat since pickup.
    await expect(
      readAgentPresence({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        now: 10_000 + 600_000,
      }),
    ).resolves.toMatchObject({ connected: false, model: declared });
    // And a new agent replaces it, which is the only thing that should.
    await writeFile(
      store.agentHeartbeatPath,
      JSON.stringify({
        sessionId: "aaaaaaaaaaaaaaaa",
        state: "waiting",
        model: { name: "claude-fable-5" },
        updatedAtMs: 700_000,
      }),
    );
    await expect(
      readAgentPresence({ store, sessionId: "aaaaaaaaaaaaaaaa", now: 700_100 }),
    ).resolves.toMatchObject({
      connected: true,
      model: { name: "claude-fable-5" },
    });
  });

  it("reads an observed session end as an immediate disconnect", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeAgentHeartbeat({
      store,
      sessionId: "aaaaaaaaaaaaaaaa",
      state: "waiting",
      writerId: "1111111111111111",
      now: 10_000,
    });
    await expect(
      writeAgentHeartbeatEnded({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        writerId: "1111111111111111",
        now: 10_500,
      }),
    ).resolves.toBe(true);
    // One second later: far inside the aging window, and disconnected anyway.
    await expect(
      readAgentPresence({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        now: 11_500,
      }),
    ).resolves.toEqual({
      connected: false,
      state: "waiting",
      updatedAtMs: 10_500,
      endedAtMs: 10_500,
      writerId: "1111111111111111",
    });
  });

  it("keeps an ended session's other heartbeat facts", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeFile(
      store.agentHeartbeatPath,
      JSON.stringify({
        sessionId: "aaaaaaaaaaaaaaaa",
        state: "waiting",
        model: { name: "Grok 4.6" },
        writerId: "1111111111111111",
        updatedAtMs: 10_000,
      }),
    );
    await writeAgentHeartbeatEnded({
      store,
      sessionId: "aaaaaaaaaaaaaaaa",
      writerId: "1111111111111111",
      now: 10_500,
    });
    // A session that ended still names the agent that held it.
    expect(
      JSON.parse(await readFile(store.agentHeartbeatPath, "utf8")),
    ).toMatchObject({ model: { name: "Grok 4.6" }, state: "ended" });
  });

  it("does not hand one agent's identity to the next", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeAgentHeartbeat({
      store,
      sessionId: "aaaaaaaaaaaaaaaa",
      state: "waiting",
      writerId: "1111111111111111",
      model: { name: "grok-4.6", client: "grok-cli 0.2.99" },
      now: 10_000,
    });
    // The same agent renewing its claim says nothing new about itself, so what
    // it already declared carries forward.
    await writeAgentHeartbeat({
      store,
      sessionId: "aaaaaaaaaaaaaaaa",
      state: "working",
      writerId: "1111111111111111",
      now: 11_000,
    });
    await expect(
      readAgentPresence({ store, sessionId: "aaaaaaaaaaaaaaaa", now: 11_500 }),
    ).resolves.toMatchObject({
      model: { name: "grok-4.6", client: "grok-cli 0.2.99" },
    });
    // A different agent that declares nothing has declared nothing. Showing it
    // under the previous agent's name would name the wrong agent at exactly
    // the moment the reader most needs to know which one they have.
    await writeAgentHeartbeat({
      store,
      sessionId: "aaaaaaaaaaaaaaaa",
      state: "waiting",
      writerId: "2222222222222222",
      now: 12_000,
    });
    await expect(
      readAgentPresence({ store, sessionId: "aaaaaaaaaaaaaaaa", now: 12_500 }),
    ).resolves.toEqual({
      connected: true,
      state: "waiting",
      updatedAtMs: 12_000,
      writerId: "2222222222222222",
    });
  });

  it("refuses to end a heartbeat another agent now owns", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeAgentHeartbeat({
      store,
      sessionId: "aaaaaaaaaaaaaaaa",
      state: "waiting",
      writerId: "2222222222222222",
      now: 20_000,
    });
    await expect(
      writeAgentHeartbeatEnded({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        writerId: "1111111111111111",
        now: 20_500,
      }),
    ).resolves.toBe(false);
    await expect(
      readAgentPresence({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        now: 20_500,
      }),
    ).resolves.toEqual({
      connected: true,
      state: "waiting",
      updatedAtMs: 20_000,
      writerId: "2222222222222222",
    });
  });

  it("refuses a stale end that races a newer agent's first heartbeat", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeAgentHeartbeat({
      store,
      sessionId: "aaaaaaaaaaaaaaaa",
      state: "waiting",
      writerId: "1111111111111111",
      now: 20_000,
    });
    let ended: Promise<boolean> | undefined;
    // The dying loop's marker starts while the heartbeat lock is held, so its
    // read and its write both land after the newer loop's first heartbeat
    // rather than straddling it.
    await withReviewStoreLock({
      lockPath: store.agentHeartbeatLockPath,
      change: async () => {
        ended = writeAgentHeartbeatEnded({
          store,
          sessionId: "aaaaaaaaaaaaaaaa",
          writerId: "1111111111111111",
          now: 20_400,
        });
        await new Promise((settle) => setTimeout(settle, 100));
        expect(
          JSON.parse(await readFile(store.agentHeartbeatPath, "utf8")),
        ).toMatchObject({ state: "waiting", writerId: "1111111111111111" });
        await writeFile(
          store.agentHeartbeatPath,
          JSON.stringify({
            sessionId: "aaaaaaaaaaaaaaaa",
            state: "waiting",
            writerId: "2222222222222222",
            updatedAtMs: 20_300,
          }),
        );
      },
      timeoutError: () => new Error("The heartbeat lock was already held"),
    });
    await expect(ended).resolves.toBe(false);
    await expect(
      readAgentPresence({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        now: 20_500,
      }),
    ).resolves.toEqual({
      connected: true,
      state: "waiting",
      updatedAtMs: 20_300,
      writerId: "2222222222222222",
    });
  });

  it("reports a heartbeat it could not write instead of raising it", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    // The connection loop awaits this write every half second inside its own
    // wait, so a lock it never wins has to be survivable: the next refresh
    // answers it, while an exception here would end a live session.
    await withReviewStoreLock({
      lockPath: store.agentHeartbeatLockPath,
      change: async () => {
        await expect(
          writeAgentHeartbeat({
            store,
            sessionId: "aaaaaaaaaaaaaaaa",
            state: "waiting",
            writerId: "1111111111111111",
            now: 30_000,
            // A lock this write will never win, waited for as briefly as
            // losing it can be observed.
            lockAttempts: 3,
          }),
        ).resolves.toBe(false);
      },
      timeoutError: () => new Error("The heartbeat lock was already held"),
    });
    await expect(
      readAgentPresence({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        now: 30_000,
      }),
    ).resolves.toEqual({ connected: false, state: "waiting" });
  });

  it("reports a heartbeat lock it could not take at all", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    // Something else owns the lock path, so no waiting can win it. Losing a
    // lock is not evidence about the agent, and the loop that awaits this
    // write every half second must survive being told so.
    await writeFile(store.agentHeartbeatLockPath, "not a lock");
    await expect(
      writeAgentHeartbeat({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        state: "waiting",
        writerId: "1111111111111111",
        now: 60_000,
        lockAttempts: 3,
      }),
    ).resolves.toBe(false);
    await expect(
      readAgentPresence({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        now: 60_000,
      }),
    ).resolves.toEqual({ connected: false, state: "waiting" });
  });

  it("raises a heartbeat write that ran and failed", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    // The heartbeat cannot be replaced by a file, so the guarded write itself
    // fails once it holds the lock.
    await mkdir(store.agentHeartbeatPath);
    await expect(
      writeAgentHeartbeat({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        state: "waiting",
        writerId: "1111111111111111",
        now: 60_000,
        lockAttempts: 3,
      }),
    ).rejects.toThrow();
  });

  it("keeps the writer a heartbeat names when a write claims no identity", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeAgentHeartbeat({
      store,
      sessionId: "aaaaaaaaaaaaaaaa",
      state: "waiting",
      writerId: "1111111111111111",
      now: 40_000,
    });
    // A second agent process reporting its progress mints no identity of its
    // own, and must not take the waiting loop's away.
    await writeAgentHeartbeat({
      store,
      sessionId: "aaaaaaaaaaaaaaaa",
      state: "working",
      requestId: "bbbbbbbbbbbbbbbb",
      now: 40_100,
    });
    await expect(
      writeAgentHeartbeatEnded({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        writerId: "1111111111111111",
        now: 40_200,
      }),
    ).resolves.toBe(true);
    await expect(
      readAgentPresence({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        now: 40_300,
      }),
    ).resolves.toEqual({
      connected: false,
      state: "waiting",
      updatedAtMs: 40_200,
      endedAtMs: 40_200,
      writerId: "1111111111111111",
    });
  });

  it("hands the heartbeat to a writer that claims it", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeAgentHeartbeat({
      store,
      sessionId: "aaaaaaaaaaaaaaaa",
      state: "waiting",
      writerId: "1111111111111111",
      now: 50_000,
    });
    await writeAgentHeartbeat({
      store,
      sessionId: "aaaaaaaaaaaaaaaa",
      state: "working",
      requestId: "bbbbbbbbbbbbbbbb",
      now: 50_100,
    });
    await writeAgentHeartbeat({
      store,
      sessionId: "aaaaaaaaaaaaaaaa",
      state: "waiting",
      writerId: "2222222222222222",
      now: 50_200,
    });
    await expect(
      writeAgentHeartbeatEnded({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        writerId: "1111111111111111",
        now: 50_300,
      }),
    ).resolves.toBe(false);
    await expect(
      writeAgentHeartbeatEnded({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        writerId: "2222222222222222",
        now: 50_400,
      }),
    ).resolves.toBe(true);
  });

  it("refuses to end a heartbeat that names no writer", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeAgentHeartbeat({
      store,
      sessionId: "aaaaaaaaaaaaaaaa",
      state: "waiting",
      now: 20_000,
    });
    await expect(
      writeAgentHeartbeatEnded({
        store,
        sessionId: "aaaaaaaaaaaaaaaa",
        writerId: "1111111111111111",
        now: 20_500,
      }),
    ).resolves.toBe(false);
  });
});

// BIG-190: a review outlives the agents attached to it, so the record of who
// the reviewer disconnected has to outlive them too.
describe("review store agent disconnect directives", () => {
  it("should keep one standing directive per disconnected agent", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeAgentDisconnectRequest({
      store,
      directive: { writerId: "1111111111111111", requestedAtMs: 10_000 },
    });
    await writeAgentDisconnectRequest({
      store,
      directive: { writerId: "2222222222222222", requestedAtMs: 20_000 },
    });
    // The second disconnect must not answer for the first. An agent taken off
    // mid turn may not run another command until after a later one was
    // recorded, and a single slot would meet it with an ordinary claim failure
    // instead of telling it the reviewer disconnected it.
    await expect(
      readAgentDisconnectRequestFor({ store, writerId: "1111111111111111" }),
    ).resolves.toMatchObject({ requestedAtMs: 10_000 });
    await expect(
      readAgentDisconnectRequestFor({ store, writerId: "2222222222222222" }),
    ).resolves.toMatchObject({ requestedAtMs: 20_000 });
  });

  it("should replace a standing directive for the same agent", async () => {
    // Disconnecting the same agent twice restates one decision; it is not two.
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeAgentDisconnectRequest({
      store,
      directive: { writerId: "1111111111111111", requestedAtMs: 10_000 },
    });
    await writeAgentDisconnectRequest({
      store,
      directive: { writerId: "1111111111111111", requestedAtMs: 30_000 },
    });
    await expect(readAgentDisconnectRequests({ store })).resolves.toEqual([
      { writerId: "1111111111111111", requestedAtMs: 30_000 },
    ]);
  });

  it("should address nobody from a record that names nobody", async () => {
    // A directive matching on absence would be a standing order against every
    // agent that ever attaches to this review.
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeStoreJson({
      path: store.agentDisconnectPath,
      value: { directives: [{ requestedAtMs: 10_000 }] },
    });
    await expect(readAgentDisconnectRequests({ store })).resolves.toEqual([]);
    await expect(
      readAgentDisconnectRequestFor({ store, writerId: "1111111111111111" }),
    ).resolves.toBeUndefined();
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

// Covers the review-owned coding-agent loop through its one action interface.

import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildFeedbackPackage } from "./feedback-package.js";
import {
  deriveSnapshotDigest,
  feedbackAgentRequest,
  messageAgentRequest,
  readAgentExchange,
  validateAgentResponseDraft,
  writeAgentRequest,
} from "./agent-exchange.js";
import { runAgentWorkLoopAction } from "./agent-work-loop.js";
import {
  cancelAgentRequest,
  claimAgentRequest,
  deleteQueuedRequest,
  commitRequestTerminal,
  reviseQueuedRequest,
} from "./request-mailbox.js";
import { startReviewRuntime } from "./server.js";
import type { ReviewRuntime } from "./server.js";
import { reviewImageId } from "./shared/review-image.js";
import { readProgress } from "./store.js";
import * as reviewStore from "./store.js";
import { renderDocument } from "../render/render-document.js";
import { AGENT_CLAIM_LEASE_MS } from "./shared/agent-claim.js";

let runtime: ReviewRuntime;
let pickedUpToken = "";
const commentBody = "Which confidence level should this claim use?";
const executablePath = fileURLToPath(
  new URL("../../bin/big-plan.mjs", import.meta.url),
);

const deferred = (): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} => {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const holdAgentRequestLock = async ({
  store,
  requestId,
}: {
  readonly store: ReviewRuntime["store"];
  readonly requestId: string;
}): Promise<() => Promise<void>> => {
  const acquired = deferred();
  const released = deferred();
  const lock = reviewStore.withReviewStoreLock({
    lockPath: join(store.agentRequestDirectory, `.${requestId}.lock`),
    change: async () => {
      acquired.resolve();
      await released.promise;
    },
    timeoutError: () => new Error("Timed out holding the agent request lock"),
  });
  await acquired.promise;
  let settled = false;
  return async () => {
    if (settled) return;
    settled = true;
    released.resolve();
    await lock;
  };
};

beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-command-"));
  const sourcePath = fileURLToPath(
    new URL("../../examples/sample.mdx", import.meta.url),
  );
  const source = await readFile(sourcePath, "utf8");
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, source);
  runtime = await startReviewRuntime({ planPath });
  const rendered = renderDocument({
    markdown: source,
    fallbackTitle: "plan",
    identity: {},
  });
  const target = rendered.blocks.find((block) => block.kind === "paragraph");
  if (target === undefined) {
    throw new Error("The sample plan has no paragraph target");
  }
  const feedback = buildFeedbackPackage({
    sessionId: runtime.sessionId,
    packageId: "aaaaaaaaaaaaaaaa",
    planId: runtime.planId,
    planPath,
    createdAt: "2026-08-02T12:00:00.000Z",
    comments: [
      {
        id: "bbbbbbbbbbbbbbbb",
        body: commentBody,
        createdAt: "2026-08-02T12:00:00.000Z",
        premiseSnapshot: deriveSnapshotDigest(source),
        target: {
          type: "block",
          blockId: target.id,
          kind: target.kind,
          label: target.label,
          ...(target.section === undefined ? {} : { section: target.section }),
        },
      },
    ],
  });
  await writeAgentRequest({
    store: runtime.store,
    request: feedbackAgentRequest({
      feedback,
      premiseSnapshot: deriveSnapshotDigest(source),
    }),
  });
});

afterAll(async () => {
  if (runtime !== undefined) await runtime.close();
});

describe("agent work loop", () => {
  it("should tolerate a heartbeat file being replaced while the review server is live", async () => {
    const readHeartbeat = vi
      .spyOn(reviewStore, "readSessionHeartbeatValue")
      .mockResolvedValueOnce(undefined);
    try {
      await expect(
        runAgentWorkLoopAction({
          kind: "prompt",
          planPath: runtime.planPath,
          executablePath,
        }),
      ).resolves.toMatchObject({ review: runtime.url });
    } finally {
      readHeartbeat.mockRestore();
    }
  });

  it("should print a ready-to-paste real-session prompt", async () => {
    const result = await runAgentWorkLoopAction({
      kind: "prompt",
      planPath: runtime.planPath,
      executablePath,
    });
    expect(result.agent_prompt).toContain("You are the coding agent");
    expect(result.agent_prompt).toContain("agent next");
    expect(result.agent_prompt).toContain("agent note");
    expect(result.agent_prompt).toContain("Retain the agent_token");
    expect(result.agent_prompt).toContain("agent next --agent <token>");
    expect(result.agent_prompt).toContain("--agent <agent_token>");
    expect(result.agent_prompt).toContain(runtime.planPath);
    expect(result.codex).toContain('codex "$(cat ');
    expect(result.claude).toContain('claude "$(cat ');
    if (typeof result.prompt_file !== "string") {
      throw new Error("The agent command did not provide its prompt file");
    }
    expect(await readFile(result.prompt_file, "utf8")).toContain(
      runtime.planPath,
    );
  });

  it("should return the oldest pending work and its response contract", async () => {
    const result = await runAgentWorkLoopAction({
      kind: "next",
      planPath: runtime.planPath,
      executablePath,
      shouldWait: false,
    });
    if (typeof result.agent_token !== "string") {
      throw new Error("The agent command did not mint a claim token");
    }
    pickedUpToken = result.agent_token;
    expect(result).toMatchObject({
      pending: true,
      work: {
        kind: "feedback",
        requestId: "aaaaaaaaaaaaaaaa",
      },
      response_template: {
        requestId: "aaaaaaaaaaaaaaaa",
      },
    });
    if (typeof result.response_file !== "string") {
      throw new Error("The agent command did not provide a response path");
    }
    await expect(
      readProgress({
        store: runtime.store,
        sessionId: runtime.sessionId,
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: "Reviewing feedback",
          state: "live",
          detail: commentBody,
        }),
      ]),
    );
  });

  it("should publish a complete needs-input outcome without editing the plan", async () => {
    // Resumes the claim the previous pickup took, the way a restarted agent
    // that still holds its token continues its own work.
    const next = await runAgentWorkLoopAction({
      kind: "next",
      planPath: runtime.planPath,
      executablePath,
      shouldWait: false,
      agentToken: pickedUpToken,
    });
    if (
      typeof next.response_file !== "string" ||
      typeof next.agent_token !== "string"
    ) {
      throw new Error("The pending request did not provide a response path");
    }
    const responseFile = next.response_file;
    // The token minted at pickup is what proves this process holds the
    // request, so the publish step carries it back.
    const agentToken = next.agent_token;
    await writeFile(
      responseFile,
      JSON.stringify({
        requestId: "aaaaaaaaaaaaaaaa",
        outcomes: [
          {
            commentId: "bbbbbbbbbbbbbbbb",
            state: "needs-input",
            message: "Should the plan state 90% or 95% confidence?",
          },
        ],
      }),
    );
    expect(
      await runAgentWorkLoopAction({
        kind: "respond",
        planPath: runtime.planPath,
        responsePath: responseFile,
        executablePath,
        agentToken,
      }),
    ).toMatchObject({
      responded: "aaaaaaaaaaaaaaaa",
      kind: "feedback",
    });
    const exchange = await readAgentExchange({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
    expect(exchange.responses).toMatchObject([
      {
        outcomes: [
          {
            state: "needs-input",
            message: "Should the plan state 90% or 95% confidence?",
          },
        ],
      },
    ]);
  });
});

describe("agent work loop lifecycle", () => {
  it("should not hand one request to two agents on the same review", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-two-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n\nOne request, two agent processes.\n";
    await writeFile(planPath, source);
    const review = await startReviewRuntime({ planPath });
    await writeAgentRequest({
      store: review.store,
      request: messageAgentRequest({
        kind: "chat",
        requestId: "dddddddddddddddd",
        sessionId: review.sessionId,
        planId: review.planId,
        premiseSnapshot: deriveSnapshotDigest(source),
        createdAt: "2026-08-12T12:00:00.000Z",
        body: "Only one agent may answer this.",
      }),
    });

    try {
      // Two `agent next` invocations against one review server: the same
      // review session id, so only a per-pickup token can tell them apart.
      const first = await runAgentWorkLoopAction({
        kind: "next",
        planPath,
        shouldWait: false,
        executablePath,
      });
      const second = await runAgentWorkLoopAction({
        kind: "next",
        planPath,
        shouldWait: false,
        executablePath,
      });

      expect(first).toMatchObject({ pending: true });
      expect(second).toMatchObject({ pending: false });
      expect(first.agent_token).toEqual(expect.any(String));
      expect(first.agent_token).not.toEqual(second.agent_token);
    } finally {
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should move to the next request when the oldest is leased elsewhere", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-lease-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n\nTwo agents are polling this plan.\n";
    await writeFile(planPath, source);
    const review = await startReviewRuntime({ planPath });
    const premiseSnapshot = deriveSnapshotDigest(source);
    const leased = messageAgentRequest({
      kind: "chat",
      requestId: "dddddddddddddddd",
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot,
      createdAt: "2026-08-12T12:00:00.000Z",
      body: "The other agent is already answering this one.",
    });
    const free = messageAgentRequest({
      kind: "chat",
      requestId: "eeeeeeeeeeeeeeee",
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot,
      createdAt: "2026-08-12T12:00:01.000Z",
      body: "This one is still unclaimed.",
    });
    await writeAgentRequest({ store: review.store, request: leased });
    await writeAgentRequest({ store: review.store, request: free });
    await claimAgentRequest({
      store: review.store,
      activeSessionId: review.sessionId,
      requestId: leased.requestId,
      claimedBy: "ffff2222ffff2222",
      baselineSnapshot: premiseSnapshot,
      now: new Date().toISOString(),
    });

    try {
      await expect(
        runAgentWorkLoopAction({
          kind: "next",
          planPath,
          shouldWait: false,
          executablePath,
        }),
      ).resolves.toMatchObject({
        pending: true,
        work: { requestId: free.requestId },
      });
    } finally {
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should leave a request reviewer-owned when its attachment cannot be opened", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-claim-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n";
    await writeFile(planPath, source);
    const review = await startReviewRuntime({ planPath });
    const imageId = reviewImageId("a".repeat(64));
    const request = messageAgentRequest({
      kind: "chat",
      requestId: "cccccccccccccccc",
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot: deriveSnapshotDigest(source),
      createdAt: "2026-08-12T12:00:00.000Z",
      body: "Please inspect the capture.",
      attachments: [
        {
          id: imageId,
          sha256: imageId,
          alt: "Capture",
          mimeType: "image/png",
          byteLength: 1,
          width: 1,
          height: 1,
          path: join(
            review.store.requestAttachmentsDirectory,
            "cccccccccccccccc",
            `image-${imageId}.png`,
          ),
        },
      ],
    });
    await writeAgentRequest({ store: review.store, request });
    try {
      await expect(
        runAgentWorkLoopAction({
          kind: "next",
          planPath,
          executablePath,
          shouldWait: false,
        }),
      ).rejects.toThrow(/could not be opened during agent pickup/);
      await expect(
        reviseQueuedRequest({
          store: review.store,
          requestId: request.requestId,
          body: "Please inspect this later.",
        }),
      ).resolves.toMatchObject({ body: "Please inspect this later." });
      await expect(
        deleteQueuedRequest({
          store: review.store,
          requestId: request.requestId,
        }),
      ).resolves.toEqual({ attachmentCleanup: "complete" });
    } finally {
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should refuse an attachment path that escapes its request directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-escape-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n";
    await writeFile(planPath, source);
    const review = await startReviewRuntime({ planPath });
    const imageId = reviewImageId("b".repeat(64));
    const request = messageAgentRequest({
      kind: "chat",
      requestId: "cccccccccccccccc",
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot: deriveSnapshotDigest(source),
      createdAt: "2026-08-12T12:00:00.000Z",
      body: "Please inspect the capture.",
      attachments: [
        {
          id: imageId,
          sha256: imageId,
          alt: "Capture",
          mimeType: "image/png",
          byteLength: 1,
          width: 1,
          height: 1,
          // Lexically under the request directory, but `..` walks back out of
          // it. A prefix test accepts this; a resolved comparison must not.
          // Built by concatenation because join() would normalize the escape.
          path: `${review.store.requestAttachmentsDirectory}/cccccccccccccccc/../../escaped.png`,
        },
      ],
    });
    await writeAgentRequest({ store: review.store, request });
    try {
      await expect(
        runAgentWorkLoopAction({
          kind: "next",
          planPath,
          executablePath,
          shouldWait: false,
        }),
      ).rejects.toThrow(/outside the request attachment directory/);
    } finally {
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should refuse a symlinked attachment target outside its request directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-symlink-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n";
    const bytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
      0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3,
    ]);
    await writeFile(planPath, source);
    const review = await startReviewRuntime({ planPath });
    const descriptor = await reviewStore.publishReviewImage({
      store: review.store,
      bytes,
      alt: "Capture",
    });
    const requestId = "cccccccccccccccc";
    const attachments = await reviewStore.freezeRequestAttachments({
      store: review.store,
      requestId,
      references: [{ id: descriptor.id, alt: descriptor.alt }],
    });
    const attachment = attachments[0];
    const outsidePath = join(directory, "outside.png");
    await writeFile(outsidePath, bytes);
    await rm(attachment.path);
    await symlink(outsidePath, attachment.path);
    const request = messageAgentRequest({
      kind: "chat",
      requestId,
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot: deriveSnapshotDigest(source),
      createdAt: "2026-08-12T12:00:00.000Z",
      body: "Please inspect the capture.",
      attachments,
    });
    await writeAgentRequest({ store: review.store, request });
    try {
      await expect(
        runAgentWorkLoopAction({
          kind: "next",
          planPath,
          executablePath,
          shouldWait: false,
        }),
      ).rejects.toThrow(/outside the request attachment directory/);
    } finally {
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should refuse a symlinked request attachment directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-root-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n";
    const bytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
      0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3,
    ]);
    await writeFile(planPath, source);
    const review = await startReviewRuntime({ planPath });
    const descriptor = await reviewStore.publishReviewImage({
      store: review.store,
      bytes,
      alt: "Capture",
    });
    const requestId = "cccccccccccccccc";
    const attachments = await reviewStore.freezeRequestAttachments({
      store: review.store,
      requestId,
      references: [{ id: descriptor.id, alt: descriptor.alt }],
    });
    const attachmentRoot = join(
      review.store.requestAttachmentsDirectory,
      requestId,
    );
    const outsideRoot = join(directory, "outside-request");
    await rm(attachmentRoot, { recursive: true });
    await mkdir(outsideRoot);
    await writeFile(join(outsideRoot, basename(attachments[0].path)), bytes);
    await symlink(outsideRoot, attachmentRoot, "dir");
    const request = messageAgentRequest({
      kind: "chat",
      requestId,
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot: deriveSnapshotDigest(source),
      createdAt: "2026-08-12T12:00:00.000Z",
      body: "Please inspect the capture.",
      attachments,
    });
    await writeAgentRequest({ store: review.store, request });
    try {
      await expect(
        runAgentWorkLoopAction({
          kind: "next",
          planPath,
          executablePath,
          shouldWait: false,
        }),
      ).rejects.toThrow(/outside the request attachment directory/);
    } finally {
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should refuse a symlinked attachment store segment", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-store-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n";
    const bytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
      0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3,
    ]);
    await writeFile(planPath, source);
    const review = await startReviewRuntime({ planPath });
    const descriptor = await reviewStore.publishReviewImage({
      store: review.store,
      bytes,
      alt: "Capture",
    });
    const requestId = "cccccccccccccccc";
    const attachments = await reviewStore.freezeRequestAttachments({
      store: review.store,
      requestId,
      references: [{ id: descriptor.id, alt: descriptor.alt }],
    });
    const attachmentDirectory = review.store.requestAttachmentsDirectory;
    const displacedDirectory = `${attachmentDirectory}.displaced`;
    const outsideDirectory = join(directory, "outside-attachments");
    await rename(attachmentDirectory, displacedDirectory);
    await mkdir(join(outsideDirectory, requestId), { recursive: true });
    await writeFile(
      join(outsideDirectory, requestId, basename(attachments[0].path)),
      bytes,
    );
    await symlink(outsideDirectory, attachmentDirectory, "dir");
    const request = messageAgentRequest({
      kind: "chat",
      requestId,
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot: deriveSnapshotDigest(source),
      createdAt: "2026-08-12T12:00:00.000Z",
      body: "Please inspect the capture.",
      attachments,
    });
    await writeAgentRequest({ store: review.store, request });
    try {
      await expect(
        runAgentWorkLoopAction({
          kind: "next",
          planPath,
          executablePath,
          shouldWait: false,
        }),
      ).rejects.toThrow(/outside the request attachment directory/);
    } finally {
      await rm(attachmentDirectory, { force: true });
      await rename(displacedDirectory, attachmentDirectory);
      await rm(outsideDirectory, { recursive: true, force: true });
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should reverify attachments when claimed work is resumed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-resume-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n";
    const bytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
      0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3,
    ]);
    await writeFile(planPath, source);
    const review = await startReviewRuntime({ planPath });
    const descriptor = await reviewStore.publishReviewImage({
      store: review.store,
      bytes,
      alt: "Capture",
    });
    const requestId = "cccccccccccccccc";
    const attachments = await reviewStore.freezeRequestAttachments({
      store: review.store,
      requestId,
      references: [{ id: descriptor.id, alt: descriptor.alt }],
    });
    const request = messageAgentRequest({
      kind: "chat",
      requestId,
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot: deriveSnapshotDigest(source),
      createdAt: "2026-08-12T12:00:00.000Z",
      body: "Please inspect the capture.",
      attachments,
    });
    await writeAgentRequest({ store: review.store, request });
    try {
      const canonicalAttachmentPath = await realpath(attachments[0].path);
      const pickup = await runAgentWorkLoopAction({
        kind: "next",
        planPath,
        executablePath,
        shouldWait: false,
      });
      await expect(Promise.resolve(pickup)).resolves.toMatchObject({
        pending: true,
        work: {
          requestId,
          attachments: [{ path: canonicalAttachmentPath }],
          attachmentManifest: [{ path: canonicalAttachmentPath }],
        },
      });
      if (typeof pickup.agent_token !== "string") {
        throw new Error("The pending request did not provide an agent token");
      }
      await rm(attachments[0].path);
      await expect(
        runAgentWorkLoopAction({
          kind: "next",
          planPath,
          executablePath,
          shouldWait: false,
          agentToken: pickup.agent_token,
        }),
      ).rejects.toThrow(/could not be opened during agent pickup/);
    } finally {
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should leave a message revisable when its baseline cannot be stored", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-baseline-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n";
    await writeFile(planPath, source);
    const review = await startReviewRuntime({ planPath });
    const request = messageAgentRequest({
      kind: "chat",
      requestId: "cccccccccccccccc",
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot: deriveSnapshotDigest(source),
      createdAt: "2026-08-12T12:00:00.000Z",
      body: "Answer once the baseline is storable.",
    });
    await writeAgentRequest({ store: review.store, request });
    // Pickup snapshots the plan as it reads it, so a later edit gives the
    // baseline a digest nothing has stored yet.
    const editedSource = "# Plan\n\nEdited after the runtime started.\n";
    await writeFile(planPath, editedSource);
    // A directory where the snapshot file belongs makes persistence fail.
    await mkdir(
      join(
        review.store.snapshotDirectory,
        `${deriveSnapshotDigest(editedSource)}.mdx`,
      ),
      { recursive: true },
    );
    try {
      await expect(
        runAgentWorkLoopAction({
          kind: "next",
          planPath,
          executablePath,
          shouldWait: false,
        }),
      ).rejects.toThrow();
      // The claim never happened, so the reviewer still owns the message.
      await expect(
        deleteQueuedRequest({
          store: review.store,
          requestId: request.requestId,
        }),
      ).resolves.toEqual({ attachmentCleanup: "complete" });
    } finally {
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should refuse pickup before writing through a symlinked snapshot store", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-snapshot-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n";
    await writeFile(planPath, source);
    const review = await startReviewRuntime({ planPath });
    const request = messageAgentRequest({
      kind: "chat",
      requestId: "cccccccccccccccc",
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot: deriveSnapshotDigest(source),
      createdAt: "2026-08-12T12:00:00.000Z",
      body: "Keep the pickup snapshot inside the review store.",
    });
    await writeAgentRequest({ store: review.store, request });
    const displacedDirectory = `${review.store.snapshotDirectory}.displaced`;
    const outsideDirectory = join(directory, "outside-snapshots");
    const sentinelPath = join(outsideDirectory, "sentinel.txt");
    await rename(review.store.snapshotDirectory, displacedDirectory);
    await mkdir(outsideDirectory);
    await writeFile(sentinelPath, "untouched\n");
    await symlink(outsideDirectory, review.store.snapshotDirectory);

    try {
      await expect(
        runAgentWorkLoopAction({
          kind: "next",
          planPath,
          executablePath,
          shouldWait: false,
        }),
      ).rejects.toThrow(/anchored directory/);
      await expect(readdir(outsideDirectory)).resolves.toEqual([
        "sentinel.txt",
      ]);
      await expect(
        deleteQueuedRequest({
          store: review.store,
          requestId: request.requestId,
        }),
      ).resolves.toEqual({ attachmentCleanup: "complete" });
    } finally {
      await rm(review.store.snapshotDirectory, { force: true });
      await rename(displacedDirectory, review.store.snapshotDirectory);
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should select the next request when deletion wins before claim", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-delete-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n";
    await writeFile(planPath, source);
    const review = await startReviewRuntime({ planPath });
    const descriptor = await reviewStore.publishReviewImage({
      store: review.store,
      bytes: Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
        0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3,
      ]),
      alt: "Capture",
    });
    const firstId = "cccccccccccccccc";
    const attachments = await reviewStore.freezeRequestAttachments({
      store: review.store,
      requestId: firstId,
      references: [{ id: descriptor.id, alt: descriptor.alt }],
    });
    const first = messageAgentRequest({
      kind: "chat",
      requestId: firstId,
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot: deriveSnapshotDigest(source),
      createdAt: "2026-08-12T12:00:00.000Z",
      body: "Please inspect the capture.",
      attachments,
    });
    const second = messageAgentRequest({
      kind: "chat",
      requestId: "dddddddddddddddd",
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot: deriveSnapshotDigest(source),
      createdAt: "2026-08-12T12:00:01.000Z",
      body: "What should happen next?",
    });
    await writeAgentRequest({ store: review.store, request: first });
    await writeAgentRequest({ store: review.store, request: second });

    const selectedValues = await reviewStore.readAgentRequestValues(
      review.store,
    );
    const readRequests = vi
      .spyOn(reviewStore, "readAgentRequestValues")
      .mockImplementationOnce(async () => {
        await deleteQueuedRequest({
          store: review.store,
          requestId: first.requestId,
        });
        return selectedValues;
      });
    try {
      await expect(
        runAgentWorkLoopAction({
          kind: "next",
          planPath,
          executablePath,
          shouldWait: false,
        }),
      ).resolves.toMatchObject({
        pending: true,
        work: { requestId: second.requestId },
      });
    } finally {
      readRequests.mockRestore();
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should select the next request when cancellation wins before claim", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-cancel-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n";
    await writeFile(planPath, source);
    const review = await startReviewRuntime({ planPath });
    const first = messageAgentRequest({
      kind: "chat",
      requestId: "cccccccccccccccc",
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot: deriveSnapshotDigest(source),
      createdAt: "2026-08-12T12:00:00.000Z",
      body: "Cancel before pickup.",
    });
    const second = messageAgentRequest({
      kind: "chat",
      requestId: "dddddddddddddddd",
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot: deriveSnapshotDigest(source),
      createdAt: "2026-08-12T12:00:01.000Z",
      body: "What should happen next?",
    });
    await writeAgentRequest({ store: review.store, request: first });
    await writeAgentRequest({ store: review.store, request: second });

    const selectedValues = await reviewStore.readAgentRequestValues(
      review.store,
    );
    const readRequests = vi
      .spyOn(reviewStore, "readAgentRequestValues")
      .mockImplementationOnce(async () => {
        await cancelAgentRequest({
          store: review.store,
          requestId: first.requestId,
          now: "2026-08-12T12:00:02.000Z",
        });
        return selectedValues;
      });
    try {
      await expect(
        runAgentWorkLoopAction({
          kind: "next",
          planPath,
          executablePath,
          shouldWait: false,
        }),
      ).resolves.toMatchObject({
        pending: true,
        work: { requestId: second.requestId },
      });
    } finally {
      readRequests.mockRestore();
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should select the next request when an answer wins before claim", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-answer-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n";
    const snapshot = deriveSnapshotDigest(source);
    await writeFile(planPath, source);
    const review = await startReviewRuntime({ planPath });
    const first = messageAgentRequest({
      kind: "chat",
      requestId: "cccccccccccccccc",
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot: snapshot,
      createdAt: "2026-08-12T12:00:00.000Z",
      body: "Answer before pickup resumes.",
    });
    const second = messageAgentRequest({
      kind: "chat",
      requestId: "dddddddddddddddd",
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot: snapshot,
      createdAt: "2026-08-12T12:00:01.000Z",
      body: "What should happen next?",
    });
    await writeAgentRequest({ store: review.store, request: first });
    await writeAgentRequest({ store: review.store, request: second });
    const claimed = await claimAgentRequest({
      store: review.store,
      requestId: first.requestId,
      claimedBy: review.sessionId,
      baselineSnapshot: snapshot,
      now: "2026-08-12T12:00:02.000Z",
    });
    const response = validateAgentResponseDraft({
      value: { requestId: first.requestId, message: "Answered elsewhere." },
      request: claimed,
      commentsById: new Map(),
      changedBlocks: new Set(),
      currentSnapshot: snapshot,
      now: "2026-08-12T12:00:03.000Z",
    });
    const selectedValues = await reviewStore.readAgentRequestValues(
      review.store,
    );
    const readRequests = vi
      .spyOn(reviewStore, "readAgentRequestValues")
      .mockImplementationOnce(async () => {
        await commitRequestTerminal({
          store: review.store,
          response,
          claimedBy: review.sessionId,
          now: "2026-08-12T12:00:03.000Z",
        });
        return selectedValues;
      });
    try {
      await expect(
        runAgentWorkLoopAction({
          kind: "next",
          planPath,
          executablePath,
          shouldWait: false,
        }),
      ).resolves.toMatchObject({
        pending: true,
        work: { requestId: second.requestId },
      });
    } finally {
      readRequests.mockRestore();
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should move concurrent waiting pickups to distinct requests", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-race-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n\nTwo agents can work in parallel.\n";
    await writeFile(planPath, source);
    const review = await startReviewRuntime({ planPath });
    const premiseSnapshot = deriveSnapshotDigest(source);
    const firstRequest = messageAgentRequest({
      kind: "chat",
      requestId: "abababababababab",
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot,
      createdAt: "2026-08-12T12:00:00.000Z",
      body: "Answer this request first.",
    });
    const secondRequest = messageAgentRequest({
      kind: "chat",
      requestId: "cdcdcdcdcdcdcdcd",
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot,
      createdAt: "2026-08-12T12:00:01.000Z",
      body: "Answer this request in parallel.",
    });
    await writeAgentRequest({ store: review.store, request: firstRequest });
    await writeAgentRequest({ store: review.store, request: secondRequest });

    let releaseLock: (() => Promise<void>) | undefined;
    try {
      releaseLock = await holdAgentRequestLock({
        store: review.store,
        requestId: firstRequest.requestId,
      });
      const firstPickup = runAgentWorkLoopAction({
        kind: "next",
        planPath,
        shouldWait: true,
        executablePath,
        modelName: "Race agent one",
      });
      await vi.waitFor(
        async () => {
          expect(
            await reviewStore.readAgentPresence({
              store: review.store,
              sessionId: review.sessionId,
            }),
          ).toMatchObject({
            state: "working",
            requestId: firstRequest.requestId,
            model: { name: "Race agent one" },
          });
        },
        { timeout: 5_000 },
      );
      const secondPickup = runAgentWorkLoopAction({
        kind: "next",
        planPath,
        shouldWait: true,
        executablePath,
        modelName: "Race agent two",
      });
      await vi.waitFor(
        async () => {
          expect(
            await reviewStore.readAgentPresence({
              store: review.store,
              sessionId: review.sessionId,
            }),
          ).toMatchObject({
            state: "working",
            requestId: firstRequest.requestId,
            model: { name: "Race agent two" },
          });
        },
        { timeout: 5_000 },
      );
      // The persisted heartbeat barrier proves both public pickups selected the
      // same unclaimed request. With retry handling removed, one pickup rejects
      // here instead of moving to request two; that counterfactual was verified.
      await releaseLock();
      releaseLock = undefined;
      const pickups = await Promise.all([firstPickup, secondPickup]);
      expect(pickups).toEqual([
        expect.objectContaining({ pending: true }),
        expect.objectContaining({ pending: true }),
      ]);
      expect(
        new Set(
          pickups.map((pickup) =>
            typeof pickup.work === "object" &&
            pickup.work !== null &&
            "requestId" in pickup.work
              ? pickup.work.requestId
              : undefined,
          ),
        ),
      ).toEqual(new Set([firstRequest.requestId, secondRequest.requestId]));
    } finally {
      await releaseLock?.();
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(["answered", "canceled"] as const)(
    "should move past a request %s during pickup preparation",
    async (terminalState) => {
      const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-stale-"));
      const planPath = join(directory, "plan.mdx");
      const source =
        "# Plan\n\nConcurrent terminal transitions are expected.\n";
      await writeFile(planPath, source);
      const review = await startReviewRuntime({ planPath });
      const premiseSnapshot = deriveSnapshotDigest(source);
      const staleRequest = messageAgentRequest({
        kind: "chat",
        requestId: "abababababababab",
        sessionId: review.sessionId,
        planId: review.planId,
        premiseSnapshot,
        createdAt: "2026-08-12T12:00:00.000Z",
        body: "This request becomes terminal during preparation.",
      });
      const nextRequest = messageAgentRequest({
        kind: "chat",
        requestId: "cdcdcdcdcdcdcdcd",
        sessionId: review.sessionId,
        planId: review.planId,
        premiseSnapshot,
        createdAt: "2026-08-12T12:00:01.000Z",
        body: "Continue with this request.",
      });
      await writeAgentRequest({ store: review.store, request: staleRequest });
      await writeAgentRequest({ store: review.store, request: nextRequest });
      let releaseLock: (() => Promise<void>) | undefined;
      try {
        releaseLock = await holdAgentRequestLock({
          store: review.store,
          requestId: staleRequest.requestId,
        });
        const pickup = runAgentWorkLoopAction({
          kind: "next",
          planPath,
          shouldWait: true,
          executablePath,
          modelName: "Stale selection agent",
        });
        await vi.waitFor(
          async () => {
            expect(
              await reviewStore.readAgentPresence({
                store: review.store,
                sessionId: review.sessionId,
              }),
            ).toMatchObject({
              state: "working",
              requestId: staleRequest.requestId,
              model: { name: "Stale selection agent" },
            });
          },
          { timeout: 5_000 },
        );
        const now = new Date().toISOString();
        await writeAgentRequest({
          store: review.store,
          request:
            terminalState === "canceled"
              ? { ...staleRequest, canceledAt: now }
              : {
                  ...staleRequest,
                  baselineSnapshot: premiseSnapshot,
                  claimedAt: now,
                  claimedBy: "eeeeeeeeeeeeeeee",
                  claimExpiresAtMs: Date.now() + AGENT_CLAIM_LEASE_MS,
                  answeredAt: now,
                },
        });
        await releaseLock();
        releaseLock = undefined;
        await expect(pickup).resolves.toMatchObject({
          pending: true,
          work: { requestId: nextRequest.requestId },
        });
      } finally {
        await releaseLock?.();
        await review.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("should mint a new token when an old pickup is already terminal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-resume-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n\nAnswer two questions in order.\n";
    await writeFile(planPath, source);
    const review = await startReviewRuntime({ planPath });
    const premiseSnapshot = deriveSnapshotDigest(source);
    const firstRequest = messageAgentRequest({
      kind: "chat",
      requestId: "dddddddddddddddd",
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot,
      createdAt: "2026-08-12T12:00:00.000Z",
      body: "Answer this first.",
    });
    const secondRequest = messageAgentRequest({
      kind: "chat",
      requestId: "eeeeeeeeeeeeeeee",
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot,
      createdAt: "2026-08-12T12:00:01.000Z",
      body: "Answer this second.",
    });
    await writeAgentRequest({ store: review.store, request: firstRequest });
    await writeAgentRequest({ store: review.store, request: secondRequest });

    try {
      const firstPickup = await runAgentWorkLoopAction({
        kind: "next",
        planPath,
        shouldWait: false,
        executablePath,
      });
      if (
        typeof firstPickup.agent_token !== "string" ||
        typeof firstPickup.response_file !== "string"
      ) {
        throw new Error(
          "The first pickup did not provide its response contract",
        );
      }
      await writeFile(
        firstPickup.response_file,
        JSON.stringify({
          requestId: firstRequest.requestId,
          message: "The first answer is complete.",
        }),
      );
      await runAgentWorkLoopAction({
        kind: "respond",
        planPath,
        responsePath: firstPickup.response_file,
        executablePath,
        agentToken: firstPickup.agent_token,
      });

      const secondPickup = await runAgentWorkLoopAction({
        kind: "next",
        planPath,
        shouldWait: false,
        executablePath,
        agentToken: firstPickup.agent_token,
      });
      expect(secondPickup).toMatchObject({
        pending: true,
        work: { requestId: secondRequest.requestId },
      });
      expect(secondPickup.agent_token).toEqual(expect.any(String));
      expect(secondPickup.agent_token).not.toBe(firstPickup.agent_token);
    } finally {
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should reject a progress note from a token without a claim", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-note-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n\nWait for a real pickup.\n";
    await writeFile(planPath, source);
    const review = await startReviewRuntime({ planPath });
    const request = messageAgentRequest({
      kind: "chat",
      requestId: "dddddddddddddddd",
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot: deriveSnapshotDigest(source),
      createdAt: "2026-08-12T12:00:00.000Z",
      body: "Do not narrate this before pickup.",
    });
    await writeAgentRequest({ store: review.store, request });

    try {
      await expect(
        runAgentWorkLoopAction({
          kind: "note",
          planPath,
          detail: "Reading the plan",
          agentToken: "ffff2222ffff2222",
        }),
      ).rejects.toThrow(/no pending request to update/i);
      await expect(
        readProgress({
          store: review.store,
          sessionId: review.sessionId,
        }),
      ).resolves.not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            requestId: request.requestId,
            stepCode: "agent-note",
          }),
        ]),
      );
    } finally {
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should keep claims usable when progress cannot be stored", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-pickup-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n\nDo not strand this pickup.\n";
    await writeFile(planPath, source);
    const review = await startReviewRuntime({ planPath });
    const request = messageAgentRequest({
      kind: "chat",
      requestId: "dddddddddddddddd",
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot: deriveSnapshotDigest(source),
      createdAt: "2026-08-12T12:00:00.000Z",
      body: "Return the committed claim token.",
    });
    await writeAgentRequest({ store: review.store, request });
    await claimAgentRequest({
      store: review.store,
      activeSessionId: review.sessionId,
      requestId: request.requestId,
      claimedBy: "eeeeeeeeeeeeeeee",
      baselineSnapshot: request.premiseSnapshot,
      now: new Date(Date.now() - AGENT_CLAIM_LEASE_MS - 1).toISOString(),
    });
    await mkdir(review.store.progressPath);

    try {
      const pickup = await runAgentWorkLoopAction({
        kind: "next",
        planPath,
        shouldWait: false,
        executablePath,
      });
      if (typeof pickup.agent_token !== "string") {
        throw new Error("Pickup did not return its committed token");
      }
      const exchange = await readAgentExchange({
        store: review.store,
        sessionId: review.sessionId,
        planId: review.planId,
      });
      expect(exchange.requests[0]).toMatchObject({
        requestId: request.requestId,
        claimedBy: pickup.agent_token,
      });

      await expect(
        runAgentWorkLoopAction({
          kind: "note",
          planPath,
          detail: "Continuing with the returned token",
          agentToken: pickup.agent_token,
        }),
      ).resolves.toMatchObject({ requestId: request.requestId });
      await expect(
        readAgentExchange({
          store: review.store,
          sessionId: review.sessionId,
          planId: review.planId,
        }),
      ).resolves.toMatchObject({
        requests: [
          expect.objectContaining({
            requestId: request.requestId,
            claimedBy: pickup.agent_token,
          }),
        ],
      });
    } finally {
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should expose a takeover after the review runtime restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-restart-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n\nContinue this review after a restart.\n";
    await writeFile(planPath, source);
    const firstReview = await startReviewRuntime({ planPath });
    let currentReview: ReviewRuntime | undefined;
    try {
      const request = messageAgentRequest({
        kind: "chat",
        requestId: "abababababababab",
        sessionId: firstReview.sessionId,
        planId: firstReview.planId,
        premiseSnapshot: deriveSnapshotDigest(source),
        createdAt: "2026-08-12T12:00:00.000Z",
        body: "Please continue with a new agent session.",
      });
      await writeAgentRequest({ store: firstReview.store, request });
      await claimAgentRequest({
        store: firstReview.store,
        activeSessionId: firstReview.sessionId,
        requestId: request.requestId,
        claimedBy: "cdcdcdcdcdcdcdcd",
        baselineSnapshot: request.premiseSnapshot,
        now: new Date(Date.now() - AGENT_CLAIM_LEASE_MS - 1).toISOString(),
      });
      await firstReview.close();

      currentReview = await startReviewRuntime({ planPath });
      expect(currentReview.sessionId).not.toBe(firstReview.sessionId);
      await expect(
        runAgentWorkLoopAction({
          kind: "next",
          planPath,
          shouldWait: false,
          executablePath,
        }),
      ).resolves.toMatchObject({
        pending: true,
        work: { requestId: request.requestId },
      });
      await expect(
        readProgress({
          store: currentReview.store,
          sessionId: currentReview.sessionId,
        }),
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            requestId: request.requestId,
            stepCode: "request-reclaimed",
            detail: "The previous agent session stopped responding",
          }),
        ]),
      );
    } finally {
      await currentReview?.close();
      await firstReview.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should materialize reviewer images before publishing a changed plan", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-assets-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n\nThe reviewer supplied a capture.\n";
    await writeFile(planPath, source);
    const review = await startReviewRuntime({ planPath });
    const descriptor = await reviewStore.publishReviewImage({
      store: review.store,
      bytes: Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
        0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3,
      ]),
      alt: "Capture",
    });
    const request = messageAgentRequest({
      kind: "chat",
      requestId: "cccccccccccccccc",
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot: deriveSnapshotDigest(source),
      createdAt: "2026-08-12T12:00:00.000Z",
      body: "Please include the capture in the plan.",
    });
    await writeAgentRequest({ store: review.store, request });
    await claimAgentRequest({
      store: review.store,
      activeSessionId: review.sessionId,
      requestId: request.requestId,
      claimedBy: review.sessionId,
      baselineSnapshot: deriveSnapshotDigest(source),
      now: new Date().toISOString(),
    });
    await writeFile(
      planPath,
      `${source}\n![Capture](review-image:${descriptor.id})\n`,
    );
    const responsePath = join(directory, "response.json");
    await writeFile(
      responsePath,
      JSON.stringify({
        requestId: request.requestId,
        message: "The capture is now part of the plan.",
      }),
    );
    try {
      await expect(
        runAgentWorkLoopAction({
          kind: "respond",
          planPath,
          responsePath,
          executablePath,
          agentToken: review.sessionId,
        }),
      ).resolves.toMatchObject({ responded: request.requestId });
      await expect(readFile(planPath, "utf8")).resolves.toContain(
        `![Capture](./assets/review-image-${descriptor.id}.png)`,
      );
      await expect(
        readFile(
          join(directory, "assets", `review-image-${descriptor.id}.png`),
        ),
      ).resolves.toEqual(expect.any(Buffer));
    } finally {
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should recover from a transient heartbeat failure while waiting", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "big-plan-agent-heartbeat-"),
    );
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, "# Plan\n");
    const review = await startReviewRuntime({ planPath });
    const heartbeat = vi
      .spyOn(reviewStore, "readSessionHeartbeatValue")
      .mockResolvedValueOnce({
        sessionId: review.sessionId,
        running: true,
        updatedAtMs: Date.now(),
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        sessionId: review.sessionId,
        running: true,
        updatedAtMs: Date.now(),
      });
    const request = messageAgentRequest({
      kind: "chat",
      requestId: "cccccccccccccccc",
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot: deriveSnapshotDigest("# Plan\n"),
      createdAt: "2026-08-12T12:00:00.000Z",
      body: "Is the plan ready?",
    });
    setTimeout(() => {
      void writeAgentRequest({ store: review.store, request });
    }, 50);
    const recoveryLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await expect(
        runAgentWorkLoopAction({
          kind: "next",
          planPath,
          executablePath,
          shouldWait: true,
        }),
      ).resolves.toMatchObject({
        pending: true,
      });
      expect(recoveryLog).toHaveBeenCalledWith(
        expect.stringContaining("Review session heartbeat recovered"),
      );
    } finally {
      heartbeat.mockRestore();
      recoveryLog.mockRestore();
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should end waiting after sustained heartbeat failures", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-timeout-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, "# Plan\n");
    const review = await startReviewRuntime({ planPath });
    const heartbeat = vi
      .spyOn(reviewStore, "readSessionHeartbeatValue")
      .mockResolvedValueOnce({
        sessionId: review.sessionId,
        running: true,
        updatedAtMs: Date.now(),
      })
      .mockResolvedValue(undefined);
    try {
      await expect(
        runAgentWorkLoopAction({
          kind: "next",
          planPath,
          executablePath,
          shouldWait: true,
        }),
      ).resolves.toMatchObject({
        pending: false,
        ended: true,
        reason: "The review server stopped while the agent was waiting.",
      });
      expect(heartbeat.mock.calls.length).toBeGreaterThan(6);
    } finally {
      heartbeat.mockRestore();
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should return an explicit shutdown reason without rereading it", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "big-plan-agent-shutdown-reason-"),
    );
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, "# Plan\n");
    const review = await startReviewRuntime({ planPath });
    const heartbeat = vi
      .spyOn(reviewStore, "readSessionHeartbeatValue")
      .mockResolvedValueOnce({
        sessionId: review.sessionId,
        running: true,
        updatedAtMs: Date.now(),
      })
      .mockResolvedValueOnce({
        sessionId: review.sessionId,
        running: false,
        updatedAtMs: Date.now(),
        stopReason: "The review server was closed by the captain.",
      });
    try {
      await expect(
        runAgentWorkLoopAction({
          kind: "next",
          planPath,
          executablePath,
          shouldWait: true,
        }),
      ).resolves.toMatchObject({
        pending: false,
        ended: true,
        reason: "The review server was closed by the captain.",
      });
      expect(heartbeat).toHaveBeenCalledTimes(2);
    } finally {
      heartbeat.mockRestore();
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should explain a normal idle timeout to a waiting agent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-idle-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, "# Plan\n");
    const review = await startReviewRuntime({
      planPath,
      idleTimeoutMs: 1_000,
    });
    try {
      await expect(
        runAgentWorkLoopAction({
          kind: "next",
          planPath,
          executablePath,
          shouldWait: true,
        }),
      ).resolves.toMatchObject({
        pending: false,
        ended: true,
        reason:
          "The review session ended normally after 1 second of inactivity.",
      });
    } finally {
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should include complete original context when picking up an old reply", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-history-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n\n## Scope\n\nKeep this focused.\n";
    await writeFile(planPath, source);
    const review = await startReviewRuntime({ planPath });
    try {
      const revision = deriveSnapshotDigest(source);
      const comment = {
        id: "2222222222222222",
        body: "Explain the original decision.",
        createdAt: "2026-08-10T12:00:00.000Z",
        premiseSnapshot: revision,
        target: { type: "document" as const },
      };
      const feedback = buildFeedbackPackage({
        sessionId: review.sessionId,
        packageId: "1111111111111111",
        planId: review.planId,
        planPath,
        createdAt: comment.createdAt,
        comments: [comment],
      });
      const originalRequest = feedbackAgentRequest({
        feedback,
        premiseSnapshot: revision,
      });
      await writeAgentRequest({
        store: review.store,
        request: originalRequest,
      });
      const originalClaim = await claimAgentRequest({
        store: review.store,
        activeSessionId: review.sessionId,
        requestId: originalRequest.requestId,
        claimedBy: review.sessionId,
        baselineSnapshot: revision,
        now: "2026-08-10T12:00:00.500Z",
      });
      await commitRequestTerminal({
        claimedBy: review.sessionId,
        store: review.store,
        response: validateAgentResponseDraft({
          value: {
            requestId: originalRequest.requestId,
            outcomes: [
              {
                commentId: comment.id,
                state: "declined",
                message: "The original plan already explains it.",
              },
            ],
          },
          request: originalClaim,
          commentsById: new Map([[comment.id, comment]]),
          changedBlocks: new Set(),
          currentSnapshot: revision,
          now: "2026-08-10T12:00:01.000Z",
        }),
        now: "2026-08-10T12:00:01.000Z",
      });
      for (let index = 1; index < 400; index += 1) {
        const chat = messageAgentRequest({
          kind: "chat",
          requestId: `8${index.toString(16).padStart(15, "0")}`,
          sessionId: review.sessionId,
          planId: review.planId,
          premiseSnapshot: revision,
          createdAt: new Date(
            Date.parse(comment.createdAt) + index + 1,
          ).toISOString(),
          body: `Historical question ${index}`,
        });
        await writeAgentRequest({
          store: review.store,
          request: {
            ...chat,
            canceledAt: new Date(
              Date.parse(comment.createdAt) + index + 2,
            ).toISOString(),
          },
        });
      }
      const reply = messageAgentRequest({
        kind: "reply",
        requestId: "ffffffffffffffff",
        sessionId: review.sessionId,
        planId: review.planId,
        premiseSnapshot: revision,
        createdAt: "2026-08-10T12:00:01.000Z",
        body: "Please clarify that answer.",
        commentId: comment.id,
      });
      await writeAgentRequest({ store: review.store, request: reply });

      await expect(
        runAgentWorkLoopAction({
          kind: "next",
          planPath,
          executablePath,
          shouldWait: false,
        }),
      ).resolves.toMatchObject({
        work: { requestId: reply.requestId },
        history: [
          { role: "reviewer", body: comment.body },
          {
            role: "agent",
            body: "The original plan already explains it.",
          },
        ],
      });
    } finally {
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should carry the connector's reported model identity onto the working heartbeat", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-model-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n\nAnswer this question.\n";
    await writeFile(planPath, source);
    const review = await startReviewRuntime({ planPath });
    const request = messageAgentRequest({
      kind: "chat",
      requestId: "dddddddddddddddd",
      sessionId: review.sessionId,
      planId: review.planId,
      premiseSnapshot: deriveSnapshotDigest(source),
      createdAt: "2026-08-12T12:00:00.000Z",
      body: "What should we prioritize?",
    });
    await writeAgentRequest({ store: review.store, request });
    try {
      await runAgentWorkLoopAction({
        kind: "next",
        planPath,
        executablePath,
        shouldWait: false,
        modelName: "Grok 4.6",
      });
      await expect(
        reviewStore.readAgentPresence({
          store: review.store,
          sessionId: review.sessionId,
        }),
      ).resolves.toMatchObject({
        connected: true,
        model: { name: "Grok 4.6" },
      });
    } finally {
      await review.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should validate a progress note before reading session state", async () => {
    await expect(
      runAgentWorkLoopAction({
        kind: "note",
        planPath: "/tmp/no-review-session.mdx",
        detail: "   ",
        agentToken: "ffff2222ffff2222",
      }),
    ).rejects.toThrow(/Progress must be between 1 and 160 characters/);
  });

  it("should refuse a descriptor whose review server has stopped", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-stopped-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, "# Plan\n");
    const stopped = await startReviewRuntime({ planPath });
    await stopped.close();
    await expect(
      runAgentWorkLoopAction({
        kind: "prompt",
        planPath,
        executablePath,
      }),
    ).rejects.toThrow(/review session is not running/);
  });
});

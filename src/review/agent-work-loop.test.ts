// Covers the review-owned coding-agent loop through its one action interface.

import {
  mkdir,
  mkdtemp,
  readFile,
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
  publishAgentResponse,
  reviseQueuedRequest,
} from "./request-mailbox.js";
import { startReviewRuntime } from "./server.js";
import type { ReviewRuntime } from "./server.js";
import { reviewImageId } from "./shared/review-image.js";
import { readProgress } from "./store.js";
import * as reviewStore from "./store.js";
import { renderDocument } from "../render/render-document.js";

let runtime: ReviewRuntime;
const commentBody = "Which confidence level should this claim use?";
const executablePath = fileURLToPath(
  new URL("../../bin/big-plan.mjs", import.meta.url),
);

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
    const next = await runAgentWorkLoopAction({
      kind: "next",
      planPath: runtime.planPath,
      executablePath,
      shouldWait: false,
    });
    if (typeof next.response_file !== "string") {
      throw new Error("The pending request did not provide a response path");
    }
    const responseFile = next.response_file;
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
      await expect(
        runAgentWorkLoopAction({
          kind: "next",
          planPath,
          executablePath,
          shouldWait: false,
        }),
      ).resolves.toMatchObject({
        pending: true,
        work: { requestId },
      });
      await rm(attachments[0].path);
      await expect(
        runAgentWorkLoopAction({
          kind: "next",
          planPath,
          executablePath,
          shouldWait: false,
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
        await publishAgentResponse({ store: review.store, response });
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
      requestId: request.requestId,
      baselineSnapshot: deriveSnapshotDigest(source),
      now: "2026-08-12T12:00:01.000Z",
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
        requestId: originalRequest.requestId,
        baselineSnapshot: revision,
        now: "2026-08-10T12:00:00.500Z",
      });
      await publishAgentResponse({
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

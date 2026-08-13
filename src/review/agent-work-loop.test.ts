// Covers the review-owned coding-agent loop through its one action interface.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { claimAgentRequest, publishAgentResponse } from "./request-mailbox.js";
import { startReviewRuntime } from "./server.js";
import type { ReviewRuntime } from "./server.js";
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

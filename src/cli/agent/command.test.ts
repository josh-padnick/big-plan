// Covers the public coding-agent loop: a fresh session gets a pasteable prompt,
// receives one pending request, and publishes one validated response.

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFeedbackPackage } from "../../review/feedback-package.js";
import {
  deriveSourceRevision,
  feedbackAgentRequest,
  readAgentExchange,
  writeAgentRequest,
} from "../../review/agent-exchange.js";
import { startReviewRuntime } from "../../review/server.js";
import type { ReviewRuntime } from "../../review/server.js";
import { readProgress } from "../../review/store.js";
import { renderDocument } from "../../render/render-document.js";
import { agentCommand } from "./command.js";

let runtime: ReviewRuntime;
let responseFile = "";

beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-command-"));
  const sourcePath = fileURLToPath(
    new URL("../../../examples/sample.mdx", import.meta.url),
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
        body: "Which confidence level should this claim use?",
        createdAt: "2026-08-02T12:00:00.000Z",
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
      sourceRevision: deriveSourceRevision(source),
    }),
  });
});

afterAll(async () => {
  await runtime.close();
});

describe("agent command", () => {
  it("should print a ready-to-paste real-session prompt", async () => {
    const result = await agentCommand([runtime.planPath]);
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
    const result = await agentCommand(["next", runtime.planPath]);
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
    responseFile = result.response_file;
    await expect(
      readProgress({
        store: runtime.store,
        sessionId: runtime.sessionId,
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: "Picked up: 1 comment",
          state: "live",
          detail: "1 comment",
        }),
      ]),
    );
  });

  it("should publish a complete question outcome without editing the plan", async () => {
    await writeFile(
      responseFile,
      JSON.stringify({
        requestId: "aaaaaaaaaaaaaaaa",
        outcomes: [
          {
            commentId: "bbbbbbbbbbbbbbbb",
            state: "question",
            message: "Should the plan state 90% or 95% confidence?",
          },
        ],
      }),
    );
    expect(
      await agentCommand(["respond", runtime.planPath, responseFile]),
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
            state: "question",
            message: "Should the plan state 90% or 95% confidence?",
          },
        ],
      },
    ]);
  });
});

describe("agent command lifecycle", () => {
  it("should refuse a descriptor whose review server has stopped", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-stopped-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, "# Plan\n");
    const stopped = await startReviewRuntime({ planPath });
    await stopped.close();
    await expect(agentCommand([planPath])).rejects.toThrow(
      /review session is not running/,
    );
  });
});

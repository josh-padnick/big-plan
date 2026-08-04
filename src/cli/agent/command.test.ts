// Covers the public coding-agent loop: a fresh session gets a pasteable prompt,
// receives one pending request, and publishes one validated response.

import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFeedbackPackage } from "../../review/feedback-package.js";
import {
  deriveSourceRevision,
  feedbackAgentRequests,
  readAgentExchange,
  writeAgentRequest,
} from "../../review/agent-exchange.js";
import { startReviewRuntime } from "../../review/server.js";
import type { ReviewRuntime } from "../../review/server.js";
import { agentHeartbeatIsFresh, readProgress } from "../../review/store.js";
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
  const [request] = feedbackAgentRequests({
    feedback,
    sourceRevision: deriveSourceRevision(source),
    requestIds: [feedback.packageId],
  });
  if (request === undefined) {
    throw new Error("The fixture feedback request was not created");
  }
  await writeAgentRequest({ store: runtime.store, request });
});

afterAll(async () => {
  await runtime.close();
});

// The launcher output is plain text: extract one labeled line's value.
const launcherField = ({
  output,
  label,
}: {
  readonly output: string;
  readonly label: string;
}): string => {
  const line = output
    .split("\n")
    .find((candidate) => candidate.startsWith(`${label}: `));
  if (line === undefined) {
    throw new Error(`The launcher output has no ${label} line`);
  }
  return line.slice(label.length + 2);
};

describe("agent command", () => {
  it("should print a plain-text launcher whose commands carry no display escaping", async () => {
    const result = await agentCommand([runtime.planPath]);
    if (typeof result !== "string") {
      throw new Error("The launcher must print plain text, not a record");
    }
    // Display-escaped quotes are the round-7 paste bug: they word-split
    // when pasted, so the printed bytes must contain no backslashes at all.
    expect(result).not.toContain("\\");
    expect(result).toContain('codex "$(cat ');
    expect(result).toContain('claude "$(cat ');
    expect(result).toContain("SECOND terminal");
    expect(launcherField({ output: result, label: "plan" })).toBe(
      runtime.planPath,
    );
    const promptFile = launcherField({
      output: result,
      label: "prompt_file",
    });
    const prompt = await readFile(promptFile, "utf8");
    expect(prompt).toContain("You are the coding agent");
    expect(prompt).toContain("agent next");
    expect(prompt).toContain("agent note");
    expect(prompt).toContain("One line per step, present tense, no repeats");
    expect(prompt).toContain(
      "keep related sentences in one paragraph; never leave a blank line between every sentence",
    );
    expect(prompt).toContain(runtime.planPath);
  });

  it("should emit codex and claude commands that round-trip through a real shell when pasted byte-for-byte", async () => {
    const result = await agentCommand([runtime.planPath]);
    if (typeof result !== "string") {
      throw new Error("The launcher must print plain text, not a record");
    }
    const promptFile = launcherField({
      output: result,
      label: "prompt_file",
    });
    const prompt = await readFile(promptFile, "utf8");
    const stubDirectory = await mkdtemp(join(tmpdir(), "big-plan-agent-stub-"));
    // Each stub proves the pasted command reaches the agent binary with the
    // whole prompt as exactly one argument.
    for (const binary of ["codex", "claude"]) {
      await writeFile(
        join(stubDirectory, binary),
        "#!/bin/sh\nprintf 'argc=%s\\n' \"$#\"\nprintf '%s' \"$1\"\n",
        { mode: 0o755 },
      );
    }
    const shells = ["/bin/sh", "zsh", "bash"].filter(
      (shell) => spawnSync(shell, ["-c", "true"]).status === 0,
    );
    expect(shells).toContain("/bin/sh");
    const pastedLines = result
      .split("\n")
      .filter(
        (line) => line.startsWith("codex ") || line.startsWith("claude "),
      );
    expect(pastedLines).toHaveLength(2);
    for (const shell of shells) {
      for (const pasted of pastedLines) {
        const run = spawnSync(shell, ["-c", pasted], {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${stubDirectory}:${process.env.PATH ?? ""}`,
          },
        });
        expect(run.status).toBe(0);
        // Command substitution strips trailing newlines; the prompt body
        // itself must arrive untouched as one argument.
        expect(run.stdout).toBe(`argc=1\n${prompt.replace(/\n+$/u, "")}`);
      }
    }
  });

  it("should pick up the oldest request queued before the agent connected", async () => {
    const result = await agentCommand(["next", runtime.planPath]);
    if (typeof result === "string") {
      throw new Error("agent next must return a structured record");
    }
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
    // The publish command is also pasted; single-quote quoting keeps it free
    // of double quotes, so structured output prints it without escaping.
    expect(String(result.respond_command)).not.toContain('"');
    await expect(
      agentHeartbeatIsFresh({
        store: runtime.store,
        sessionId: runtime.sessionId,
      }),
    ).resolves.toBe(true);
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
          requestId: "aaaaaaaaaaaaaaaa",
          at: expect.any(String),
        }),
      ]),
    );
  });

  it("should relay a bounded narration line and renew the working heartbeat", async () => {
    await expect(
      agentCommand([
        "note",
        runtime.planPath,
        `Reading the reviewer request${" now".repeat(50)}`,
      ]),
    ).resolves.toMatchObject({
      noted: true,
      requestId: "aaaaaaaaaaaaaaaa",
    });
    await expect(
      readProgress({
        store: runtime.store,
        sessionId: runtime.sessionId,
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: expect.stringMatching(/^Reading the reviewer request/u),
          state: "live",
          requestId: "aaaaaaaaaaaaaaaa",
          at: expect.any(String),
        }),
      ]),
    );
    const progress = await readProgress({
      store: runtime.store,
      sessionId: runtime.sessionId,
    });
    expect(progress.at(-1)?.step).toHaveLength(120);
    await expect(
      agentHeartbeatIsFresh({
        store: runtime.store,
        sessionId: runtime.sessionId,
      }),
    ).resolves.toBe(true);
    await expect(
      agentCommand(["note", runtime.planPath, "   "]),
    ).rejects.toThrow(/must contain one short line/u);
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
    await expect(
      readProgress({
        store: runtime.store,
        sessionId: runtime.sessionId,
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: "Agent response ready",
          state: "done",
          requestId: "aaaaaaaaaaaaaaaa",
          at: expect.any(String),
        }),
      ]),
    );
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
      /review server for this plan is not running/,
    );
  });
});

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
  messageAgentRequest,
  readAgentExchange,
  writeAgentRequest,
} from "../../review/agent-exchange.js";
import { startReviewRuntime } from "../../review/server.js";
import type { ReviewRuntime } from "../../review/server.js";
import {
  agentHeartbeatIsFresh,
  appendAgentCancellation,
  readProgress,
} from "../../review/store.js";
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
  runtime = await startReviewRuntime({
    planPath,
    validatePlan: () => undefined,
  });
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
    const stopped = await startReviewRuntime({
      planPath,
      validatePlan: () => undefined,
    });
    await stopped.close();
    await expect(agentCommand([planPath])).rejects.toThrow(
      /review server for this plan is not running/,
    );
  });

  it("should answer R2 after an older R1 cancellation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-r1-r2-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n\nKeep later requests answerable.\n";
    await writeFile(planPath, source);
    const cancelledRuntime = await startReviewRuntime({
      planPath,
      validatePlan: () => undefined,
    });
    const sourceRevision = deriveSourceRevision(source);
    const request1 = messageAgentRequest({
      kind: "chat",
      requestId: "cccccccccccccccc",
      sessionId: cancelledRuntime.sessionId,
      planId: cancelledRuntime.planId,
      sourceRevision,
      createdAt: "2026-08-04T14:00:00.000Z",
      body: "Request one",
    });
    await writeAgentRequest({
      store: cancelledRuntime.store,
      request: request1,
    });
    await expect(
      agentCommand(["next", cancelledRuntime.planPath]),
    ).resolves.toMatchObject({
      pending: true,
      work: { requestId: request1.requestId },
    });
    await appendAgentCancellation({
      store: cancelledRuntime.store,
      cancellation: {
        requestId: request1.requestId,
        at: "2026-08-04T14:01:00.000Z",
      },
    });
    const request2 = messageAgentRequest({
      kind: "chat",
      requestId: "dddddddddddddddd",
      sessionId: cancelledRuntime.sessionId,
      planId: cancelledRuntime.planId,
      sourceRevision,
      createdAt: "2026-08-04T14:02:00.000Z",
      body: "Request two",
    });
    await writeAgentRequest({
      store: cancelledRuntime.store,
      request: request2,
    });
    const pickup2 = await agentCommand(["next", cancelledRuntime.planPath]);
    if (
      typeof pickup2 === "string" ||
      typeof pickup2.response_file !== "string"
    ) {
      throw new Error("R2 pickup did not provide a response file");
    }
    expect(pickup2).toMatchObject({
      pending: true,
      work: { requestId: request2.requestId },
    });
    await writeFile(
      pickup2.response_file,
      JSON.stringify({
        requestId: request2.requestId,
        message: "R2 completed.",
      }),
    );
    await expect(
      agentCommand([
        "respond",
        cancelledRuntime.planPath,
        pickup2.response_file,
      ]),
    ).resolves.toMatchObject({ responded: request2.requestId });
    await expect(
      agentCommand(["next", cancelledRuntime.planPath]),
    ).resolves.toMatchObject({ pending: false });
    await cancelledRuntime.close();
  });

  it("should reject a late cancelled R1 response without poisoning R2", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-late-r1-"));
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n\nReject only the cancelled response identity.\n";
    await writeFile(planPath, source);
    const cancelledRuntime = await startReviewRuntime({
      planPath,
      validatePlan: () => undefined,
    });
    const sourceRevision = deriveSourceRevision(source);
    const request1 = messageAgentRequest({
      kind: "chat",
      requestId: "eeeeeeeeeeeeeeee",
      sessionId: cancelledRuntime.sessionId,
      planId: cancelledRuntime.planId,
      sourceRevision,
      createdAt: "2026-08-04T15:00:00.000Z",
      body: "Request one",
    });
    const request2 = messageAgentRequest({
      kind: "chat",
      requestId: "ffffffffffffffff",
      sessionId: cancelledRuntime.sessionId,
      planId: cancelledRuntime.planId,
      sourceRevision,
      createdAt: "2026-08-04T15:01:00.000Z",
      body: "Request two",
    });
    await writeAgentRequest({
      store: cancelledRuntime.store,
      request: request1,
    });
    await writeAgentRequest({
      store: cancelledRuntime.store,
      request: request2,
    });
    const pickup1 = await agentCommand(["next", cancelledRuntime.planPath]);
    if (
      typeof pickup1 === "string" ||
      typeof pickup1.response_file !== "string"
    ) {
      throw new Error("R1 pickup did not provide a response file");
    }
    expect(pickup1).toMatchObject({
      pending: true,
      work: { requestId: request1.requestId },
    });
    await appendAgentCancellation({
      store: cancelledRuntime.store,
      cancellation: {
        requestId: request1.requestId,
        at: "2026-08-04T15:02:00.000Z",
      },
    });
    await writeFile(
      pickup1.response_file,
      JSON.stringify({
        requestId: request1.requestId,
        message: "This response arrived too late.",
      }),
    );
    await expect(
      agentCommand([
        "respond",
        cancelledRuntime.planPath,
        pickup1.response_file,
      ]),
    ).rejects.toThrow(/reviewer cancelled this request/u);
    const pickup2 = await agentCommand(["next", cancelledRuntime.planPath]);
    if (
      typeof pickup2 === "string" ||
      typeof pickup2.response_file !== "string"
    ) {
      throw new Error("R2 pickup did not provide a response file");
    }
    expect(pickup2).toMatchObject({
      pending: true,
      work: { requestId: request2.requestId },
    });
    await writeFile(
      pickup2.response_file,
      JSON.stringify({
        requestId: request2.requestId,
        message: "R2 completed after R1 was cancelled.",
      }),
    );
    await expect(
      agentCommand([
        "respond",
        cancelledRuntime.planPath,
        pickup2.response_file,
      ]),
    ).resolves.toMatchObject({ responded: request2.requestId });
    await expect(
      agentCommand(["next", cancelledRuntime.planPath]),
    ).resolves.toMatchObject({ pending: false });
    await cancelledRuntime.close();
  });

  it("should pick up the next request promptly when a queued request is cancelled", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "big-plan-agent-cancel-wait-"),
    );
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n\nContinue promptly after cancellation.\n";
    await writeFile(planPath, source);
    const cancelledRuntime = await startReviewRuntime({
      planPath,
      validatePlan: () => undefined,
    });
    const sourceRevision = deriveSourceRevision(source);
    const pickupStartedAt = Date.now();
    const pickupPromise = agentCommand([
      "next",
      cancelledRuntime.planPath,
      "--wait",
    ]);

    await new Promise((settle) => {
      setTimeout(settle, 20);
    });
    const request1 = messageAgentRequest({
      kind: "chat",
      requestId: "1111111111111111",
      sessionId: cancelledRuntime.sessionId,
      planId: cancelledRuntime.planId,
      sourceRevision,
      createdAt: "2026-08-04T16:00:00.000Z",
      body: "Cancelled before pickup",
    });
    await writeAgentRequest({
      store: cancelledRuntime.store,
      request: request1,
    });
    await appendAgentCancellation({
      store: cancelledRuntime.store,
      cancellation: {
        requestId: request1.requestId,
        at: "2026-08-04T16:00:00.010Z",
      },
    });
    const request2 = messageAgentRequest({
      kind: "chat",
      requestId: "2222222222222222",
      sessionId: cancelledRuntime.sessionId,
      planId: cancelledRuntime.planId,
      sourceRevision,
      createdAt: "2026-08-04T16:00:00.020Z",
      body: "Pick this up next",
    });
    await writeAgentRequest({
      store: cancelledRuntime.store,
      request: request2,
    });

    await expect(pickupPromise).resolves.toMatchObject({
      pending: true,
      work: { requestId: request2.requestId },
    });
    expect(Date.now() - pickupStartedAt).toBeLessThan(750);
    await cancelledRuntime.close();
  });
});

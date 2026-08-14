// Keeps the public CLI adapter responsible for rejecting malformed argument
// shapes before they reach the review-owned work loop.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deriveSnapshotDigest,
  messageAgentRequest,
  writeAgentRequest,
} from "../../review/agent-exchange.js";
import { startReviewRuntime } from "../../review/server.js";
import { readAgentPresence } from "../../review/store.js";
import { agentCommand } from "./command.js";

describe("agent command adapter", () => {
  it("should reject an unsupported argument shape with command usage", async () => {
    await expect(agentCommand(["unknown", "plan.mdx"])).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringContaining("big-plan agent"),
    });
  });

  it.each(["next", "note", "respond"])(
    "should reject the bare reserved %s action",
    async (action) => {
      await expect(agentCommand([action])).rejects.toMatchObject({
        code: "INVALID_INPUT",
        message: expect.stringContaining("big-plan agent"),
      });
    },
  );
});

describe("agent command connector model identity", () => {
  const originalModelEnv = process.env["BIG_PLAN_AGENT_MODEL"];

  afterEach(() => {
    if (originalModelEnv === undefined) {
      delete process.env["BIG_PLAN_AGENT_MODEL"];
    } else {
      process.env["BIG_PLAN_AGENT_MODEL"] = originalModelEnv;
    }
  });

  it.each([
    {
      label: "the trimmed connector-reported model",
      environmentValue: "  Grok 4.6  ",
      expectedModel: { name: "Grok 4.6" },
    },
    {
      label: "no model when the connector does not report one",
      environmentValue: undefined,
      expectedModel: undefined,
    },
  ])("should persist $label", async ({ environmentValue, expectedModel }) => {
    if (environmentValue === undefined) {
      delete process.env["BIG_PLAN_AGENT_MODEL"];
    } else {
      process.env["BIG_PLAN_AGENT_MODEL"] = environmentValue;
    }
    const directory = await mkdtemp(
      join(tmpdir(), "big-plan-cli-agent-model-"),
    );
    const planPath = join(directory, "plan.mdx");
    const source = "# Plan\n\nAnswer this question.\n";
    try {
      await writeFile(planPath, source);
      const review = await startReviewRuntime({ planPath });
      try {
        await writeAgentRequest({
          store: review.store,
          request: messageAgentRequest({
            kind: "chat",
            requestId: "dddddddddddddddd",
            sessionId: review.sessionId,
            planId: review.planId,
            premiseSnapshot: deriveSnapshotDigest(source),
            createdAt: "2026-08-12T12:00:00.000Z",
            body: "What should we prioritize?",
          }),
        });
        await agentCommand(["next", planPath]);
        const presence = await readAgentPresence({
          store: review.store,
          sessionId: review.sessionId,
        });
        expect(presence).toMatchObject({ connected: true });
        if (expectedModel === undefined) {
          expect(presence).not.toHaveProperty("model");
        } else {
          expect(presence).toMatchObject({ model: expectedModel });
        }
      } finally {
        await review.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

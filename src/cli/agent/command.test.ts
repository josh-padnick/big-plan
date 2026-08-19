// Keeps the public CLI adapter responsible for rejecting malformed argument
// shapes before they reach the review-owned work loop.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deriveSnapshotDigest,
  messageAgentRequest,
  readAgentExchange,
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

  // Without the token these two cannot say which agent process is speaking,
  // so accepting them untokened would quietly reopen the double-claim they
  // exist to prevent.
  it.each([
    { action: "note", args: ["note", "plan.mdx", "Reading the request"] },
    { action: "respond", args: ["respond", "plan.mdx", "response.json"] },
  ])("should reject $action without an agent token", async ({ args }) => {
    await expect(agentCommand(args)).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringContaining("--agent"),
    });
  });

  it("should reject an agent flag with no token after it", async () => {
    await expect(
      agentCommand(["note", "plan.mdx", "Reading the request", "--agent"]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it.each([
    { label: "a missing value", tail: ["--agent"] },
    { label: "another flag as its value", tail: ["--agent", "--wait"] },
    { label: "a malformed value", tail: ["--agent", "not-a-token"] },
    {
      label: "a repeated flag",
      tail: ["--agent", "aaaaaaaaaaaaaaaa", "--agent", "bbbbbbbbbbbbbbbb"],
    },
  ])(
    "should reject --agent with $label without claiming work",
    async ({ tail }) => {
      const directory = await mkdtemp(
        join(tmpdir(), "big-plan-cli-agent-token-"),
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
          const outcome = await agentCommand(["next", planPath, ...tail]).then(
            () => ({ status: "fulfilled" as const, code: undefined }),
            (error: unknown) => ({
              status: "rejected" as const,
              code:
                typeof error === "object" &&
                error !== null &&
                "code" in error &&
                typeof error.code === "string"
                  ? error.code
                  : undefined,
            }),
          );
          const exchange = await readAgentExchange({
            store: review.store,
            sessionId: review.sessionId,
            planId: review.planId,
          });

          expect({
            ...outcome,
            claimedBy: exchange.requests[0]?.claimedBy,
          }).toEqual({
            status: "rejected",
            code: "INVALID_INPUT",
            claimedBy: undefined,
          });
        } finally {
          await review.close();
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
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
    // A name is what a reviewer reads on the badge, so neither of these can be
    // allowed to reach it: whitespace names nothing, and an overlong value is
    // not a model name a connector meant to report.
    {
      label: "no model for a whitespace-only report",
      environmentValue: "   ",
      expectedModel: undefined,
    },
    {
      label: "no model for a report past the length bound",
      environmentValue: "m".repeat(81),
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
        // The heartbeat names the connector too, so an idle agent is still
        // identifiable; the claim remains authoritative for work in flight.
        if (expectedModel === undefined) {
          expect(presence).not.toHaveProperty("model");
        } else {
          expect(presence).toMatchObject({ model: expectedModel });
        }
        const exchange = await readAgentExchange({
          store: review.store,
          sessionId: review.sessionId,
          planId: review.planId,
        });
        if (expectedModel === undefined) {
          expect(exchange.requests[0]).not.toHaveProperty("claimedModel");
        } else {
          expect(exchange.requests[0]).toMatchObject({
            claimedModel: expectedModel,
          });
        }
      } finally {
        await review.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  // `note` carries the connector's model too, and it is the command an agent
  // runs repeatedly during a turn - so a connector that starts reporting a
  // model mid-turn has to reach the badge through this path as well.
  it("should persist the connector model reported on a note", async () => {
    delete process.env["BIG_PLAN_AGENT_MODEL"];
    const directory = await mkdtemp(
      join(tmpdir(), "big-plan-cli-agent-model-note-"),
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
        const claimed = (
          await readAgentExchange({
            store: review.store,
            sessionId: review.sessionId,
            planId: review.planId,
          })
        ).requests[0];
        expect(claimed).not.toHaveProperty("claimedModel");
        const agentToken = claimed?.claimedBy;
        if (typeof agentToken !== "string") {
          throw new Error("The next command minted no claim token");
        }

        process.env["BIG_PLAN_AGENT_MODEL"] = "  Grok 4.6  ";
        await agentCommand([
          "note",
          planPath,
          "Reading the request",
          "--agent",
          agentToken,
        ]);

        // A note renews the claim, so the model it reports lands on the
        // request's `claimedModel` - the same field the `next` path writes,
        // and the one the badge reads.
        expect(
          (
            await readAgentExchange({
              store: review.store,
              sessionId: review.sessionId,
              planId: review.planId,
            })
          ).requests[0],
        ).toMatchObject({ claimedModel: { name: "Grok 4.6" } });
      } finally {
        await review.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

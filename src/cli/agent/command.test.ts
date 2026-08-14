// Keeps the public CLI adapter responsible for rejecting malformed argument
// shapes before they reach the review-owned work loop.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as agentWorkLoop from "../../review/agent-work-loop.js";
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
    vi.restoreAllMocks();
    if (originalModelEnv === undefined) {
      delete process.env["BIG_PLAN_AGENT_MODEL"];
    } else {
      process.env["BIG_PLAN_AGENT_MODEL"] = originalModelEnv;
    }
  });

  it("should forward a trimmed BIG_PLAN_AGENT_MODEL onto a next action", async () => {
    process.env["BIG_PLAN_AGENT_MODEL"] = "  Grok 4.6  ";
    const runAction = vi
      .spyOn(agentWorkLoop, "runAgentWorkLoopAction")
      .mockResolvedValue({});
    await agentCommand(["next", "plan.mdx", "--wait"]);
    expect(runAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "next", modelName: "Grok 4.6" }),
    );
  });

  it("should omit modelName from a next action when unset", async () => {
    delete process.env["BIG_PLAN_AGENT_MODEL"];
    const runAction = vi
      .spyOn(agentWorkLoop, "runAgentWorkLoopAction")
      .mockResolvedValue({});
    await agentCommand(["next", "plan.mdx", "--wait"]);
    const action = runAction.mock.calls[0]?.[0];
    expect(action).not.toHaveProperty("modelName");
  });
});

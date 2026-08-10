// Keeps the public CLI adapter responsible for rejecting malformed argument
// shapes before they reach the review-owned work loop.

import { describe, expect, it } from "vitest";
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

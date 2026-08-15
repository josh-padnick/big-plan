import { describe, expect, it } from "vitest";
import {
  agentConnectCommand,
  agentNextCommand,
  agentRecoveryPrompt,
  quoteShellArgument,
  reviewRestartCommand,
} from "./agent-command.js";

describe("agent commands", () => {
  const executablePath = "/tmp/big plan/bin/big-plan.mjs";
  const planPath = "/tmp/captain's plan.mdx";

  it("should quote one shell argument without changing its value", () => {
    expect(quoteShellArgument(planPath)).toBe(`'/tmp/captain'"'"'s plan.mdx'`);
  });

  it("should compose the review and agent commands in one place", () => {
    expect(reviewRestartCommand({ executablePath, planPath })).toBe(
      `node '/tmp/big plan/bin/big-plan.mjs' review '/tmp/captain'"'"'s plan.mdx'`,
    );
    expect(agentConnectCommand({ executablePath, planPath })).toBe(
      `node '/tmp/big plan/bin/big-plan.mjs' agent '/tmp/captain'"'"'s plan.mdx'`,
    );
    expect(agentNextCommand({ executablePath, planPath })).toBe(
      `node '/tmp/big plan/bin/big-plan.mjs' agent next '/tmp/captain'"'"'s plan.mdx' --wait`,
    );
  });

  it("should keep recovery guidance tied to the connect command", () => {
    expect(agentRecoveryPrompt({ executablePath, planPath })).toBe(
      `Reconnect to my existing Big Plan review for /tmp/captain's plan.mdx. Run node '/tmp/big plan/bin/big-plan.mjs' agent '/tmp/captain'"'"'s plan.mdx'. Read the prompt_file path it prints and follow that prompt in this agent session. Keep the connection loop running so the review remains live.`,
    );
  });
});

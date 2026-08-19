import { describe, expect, it } from "vitest";
import {
  agentConnectCommand,
  agentNextCommand,
  agentRecoveryPrompt,
  reviewRestartCommand,
} from "./agent-command.js";

describe("agent commands", () => {
  const executablePath = "/tmp/big plan/bin/big-plan.mjs";
  const planPath = "/tmp/captain's plan.mdx";

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
      [
        `Reconnect to my existing Big Plan review for /tmp/captain's plan.mdx.`,
        "First export what you know about yourself in that shell, skipping any you cannot answer: BIG_PLAN_AGENT_MODEL as the exact model id your API uses, for example grok-4.6; BIG_PLAN_AGENT_EFFORT as your reasoning effort; BIG_PLAN_AGENT_CLIENT as your tool and version, for example grok-cli 0.2.99; and BIG_PLAN_AGENT_SESSION_URL as a link to this conversation, or BIG_PLAN_AGENT_SESSION as its id if it has no link.",
        `Then run node '/tmp/big plan/bin/big-plan.mjs' agent '/tmp/captain'"'"'s plan.mdx'.`,
        "Read the prompt_file path it prints and follow that prompt in this agent session.",
        "Keep the connection loop running so the review remains live.",
      ].join(" "),
    );
  });
});

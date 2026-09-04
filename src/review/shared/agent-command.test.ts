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
      `node '/tmp/big plan/bin/big-plan.mjs' agent connect '/tmp/captain'"'"'s plan.mdx'`,
    );
    expect(agentNextCommand({ executablePath, planPath })).toBe(
      `node '/tmp/big plan/bin/big-plan.mjs' agent next '/tmp/captain'"'"'s plan.mdx' --wait`,
    );
  });

  it("should keep recovery guidance tied to the connect command", () => {
    expect(agentRecoveryPrompt({ executablePath, planPath })).toBe(
      [
        `Reconnect to my existing Big Plan review for /tmp/captain's plan.mdx.`,
        "Identity is OPTIONAL; skip every field you do not know. BIG_PLAN_AGENT_MODEL (the exact API model id) matters most. You may also export BIG_PLAN_AGENT_EFFORT, BIG_PLAN_AGENT_CLIENT, and BIG_PLAN_AGENT_SESSION_URL, or BIG_PLAN_AGENT_SESSION when the conversation has an id but no link.",
        `Then run node '/tmp/big plan/bin/big-plan.mjs' agent connect '/tmp/captain'"'"'s plan.mdx'.`,
        "Keep this one command in the foreground. It waits for a reviewer request and returns the request, exact response template, validation rules, and submit command together.",
      ].join(" "),
    );
  });
});

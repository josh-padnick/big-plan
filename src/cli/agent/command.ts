// Adapts `big-plan agent` arguments and structured CLI errors to the
// review-owned coding-agent work loop.

import { resolve } from "node:path";
import { AxiError } from "axi-sdk-js";
import {
  AgentWorkLoopRejected,
  runAgentWorkLoopAction,
} from "../../review/agent-work-loop.js";
import type { AgentWorkLoopAction } from "../../review/agent-work-loop.js";

const USAGE = [
  "Usage:",
  "  big-plan agent <input.mdx>",
  "  big-plan agent next <input.mdx> [--wait]",
  '  big-plan agent note <input.mdx> "<progress>"',
  "  big-plan agent respond <input.mdx> <response.json>",
].join("\n");

const invalidArguments = (): never => {
  throw new AxiError(USAGE, "INVALID_INPUT", [USAGE]);
};

const executablePath = (): string =>
  resolve(process.argv[1] ?? "bin/big-plan.mjs");

const RESERVED_ACTIONS = new Set(["next", "note", "respond"]);

/** Parses one public command into the review-owned work-loop action. */
const parseAction = (args: ReadonlyArray<string>): AgentWorkLoopAction => {
  if (args.length === 1 && !RESERVED_ACTIONS.has(args[0] ?? "")) {
    return {
      kind: "prompt",
      planPath: args[0] ?? "",
      executablePath: executablePath(),
    };
  }
  if (
    args[0] === "next" &&
    (args.length === 2 || (args.length === 3 && args[2] === "--wait"))
  ) {
    return {
      kind: "next",
      planPath: args[1] ?? "",
      shouldWait: args[2] === "--wait",
      executablePath: executablePath(),
    };
  }
  if (args[0] === "respond" && args.length === 3) {
    return {
      kind: "respond",
      planPath: args[1] ?? "",
      responsePath: args[2] ?? "",
      executablePath: executablePath(),
    };
  }
  if (args[0] === "note" && args.length === 3) {
    return { kind: "note", planPath: args[1] ?? "", detail: args[2] ?? "" };
  }
  return invalidArguments();
};

/** Runs one coding-agent CLI action and translates review errors for Axi. */
export const agentCommand = async (
  args: ReadonlyArray<string>,
): Promise<Record<string, unknown>> => {
  try {
    return await runAgentWorkLoopAction(parseAction(args));
  } catch (error: unknown) {
    if (!(error instanceof AgentWorkLoopRejected)) throw error;
    throw new AxiError(
      error.message,
      error.code === "validation-error" ? "VALIDATION_ERROR" : "INVALID_INPUT",
      error.details.length === 0 ? [USAGE] : [...error.details],
    );
  }
};

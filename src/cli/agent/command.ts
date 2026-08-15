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
  "  big-plan agent next <input.mdx> [--wait] [--agent <token>]",
  '  big-plan agent note <input.mdx> "<progress>" --agent <token>',
  "  big-plan agent respond <input.mdx> <response.json> --agent <token>",
  "",
  "The agent token is minted by `next` and returned with the work item.",
  "Run the note_command and respond_command it hands back rather than",
  "composing these yourself.",
].join("\n");

const invalidArguments = (): never => {
  throw new AxiError(USAGE, "INVALID_INPUT", [USAGE]);
};

const executablePath = (): string =>
  resolve(process.argv[1] ?? "bin/big-plan.mjs");

const RESERVED_ACTIONS = new Set(["next", "note", "respond"]);

// The connector's own report of which model is running it, e.g. "Grok 4.6".
// Read once per process so the reviewer sees a name only when the launching
// environment explicitly set one - never a guess from the connector itself.
const connectorModelName = (): string | undefined => {
  const trimmed = process.env["BIG_PLAN_AGENT_MODEL"]?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
};

/**
 * Lifts `--agent <token>` out of the positional arguments.
 *
 * The token identifies which agent process holds the claim, so `note` and
 * `respond` cannot be parsed without it and the positional shapes below stay
 * as simple as they were before it existed.
 */
const takeAgentToken = (
  args: ReadonlyArray<string>,
): { readonly rest: ReadonlyArray<string>; readonly agentToken?: string } => {
  const flag = args.indexOf("--agent");
  if (flag === -1) return { rest: args };
  const agentToken = args[flag + 1];
  if (agentToken === undefined) return invalidArguments();
  return {
    rest: [...args.slice(0, flag), ...args.slice(flag + 2)],
    agentToken,
  };
};

/** Parses one public command into the review-owned work-loop action. */
const parseAction = (
  args: ReadonlyArray<string>,
  agentToken: string | undefined,
): AgentWorkLoopAction => {
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
    const modelName = connectorModelName();
    return {
      kind: "next",
      planPath: args[1] ?? "",
      shouldWait: args[2] === "--wait",
      executablePath: executablePath(),
      ...(agentToken === undefined ? {} : { agentToken }),
      ...(modelName === undefined ? {} : { modelName }),
    };
  }
  if (args[0] === "respond" && args.length === 3 && agentToken !== undefined) {
    return {
      kind: "respond",
      planPath: args[1] ?? "",
      responsePath: args[2] ?? "",
      executablePath: executablePath(),
      agentToken,
    };
  }
  if (args[0] === "note" && args.length === 3 && agentToken !== undefined) {
    const modelName = connectorModelName();
    return {
      kind: "note",
      planPath: args[1] ?? "",
      detail: args[2] ?? "",
      agentToken,
      ...(modelName === undefined ? {} : { modelName }),
    };
  }
  return invalidArguments();
};

/** Runs one coding-agent CLI action and translates review errors for Axi. */
export const agentCommand = async (
  args: ReadonlyArray<string>,
): Promise<Record<string, unknown>> => {
  const { rest, agentToken } = takeAgentToken(args);
  try {
    return await runAgentWorkLoopAction(parseAction(rest, agentToken));
  } catch (error: unknown) {
    if (!(error instanceof AgentWorkLoopRejected)) throw error;
    throw new AxiError(
      error.message,
      error.code === "validation-error" ? "VALIDATION_ERROR" : "INVALID_INPUT",
      error.details.length === 0 ? [USAGE] : [...error.details],
    );
  }
};

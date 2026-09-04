// Adapts `big-plan agent` arguments and structured CLI errors to the
// review-owned coding-agent work loop.

import { fileURLToPath } from "node:url";
import { AxiError } from "axi-sdk-js";
import {
  AgentWorkLoopRejected,
  runAgentWorkLoopAction,
} from "../../review/agent-work-loop.js";
import type { AgentWorkLoopAction } from "../../review/agent-work-loop.js";

const USAGE = [
  "Usage:",
  "  big-plan agent <input.mdx>",
  "  big-plan agent connect <input.mdx>",
  "  big-plan agent next <input.mdx> [--wait] [--agent <token>] [--connection <token>]",
  '  big-plan agent push <input.mdx> (--prompt "<text>" | --about "<text>") [--thread <id>] [--agent <token>] [--connection <token>]',
  '  big-plan agent note <input.mdx> "<progress>" --agent <token> [--connection <token>]',
  "  big-plan agent respond <input.mdx> <response.json> --agent <token> [--connection <token>]",
  "",
  "The agent token is minted by `next` and returned with the work item.",
  'The returned note_command records "Working on the request" and renews',
  "the claim; run it and respond_command exactly as returned.",
  'Use `agent note <input.mdx> "<progress>" --agent <token>` for later updates.',
  "The connection token is minted by the first `next`, returned as",
  "connection_token, and carried by every command `next` returns; pass it back",
  "so this stays one agent session rather than a new one per command.",
].join("\n");

const invalidArguments = (): never => {
  throw new AxiError(USAGE, "INVALID_INPUT", [USAGE]);
};

const executablePath = (): string =>
  fileURLToPath(new URL("../../../bin/big-plan.mjs", import.meta.url));

const RESERVED_ACTIONS = new Set([
  "connect",
  "next",
  "push",
  "note",
  "respond",
]);
const AGENT_TOKEN = /^[a-f0-9]{16}$/;

// The connector's own report of which model is running it, e.g. "Grok 4.6".
// Read once per process so the reviewer sees a name only when the launching
// environment explicitly set one - never a guess from the connector itself.
const connectorModelName = (): string | undefined => {
  const trimmed = process.env["BIG_PLAN_AGENT_MODEL"]?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
};

/*
The rest of what a connector may declare about itself, read on the same terms
as the model name: stated by the launching environment or absent, never
inferred here.

All four are ordinary environment variables read once per process and carried
on the heartbeat and claim writes that already happen. Declaring them costs the
connection nothing: no extra call, no extra byte on the wire beyond the strings
themselves, and no work at all for a connector that declares none.
*/
const connectorValue = (variable: string): string | undefined => {
  const trimmed = process.env[variable]?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
};

const connectorModelEffort = (): string | undefined =>
  connectorValue("BIG_PLAN_AGENT_EFFORT");

const connectorClient = (): string | undefined =>
  connectorValue("BIG_PLAN_AGENT_CLIENT");

const connectorSessionUrl = (): string | undefined =>
  connectorValue("BIG_PLAN_AGENT_SESSION_URL");

const connectorSessionId = (): string | undefined =>
  connectorValue("BIG_PLAN_AGENT_SESSION");

/**
 * Lifts one `<flag> <token>` pair out of the positional arguments.
 *
 * `--agent` names which claim the process holds and `--connection` names the
 * agent session running it. Both are opaque tokens Big Plan minted and handed
 * back, so both are lifted the same way and the positional shapes below stay as
 * simple as they were before either existed.
 */
const takeTokenFlag = (
  args: ReadonlyArray<string>,
  flagName: string,
): { readonly rest: ReadonlyArray<string>; readonly token?: string } => {
  const flags = args.flatMap((argument, index) =>
    argument === flagName ? [index] : [],
  );
  if (flags.length === 0) return { rest: args };
  if (flags.length !== 1) return invalidArguments();
  const flag = flags[0] ?? -1;
  const token = args[flag + 1];
  if (token === undefined || !AGENT_TOKEN.test(token)) {
    return invalidArguments();
  }
  return {
    rest: [...args.slice(0, flag), ...args.slice(flag + 2)],
    token,
  };
};

/** Reads the mutually exclusive push wording and optional thread id. */
const parsePushFlags = (
  args: ReadonlyArray<string>,
): {
  readonly origin: "prompt" | "about";
  readonly body: string;
  readonly threadId?: string;
} => {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      (flag !== "--prompt" && flag !== "--about" && flag !== "--thread") ||
      value === undefined ||
      values.has(flag)
    ) {
      return invalidArguments();
    }
    values.set(flag, value);
  }
  const prompt = values.get("--prompt");
  const about = values.get("--about");
  if ((prompt === undefined) === (about === undefined)) {
    return invalidArguments();
  }
  const threadId = values.get("--thread");
  if (threadId !== undefined && !AGENT_TOKEN.test(threadId)) {
    return invalidArguments();
  }
  return {
    origin: prompt === undefined ? "about" : "prompt",
    body: prompt ?? about ?? "",
    ...(threadId === undefined ? {} : { threadId }),
  };
};

/** Parses one public command into the review-owned work-loop action. */
const parseAction = (
  args: ReadonlyArray<string>,
  agentToken: string | undefined,
  connectionToken: string | undefined,
): AgentWorkLoopAction => {
  if (
    args[0] === "connect" &&
    args.length === 2 &&
    agentToken === undefined &&
    connectionToken === undefined
  ) {
    return {
      kind: "next",
      planPath: args[1] ?? "",
      shouldWait: true,
      connectionSummary: true,
      executablePath: executablePath(),
      ...(connectorModelName() === undefined
        ? {}
        : { modelName: connectorModelName() }),
      ...(connectorModelEffort() === undefined
        ? {}
        : { modelEffort: connectorModelEffort() }),
      ...(connectorClient() === undefined
        ? {}
        : { modelClient: connectorClient() }),
      ...(connectorSessionUrl() === undefined
        ? {}
        : { sessionUrl: connectorSessionUrl() }),
      ...(connectorSessionId() === undefined
        ? {}
        : { sessionId: connectorSessionId() }),
    };
  }
  if (
    args.length === 1 &&
    agentToken === undefined &&
    connectionToken === undefined &&
    !RESERVED_ACTIONS.has(args[0] ?? "")
  ) {
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
    const modelEffort = connectorModelEffort();
    const modelClient = connectorClient();
    const sessionUrl = connectorSessionUrl();
    const sessionId = connectorSessionId();
    return {
      kind: "next",
      planPath: args[1] ?? "",
      shouldWait: args[2] === "--wait",
      executablePath: executablePath(),
      ...(agentToken === undefined ? {} : { agentToken }),
      ...(connectionToken === undefined ? {} : { connectionToken }),
      ...(modelName === undefined ? {} : { modelName }),
      ...(modelEffort === undefined ? {} : { modelEffort }),
      ...(modelClient === undefined ? {} : { modelClient }),
      ...(sessionUrl === undefined ? {} : { sessionUrl }),
      ...(sessionId === undefined ? {} : { sessionId }),
    };
  }
  if (args[0] === "push" && args.length >= 4) {
    const push = parsePushFlags(args.slice(2));
    const modelName = connectorModelName();
    const modelEffort = connectorModelEffort();
    const modelClient = connectorClient();
    const sessionUrl = connectorSessionUrl();
    const sessionId = connectorSessionId();
    return {
      kind: "push",
      planPath: args[1] ?? "",
      executablePath: executablePath(),
      ...push,
      ...(agentToken === undefined ? {} : { agentToken }),
      ...(connectionToken === undefined ? {} : { connectionToken }),
      ...(modelName === undefined ? {} : { modelName }),
      ...(modelEffort === undefined ? {} : { modelEffort }),
      ...(modelClient === undefined ? {} : { modelClient }),
      ...(sessionUrl === undefined ? {} : { sessionUrl }),
      ...(sessionId === undefined ? {} : { sessionId }),
    };
  }
  if (args[0] === "respond" && args.length === 3 && agentToken !== undefined) {
    return {
      kind: "respond",
      planPath: args[1] ?? "",
      responsePath: args[2] ?? "",
      executablePath: executablePath(),
      agentToken,
      ...(connectionToken === undefined ? {} : { connectionToken }),
    };
  }
  if (args[0] === "note" && args.length === 3 && agentToken !== undefined) {
    const modelName = connectorModelName();
    const modelEffort = connectorModelEffort();
    const modelClient = connectorClient();
    const sessionUrl = connectorSessionUrl();
    const sessionId = connectorSessionId();
    return {
      kind: "note",
      planPath: args[1] ?? "",
      detail: args[2] ?? "",
      agentToken,
      ...(connectionToken === undefined ? {} : { connectionToken }),
      ...(modelName === undefined ? {} : { modelName }),
      ...(modelEffort === undefined ? {} : { modelEffort }),
      ...(modelClient === undefined ? {} : { modelClient }),
      ...(sessionUrl === undefined ? {} : { sessionUrl }),
      ...(sessionId === undefined ? {} : { sessionId }),
    };
  }
  return invalidArguments();
};

/** Runs one coding-agent CLI action and translates review errors for Axi. */
export const agentCommand = async (
  args: ReadonlyArray<string>,
): Promise<Record<string, unknown>> => {
  try {
    const { rest: withoutConnection, token: connectionToken } = takeTokenFlag(
      args,
      "--connection",
    );
    const { rest, token: agentToken } = takeTokenFlag(
      withoutConnection,
      "--agent",
    );
    return await runAgentWorkLoopAction(
      parseAction(rest, agentToken, connectionToken),
    );
  } catch (error: unknown) {
    if (error instanceof AxiError) throw error;
    if (!(error instanceof AgentWorkLoopRejected)) throw error;
    /*
    Being disconnected (BIG-190) and losing primacy (BIG-171) each get their own
    code because a harness has to be able to branch on them. Reported as
    INVALID_INPUT they were indistinguishable from a mistyped flag, so the only
    safe response was to retry - which is the churn a disconnected loop and a
    displaced loop must not do. The usage block is withheld for both: the
    command was well formed, and printing usage would suggest otherwise.
    */
    const code =
      error.code === "validation-error"
        ? "VALIDATION_ERROR"
        : error.code === "source-moved"
          ? "SOURCE_MOVED"
          : error.code === "agent-disconnected"
            ? "AGENT_DISCONNECTED"
            : error.code === "primacy-lost"
              ? "NOT_PRIMARY"
              : "INVALID_INPUT";
    throw new AxiError(
      error.message,
      code,
      error.details.length === 0 &&
        error.code !== "agent-disconnected" &&
        error.code !== "primacy-lost"
        ? [USAGE]
        : [...error.details],
    );
  }
};

// Owns the shell commands and recovery text for a live review and its coding
// agent. Callers provide paths; this module owns command shape so browser
// guidance and runtime output cannot drift apart, and quotes every path
// through the repository's one shell-quoting owner.

import { quoteShellArgument } from "../../shell-quoting/quote.js";

export const agentConnectCommand = ({
  executablePath,
  planPath,
}: {
  readonly executablePath: string;
  readonly planPath: string;
}): string =>
  `node ${quoteShellArgument(executablePath)} agent ${quoteShellArgument(planPath)}`;

export const reviewRestartCommand = ({
  executablePath,
  planPath,
}: {
  readonly executablePath: string;
  readonly planPath: string;
}): string =>
  `node ${quoteShellArgument(executablePath)} review ${quoteShellArgument(planPath)}`;

/**
 * The identity a connection keeps across the commands it runs.
 *
 * A pickup token names one claim and dies with it, so it cannot say that the
 * process asking for work now is the process the reviewer was looking at a
 * moment ago. This token can: `agent next` mints it once, every command it
 * returns carries it back, and the presence record names it for as long as the
 * connection lasts. That is what lets a decision taken about an agent between
 * two of its commands still reach it (BIG-190).
 */
const connectionFlag = (connectionToken: string | undefined): string =>
  connectionToken === undefined
    ? ""
    : ` --connection ${quoteShellArgument(connectionToken)}`;

/**
 * Asks for the next piece of review work.
 *
 * The agent token is optional and means one thing: this is the agent that used
 * it, coming back. A returning loop is otherwise indistinguishable from a
 * second agent connecting - both are fresh processes with nothing of their own
 * to show - and being mistaken for one costs it the right to answer at all
 * (BIG-171). The token is handed back at pickup for exactly this, so the loop
 * always has one to offer after its first turn.
 */
export const agentNextCommand = ({
  executablePath,
  planPath,
  agentToken,
  connectionToken,
}: {
  readonly executablePath: string;
  readonly planPath: string;
  readonly agentToken?: string;
  readonly connectionToken?: string;
}): string =>
  `node ${quoteShellArgument(executablePath)} agent next ${quoteShellArgument(planPath)} --wait${
    agentToken === undefined ? "" : ` --agent ${quoteShellArgument(agentToken)}`
  }${connectionFlag(connectionToken)}`;

export const AGENT_NOTE_INITIAL_PROGRESS = "Working on the request";

/**
 * Narrates progress and renews the claim taken at pickup.
 *
 * The agent token is minted per pickup and must be handed back, because it is
 * the only thing that distinguishes two agent processes attached to one review
 * session. Callers never compose this string themselves; `agent next` returns
 * it ready to run so the token cannot be dropped or mistyped.
 */
export const agentNoteCommand = ({
  executablePath,
  planPath,
  agentToken,
  connectionToken,
}: {
  readonly executablePath: string;
  readonly planPath: string;
  readonly agentToken: string;
  readonly connectionToken?: string;
}): string =>
  `node ${quoteShellArgument(executablePath)} agent note ${quoteShellArgument(planPath)} ${quoteShellArgument(AGENT_NOTE_INITIAL_PROGRESS)} --agent ${quoteShellArgument(agentToken)}${connectionFlag(connectionToken)}`;

/** Publishes the drafted response under the claim taken at pickup. */
export const agentRespondCommand = ({
  executablePath,
  planPath,
  responsePath,
  agentToken,
  connectionToken,
}: {
  readonly executablePath: string;
  readonly planPath: string;
  readonly responsePath: string;
  readonly agentToken: string;
  readonly connectionToken?: string;
}): string =>
  `node ${quoteShellArgument(executablePath)} agent respond ${quoteShellArgument(planPath)} ${quoteShellArgument(responsePath)} --agent ${quoteShellArgument(agentToken)}${connectionFlag(connectionToken)}`;

export const agentRecoveryPrompt = ({
  executablePath,
  planPath,
}: {
  readonly executablePath: string;
  readonly planPath: string;
}): string =>
  [
    `Reconnect to my existing Big Plan review for ${planPath}.`,
    // The agent is the only party that knows any of this. Big Plan never
    // guesses, and detecting it from the outside would be a guess, so the one
    // honest source is asked directly - in the prompt the reviewer is already
    // handing over. The model is asked for as an id rather than a name because
    // an id is the form an agent can state without composing it.
    "First export what you know about yourself in that shell, skipping any you cannot answer: BIG_PLAN_AGENT_MODEL as the exact model id your API uses, for example grok-4.6; BIG_PLAN_AGENT_EFFORT as your reasoning effort; BIG_PLAN_AGENT_CLIENT as your tool and version, for example grok-cli 0.2.99; and BIG_PLAN_AGENT_SESSION_URL as a link to this conversation, or BIG_PLAN_AGENT_SESSION as its id if it has no link.",
    `Then run ${agentConnectCommand({ executablePath, planPath })}.`,
    "Read the prompt_file path it prints and follow that prompt in this agent session.",
    "Keep the connection loop running so the review remains live.",
  ].join(" ");

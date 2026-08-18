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

export const agentNextCommand = ({
  executablePath,
  planPath,
}: {
  readonly executablePath: string;
  readonly planPath: string;
}): string =>
  `node ${quoteShellArgument(executablePath)} agent next ${quoteShellArgument(planPath)} --wait`;

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
}: {
  readonly executablePath: string;
  readonly planPath: string;
  readonly agentToken: string;
}): string =>
  `node ${quoteShellArgument(executablePath)} agent note ${quoteShellArgument(planPath)} ${quoteShellArgument(AGENT_NOTE_INITIAL_PROGRESS)} --agent ${quoteShellArgument(agentToken)}`;

/** Publishes the drafted response under the claim taken at pickup. */
export const agentRespondCommand = ({
  executablePath,
  planPath,
  responsePath,
  agentToken,
}: {
  readonly executablePath: string;
  readonly planPath: string;
  readonly responsePath: string;
  readonly agentToken: string;
}): string =>
  `node ${quoteShellArgument(executablePath)} agent respond ${quoteShellArgument(planPath)} ${quoteShellArgument(responsePath)} --agent ${quoteShellArgument(agentToken)}`;

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

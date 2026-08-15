// Owns the shell commands and recovery text that connect a coding agent to a
// live review. Callers provide paths; this module owns command shape and shell
// quoting so the browser guidance and agent loop cannot drift apart.

/** Quotes trusted text as one literal POSIX-shell argument. */
export const quoteShellArgument = (value: string): string =>
  `'${value.replaceAll("'", `'"'"'`)}'`;

export const agentConnectCommand = ({
  executablePath,
  planPath,
}: {
  readonly executablePath: string;
  readonly planPath: string;
}): string =>
  `node ${quoteShellArgument(executablePath)} agent ${quoteShellArgument(planPath)}`;

export const agentNextCommand = ({
  executablePath,
  planPath,
}: {
  readonly executablePath: string;
  readonly planPath: string;
}): string =>
  `node ${quoteShellArgument(executablePath)} agent next ${quoteShellArgument(planPath)} --wait`;

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
  `node ${quoteShellArgument(executablePath)} agent note ${quoteShellArgument(planPath)} --agent ${agentToken}`;

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
  `node ${quoteShellArgument(executablePath)} agent respond ${quoteShellArgument(planPath)} ${quoteShellArgument(responsePath)} --agent ${agentToken}`;

export const agentRecoveryPrompt = ({
  executablePath,
  planPath,
}: {
  readonly executablePath: string;
  readonly planPath: string;
}): string =>
  [
    `Reconnect to my existing Big Plan review for ${planPath}.`,
    `Run ${agentConnectCommand({ executablePath, planPath })}.`,
    "Read the prompt_file path it prints and follow that prompt in this agent session.",
    "Keep the connection loop running so the review remains live.",
  ].join(" ");

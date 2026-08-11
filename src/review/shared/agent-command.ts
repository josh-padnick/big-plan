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

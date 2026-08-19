// Names the process holding the service's port when that process is not ours.
//
// The fixed port is the product: saved links point at the configured port, so
// sliding to a free neighbour would turn a loud, diagnosable failure into a
// quiet supply of wrong addresses. The service never auto-increments. It fails
// loudly instead, and a failure that says "port 8790 is in use" without saying
// by what is a failure the reader cannot act on - hence this module.
//
// Identification is best effort by construction. It shells out to whatever the
// platform provides, treats every failure as "could not identify", and never
// blocks the caller for long. A message that names nothing is still correct;
// it is only less useful.

import { execFile } from "node:child_process";

// Long enough for a cold `lsof` on a busy machine, short enough that nobody
// notices the difference between this and an immediate error.
const IDENTIFY_TIMEOUT_MS = 1_500;

const run = async (
  command: string,
  args: ReadonlyArray<string>,
): Promise<string | undefined> =>
  new Promise((settle) => {
    execFile(
      command,
      [...args],
      { timeout: IDENTIFY_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        settle(error === null ? stdout : undefined);
      },
    );
  });

// lsof prints one line per listener: "node    48298 personal   23u  IPv4 ..."
const parseLsof = (output: string): string | undefined => {
  const line = output
    .split("\n")
    .slice(1)
    .find((candidate) => candidate.trim() !== "");
  if (line === undefined) return undefined;
  const [command, pid] = line.trim().split(/\s+/);
  if (command === undefined || pid === undefined) return undefined;
  return `${command} (process ${pid})`;
};

// netstat prints "  TCP    127.0.0.1:8790   0.0.0.0:0   LISTENING   4812"
const parseNetstat = (output: string, port: number): string | undefined => {
  // Anchored to a non-digit boundary: `:879` is a substring of `:8790`, and a
  // message that names the wrong process is worse than one that names none.
  const listener = new RegExp(`:${port}(?!\\d)`);
  const line = output
    .split("\n")
    .find(
      (candidate) =>
        listener.test(candidate) &&
        candidate.toUpperCase().includes("LISTENING"),
    );
  if (line === undefined) return undefined;
  const columns = line.trim().split(/\s+/);
  const pid = columns[columns.length - 1];
  return pid === undefined ? undefined : `process ${pid}`;
};

/**
 * Describes whatever is listening on one port, or undefined when unknown.
 *
 * The returned string is meant to be dropped straight into an error sentence,
 * so it names a command and a pid where it can and nothing where it cannot.
 */
export const describePortOccupier = async ({
  port,
}: {
  readonly port: number;
}): Promise<string | undefined> => {
  if (process.platform === "win32") {
    const output = await run("netstat", ["-ano", "-p", "TCP"]);
    return output === undefined ? undefined : parseNetstat(output, port);
  }
  const output = await run("lsof", [
    "-nP",
    `-iTCP:${port}`,
    "-sTCP:LISTEN",
    "-Fcn",
  ]);
  if (output === undefined) {
    // Some systems ship lsof only for root, or not at all.
    return undefined;
  }
  // -F prints one field per line, tagged: "p48298", "cnode", "n127.0.0.1:8790".
  const pid = /^p(\d+)$/m.exec(output)?.[1];
  const command = /^c(.+)$/m.exec(output)?.[1];
  if (pid === undefined) return parseLsof(output);
  return command === undefined
    ? `process ${pid}`
    : `${command} (process ${pid})`;
};

/** Builds the sentence a command prints when the port is not ours to use. */
export const foreignPortMessage = ({
  port,
  occupier,
}: {
  readonly port: number;
  readonly occupier: string | undefined;
}): string =>
  [
    `Port ${port} is held by ${occupier ?? "another process this machine would not name"},`,
    "so the Big Plan service cannot claim it and saved review links are unavailable.",
    "Big Plan never moves to a different port on its own, because saved links point at this one.",
    "Free the port, or set BIG_PLAN_PORT to a port Big Plan should use instead.",
  ].join(" ");

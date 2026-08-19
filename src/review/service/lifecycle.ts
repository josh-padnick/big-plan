// Owns the service's lifecycle from the outside: is it running, start it if
// not, stop it, and describe it.
//
// The default is no setup at all. Any command that prints a link calls
// `ensureServiceRunning`, which spawns a plain detached child process when
// nothing answers. That is one Node call and behaves the same on macOS,
// Linux, and Windows, which is why the optional login item can stay optional.
//
// A port that answers with anything other than this product is never adopted.
// Treating a stranger's listener as the service would send saved review links
// into someone else's process.

import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { servicePaths, servicePort } from "./paths.js";
import { describePortOccupier, foreignPortMessage } from "./port-occupier.js";
import { SERVICE_PRODUCT } from "./server.js";
import type { ServiceHealth } from "./server.js";
import { serviceVersion } from "./version.js";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

// Long enough for a cold Node start on a busy machine, short enough that a
// command which cannot start the service still returns promptly with the
// direct address instead of appearing to hang.
const READY_TIMEOUT_MS = 5_000;
const READY_POLL_MS = 100;
const PROBE_TIMEOUT_MS = 750;
// A loopback connect either lands or refuses immediately; this only bounds a
// listener that accepts and then says nothing.
const CONNECT_TIMEOUT_MS = 500;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validateHealth = (value: unknown): ServiceHealth | undefined => {
  if (
    !isRecord(value) ||
    value.product !== SERVICE_PRODUCT ||
    typeof value.version !== "string" ||
    value.version === "" ||
    typeof value.pid !== "number" ||
    !Number.isInteger(value.pid) ||
    typeof value.port !== "number" ||
    !Number.isInteger(value.port) ||
    typeof value.startedAt !== "string" ||
    Number.isNaN(Date.parse(value.startedAt))
  ) {
    return undefined;
  }
  return {
    product: SERVICE_PRODUCT,
    version: value.version,
    pid: value.pid,
    port: value.port,
    startedAt: new Date(value.startedAt).toISOString(),
  };
};

/**
 * What is listening on the service's port.
 *
 * `foreign` is not a failure to retry. It means the port belongs to something
 * else, and the only honest responses are to leave it alone and to say so.
 */
export type ServiceProbe =
  | { readonly kind: "running"; readonly health: ServiceHealth }
  | { readonly kind: "absent" }
  | { readonly kind: "foreign" };

/** Asks the port who it is, without adopting an answer it did not expect. */
export const probeService = async ({
  port = servicePort(),
}: {
  readonly port?: number;
} = {}): Promise<ServiceProbe> => {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/healthz`, {
      // Never followed: a listener holding this port could otherwise answer
      // with a redirect, have any host in the world return a health record,
      // and be adopted as our service. Identity is only ever read from the
      // socket we connected to on loopback, and a redirect is not that - it
      // arrives here as a non-ok status and is refused below like any other
      // answer this product would not have given.
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    // Refused, reset, or timed out: nothing is answering here.
    return { kind: "absent" };
  }
  if (!response.ok || response.redirected) return { kind: "foreign" };
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { kind: "foreign" };
  }
  const health = validateHealth(parsed);
  return health === undefined
    ? { kind: "foreign" }
    : { kind: "running", health };
};

/**
 * Reads the service token, minting one when the service has never run.
 *
 * Two commands starting at once both find no token and both try to mint one.
 * The exclusive create is what makes that safe: the loser's write fails, and
 * it re-reads the winner's token rather than overwriting it. Minting through a
 * plain write would leave the two processes holding different secrets, and the
 * later one would lock the earlier one out of its own service.
 */
export const ensureServiceToken = async (): Promise<string> => {
  const { directory, tokenPath } = servicePaths();
  const existing = await readServiceToken();
  if (existing !== undefined) return existing;

  await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
  const minted = randomBytes(32).toString("base64url");
  try {
    await writeFile(tokenPath, `${minted}\n`, {
      encoding: "utf8",
      mode: FILE_MODE,
      flag: "wx",
    });
    return minted;
  } catch {
    // Someone else won the race, or the directory refuses writes. Either way
    // the token on disk is the only one that counts.
    const written = await readServiceToken();
    if (written !== undefined) return written;
    throw new Error(
      `The Big Plan service token could not be created at ${tokenPath}`,
    );
  }
};

/** Reads the service token, or undefined when none has been minted. */
export const readServiceToken = async (): Promise<string | undefined> => {
  try {
    const token = (await readFile(servicePaths().tokenPath, "utf8")).trim();
    return token === "" ? undefined : token;
  } catch {
    return undefined;
  }
};

type RuntimeRecord = {
  readonly pid: number;
  readonly port: number;
  readonly startedAt: string;
  /** How the process was started, which is what `status` reports back. */
  readonly managedBy: "on-demand" | "login-item";
};

/** Records what the running process is, for `big-plan service status`. */
export const writeServiceRuntimeRecord = async (
  record: RuntimeRecord,
): Promise<void> => {
  const { directory, runtimePath } = servicePaths();
  await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
  await writeFile(runtimePath, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    mode: FILE_MODE,
  });
};

/** Removes the runtime record on a clean exit. */
export const clearServiceRuntimeRecord = async (): Promise<void> => {
  await rm(servicePaths().runtimePath, { force: true });
};

/** Reads the runtime record, which is advisory: `/healthz` is authoritative. */
export const readServiceRuntimeRecord = async (): Promise<
  RuntimeRecord | undefined
> => {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(servicePaths().runtimePath, "utf8"),
    );
    if (
      !isRecord(parsed) ||
      typeof parsed.pid !== "number" ||
      typeof parsed.port !== "number" ||
      typeof parsed.startedAt !== "string" ||
      (parsed.managedBy !== "on-demand" && parsed.managedBy !== "login-item")
    ) {
      return undefined;
    }
    return {
      pid: parsed.pid,
      port: parsed.port,
      startedAt: parsed.startedAt,
      managedBy: parsed.managedBy,
    };
  } catch {
    return undefined;
  }
};

const wait = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((settle) => {
    setTimeout(settle, milliseconds);
  });
};

// dist/review/service/lifecycle.js -> dist/review/service/main.js
const serviceEntryPoint = (): string =>
  fileURLToPath(new URL("./main.js", import.meta.url));

/**
 * What a caller that wanted a working stable link ended up with.
 *
 * `unavailable` carries the sentence a command should print. A command that
 * cannot start the service still succeeds: it prints the session's direct
 * address, which is exactly today's behaviour, never worse.
 */
export type ServiceAvailability =
  | {
      readonly kind: "running";
      readonly health: ServiceHealth;
      readonly spawned: boolean;
    }
  | { readonly kind: "unavailable"; readonly reason: string };

// Whether anything at all holds the port, asked of the socket rather than of
// a tool: a listener that speaks no HTTP answers no probe, and it is exactly
// that listener the failure has to be able to name.
const portIsHeld = async ({
  port,
}: {
  readonly port: number;
}): Promise<boolean> =>
  new Promise((settle) => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (held: boolean): void => {
      socket.destroy();
      settle(held);
    };
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });

// Why a start that never answered failed. A held port is the case the fixed-
// port policy exists for, and it has to say so with the occupier and the
// override rather than as a timeout the reader cannot act on.
const startFailureReason = async ({
  port,
}: {
  readonly port: number;
}): Promise<string> =>
  (await portIsHeld({ port }))
    ? foreignPortMessage({
        port,
        occupier: await describePortOccupier({ port }),
      })
    : `The Big Plan service did not start on port ${port} in time, so stable review links are unavailable.`;

const spawnAndAwaitReady = async ({
  port,
}: {
  readonly port: number;
}): Promise<ServiceAvailability> => {
  // A token that can be neither read nor minted is a start that cannot
  // happen, and it is a returned reason like every other one: this path
  // promises the caller a result, never an exception, because the command
  // asking for it still has a session address to print.
  try {
    await ensureServiceToken();
  } catch (error: unknown) {
    return {
      kind: "unavailable",
      reason: `The Big Plan service could not be started because its token at ${servicePaths().tokenPath} is unavailable: ${String(error)}`,
    };
  }
  // A child that exits before answering could not take the port - usually
  // because something else already has it. Waiting out the full deadline for
  // an answer that is never coming only delays the explanation.
  let childExited = false;
  let forkFailure: string | undefined;
  try {
    const child = spawn(process.execPath, [serviceEntryPoint()], {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.once("exit", () => {
      childExited = true;
    });
    // A fork that never happened - no descriptors left, no permission to
    // execute - arrives here rather than as a throw, and an `error` event
    // nobody listens for is re-thrown as an uncaught exception. That would
    // take down the command this was supposed to leave working.
    child.once("error", (error: Error) => {
      forkFailure = String(error);
      childExited = true;
    });
    child.unref();
  } catch (error: unknown) {
    return {
      kind: "unavailable",
      reason: `The Big Plan service could not be started: ${String(error)}`,
    };
  }

  // Two commands racing this are benign: the loser's child exits on
  // EADDRINUSE and both polls adopt the survivor, because adoption is decided
  // by what answers `/healthz` rather than by who spawned it. That is why a
  // child that exited is still followed by one more probe before giving up.
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await wait(READY_POLL_MS);
    const ready = await probeService({ port });
    if (ready.kind === "running") {
      return { kind: "running", health: ready.health, spawned: true };
    }
    if (ready.kind === "foreign") {
      return {
        kind: "unavailable",
        reason: foreignPortMessage({
          port,
          occupier: await describePortOccupier({ port }),
        }),
      };
    }
    if (childExited) break;
  }
  if (forkFailure !== undefined) {
    return {
      kind: "unavailable",
      reason: `The Big Plan service could not be started: ${forkFailure}`,
    };
  }
  return { kind: "unavailable", reason: await startFailureReason({ port }) };
};

/**
 * Makes sure the service is answering, spawning it if nothing is.
 *
 * Three outcomes and no fourth: our service is reused, a service of the wrong
 * version is replaced, and anything else on the port is left strictly alone.
 * Big Plan never slides to a neighbouring port when this one is taken - the
 * fixed port is the address saved links point at, so moving quietly would turn
 * a loud failure into a supply of wrong addresses.
 */
export const ensureServiceRunning = async ({
  port = servicePort(),
}: {
  readonly port?: number;
} = {}): Promise<ServiceAvailability> => {
  const probe = await probeService({ port });

  if (probe.kind === "foreign") {
    return {
      kind: "unavailable",
      reason: foreignPortMessage({
        port,
        occupier: await describePortOccupier({ port }),
      }),
    };
  }

  if (probe.kind === "running") {
    const expected = await serviceVersion();
    if (probe.health.version === expected) {
      return { kind: "running", health: probe.health, spawned: false };
    }
    // A service outlives the CLI that spawned it, so an upgrade would
    // otherwise leave an old process serving old pages indefinitely. It holds
    // no state, so replacing it costs a sub-second gap and nothing else.
    // `absent` is not a failure here: the old process exited on its own
    // between the probe and the request, which is the outcome we wanted.
    const stop = await stopService({ port });
    if (stop.kind === "refused") {
      return {
        kind: "unavailable",
        reason: `A Big Plan service from version ${probe.health.version} is running on port ${port} and could not be stopped to replace it with ${expected}: ${stop.reason} Run \`big-plan service restart\`.`,
      };
    }
  }

  return spawnAndAwaitReady({ port });
};

/**
 * What asking the service to stop actually achieved.
 *
 * The three cases are kept apart because a caller reports them to a person,
 * and collapsing them would let a stop that did not happen be announced as one
 * that did. `refused` carries the sentence explaining why, and says whether
 * our own service is the thing still holding the port: a stop that could not
 * be delivered leaves it serving saved links, while a port held by a stranger
 * means Big Plan is serving nothing there at all.
 */
export type ServiceStop =
  | { readonly kind: "absent" }
  | { readonly kind: "stopped" }
  | {
      readonly kind: "refused";
      readonly reason: string;
      readonly stillServing: boolean;
    };

/** Asks a running service to exit, reporting what actually happened. */
export const stopService = async ({
  port = servicePort(),
}: {
  readonly port?: number;
} = {}): Promise<ServiceStop> => {
  const probe = await probeService({ port });
  if (probe.kind === "absent") return { kind: "absent" };
  if (probe.kind === "foreign") {
    return {
      kind: "refused",
      stillServing: false,
      reason: foreignPortMessage({
        port,
        occupier: await describePortOccupier({ port }),
      }),
    };
  }
  // Minted rather than merely read: the service reads its token per request
  // precisely so a re-minted one is accepted, and a token missing from disk
  // must not leave the operator unable to stop their own process.
  let token: string;
  try {
    token = await ensureServiceToken();
  } catch (error: unknown) {
    return {
      kind: "refused",
      stillServing: true,
      reason: `The Big Plan service on port ${port} could not be stopped because its token is unavailable: ${String(error)}`,
    };
  }
  try {
    const response = await fetch(`http://127.0.0.1:${port}/stop`, {
      method: "POST",
      headers: { "x-big-plan-service-token": token },
      // The owner token rides on this request, and a redirect is followed
      // with the header intact, so a redirect is refused rather than chased.
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok || response.redirected) {
      return {
        kind: "refused",
        stillServing: true,
        reason: `The Big Plan service on port ${port} refused the stop request with HTTP ${response.status}.`,
      };
    }
  } catch (error: unknown) {
    return {
      kind: "refused",
      stillServing: true,
      reason: `The Big Plan service on port ${port} could not be asked to stop: ${String(error)}`,
    };
  }
  // The process answers before it closes its listener, so a caller that
  // immediately probes again should see it gone rather than racing it.
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await wait(READY_POLL_MS);
    if ((await probeService({ port })).kind !== "running") {
      return { kind: "stopped" };
    }
  }
  return {
    kind: "refused",
    stillServing: true,
    reason: `The Big Plan service on port ${port} accepted the stop request but is still listening.`,
  };
};

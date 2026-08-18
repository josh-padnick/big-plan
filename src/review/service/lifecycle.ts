// Owns the service's lifecycle from the outside: is it running, start it if
// not, stop it, and describe it.
//
// This step owns the two questions that can be answered without starting
// anything: what is listening on the port, and what credential authorizes a
// change. Starting and stopping arrive with the command surface that names
// them.
//
// A port that answers with anything other than this product is never adopted.
// Treating a stranger's listener as the service would send saved review links
// into someone else's process.

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { servicePaths, servicePort } from "./paths.js";
import { SERVICE_PRODUCT } from "./server.js";
import type { ServiceHealth } from "./server.js";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

const PROBE_TIMEOUT_MS = 750;

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
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    // Refused, reset, or timed out: nothing is answering here.
    return { kind: "absent" };
  }
  if (!response.ok) return { kind: "foreign" };
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

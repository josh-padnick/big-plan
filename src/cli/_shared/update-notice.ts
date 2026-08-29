// Owns the passive package-update notice shown with CLI guidance. Registry
// work runs in a detached worker after command output, so normal commands only
// read a small cache and never wait on the network.

import { spawn } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectInstallMethod,
  fetchLatestVersion,
  isUpdateAvailable,
} from "axi-sdk-js";
import { candidateStateDirectories } from "../../review/state-directory.js";

const CACHE_NAME = "update-check.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const REGISTRY_TIMEOUT_MS = 2_000;

type UpdateCheckMarker = {
  readonly checkedAtMs: number;
  readonly latest?: string;
};

export type PreparedUpdateNotice = {
  readonly line?: string;
  /** Starts a detached refresh after the command has already printed. */
  readonly refreshAfterOutput?: () => void;
};

const parseMarker = (raw: string): UpdateCheckMarker | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object" ||
      value === null ||
      !("checkedAtMs" in value) ||
      typeof value.checkedAtMs !== "number" ||
      !Number.isFinite(value.checkedAtMs)
    ) {
      return undefined;
    }
    const latest =
      "latest" in value && typeof value.latest === "string"
        ? value.latest
        : undefined;
    return { checkedAtMs: value.checkedAtMs, latest };
  } catch {
    return undefined;
  }
};

const readMarker = async (): Promise<UpdateCheckMarker | undefined> => {
  for (const directory of candidateStateDirectories()) {
    try {
      const marker = parseMarker(
        await readFile(join(directory, CACHE_NAME), "utf8"),
      );
      if (marker !== undefined) {
        return marker;
      }
    } catch {
      // A missing or unreadable cache is a silent miss.
    }
  }
  return undefined;
};

const updateLine = (
  current: string,
  marker: UpdateCheckMarker | undefined,
  now: number,
): string | undefined => {
  if (
    marker === undefined ||
    now - marker.checkedAtMs < 0 ||
    now - marker.checkedAtMs >= CACHE_TTL_MS ||
    marker.latest === undefined ||
    !isUpdateAvailable(current, marker.latest)
  ) {
    return undefined;
  }
  return `Update available: Big Plan ${marker.latest} (running ${current}); update with your package manager (https://big-plan.ai/intro/installation/).`;
};

const launchRefreshWorker = (): void => {
  try {
    const workerPath = fileURLToPath(
      new URL("./update-notice-worker.js", import.meta.url),
    );
    const child = spawn(process.execPath, [workerPath], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // Failure to start the optional check never affects the user's command.
  }
};

const ignoreRefreshFailure =
  (launchRefresh: () => void): (() => void) =>
  (): void => {
    try {
      launchRefresh();
    } catch {
      // A synchronous launcher failure remains invisible to the command that
      // has already produced its output.
    }
  };

/**
 * Reads an already-completed check for guidance output and arranges a stale
 * cache refresh. Ephemeral npx installs do neither because they already run
 * the requested published version.
 */
export const prepareUpdateNotice = async ({
  currentVersion,
  invokedAs,
  env = process.env,
  now = Date.now(),
  resolveEntry = realpath,
  launchRefresh = launchRefreshWorker,
}: {
  readonly currentVersion: string;
  readonly invokedAs: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: number;
  readonly resolveEntry?: (path: string) => Promise<string>;
  readonly launchRefresh?: () => void;
}): Promise<PreparedUpdateNotice> => {
  try {
    const entry = await resolveEntry(invokedAs);
    if (detectInstallMethod({ entry, env }).kind === "npx") {
      return {};
    }

    const marker = await readMarker();
    const isFresh =
      marker !== undefined &&
      now - marker.checkedAtMs >= 0 &&
      now - marker.checkedAtMs < CACHE_TTL_MS;
    const line = updateLine(currentVersion, marker, now);
    return {
      ...(line === undefined ? {} : { line }),
      ...(isFresh
        ? {}
        : { refreshAfterOutput: ignoreRefreshFailure(launchRefresh) }),
    };
  } catch {
    // Every part of this optional path is fail-open, including install
    // detection and local cache discovery supplied by platform state.
    return {};
  }
};

/** Refreshes the shared marker. Called only by the detached worker. */
export const refreshUpdateNoticeCache = async ({
  fetchLatest = () =>
    fetchLatestVersion("big-plan", {
      fetchTimeoutMs: REGISTRY_TIMEOUT_MS,
      // The npm-process fallback is intentionally omitted for this passive,
      // best-effort check; a failed HTTP lookup simply produces no notice.
      npmView: async () => null,
    }),
}: {
  readonly fetchLatest?: () => Promise<string | null>;
} = {}): Promise<void> => {
  let latest: string | undefined;
  try {
    latest = (await fetchLatest()) ?? undefined;
  } catch {
    return;
  }
  if (latest === undefined) {
    return;
  }

  const content = JSON.stringify({ checkedAtMs: Date.now(), latest });
  for (const directory of candidateStateDirectories()) {
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, CACHE_NAME), content, "utf8");
      return;
    } catch {
      // Try the next state directory; no writable location is a silent miss.
    }
  }
};

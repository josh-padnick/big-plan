// The service's durable index of plans: one small file per plan naming where
// that plan lives on disk.
//
// Two properties are deliberate and worth stating, because both are easy to
// break by "improving" this file:
//
//  - An entry records identity, never liveness. Whether a session is running
//    is answered by the plan's own review store, which already distinguishes
//    running, stopped-with-a-reason, and stale. A second copy here would
//    drift, and the drift would surface as a page confidently describing a
//    session that is actually alive.
//  - An entry outlives the session that created it. Keeping it after the
//    review ends is the entire reason a dead link can be explained instead of
//    refused, so nothing prunes on shutdown.

import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { servicePaths } from "./paths.js";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

// The plan id is the review store's own identifier: sixteen hex characters
// derived from the plan's resolved path. Checking the shape here is what lets
// it be used as a filename without sanitising anything.
const PLAN_ID = /^[a-f0-9]{16}$/;

// A registry file is writable by anything running as the reviewer, so it is
// re-checked on read exactly as if it had arrived over the wire. A file that
// grew past this is not an entry this module wrote.
const MAX_ENTRY_BYTES = 8 * 1024;

export type ServiceRegistryEntry = {
  readonly version: 1;
  readonly planId: string;
  /** The plan's resolved path, which is what the plan id was derived from. */
  readonly planPath: string;
  readonly firstSeenAt: string;
  readonly lastStartedAt: string;
};

/** Reports whether one value is a plan id this module would accept. */
export const isServicePlanId = (value: string): boolean => PLAN_ID.test(value);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isIsoInstant = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));

/** Checks one registry entry read from disk, rejecting anything unexpected. */
export const validateServiceRegistryEntry = (
  value: unknown,
): ServiceRegistryEntry | undefined => {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.planId !== "string" ||
    !PLAN_ID.test(value.planId) ||
    typeof value.planPath !== "string" ||
    value.planPath === "" ||
    !isIsoInstant(value.firstSeenAt) ||
    !isIsoInstant(value.lastStartedAt)
  ) {
    return undefined;
  }
  return {
    version: 1,
    planId: value.planId,
    planPath: value.planPath,
    firstSeenAt: new Date(value.firstSeenAt).toISOString(),
    lastStartedAt: new Date(value.lastStartedAt).toISOString(),
  };
};

const entryPath = (planId: string): string =>
  join(servicePaths().registryDirectory, `${planId}.json`);

/** Reads one plan's entry, or undefined when it is missing or unreadable. */
export const readServiceRegistryEntry = async ({
  planId,
}: {
  readonly planId: string;
}): Promise<ServiceRegistryEntry | undefined> => {
  if (!PLAN_ID.test(planId)) return undefined;
  let raw: string;
  try {
    raw = await readFile(entryPath(planId), "utf8");
  } catch {
    // Missing or unreadable reads as "this machine has never seen that plan",
    // which is a page the service can serve rather than an error.
    return undefined;
  }
  if (raw.length > MAX_ENTRY_BYTES) return undefined;
  try {
    return validateServiceRegistryEntry(JSON.parse(raw));
  } catch {
    return undefined;
  }
};

/**
 * Records that a review session started for one plan.
 *
 * Called by the CLI at session start, and idempotent: a plan reviewed twice
 * keeps its original `firstSeenAt` and advances `lastStartedAt`.
 */
export const rememberPlan = async ({
  planId,
  planPath,
  now = new Date(),
}: {
  readonly planId: string;
  readonly planPath: string;
  readonly now?: Date;
}): Promise<ServiceRegistryEntry> => {
  if (!PLAN_ID.test(planId)) {
    throw new Error(`Refusing a registry entry for plan id ${planId}`);
  }
  const existing = await readServiceRegistryEntry({ planId });
  const entry: ServiceRegistryEntry = {
    version: 1,
    planId,
    planPath,
    firstSeenAt: existing?.firstSeenAt ?? now.toISOString(),
    lastStartedAt: now.toISOString(),
  };
  const directory = servicePaths().registryDirectory;
  await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
  // Written through a temporary name so a reader never observes half a file;
  // the service reads these while the CLI writes them.
  const target = entryPath(planId);
  const staging = `${target}.${process.pid}.tmp`;
  await writeFile(staging, `${JSON.stringify(entry, null, 2)}\n`, {
    encoding: "utf8",
    mode: FILE_MODE,
  });
  await rename(staging, target);
  return entry;
};

/** Lists every entry the registry currently holds, in plan-id order. */
export const listServiceRegistryEntries = async (): Promise<
  ReadonlyArray<ServiceRegistryEntry>
> => {
  let names: ReadonlyArray<string>;
  try {
    names = await readdir(servicePaths().registryDirectory);
  } catch {
    return [];
  }
  const planIds = names
    .flatMap((name) => (name.endsWith(".json") ? [name.slice(0, -5)] : []))
    .filter((planId) => PLAN_ID.test(planId))
    .sort();
  const entries = await Promise.all(
    planIds.map(async (planId) => readServiceRegistryEntry({ planId })),
  );
  return entries.filter(
    (entry): entry is ServiceRegistryEntry => entry !== undefined,
  );
};

/**
 * Drops entries whose plan file no longer exists.
 *
 * This is the only thing that expires. An entry is a few hundred bytes and
 * losing one turns a good link back into a connection error, so age alone
 * never removes anything.
 */
export const pruneMissingPlans = async ({
  exists,
}: {
  readonly exists: (planPath: string) => Promise<boolean>;
}): Promise<number> => {
  const entries = await listServiceRegistryEntries();
  let dropped = 0;
  for (const entry of entries) {
    if (await exists(entry.planPath)) continue;
    await rm(entryPath(entry.planId), { force: true });
    dropped += 1;
  }
  return dropped;
};

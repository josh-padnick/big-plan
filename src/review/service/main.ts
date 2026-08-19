// The entry point of the spawned service process.
//
// It is deliberately tiny and has no arguments: `ensureServiceRunning` starts
// it with `process.execPath` and nothing else, so the only way to influence it
// is the environment every other Big Plan command already reads.
//
// There is no idle timeout. A service that exited on its own would mean a
// saved link works at noon and fails at four for no reason a person can see;
// it exits when it is told to, or when the login session it belongs to ends.

import { access } from "node:fs/promises";
import {
  clearServiceRuntimeRecord,
  ensureServiceToken,
  readServiceToken,
  writeServiceRuntimeRecord,
} from "./lifecycle.js";
import { servicePort } from "./paths.js";
import { pruneMissingPlans } from "./registry.js";
import { startService } from "./server.js";
import { serviceVersion } from "./version.js";

const planFileExists = async (planPath: string): Promise<boolean> => {
  try {
    await access(planPath);
    return true;
  } catch {
    return false;
  }
};

/** Runs the service until it is asked to stop. */
export const runService = async (): Promise<void> => {
  await ensureServiceToken();
  const port = servicePort();
  const startedAtMs = Date.now();
  const clearOwnRecord = async (): Promise<void> => {
    await clearServiceRuntimeRecord({ pid: process.pid });
  };

  let closed = false;
  let runtime;
  try {
    runtime = await startService({
      // The token is read per mutating request rather than captured at boot:
      // the CLI may re-mint it, and a service holding a boot-time copy would
      // then refuse its own operator until it was restarted.
      readToken: readServiceToken,
      version: await serviceVersion(),
      port,
      now: startedAtMs,
      // The record describes a process that is about to stop existing, and the
      // stop that ends it is usually an HTTP one rather than a signal.
      onClosed: async () => {
        closed = true;
        await clearOwnRecord();
      },
    });
  } catch (error: unknown) {
    // Nothing ever listened. Only a record this process wrote is cleared, and
    // it never wrote one, so a start that lost the port race leaves the
    // winner's record exactly where it is.
    await clearOwnRecord();
    throw error;
  }

  // Written only once the listener is bound, because the record's path is
  // shared by every start on this machine: a start that writes before it binds
  // overwrites the record of the process that already owns the port, and then
  // deletes it on the way out. The stop that can arrive in the gap between
  // binding and this write is settled by the recheck below rather than by
  // writing earlier.
  await writeServiceRuntimeRecord({
    pid: process.pid,
    port,
    startedAt: new Date(startedAtMs).toISOString(),
    // The login item sets this to "login-item" when it starts the process;
    // until that ships, every start is on demand.
    managedBy:
      process.env["BIG_PLAN_SERVICE_MANAGED_BY"] === "login-item"
        ? "login-item"
        : "on-demand",
  });
  // A stop that closed the listener before the write above had nothing to
  // clear, so the record would otherwise outlive the process it describes.
  if (closed) await clearOwnRecord();

  // The only thing that expires. An entry whose plan file is gone can never
  // explain anything useful again; everything else is kept, because losing an
  // entry turns a good link back into a connection error. Start is the only
  // moment this runs: a branch switch can hide a plan file for a minute, and
  // pruning on a timer would turn that into a link-killing race.
  await pruneMissingPlans({ exists: planFileExists });

  const stop = (): void => {
    void runtime.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
};

await runService();

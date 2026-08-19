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
  // The token is read per mutating request, not captured here: the CLI may
  // re-mint it, and a service holding a boot-time copy would then refuse its
  // own operator until it was restarted.
  // Written before anything can answer: the record is created once, and
  // cleared once, by a process that is listening in between. A record written
  // after the port opened could be cleared by a stop that arrived first and
  // then recreated by this write, describing a process that has already gone.
  const startedAtMs = Date.now();
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

  let runtime;
  try {
    runtime = await startService({
      readToken: readServiceToken,
      version: await serviceVersion(),
      port,
      now: startedAtMs,
      // The record describes a process that is about to stop existing, and the
      // stop that ends it is usually an HTTP one rather than a signal.
      onClosed: clearServiceRuntimeRecord,
    });
  } catch (error: unknown) {
    // Nothing ever listened, so the record would outlive a process that never
    // served a link.
    await clearServiceRuntimeRecord();
    throw error;
  }

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

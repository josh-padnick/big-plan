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
import { ensureServiceToken, readServiceToken } from "./lifecycle.js";
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
  const runtime = await startService({
    readToken: readServiceToken,
    version: await serviceVersion(),
    port,
  });

  // The only thing that expires. An entry whose plan file is gone can never
  // explain anything useful again; everything else is kept, because losing an
  // entry turns a good link back into a connection error.
  await pruneMissingPlans({ exists: planFileExists });

  const stop = (): void => {
    void runtime.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
};

await runService();

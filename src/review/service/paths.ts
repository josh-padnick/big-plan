// The one place the local service's on-disk locations and its fixed port are
// constructed. Everything else in the service asks this module rather than
// joining paths or reading the environment again, so a change of layout is a
// change here and a mistyped directory cannot exist somewhere else.

import { join } from "node:path";
import { primaryStateDirectory } from "../state-directory.js";

/**
 * The port the service claims by default.
 *
 * A saved link is only permanent if the address in it is predictable, so this
 * is a constant rather than something negotiated at start. `BIG_PLAN_PORT`
 * exists for the case the constant collides with something already on the
 * machine; changing it invalidates links already saved at the old port, which
 * is why it is an escape hatch rather than a setting.
 */
export const DEFAULT_SERVICE_PORT = 8790;

/** Resolves the port the service should claim, honouring `BIG_PLAN_PORT`. */
export const servicePort = (): number => {
  const configured = process.env["BIG_PLAN_PORT"];
  if (configured === undefined || configured.trim() === "") {
    return DEFAULT_SERVICE_PORT;
  }
  const parsed = Number(configured);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    return DEFAULT_SERVICE_PORT;
  }
  return parsed;
};

/** Whether this service instance should keep live requests on its own port. */
export const serviceProxyEnabled = (): boolean =>
  process.env["BIG_PLAN_PROXY"] === "1";

/** The address a saved review link points at. */
export const serviceOrigin = (): string => `http://127.0.0.1:${servicePort()}`;

/** The stable, per-plan review address the CLI prints and the service answers. */
export const servicePlanUrl = ({
  planId,
}: {
  readonly planId: string;
}): string => `${serviceOrigin()}/plan/${planId}`;

export type ServicePaths = {
  /** Everything the service owns, under the user-level state directory. */
  readonly directory: string;
  /** One file per plan, forming the durable index of known plans. */
  readonly registryDirectory: string;
  /** The shared secret gating every mutating route. */
  readonly tokenPath: string;
  /** What the running process records about itself for `service status`. */
  readonly runtimePath: string;
};

/** Names every location the service owns. */
export const servicePaths = (): ServicePaths => {
  const directory = join(primaryStateDirectory(), "service");
  return {
    directory,
    registryDirectory: join(directory, "plans"),
    tokenPath: join(directory, "token"),
    runtimePath: join(directory, "runtime.json"),
  };
};

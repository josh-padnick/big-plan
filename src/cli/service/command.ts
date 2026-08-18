// Implements `big-plan service <status|start|stop|restart>`: the I/O boundary
// around the local service's lifecycle.
//
// The command surface exists so nobody is ever stuck with a background process
// they cannot name or stop. Every action here is something a person can also
// see in the review document later, and the document will always name the
// command it is equivalent to rather than hiding it.

import { AxiError } from "axi-sdk-js";
import {
  ensureServiceRunning,
  probeService,
  readServiceRuntimeRecord,
  stopService,
} from "../../review/service/lifecycle.js";
import { servicePort } from "../../review/service/paths.js";
import {
  describePortOccupier,
  foreignPortMessage,
} from "../../review/service/port-occupier.js";
import { listServiceRegistryEntries } from "../../review/service/registry.js";

const USAGE = [
  "Usage:",
  "  big-plan service status     Report whether the service is running, and where",
  "  big-plan service start      Start it now, as any link-printing command would",
  "  big-plan service stop       Stop it; the next big-plan command starts it again",
  "  big-plan service restart    Stop, then start",
  "",
  "The service answers saved review links on a fixed loopback port, so a link",
  "still works after the review session behind it ends. It listens on this",
  "machine only and never makes an outbound request.",
].join("\n");

const invalidArguments = (): never => {
  throw new AxiError(USAGE, "INVALID_INPUT", [USAGE]);
};

const reportStatus = async (): Promise<Record<string, unknown>> => {
  const port = servicePort();
  const [probe, record, plans] = await Promise.all([
    probeService({ port }),
    readServiceRuntimeRecord(),
    listServiceRegistryEntries(),
  ]);
  if (probe.kind === "foreign") {
    return {
      service: "unavailable",
      port,
      plans: plans.length,
      occupied_by: (await describePortOccupier({ port })) ?? "unknown",
      help: [
        foreignPortMessage({
          port,
          occupier: await describePortOccupier({ port }),
        }),
        "Then run `big-plan service start`",
      ],
    };
  }
  if (probe.kind === "absent") {
    return {
      service: "stopped",
      port,
      plans: plans.length,
      help: [
        "Nothing is listening; saved review links will not open until it starts",
        "Any big-plan command that prints a link starts it again, or run `big-plan service start`",
      ],
    };
  }
  return {
    service: "running",
    port: probe.health.port,
    version: probe.health.version,
    pid: probe.health.pid,
    started: probe.health.startedAt,
    plans: plans.length,
    managed_by: record?.managedBy ?? "on-demand",
    address: `http://127.0.0.1:${probe.health.port}`,
    help: [
      `Open http://127.0.0.1:${probe.health.port} to see what this process is`,
      "Run `big-plan service stop` to stop it",
    ],
  };
};

const reportStart = async (): Promise<Record<string, unknown>> => {
  const availability = await ensureServiceRunning();
  if (availability.kind === "unavailable") {
    throw new AxiError(availability.reason, "INTERNAL_ERROR", [USAGE]);
  }
  return {
    service: "running",
    port: availability.health.port,
    version: availability.health.version,
    pid: availability.health.pid,
    started: availability.health.startedAt,
    address: `http://127.0.0.1:${availability.health.port}`,
    help: [
      availability.spawned
        ? "The service was not running and has been started"
        : "The service was already running",
      "Saved review links open again from now on",
    ],
  };
};

const reportStop = async (): Promise<Record<string, unknown>> => {
  const port = servicePort();
  const stopped = await stopService({ port });
  return {
    service: "stopped",
    port,
    help: stopped
      ? [
          "Saved review links will not open until the service starts again",
          "Any big-plan command that prints a link starts it again",
        ]
      : ["The service was not running"],
  };
};

/** Runs one `big-plan service` action. */
export const serviceCommand = async (
  args: ReadonlyArray<string>,
): Promise<Record<string, unknown>> => {
  const action = args.length === 0 ? "status" : args[0];
  if (args.length > 1) return invalidArguments();
  switch (action) {
    case "status":
      return reportStatus();
    case "start":
      return reportStart();
    case "stop":
      return reportStop();
    case "restart":
      await stopService();
      return reportStart();
    default:
      return invalidArguments();
  }
};

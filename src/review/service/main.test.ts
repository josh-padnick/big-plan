// Drives the real service process module end to end, because the runtime
// record's lifetime is a property of that module and of nothing smaller: it
// has to exist for as long as the port answers, and never outlive it.

import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureServiceToken,
  readServiceRuntimeRecord,
} from "./lifecycle.js";

let stateDirectory: string;
let previousStateDirectory: string | undefined;
let previousPort: string | undefined;
let port = 0;
let token = "";

// A port the OS just handed back, so the test never touches the fixed one.
const reserveFreePort = async (): Promise<number> => {
  const probe = createServer();
  await new Promise<void>((settle) => {
    probe.listen({ host: "127.0.0.1", port: 0 }, () => settle());
  });
  const address = probe.address();
  const free =
    typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((settle) => probe.close(() => settle()));
  return free;
};

beforeEach(async () => {
  stateDirectory = await mkdtemp(join(tmpdir(), "big-plan-main-"));
  previousStateDirectory = process.env["BIG_PLAN_STATE_DIR"];
  previousPort = process.env["BIG_PLAN_PORT"];
  process.env["BIG_PLAN_STATE_DIR"] = stateDirectory;
  port = await reserveFreePort();
  process.env["BIG_PLAN_PORT"] = String(port);
  token = await ensureServiceToken();
});

afterEach(async () => {
  for (const [name, value] of [
    ["BIG_PLAN_STATE_DIR", previousStateDirectory],
    ["BIG_PLAN_PORT", previousPort],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(stateDirectory, { recursive: true, force: true });
});

describe("the service process", () => {
  it("should keep a record of itself for exactly as long as it answers", async () => {
    // The module starts the service on import and resolves once it is
    // listening; by then nothing may have been able to reach a port that had
    // no record behind it.
    await import("./main.js");

    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
    expect(await readServiceRuntimeRecord()).toMatchObject({
      pid: process.pid,
      port,
      managedBy: "on-demand",
    });

    const stopped = await fetch(`http://127.0.0.1:${port}/stop`, {
      method: "POST",
      headers: { "x-big-plan-service-token": token },
    });
    expect(stopped.status).toBe(200);

    // Nothing is listening any more, so nothing on disk may still say a
    // process is.
    await vi.waitFor(async () => {
      expect(await readServiceRuntimeRecord()).toBe(undefined);
    });
    await expect(fetch(`http://127.0.0.1:${port}/healthz`)).rejects.toThrow();
  });
});

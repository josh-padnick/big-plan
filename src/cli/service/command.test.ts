// Proves the command says only what is true when a stop cannot happen.
//
// The whole service exists so nobody is stuck with a background process they
// cannot name or stop, which makes a refusal that misdescribes the port worse
// than no message at all.

import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AxiError } from "axi-sdk-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serviceCommand } from "./command.js";

let stateDirectory: string;
let previousStateDirectory: string | undefined;
let previousPort: string | undefined;
let listener: Server | undefined;

// Someone else's listener, answering nothing this product would recognise.
const occupyPort = async (): Promise<number> => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("not big plan");
  });
  await new Promise<void>((settle) => {
    server.listen({ host: "127.0.0.1", port: 0 }, () => settle());
  });
  listener = server;
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : 0;
};

beforeEach(async () => {
  stateDirectory = await mkdtemp(join(tmpdir(), "big-plan-command-"));
  previousStateDirectory = process.env["BIG_PLAN_STATE_DIR"];
  previousPort = process.env["BIG_PLAN_PORT"];
  process.env["BIG_PLAN_STATE_DIR"] = stateDirectory;
});

afterEach(async () => {
  if (listener !== undefined) {
    listener.closeAllConnections();
    await new Promise<void>((settle) => listener?.close(() => settle()));
    listener = undefined;
  }
  for (const [name, value] of [
    ["BIG_PLAN_STATE_DIR", previousStateDirectory],
    ["BIG_PLAN_PORT", previousPort],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(stateDirectory, { recursive: true, force: true });
});

describe("`big-plan service stop`", () => {
  it("should say the port is not ours without claiming we still serve it", async () => {
    const port = await occupyPort();
    process.env["BIG_PLAN_PORT"] = String(port);

    const failure = await serviceCommand(["stop"]).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AxiError);
    const suggestions = (failure as AxiError).suggestions.join("\n");
    expect(suggestions).toContain(String(port));
    expect(suggestions).toContain("BIG_PLAN_PORT");
    // Nothing of ours is listening there, so saying otherwise would be the
    // same false claim a silent "stopped" used to make.
    expect(suggestions).not.toContain("still serving saved review links");
  });

  it("should report that nothing was running rather than a stop it performed", async () => {
    // Port 1 is reserved and nothing serves it.
    process.env["BIG_PLAN_PORT"] = "1";
    expect(await serviceCommand(["stop"])).toEqual({
      service: "stopped",
      port: 1,
      help: ["The service was not running"],
    });
  });
});

// Proves the two rules that decide whether a port is ours to use: only a
// listener that identifies as this product is ever adopted, and the token two
// racing commands mint is the same token.

import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureServiceToken,
  probeService,
  readServiceToken,
} from "./lifecycle.js";
import { servicePaths } from "./paths.js";

let stateDirectory: string;
let previousStateDirectory: string | undefined;
let listener: Server | undefined;

const listenWith = async (
  handler: (path: string) => { readonly status: number; readonly body: string },
): Promise<number> => {
  const server = createServer((request, response) => {
    const answer = handler(request.url ?? "/");
    response.writeHead(answer.status, {
      "content-type": "application/json; charset=utf-8",
    });
    response.end(answer.body);
  });
  await new Promise<void>((settle) => {
    server.listen({ host: "127.0.0.1", port: 0 }, () => settle());
  });
  listener = server;
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : 0;
};

beforeEach(async () => {
  stateDirectory = await mkdtemp(join(tmpdir(), "big-plan-lifecycle-"));
  previousStateDirectory = process.env["BIG_PLAN_STATE_DIR"];
  process.env["BIG_PLAN_STATE_DIR"] = stateDirectory;
});

afterEach(async () => {
  if (listener !== undefined) {
    await new Promise<void>((settle) => listener?.close(() => settle()));
    listener = undefined;
  }
  if (previousStateDirectory === undefined) {
    delete process.env["BIG_PLAN_STATE_DIR"];
  } else {
    process.env["BIG_PLAN_STATE_DIR"] = previousStateDirectory;
  }
  await rm(stateDirectory, { recursive: true, force: true });
});

describe("probing the port", () => {
  it("should report nothing listening as absent", async () => {
    // Port 1 is reserved and nothing serves it, so this exercises the refused
    // connection rather than a slow one.
    expect((await probeService({ port: 1 })).kind).toBe("absent");
  });

  it("should adopt only a listener that identifies as this product", async () => {
    const port = await listenWith(() => ({
      status: 200,
      body: JSON.stringify({
        product: "big-plan-service",
        version: "1.2.3",
        pid: 4242,
        port: 8790,
        startedAt: "2026-08-17T12:00:00.000Z",
      }),
    }));
    const probe = await probeService({ port });
    expect(probe.kind).toBe("running");
    expect(probe.kind === "running" && probe.health.version).toBe("1.2.3");
  });

  it("should treat a stranger's listener as foreign, never as ours", async () => {
    // Adopting this would send every saved review link into someone else's
    // process, so anything that is not exactly our health record is foreign.
    for (const body of [
      "not json at all",
      JSON.stringify({ product: "something-else" }),
      JSON.stringify({ product: "big-plan-service" }),
      JSON.stringify({
        product: "big-plan-service",
        version: "",
        pid: 1,
        port: 1,
        startedAt: "2026-08-17T12:00:00.000Z",
      }),
    ]) {
      const port = await listenWith(() => ({ status: 200, body }));
      expect((await probeService({ port })).kind).toBe("foreign");
      await new Promise<void>((settle) => listener?.close(() => settle()));
      listener = undefined;
    }
  });

  it("should treat an error response as foreign", async () => {
    const port = await listenWith(() => ({ status: 500, body: "{}" }));
    expect((await probeService({ port })).kind).toBe("foreign");
  });
});

describe("the service token", () => {
  it("should mint one token and reuse it", async () => {
    const first = await ensureServiceToken();
    expect(first).not.toBe("");
    expect(await ensureServiceToken()).toBe(first);
    expect(await readServiceToken()).toBe(first);
  });

  it("should give every racing command the same token", async () => {
    // Minting through a plain write would leave two processes holding
    // different secrets, and the later one would lock the earlier out of its
    // own service.
    const minted = await Promise.all(
      Array.from({ length: 8 }, async () => ensureServiceToken()),
    );
    expect(new Set(minted).size).toBe(1);
    expect(await readServiceToken()).toBe(minted[0]);
  });

  it("should report no token before one is minted", async () => {
    expect(await readServiceToken()).toBe(undefined);
  });

  it("should ignore an empty token file rather than trusting it", async () => {
    await ensureServiceToken();
    await writeFile(servicePaths().tokenPath, "\n", "utf8");
    expect(await readServiceToken()).toBe(undefined);
  });
});

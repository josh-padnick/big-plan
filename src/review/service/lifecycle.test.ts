// Proves the two rules that decide whether a port is ours to use: only a
// listener that identifies as this product is ever adopted, and the token two
// racing commands mint is the same token.

import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearServiceRuntimeRecord,
  ensureServiceRunning,
  ensureServiceToken,
  probeService,
  readServiceRuntimeRecord,
  readServiceToken,
  stopService,
  writeServiceRuntimeRecord,
} from "./lifecycle.js";
import { servicePaths } from "./paths.js";
import { foreignPortMessage } from "./port-occupier.js";

let stateDirectory: string;
let previousStateDirectory: string | undefined;
let listener: Server | undefined;

const listenWith = async (
  handler: (path: string) => {
    readonly status: number;
    readonly body: string;
    readonly headers?: Readonly<Record<string, string>>;
  },
): Promise<number> => {
  const server = createServer((request, response) => {
    const answer = handler(request.url ?? "/");
    response.writeHead(answer.status, {
      "content-type": "application/json; charset=utf-8",
      ...answer.headers,
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

// A listener that identifies as this product, so `stopService` gets past the
// probe and reaches the outcome under test.
const listenAsService = async ({
  stop,
}: {
  readonly stop: "accept" | "refuse";
}): Promise<number> => {
  const server = createServer((request, response) => {
    const address = server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    if (request.method === "POST" && request.url === "/stop") {
      if (stop === "refuse") {
        response.writeHead(403, { "content-type": "text/plain" });
        response.end("refused");
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"stopping":true}');
      response.on("finish", () => {
        server.closeAllConnections();
        server.close();
      });
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        product: "big-plan-service",
        version: "1.2.3",
        pid: process.pid,
        port,
        startedAt: "2026-08-17T12:00:00.000Z",
      }),
    );
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

  it("should never follow a redirect off the socket it connected to", async () => {
    // A listener holding the port could otherwise point the probe at any host
    // in the world, have it return a valid health record, and be adopted as
    // our service - which is what "never adopted" has to rule out.
    const port = await listenWith(() => ({
      status: 302,
      body: "",
      headers: { location: "https://plans.evil.example/healthz" },
    }));
    expect((await probeService({ port })).kind).toBe("foreign");
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

describe("starting when the token cannot be minted", () => {
  it("should report why rather than throwing at the caller", async () => {
    // A directory where the token file belongs: unreadable and unwritable
    // without touching permissions, which is the shape of a state directory
    // another user owns. The command asking for a link still has the
    // session's own address to print, so this must come back as a reason.
    await mkdir(servicePaths().tokenPath, { recursive: true });

    // Port 1 is reserved and nothing serves it, so a start is attempted.
    const availability = await ensureServiceRunning({ port: 1 });

    expect(availability.kind).toBe("unavailable");
    expect(
      availability.kind === "unavailable" && availability.reason,
    ).toContain(servicePaths().tokenPath);
  });
});

describe("the message when the port is not ours", () => {
  it("should name the occupier and the override, and promise no port hunting", () => {
    const message = foreignPortMessage({
      port: 8790,
      occupier: "nginx (process 501)",
    });
    expect(message).toContain("8790");
    expect(message).toContain("nginx (process 501)");
    expect(message).toContain("BIG_PLAN_PORT");
    expect(message).toContain("never moves to a different port");
  });

  it("should stay useful when the occupier cannot be identified", () => {
    const message = foreignPortMessage({ port: 8790, occupier: undefined });
    expect(message).toContain("8790");
    expect(message).toContain("BIG_PLAN_PORT");
  });
});

describe("stopping the service", () => {
  it("should report that nothing was running rather than a stop it performed", async () => {
    // Port 1 is reserved and nothing serves it.
    expect((await stopService({ port: 1 })).kind).toBe("absent");
  });

  it("should stop a service whose token has gone missing from disk", async () => {
    // The service reads its token per request precisely so a re-minted one is
    // accepted; without minting here, deleting the token file would leave the
    // operator unable to stop their own process.
    expect(await readServiceToken()).toBe(undefined);
    const port = await listenAsService({ stop: "accept" });

    expect((await stopService({ port })).kind).toBe("stopped");
    expect((await probeService({ port })).kind).toBe("absent");
    expect(await readServiceToken()).not.toBe(undefined);
  });

  it("should refuse to report a stop the service would not perform", async () => {
    const port = await listenAsService({ stop: "refuse" });

    const outcome = await stopService({ port });
    expect(outcome.kind).toBe("refused");
    expect(outcome.kind === "refused" && outcome.reason).toContain(
      String(port),
    );
    // And the honest part: it is still there, serving saved review links.
    expect((await probeService({ port })).kind).toBe("running");
  });
});

describe("the runtime record", () => {
  it("should let the process it describes clear it", async () => {
    await writeServiceRuntimeRecord({
      pid: 4812,
      port: 8790,
      startedAt: new Date(0).toISOString(),
      managedBy: "on-demand",
    });

    await clearServiceRuntimeRecord({ pid: 4812 });

    expect(await readServiceRuntimeRecord()).toBe(undefined);
  });

  it("should keep the listening process's record when another start exits", async () => {
    // Two starts race for the fixed port. The loser exits on EADDRINUSE while
    // the winner keeps answering, and it must not take the winner's record
    // with it: every reader would then describe a live process from a default.
    await writeServiceRuntimeRecord({
      pid: 4812,
      port: 8790,
      startedAt: new Date(0).toISOString(),
      managedBy: "login-item",
    });

    await clearServiceRuntimeRecord({ pid: 5199 });

    expect(await readServiceRuntimeRecord()).toMatchObject({
      pid: 4812,
      managedBy: "login-item",
    });
  });
});

// Exercises the review command's public argument boundary before any review
// runtime can start listening, and the answer it gives a reviewer whose plan is
// already being served by a live runtime.

import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordGuidanceAcknowledgment } from "../_shared/guidance-gate.js";
import { startReviewRuntime } from "../../review/server.js";
import { servicePaths } from "../../review/service/paths.js";
import { serviceVersion } from "../../review/service/version.js";
import { reviewCommand } from "./command.js";

const INVALID_IDLE_TIMEOUT_MESSAGE =
  "--idle-timeout must be 0 to disable it, or at least 1 minute";

const PLAN = `# Custody plan

The runtime serves this document and nothing else.

## Status quo

Today's reality is that a second review command takes the review away.
`;

let tempDirectory = "";
let stub: Server | undefined;
let stubPort = 0;
let stubIdentity: string | undefined;
let previousPort: string | undefined;
let previousStateDirectory: string | undefined;

// Every test runs against this listener, on a port the OS handed out, because
// a link-printing path that fell through to the real fixed port would probe a
// machine-wide address and spawn a detached process. Unidentified it reads as
// a stranger holding the port, which is the outcome that needs no spawn;
// `identifyAsService` turns it into a service the lifecycle will adopt.
const startStubOccupier = async (): Promise<void> => {
  const created = createServer((request, response) => {
    if (stubIdentity === undefined) {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("not big plan");
      return;
    }
    response.writeHead(request.url === "/healthz" ? 200 : 404, {
      "content-type": "application/json; charset=utf-8",
    });
    response.end(
      JSON.stringify({
        product: "big-plan-service",
        version: stubIdentity,
        pid: process.pid,
        port: stubPort,
        startedAt: "2026-08-17T12:00:00.000Z",
      }),
    );
  });
  await new Promise<void>((settle) => {
    created.listen({ host: "127.0.0.1", port: 0 }, () => settle());
  });
  stub = created;
  const address = created.address();
  stubPort = typeof address === "object" && address !== null ? address.port : 0;
  process.env["BIG_PLAN_PORT"] = String(stubPort);
};

const identifyAsService = (version: string): void => {
  stubIdentity = version;
};

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "big-plan-review-command-"));
  previousStateDirectory = process.env["BIG_PLAN_STATE_DIR"];
  previousPort = process.env["BIG_PLAN_PORT"];
  process.env["BIG_PLAN_STATE_DIR"] = join(tempDirectory, "state");
  stubIdentity = undefined;
  await startStubOccupier();
  await recordGuidanceAcknowledgment();
});

const stopStub = async (): Promise<void> => {
  if (stub === undefined) return;
  stub.closeAllConnections();
  const closing = stub;
  stub = undefined;
  await new Promise<void>((settle) => closing.close(() => settle()));
};

afterEach(async () => {
  await stopStub();
  for (const [name, value] of [
    ["BIG_PLAN_STATE_DIR", previousStateDirectory],
    ["BIG_PLAN_PORT", previousPort],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(tempDirectory, { recursive: true, force: true });
});

describe("reviewCommand", () => {
  it.each(["0.5", "0.01"])(
    "should reject the nonzero sub-minute idle timeout %s",
    async (idleMinutes) => {
      await expect(
        reviewCommand(["missing.mdx", "--idle-timeout", idleMinutes]),
      ).rejects.toMatchObject({
        code: "INVALID_INPUT",
        message: INVALID_IDLE_TIMEOUT_MESSAGE,
      });
    },
  );

  it.each(["0", "1"])(
    "should accept the idle timeout boundary %s before reading the input",
    async (idleMinutes) => {
      const missingInput = join(tempDirectory, "missing.mdx");
      await expect(
        reviewCommand([missingInput, "--idle-timeout", idleMinutes]),
      ).rejects.toMatchObject({
        code: "INPUT_NOT_FOUND",
        message: expect.stringContaining(missingInput),
      });
    },
  );

  it("should accept --takeover as an option rather than a second plan", async () => {
    const missingInput = join(tempDirectory, "missing.mdx");
    await expect(
      reviewCommand([missingInput, "--takeover"]),
    ).rejects.toMatchObject({
      code: "INPUT_NOT_FOUND",
      message: expect.stringContaining(missingInput),
    });
  });

  it("should report the live runtime's address instead of taking custody", async () => {
    const planPath = join(tempDirectory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const live = await startReviewRuntime({ planPath });
    try {
      const result = await reviewCommand([planPath]);

      expect(result).toMatchObject({
        custody: "held",
        review: live.url,
        plan: live.planPath,
        session: live.sessionId,
      });
      const help = result["help"];
      expect(help).toEqual(
        expect.arrayContaining([
          expect.stringContaining(`already serves this plan at ${live.url}`),
          expect.stringContaining("--takeover"),
        ]),
      );
      // The live session must still be the one holding the plan.
      await expect(
        fetch(live.url).then((response) => response.status),
      ).resolves.toBe(200);
    } finally {
      await live.close();
    }
  });

  it("should hand over the durable address for a plan another session holds", async () => {
    // This branch prints an address belonging to a session the reader does not
    // control, so it is the one that most needs the link that outlives it.
    identifyAsService(await serviceVersion());
    const planPath = join(tempDirectory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const live = await startReviewRuntime({ planPath });
    try {
      const result = await reviewCommand([planPath]);

      const stable = `http://127.0.0.1:${stubPort}/plan/${live.planId}`;
      expect(result).toMatchObject({
        custody: "held",
        review: stable,
        direct: live.url,
      });
      expect(result["link"]).toBe(undefined);
      expect(result["help"]).toEqual(
        expect.arrayContaining([
          expect.stringContaining(`Open ${stable}`),
          expect.stringContaining(`Direct runtime address: ${live.url}`),
          expect.stringContaining("read-only until each reloads"),
        ]),
      );
    } finally {
      await live.close();
    }
  });

  it("should still report held custody when the service token is unusable", async () => {
    // A directory where the token file belongs: the state directory is fine
    // for everything else, and a token nobody can mint must cost the reader
    // the durable link and nothing more.
    await stopStub();
    await mkdir(servicePaths().tokenPath, { recursive: true });
    const planPath = join(tempDirectory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const live = await startReviewRuntime({ planPath });
    try {
      const result = await reviewCommand([planPath]);

      expect(result).toMatchObject({ custody: "held", review: live.url });
      expect(result["link"]).toBe(undefined);
      expect(result["help"]).toEqual(
        expect.arrayContaining([
          expect.stringContaining(servicePaths().tokenPath),
        ]),
      );
    } finally {
      await live.close();
    }
  });

  it("should still report held custody when no durable address can be published", async () => {
    // A stranger on the port is the case the service refuses to work around,
    // so the command degrades to today's behaviour and says why.
    identifyAsService("not-this-build");
    const planPath = join(tempDirectory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const live = await startReviewRuntime({ planPath });
    try {
      const result = await reviewCommand([planPath]);

      expect(result).toMatchObject({ custody: "held", review: live.url });
      expect(result["link"]).toBe(undefined);
      expect(result["help"]).toEqual(
        expect.arrayContaining([expect.stringContaining("could not be")]),
      );
    } finally {
      await live.close();
    }
  });
});

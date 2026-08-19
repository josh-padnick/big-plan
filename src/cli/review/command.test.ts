// Exercises the review command's public argument boundary before any review
// runtime can start listening, and the answer it gives a reviewer whose plan is
// already being served by a live runtime.

import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordGuidanceAcknowledgment } from "../_shared/guidance-gate.js";
import { startReviewRuntime } from "../../review/server.js";
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
let servicePort: Server | undefined;

// Stands in for the link service on the port the CLI will look at, answering
// the one record the lifecycle adopts. Nothing is spawned, and no real fixed
// port is touched.
const listenAsService = async ({
  version,
}: {
  readonly version: string;
}): Promise<number> => {
  const created = createServer((request, response) => {
    const address = created.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    response.writeHead(request.url === "/healthz" ? 200 : 404, {
      "content-type": "application/json; charset=utf-8",
    });
    response.end(
      JSON.stringify({
        product: "big-plan-service",
        version,
        pid: process.pid,
        port,
        startedAt: "2026-08-17T12:00:00.000Z",
      }),
    );
  });
  await new Promise<void>((settle) => {
    created.listen({ host: "127.0.0.1", port: 0 }, () => settle());
  });
  servicePort = created;
  const address = created.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  process.env["BIG_PLAN_PORT"] = String(port);
  return port;
};

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "big-plan-review-command-"));
  process.env["BIG_PLAN_STATE_DIR"] = join(tempDirectory, "state");
  await recordGuidanceAcknowledgment();
});

afterEach(async () => {
  if (servicePort !== undefined) {
    servicePort.closeAllConnections();
    await new Promise<void>((settle) => servicePort?.close(() => settle()));
    servicePort = undefined;
  }
  delete process.env["BIG_PLAN_PORT"];
  delete process.env["BIG_PLAN_STATE_DIR"];
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
    const port = await listenAsService({ version: await serviceVersion() });
    const planPath = join(tempDirectory, "plan.mdx");
    await writeFile(planPath, PLAN);
    const live = await startReviewRuntime({ planPath });
    try {
      const result = await reviewCommand([planPath]);

      const stable = `http://127.0.0.1:${port}/plan/${live.planId}`;
      expect(result).toMatchObject({ custody: "held", link: stable });
      expect(result["help"]).toEqual(
        expect.arrayContaining([expect.stringContaining(stable)]),
      );
    } finally {
      await live.close();
    }
  });

  it("should still report held custody when no durable address can be published", async () => {
    // A stranger on the port is the case the service refuses to work around,
    // so the command degrades to today's behaviour and says why.
    await listenAsService({ version: "not-this-build" });
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

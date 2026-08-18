// The BIG-156 diagnosis reproduction, made permanent.
//
// Every other rule in this change is pure and tested as such. This one fact is
// not: that a real `agent next --wait` process notices its real spawner dying,
// reports the end, and never claims work afterwards. Nothing short of a
// process tree can prove it, because the bug is entirely about which processes
// outlive which. Before the fix, the orphaned loop kept heartbeating forever
// and claimed the next request within a second of the reviewer sending it.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deriveSnapshotDigest,
  messageAgentRequest,
  readAgentExchange,
  writeAgentRequest,
} from "./agent-exchange.js";
import { startReviewRuntime } from "./server.js";
import type { ReviewRuntime } from "./server.js";
import { readAgentPresence } from "./store.js";

// The observed-end path is bounded by one wait iteration plus a file write.
// Anything approaching this budget means the loop is no longer checking its
// spawner on every iteration.
//
// It bounds what is asserted, never what is waited for. A loaded machine that
// takes longer has to fail with the time it actually took, because "timed out
// after 2000ms" cannot tell a lost regression apart from a busy runner.
const EXIT_BUDGET_MS = 2_000;

const CONNECT_TIMEOUT_MS = 20_000;

// Spawns `agent next --wait` from a throwaway parent and reports its pid, so
// the test can kill the spawner alone and leave the loop running - which is
// exactly what a coding-agent harness dying does.
const HARNESS_SCRIPT = `
const { spawn } = require("node:child_process");
const child = spawn(
  process.execPath,
  [process.env.BIG_PLAN_BIN, "agent", "next", process.env.BIG_PLAN_PLAN, "--wait"],
  { stdio: "ignore" },
);
process.stdout.write(String(child.pid) + "\\n");
setInterval(() => undefined, 1_000);
`;

let runtime: ReviewRuntime;
let directory = "";
let planPath = "";
let source = "";

const binPath = fileURLToPath(
  new URL("../../bin/big-plan.mjs", import.meta.url),
);

const until = async ({
  condition,
  timeoutMs,
  describe: label,
}: {
  readonly condition: () => Promise<boolean>;
  readonly timeoutMs: number;
  readonly describe: string;
}): Promise<number> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (await condition()) return Date.now() - startedAt;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "big-plan-orphan-"));
  source = await readFile(
    fileURLToPath(new URL("../../examples/sample.mdx", import.meta.url)),
    "utf8",
  );
  planPath = join(directory, "plan.mdx");
  await writeFile(planPath, source);
  runtime = await startReviewRuntime({ planPath });
});

afterAll(async () => {
  if (runtime !== undefined) await runtime.close();
  if (directory !== "") await rm(directory, { recursive: true, force: true });
});

describe("an agent loop whose spawner dies", () => {
  it("reports the end, exits, and never claims the next request", async () => {
    const harness = spawn(process.execPath, ["-e", HARNESS_SCRIPT], {
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, BIG_PLAN_BIN: binPath, BIG_PLAN_PLAN: planPath },
    });
    let harnessOutput = "";
    harness.stdout.on("data", (chunk: Buffer) => {
      harnessOutput += chunk.toString("utf8");
    });
    let loopPid = 0;
    try {
      await until({
        condition: async () => {
          const reported = Number.parseInt(harnessOutput.trim(), 10);
          if (!Number.isInteger(reported) || reported <= 0) return false;
          loopPid = reported;
          return true;
        },
        timeoutMs: CONNECT_TIMEOUT_MS,
        describe: "the harness to report its child's pid",
      });

      // The loop is provably attached: the card would read connected here.
      await until({
        condition: async () =>
          (
            await readAgentPresence({
              store: runtime.store,
              sessionId: runtime.sessionId,
            })
          ).connected,
        timeoutMs: CONNECT_TIMEOUT_MS,
        describe: "the agent loop to report presence",
      });

      // The harness dies. The loop does not, and on current main it goes on
      // heartbeating for its dead agent indefinitely.
      harness.kill("SIGKILL");

      // Sent while the corpse would still have been holding presence. This is
      // the reviewer's message in the diagnosis, which the orphan claimed
      // 293ms after the agent that would have answered it was already dead.
      await writeAgentRequest({
        store: runtime.store,
        request: messageAgentRequest({
          kind: "chat",
          requestId: "c".repeat(16),
          sessionId: runtime.sessionId,
          planId: runtime.planId,
          premiseSnapshot: deriveSnapshotDigest(source),
          createdAt: "2026-08-18T12:00:00.000Z",
          body: "Does this plan still hold?",
        }),
      });

      const endedAfterMs = await until({
        condition: async () =>
          (
            await readAgentPresence({
              store: runtime.store,
              sessionId: runtime.sessionId,
            })
          ).endedAtMs !== undefined,
        timeoutMs: CONNECT_TIMEOUT_MS,
        describe: "the loop to report its session ending",
      });
      expect(endedAfterMs).toBeLessThanOrEqual(EXIT_BUDGET_MS);

      const presence = await readAgentPresence({
        store: runtime.store,
        sessionId: runtime.sessionId,
      });
      expect(presence.connected).toBe(false);

      const exitedAfterMs = await until({
        condition: async () => !processIsAlive(loopPid),
        timeoutMs: CONNECT_TIMEOUT_MS,
        describe: "the agent loop process to exit",
      });
      expect(exitedAfterMs).toBeLessThanOrEqual(EXIT_BUDGET_MS);

      // The whole point: a dead agent's request stays available for a live one
      // instead of being taken to a pipe with no reader.
      const exchange = await readAgentExchange({
        store: runtime.store,
        sessionId: runtime.sessionId,
        planId: runtime.planId,
      });
      const message = exchange.requests.find(
        (request) => request.requestId === "c".repeat(16),
      );
      expect(message).toBeDefined();
      expect(message?.claimedBy).toBeUndefined();
      expect(message?.claimedAt).toBeUndefined();
    } finally {
      harness.kill("SIGKILL");
      if (loopPid > 0 && processIsAlive(loopPid))
        process.kill(loopPid, "SIGKILL");
    }
  }, 40_000);
});

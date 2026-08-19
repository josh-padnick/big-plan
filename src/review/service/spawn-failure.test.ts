// Proves the promise the lazy-spawn path makes: a command that cannot start
// the service still returns, so the caller can fall back to the session's own
// address. A fork that never happens is reported through the child's `error`
// event rather than by throwing, and an `error` nobody listens for is
// re-thrown as an uncaught exception that would take the command with it.

import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  // A machine out of processes or descriptors, or one whose node binary is
  // not executable: spawn returns a child that only ever emits `error`.
  spawn: () => {
    const child = new EventEmitter() as EventEmitter & {
      readonly unref: () => void;
    };
    Object.assign(child, { unref: () => {} });
    setTimeout(() => child.emit("error", new Error("spawn EACCES")), 0);
    return child;
  },
  execFile: (
    _command: string,
    _args: ReadonlyArray<string>,
    _options: unknown,
    done: (error: Error | null, stdout: string) => void,
  ) => done(new Error("no occupier lookup in this test"), ""),
}));

const { ensureServiceRunning } = await import("./lifecycle.js");

let stateDirectory: string;
let previousStateDirectory: string | undefined;

beforeEach(async () => {
  stateDirectory = await mkdtemp(join(tmpdir(), "big-plan-spawn-"));
  previousStateDirectory = process.env["BIG_PLAN_STATE_DIR"];
  process.env["BIG_PLAN_STATE_DIR"] = stateDirectory;
});

afterEach(async () => {
  if (previousStateDirectory === undefined) {
    delete process.env["BIG_PLAN_STATE_DIR"];
  } else {
    process.env["BIG_PLAN_STATE_DIR"] = previousStateDirectory;
  }
  await rm(stateDirectory, { recursive: true, force: true });
});

describe("a service that could not be spawned", () => {
  it("should report why instead of crashing the command that asked", async () => {
    // Port 1 is reserved and nothing serves it, so the spawn is reached.
    const availability = await ensureServiceRunning({ port: 1 });

    expect(availability.kind).toBe("unavailable");
    expect(
      availability.kind === "unavailable" && availability.reason,
    ).toContain("spawn EACCES");
  });
});

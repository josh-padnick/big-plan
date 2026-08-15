// Exercises the review command's public idle-timeout argument boundary before
// any review runtime can start listening.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordGuidanceAcknowledgment } from "../_shared/guidance-gate.js";
import { reviewCommand } from "./command.js";

const INVALID_IDLE_TIMEOUT_MESSAGE =
  "--idle-timeout must be 0 to disable it, or at least 1 minute";

let tempDirectory = "";

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "big-plan-review-command-"));
  process.env["BIG_PLAN_STATE_DIR"] = join(tempDirectory, "state");
  await recordGuidanceAcknowledgment();
});

afterEach(async () => {
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
});

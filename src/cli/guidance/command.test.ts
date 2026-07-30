// Exercises the guidance command's surface: guidance output, unlocking of
// validate through the recorded acknowledgment, and the degraded messaging
// when no state directory accepts writes. Gate policy such as expiry lives
// with the gate in ../_shared/guidance-gate.test.ts.

import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateCommand } from "../validate/command.js";
import { guidanceCommand } from "./command.js";

let tempDirectory = "";
let stateDirectory = "";

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "big-plan-guidance-"));
  stateDirectory = join(tempDirectory, "state");
  process.env["BIG_PLAN_STATE_DIR"] = stateDirectory;
});

afterEach(async () => {
  delete process.env["BIG_PLAN_STATE_DIR"];
  await rm(tempDirectory, { recursive: true, force: true });
});

describe("guidanceCommand", () => {
  it("should print the principles and record the acknowledgment", async () => {
    const output = await guidanceCommand([]);

    expect(output).toContain("# How to write a plan a human loves to review");
    expect(output).toContain("quick summary");
    expect(await readdir(stateDirectory)).toHaveLength(1);
  });

  it("should reject a second argument", async () => {
    await expect(
      guidanceCommand(["QuickSummary", "extra"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: 'Unexpected extra argument "extra"',
      suggestions: ["Usage: big-plan guidance [component]"],
    });
  });

  it("should print one component's usage guidance without touching the gate", async () => {
    const output = await guidanceCommand(["QuickSummary"]);

    expect(output).toContain("# Using QuickSummary well");
    // Component guidance is reference material; only the full principles run
    // records an acknowledgment.
    await expect(validateCommand(["plan.mdx"])).rejects.toMatchObject({
      code: "GUIDANCE_REQUIRED",
    });
  });

  it("should list the known components when the component is unknown", async () => {
    await expect(guidanceCommand(["Unknown"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: 'Unknown component "Unknown"',
      suggestions: [
        expect.stringContaining("QuickSummary"),
        "Usage: big-plan guidance [component]",
      ],
    });
  });

  it("should keep validate locked until guidance has been read", async () => {
    const inputPath = join(tempDirectory, "plan.mdx");
    await writeFile(inputPath, "# Plan\n\nLede.\n\n## Scope\n\nOne.\n", "utf8");

    await expect(validateCommand([inputPath])).rejects.toMatchObject({
      code: "GUIDANCE_REQUIRED",
      message: "Read the plan-writing guidance before working on a plan",
    });

    await guidanceCommand([]);
    await expect(validateCommand([inputPath])).resolves.toMatchObject({
      title: "Plan",
    });
  });

  it("should warn instead of locking when no state directory is writable", async () => {
    const blockerPath = join(tempDirectory, "blocker");
    await writeFile(blockerPath, "", "utf8");
    // A directory path nested under a plain file can never be created, so
    // every state write fails and the gate degrades to a warning.
    process.env["BIG_PLAN_STATE_DIR"] = join(blockerPath, "state");
    const inputPath = join(tempDirectory, "plan.mdx");
    await writeFile(inputPath, "# Plan\n\nLede.\n\n## Scope\n\nOne.\n", "utf8");

    const output = await guidanceCommand([]);
    expect(output).toContain("could not be saved");

    await expect(validateCommand([inputPath])).resolves.toMatchObject({
      title: "Plan",
      help: expect.arrayContaining([
        expect.stringContaining(
          "Guidance acknowledgment could not be verified",
        ),
      ]),
    });
  });
});

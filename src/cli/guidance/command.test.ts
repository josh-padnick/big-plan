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

// Every command whose call site invokes requireGuidanceAcknowledgment.
const GATED_COMMANDS = ["validate", "render", "review"] as const;

// The command appends its acknowledgment note after the principles, so the
// last non-empty line is the note and nothing else.
const closingNote = (output: string): string =>
  output.trimEnd().split("\n").at(-1) ?? "";

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
    expect(output).toContain(
      "supported static sequence, class, state, entity-relationship, schedule, journey, pie, mindmap, timeline, and git views",
    );
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

  it("should print the complete slide catalog in one guidance call", async () => {
    const output = await guidanceCommand(["Slide"]);

    expect(output).toContain("# Using Slide well");
    expect(output).toContain("### Status quo (`status-quo`)");
    expect(output).toContain("### Desired experience (`desired-experience`)");
    expect(output).toContain("### Desired outcome (`desired-outcome`)");
    expect(output).toContain("### User journeys (`user-journey`)");
    expect(output).toContain(
      "distinct `name` for its kicker and sidebar plus an ultra-concise `toc` form",
    );
    expect(output).toContain(
      "`Wireframe` — Default: draw the shortest CLEAR-compliant sequence",
    );
    expect(output).toContain("### Acceptance criteria (`acceptance-criteria`)");
    expect(output).toContain("Components that pair well");
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

  it("should name every gated command in the acknowledgment note", async () => {
    // The note is the only place a reader learns what reading guidance bought
    // them, so it has to name the same commands the gate actually guards.
    // Assert against the note alone; the principles above it mention commands
    // too, and matching those would let the note drift unnoticed.
    for (const command of GATED_COMMANDS) {
      expect(closingNote(await guidanceCommand([]))).toContain(
        `\`big-plan ${command}\``,
      );
    }
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

    const note = closingNote(await guidanceCommand([]));
    expect(note).toContain("could not be saved");
    // The degraded note has to describe the same command set as the unlocked
    // one, or a reader learns the gate covers less than it does.
    for (const command of GATED_COMMANDS) {
      expect(note).toContain(command);
    }

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

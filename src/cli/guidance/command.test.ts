// Exercises the guidance command and its acknowledgment gate: guidance output,
// per-directory unlocking of validate and render, expiry, and the requirement
// that the shipped template itself passes validation.

import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateCommand } from "../validate/command.js";
import { guidanceCommand } from "./command.js";
import { GUIDANCE_VERSION, TEMPLATE_MDX } from "./content.generated.js";

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

// Rewrites the single acknowledgment marker, so tests can age or corrupt it.
const overwriteMarker = async (content: string): Promise<void> => {
  const [markerName] = await readdir(stateDirectory);
  if (markerName === undefined) {
    throw new Error("expected an acknowledgment marker to exist");
  }
  await writeFile(join(stateDirectory, markerName), content, "utf8");
};

describe("guidanceCommand", () => {
  it("should print the principles and the template and record the acknowledgment", async () => {
    const output = await guidanceCommand([]);

    expect(output).toContain("# How to write a plan a human loves to review");
    expect(output).toContain("## Start from this template");
    expect(output).toContain("## Acceptance criteria");
    expect(await readdir(stateDirectory)).toHaveLength(1);
  });

  it("should reject any argument", async () => {
    await expect(guidanceCommand(["plan.mdx"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: 'Unexpected extra argument "plan.mdx"',
      suggestions: ["Usage: big-plan guidance"],
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

  it("should expire an acknowledgment older than 24 hours", async () => {
    await guidanceCommand([]);
    await overwriteMarker(
      JSON.stringify({
        version: GUIDANCE_VERSION,
        acknowledgedAtMs: Date.now() - 25 * 60 * 60 * 1000,
      }),
    );

    await expect(validateCommand(["plan.mdx"])).rejects.toMatchObject({
      code: "GUIDANCE_REQUIRED",
    });
  });

  it("should expire an acknowledgment recorded for different guidance content", async () => {
    await guidanceCommand([]);
    await overwriteMarker(
      JSON.stringify({ version: "stale", acknowledgedAtMs: Date.now() }),
    );

    await expect(validateCommand(["plan.mdx"])).rejects.toMatchObject({
      code: "GUIDANCE_REQUIRED",
    });
  });

  it("should treat a corrupt marker as no acknowledgment", async () => {
    await guidanceCommand([]);
    await overwriteMarker("not json");

    await expect(validateCommand(["plan.mdx"])).rejects.toMatchObject({
      code: "GUIDANCE_REQUIRED",
    });
  });

  it("should ship a template that passes validation and authoring lint", async () => {
    await guidanceCommand([]);
    const templatePath = join(tempDirectory, "template.mdx");
    await writeFile(templatePath, TEMPLATE_MDX, "utf8");

    await expect(validateCommand([templatePath])).resolves.toMatchObject({
      validated: templatePath,
    });
  });
});

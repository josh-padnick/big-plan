// Exercises only the render command's HTML-specific derivation, result,
// invalid-document message, and lint enforcement; shared CLI lifecycle policy
// has its own tests.

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordGuidanceAcknowledgment } from "../_shared/guidance-gate.js";
import { renderCommand } from "./command.js";

let tempDirectory = "";

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "big-plan-render-"));
  process.env["BIG_PLAN_STATE_DIR"] = join(tempDirectory, "state");
  await recordGuidanceAcknowledgment();
});

afterEach(async () => {
  delete process.env["BIG_PLAN_STATE_DIR"];
  await rm(tempDirectory, { recursive: true, force: true });
});

describe("renderCommand", () => {
  it("should report every diagnostic with the render-specific message", async () => {
    const inputPath = join(tempDirectory, "invalid.mdx");
    await writeFile(
      inputPath,
      "<Unknown first={value} />\n\nCopy {value}\n",
      "utf8",
    );

    await expect(renderCommand([inputPath])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Cannot render document with invalid MDX",
      suggestions: [
        '1:1 Unknown component "Unknown"',
        '1:10 Expression-valued attribute "first" is not supported',
        "3:6 Text expressions are not supported",
      ],
    });
  });

  it("should write HTML and report its review facts", async () => {
    const inputPath = join(tempDirectory, "plan.md");
    const outputPath = join(tempDirectory, "plan.html");
    await writeFile(
      inputPath,
      "# Adapter plan\n\nOne lede sentence.\n\n## Rollout\n",
      "utf8",
    );

    const result = await renderCommand([inputPath]);

    expect(result).toEqual({
      rendered: outputPath,
      title: "Adapter plan",
      sections: 1,
      help: [`Open ${outputPath} in your browser to review the document`],
    });
    const html = await readFile(outputPath, "utf8");
    expect(html).toContain("<title>Adapter plan</title>");
    expect(html).toMatch(/<html lang="en" data-plan-id="[a-f0-9]{16}">/);
  });

  it("should refuse to render a plan that fails authoring lint and write nothing", async () => {
    const inputPath = join(tempDirectory, "plan.mdx");
    await writeFile(inputPath, "# Adapter plan\n\n## Rollout\n", "utf8");
    const entriesBefore = await readdir(tempDirectory);

    await expect(renderCommand([inputPath])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Plan failed authoring lint",
      suggestions: [
        "3:1 [lede-presence] Open with a lede: one concise sentence after the title stating the plan's thesis, before the first section heading",
      ],
    });
    expect(await readdir(tempDirectory)).toEqual(entriesBefore);
  });

  it("should stay locked until guidance has been read", async () => {
    process.env["BIG_PLAN_STATE_DIR"] = join(tempDirectory, "other-state");

    await expect(renderCommand(["plan.mdx"])).rejects.toMatchObject({
      code: "GUIDANCE_REQUIRED",
    });
  });

  it("should diagnose a usage error before the guidance prerequisite", async () => {
    process.env["BIG_PLAN_STATE_DIR"] = join(tempDirectory, "other-state");

    await expect(
      renderCommand(["plan.mdx", "plan.html", "extra"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: 'Unexpected extra argument "extra"',
      suggestions: ["Usage: big-plan render <input.mdx> [output.html]"],
    });
  });
});

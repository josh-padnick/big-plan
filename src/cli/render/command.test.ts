// Exercises only the render command's HTML-specific derivation, result, and
// invalid-document message; shared CLI lifecycle policy has its own tests.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderCommand } from "./command.js";

let tempDirectory = "";

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "big-plan-render-"));
});

afterEach(async () => {
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
    await writeFile(inputPath, "# Adapter plan\n\n## Rollout\n", "utf8");

    const result = await renderCommand([inputPath]);

    expect(result).toEqual({
      rendered: outputPath,
      title: "Adapter plan",
      sections: 1,
      help: [`Open ${outputPath} in your browser to review the document`],
    });
    await expect(readFile(outputPath, "utf8")).resolves.toContain(
      "<title>Adapter plan</title>",
    );
  });
});

// Exercises the render command through its real filesystem adapter: argument
// failures, default output placement, and creation of nested output paths.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderCommand } from "./render-command.js";

let tempDirectory = "";

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "big-plan-render-command-"));
});

afterEach(async () => {
  await rm(tempDirectory, { recursive: true, force: true });
});

describe("renderCommand validation", () => {
  it("should report usage when the input argument is missing", async () => {
    await expect(renderCommand([])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Missing input MDX file",
      suggestions: ["Usage: big-plan render <input.mdx> [output.html]"],
    });
  });

  it("should list every positional diagnostic when the MDX is invalid", async () => {
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
        "1:1 Unknown block \"Unknown\"",
        "1:10 Expression-valued attribute \"first\" is not supported",
        "3:6 Text expressions are not supported",
      ],
    });
  });

  it("should identify the input path when the file cannot be read", async () => {
    const inputPath = join(tempDirectory, "missing.md");

    await expect(renderCommand([inputPath])).rejects.toMatchObject({
      code: "INPUT_NOT_FOUND",
      message: `Cannot read input file: ${inputPath}`,
    });
  });
});

describe("renderCommand output", () => {
  it("should write beside the input when the output argument is omitted", async () => {
    const inputPath = join(tempDirectory, "plan.md");
    const outputPath = join(tempDirectory, "plan.html");
    await writeFile(inputPath, "# Adapter plan\n\n## Rollout\n", "utf8");

    const result = await renderCommand([inputPath]);

    expect(result).toMatchObject({
      rendered: outputPath,
      title: "Adapter plan",
      sections: 1,
    });
    await expect(readFile(outputPath, "utf8")).resolves.toContain(
      "<title>Adapter plan</title>",
    );
  });

  it("should create parent directories when the output path is nested", async () => {
    const inputPath = join(tempDirectory, "plan.md");
    const outputPath = join(tempDirectory, "nested", "review", "plan.html");
    await writeFile(inputPath, "review text", "utf8");

    const result = await renderCommand([inputPath, outputPath]);

    expect(result).toMatchObject({ rendered: outputPath, title: "plan" });
    await expect(readFile(outputPath, "utf8")).resolves.toContain(
      "<title>plan</title>",
    );
  });
});

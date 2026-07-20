// Exercises the render command through its real filesystem adapter: argument
// and MDX validation failures, output placement, and nested directory creation.

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
      suggestions: [
        "Usage: big-plan render <input.mdx> [output.html] [--embed [--theme light|dark]]",
      ],
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
        '1:1 Unknown component "Unknown"',
        '1:10 Expression-valued attribute "first" is not supported',
        "3:6 Text expressions are not supported",
      ],
    });
  });

  it("should reject an unknown flag when one is passed", async () => {
    await expect(renderCommand(["--frame", "plan.mdx"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Unknown flag: --frame",
    });
  });

  it("should reject --theme when --embed is absent", async () => {
    await expect(
      renderCommand(["plan.mdx", "--theme", "dark"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message:
        "--theme requires --embed; the viewer keeps its own theme control",
    });
  });

  it("should reject --theme when its value is not light or dark", async () => {
    await expect(
      renderCommand(["plan.mdx", "--embed", "--theme=sepia"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: '--theme must be "light" or "dark", got: sepia',
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

  it("should render the chromeless embed envelope when --embed is passed", async () => {
    const inputPath = join(tempDirectory, "plan.md");
    const outputPath = join(tempDirectory, "plan.html");
    await writeFile(inputPath, "# Embedded plan\n\n## Rollout\n", "utf8");

    await renderCommand([inputPath, "--embed"]);

    const html = await readFile(outputPath, "utf8");
    expect(html).toContain("data-embed");
    expect(html).not.toContain("data-theme-toggle");
    expect(html).toContain('<html lang="en">');
  });

  it("should pin the embed to the requested color scheme when --theme is passed", async () => {
    const inputPath = join(tempDirectory, "plan.md");
    const outputPath = join(tempDirectory, "plan.html");
    await writeFile(inputPath, "# Embedded plan\n", "utf8");

    await renderCommand([inputPath, "--embed", "--theme", "dark"]);

    await expect(readFile(outputPath, "utf8")).resolves.toContain(
      '<html lang="en" data-theme="dark">',
    );
  });
});

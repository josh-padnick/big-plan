// Exercises the render command through its real filesystem adapter: argument
// and MDX validation failures, output placement, and nested directory creation.

import {
  link,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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
  it("should reject an option-shaped argument instead of writing to it", async () => {
    const inputPath = join(tempDirectory, "plan.mdx");
    await writeFile(inputPath, "# Plan\n\n## S\n", "utf8");
    await expect(renderCommand([inputPath, "--html"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("should report usage when the input argument is missing", async () => {
    await expect(renderCommand([])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Missing input MDX file",
      suggestions: ["Usage: big-plan render <input.mdx> [output.html]"],
    });
  });

  it.each(["--renderer", "--renderer=react", "--unknown"])(
    "should reject the unknown option %s before writing output",
    async (option) => {
      const inputPath = join(tempDirectory, "plan.mdx");
      await writeFile(inputPath, "# Plan\n", "utf8");

      await expect(
        renderCommand([inputPath, option, "react"]),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: `Unknown option "${option}"`,
        suggestions: ["Usage: big-plan render <input.mdx> [output.html]"],
      });
    },
  );

  it("should reject excess positional arguments", async () => {
    const inputPath = join(tempDirectory, "plan.mdx");
    await writeFile(inputPath, "# Plan\n", "utf8");

    await expect(
      renderCommand([inputPath, "plan.html", "extra"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Too many arguments",
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
        '1:1 Unknown component "Unknown"',
        '1:10 Expression-valued attribute "first" is not supported',
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

  it("should reject a lexical collision before reading a missing input", async () => {
    const inputPath = join(tempDirectory, "missing.mdx");

    await expect(renderCommand([inputPath, inputPath])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Output path would overwrite the input MDX file",
    });
  });
});

describe("renderCommand output", () => {
  it("should refuse an output path that would overwrite the input", async () => {
    const inputPath = join(tempDirectory, "plan.mdx");
    const source = "# Adapter plan\n\n## Rollout\n";
    await writeFile(inputPath, source, "utf8");
    await expect(renderCommand([inputPath, inputPath])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(await readFile(inputPath, "utf8")).toBe(source);
  });

  it.each([
    ["symbolic link", symlink],
    ["hard link", link],
  ])("should refuse an output %s that aliases the input", async (_, alias) => {
    const inputPath = join(tempDirectory, "plan.mdx");
    const outputPath = join(tempDirectory, "plan.html");
    const source = "# Adapter plan\n\n## Rollout\n";
    await writeFile(inputPath, source, "utf8");
    await alias(inputPath, outputPath);

    await expect(renderCommand([inputPath, outputPath])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Output path would overwrite the input MDX file",
    });
    expect(await readFile(inputPath, "utf8")).toBe(source);
  });

  it("should refuse a case-only alias on a case-insensitive filesystem", async () => {
    const inputPath = join(tempDirectory, "plan.mdx");
    const outputPath = join(tempDirectory, "PLAN.MDX");
    const source = "# Adapter plan\n\n## Rollout\n";
    await writeFile(inputPath, source, "utf8");
    try {
      if ((await realpath(outputPath)) !== (await realpath(inputPath))) {
        return;
      }
    } catch {
      return;
    }

    await expect(renderCommand([inputPath, outputPath])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Output path would overwrite the input MDX file",
    });
    expect(await readFile(inputPath, "utf8")).toBe(source);
  });

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

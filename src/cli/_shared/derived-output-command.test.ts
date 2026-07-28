// Exercises the shared derived-output lifecycle once: argument policy, input
// reading, diagnostic translation, output placement, and directory creation.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MarkdownDiagnosticsError } from "../../render/render-document.js";
import { runDerivedOutputCommand } from "./derived-output-command.js";

const USAGE = "Usage: big-plan example <input.mdx> [output.txt]";
let tempDirectory = "";

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "big-plan-derived-output-"));
});

afterEach(async () => {
  await rm(tempDirectory, { recursive: true, force: true });
});

// Supplies a deterministic derivation so tests can exercise shared CLI policy
// from either production renderer.
const runExampleCommand = (
  args: ReadonlyArray<string>,
): Promise<Record<string, unknown>> =>
  runDerivedOutputCommand({
    args,
    usage: USAGE,
    outputSuffix: ".txt",
    invalidDocumentMessage: "Cannot derive invalid input",
    derive: ({ markdown, fallbackTitle }) => ({
      content: `${fallbackTitle}:${markdown.toUpperCase()}`,
    }),
    serialize: ({ content }) => content,
    result: ({ derived, outputPath }) => ({
      output: outputPath,
      content: derived.content,
    }),
  });

describe("runDerivedOutputCommand argument and input policy", () => {
  it("should reject a missing input argument", async () => {
    await expect(runExampleCommand([])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Missing input MDX file",
      suggestions: [USAGE],
    });
  });

  it.each(["--output", "--output=plan.txt", "--unknown"])(
    "should reject the option-shaped argument %s",
    async (option) => {
      await expect(runExampleCommand([option])).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: `Unknown option "${option}"`,
        suggestions: [USAGE],
      });
    },
  );

  it("should reject a third positional argument", async () => {
    await expect(
      runExampleCommand(["plan.mdx", "plan.txt", "extra"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: 'Unexpected extra argument "extra"',
      suggestions: [USAGE],
    });
  });

  it("should identify an unreadable input path", async () => {
    const inputPath = join(tempDirectory, "missing.mdx");

    await expect(runExampleCommand([inputPath])).rejects.toMatchObject({
      code: "INPUT_NOT_FOUND",
      message: `Cannot read input file: ${inputPath}`,
      suggestions: [USAGE],
    });
  });

  it("should reject a lexical collision before reading a missing input", async () => {
    const inputPath = join(tempDirectory, "missing.mdx");

    await expect(
      runExampleCommand([inputPath, inputPath]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Output path would overwrite the input MDX file",
    });
  });
});

describe("runDerivedOutputCommand derivation and output", () => {
  it("should translate every positional document diagnostic", async () => {
    const inputPath = join(tempDirectory, "invalid.mdx");
    await writeFile(inputPath, "invalid", "utf8");

    await expect(
      runDerivedOutputCommand({
        args: [inputPath],
        usage: USAGE,
        outputSuffix: ".txt",
        invalidDocumentMessage: "Cannot derive invalid input",
        derive: () => {
          throw new MarkdownDiagnosticsError([
            { line: 2, column: 4, message: "First problem" },
            { message: "Unknown position" },
          ]);
        },
        serialize: () => "",
        result: () => ({}),
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Cannot derive invalid input",
      suggestions: ["2:4 First problem", "?:? Unknown position"],
    });
  });

  it("should derive a default output beside the input", async () => {
    const inputPath = join(tempDirectory, "plan.mdx");
    const outputPath = join(tempDirectory, "plan.txt");
    await writeFile(inputPath, "plan body", "utf8");

    const result = await runExampleCommand([inputPath]);

    expect(result).toEqual({
      output: outputPath,
      content: "plan:PLAN BODY",
    });
    await expect(readFile(outputPath, "utf8")).resolves.toBe("plan:PLAN BODY");
  });

  it("should create nested output folders when asked", async () => {
    const inputPath = join(tempDirectory, "plan.mdx");
    const outputPath = join(tempDirectory, "nested", "review", "plan.txt");
    await writeFile(inputPath, "plan body", "utf8");

    const result = await runExampleCommand([inputPath, outputPath]);

    expect(result["output"]).toBe(outputPath);
    await expect(readFile(outputPath, "utf8")).resolves.toBe("plan:PLAN BODY");
  });
});

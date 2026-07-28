// Exercises the guarded writer's inode-aware overwrite protection and its
// ability to replace safe existing outputs without truncating the input.

import {
  chmod,
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
import { createGuardedOutputWriter } from "./guarded-output-writer.js";

const USAGE = "Usage: big-plan example <input.mdx> [output.txt]";
let tempDirectory = "";

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "big-plan-output-writer-"));
});

afterEach(async () => {
  await rm(tempDirectory, { recursive: true, force: true });
});

describe("createGuardedOutputWriter collision protection", () => {
  it("should reject a lexical collision before opening the output", () => {
    const inputPath = join(tempDirectory, "plan.mdx");

    expect(() =>
      createGuardedOutputWriter({
        inputPath,
        outputPath: inputPath,
        usage: USAGE,
      }),
    ).toThrow("Output path would overwrite the input MDX file");
  });

  it.each([
    ["symbolic link", symlink],
    ["hard link", link],
  ])("should refuse an output %s that aliases the input", async (_, alias) => {
    const inputPath = join(tempDirectory, "plan.mdx");
    const outputPath = join(tempDirectory, "plan.txt");
    const source = "# Protected plan\n";
    await writeFile(inputPath, source, "utf8");
    await alias(inputPath, outputPath);
    const writeOutput = createGuardedOutputWriter({
      inputPath,
      outputPath,
      usage: USAGE,
    });

    await expect(writeOutput("replacement")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Output path would overwrite the input MDX file",
      suggestions: [USAGE],
    });
    expect(await readFile(inputPath, "utf8")).toBe(source);
  });

  it.each([
    ["symbolic link", symlink],
    ["hard link", link],
  ])(
    "should preserve the overwrite error for a non-writable input aliased by %s",
    async (_, alias) => {
      const inputPath = join(tempDirectory, "plan.mdx");
      const outputPath = join(tempDirectory, "plan.txt");
      const source = "# Protected plan\n";
      await writeFile(inputPath, source, "utf8");
      await alias(inputPath, outputPath);
      await chmod(inputPath, 0o400);
      const writeOutput = createGuardedOutputWriter({
        inputPath,
        outputPath,
        usage: USAGE,
      });

      await expect(writeOutput("replacement")).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: "Output path would overwrite the input MDX file",
        suggestions: [USAGE],
      });
      expect(await readFile(inputPath, "utf8")).toBe(source);
    },
  );

  it("should refuse a case-only alias on a case-insensitive filesystem", async () => {
    const inputPath = join(tempDirectory, "plan.mdx");
    const outputPath = join(tempDirectory, "PLAN.MDX");
    const source = "# Protected plan\n";
    await writeFile(inputPath, source, "utf8");
    try {
      if ((await realpath(outputPath)) !== (await realpath(inputPath))) {
        return;
      }
    } catch {
      return;
    }
    const writeOutput = createGuardedOutputWriter({
      inputPath,
      outputPath,
      usage: USAGE,
    });

    await expect(writeOutput("replacement")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Output path would overwrite the input MDX file",
    });
    expect(await readFile(inputPath, "utf8")).toBe(source);
  });
});

describe("createGuardedOutputWriter safe writes", () => {
  it("should replace an existing write-only output file", async () => {
    const inputPath = join(tempDirectory, "plan.mdx");
    const outputPath = join(tempDirectory, "plan.txt");
    await writeFile(inputPath, "# Plan\n", "utf8");
    await writeFile(outputPath, "old content", "utf8");
    await chmod(outputPath, 0o200);
    const writeOutput = createGuardedOutputWriter({
      inputPath,
      outputPath,
      usage: USAGE,
    });

    await writeOutput("new content");

    await chmod(outputPath, 0o600);
    await expect(readFile(outputPath, "utf8")).resolves.toBe("new content");
  });
});

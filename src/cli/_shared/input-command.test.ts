// Pins the shared input command interface: argument limits, UTF-8 reads,
// fallback titles, and positional renderer diagnostic translation.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MarkdownDiagnosticsError } from "../../render/render-document.js";
import {
  deriveInputFile,
  parseInputCommandArguments,
} from "./input-command.js";

const USAGE = "Usage: big-plan example <input.mdx>";
let tempDirectory = "";

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "big-plan-input-command-"));
});

afterEach(async () => {
  await rm(tempDirectory, { recursive: true, force: true });
});

describe("parseInputCommandArguments", () => {
  it("should resolve one required input when no trailing args are allowed", () => {
    const inputPath = join(tempDirectory, "plan.mdx");

    expect(
      parseInputCommandArguments({
        args: [inputPath],
        usage: USAGE,
        maximumArguments: 1,
      }),
    ).toEqual({ inputPath, trailingArgs: [] });
  });

  it("should reject a second argument when only the input is allowed", () => {
    expect(() =>
      parseInputCommandArguments({
        args: ["plan.mdx", "output.html"],
        usage: USAGE,
        maximumArguments: 1,
      }),
    ).toThrow('Unexpected extra argument "output.html"');
  });
});

describe("deriveInputFile", () => {
  it("should read UTF-8 input and derive its fallback title", async () => {
    const inputPath = join(tempDirectory, "rollout.plan.mdx");
    await writeFile(inputPath, "# Rollout\n", "utf8");

    await expect(
      deriveInputFile({
        inputPath,
        usage: USAGE,
        invalidDocumentMessage: "Invalid",
        derive: ({ markdown, fallbackTitle }) => ({
          markdown,
          fallbackTitle,
        }),
      }),
    ).resolves.toEqual({
      markdown: "# Rollout\n",
      derived: {
        markdown: "# Rollout\n",
        fallbackTitle: "rollout.plan",
      },
    });
  });

  it("should translate every renderer diagnostic", async () => {
    const inputPath = join(tempDirectory, "invalid.mdx");
    await writeFile(inputPath, "invalid", "utf8");

    await expect(
      deriveInputFile({
        inputPath,
        usage: USAGE,
        invalidDocumentMessage: "Cannot validate document with invalid MDX",
        derive: () => {
          throw new MarkdownDiagnosticsError([
            { line: 2, column: 4, message: "First problem" },
            { message: "Unknown position" },
          ]);
        },
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Cannot validate document with invalid MDX",
      suggestions: ["2:4 First problem", "?:? Unknown position"],
    });
  });
});

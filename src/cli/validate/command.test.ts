// Exercises the no-write validate command: structural summary, exact argument
// policy, renderer diagnostic parity, and validate-only authoring lint.

import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileCommand } from "../compile/command.js";
import { renderCommand } from "../render/command.js";
import { validateCommand } from "./command.js";

let tempDirectory = "";

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "big-plan-validate-"));
});

afterEach(async () => {
  await rm(tempDirectory, { recursive: true, force: true });
});

describe("validateCommand", () => {
  it("should report the validated plan summary without writing anything", async () => {
    const inputPath = join(tempDirectory, "plan.mdx");
    await writeFile(
      inputPath,
      '# Rollout plan\n\n## Scope\n\n<Callout type="note">\n\nOne increment.\n\n</Callout>\n',
      "utf8",
    );
    const entriesBefore = await readdir(tempDirectory);

    await expect(validateCommand([inputPath])).resolves.toEqual({
      validated: inputPath,
      title: "Rollout plan",
      sections: 1,
      components: 1,
    });
    expect(await readdir(tempDirectory)).toEqual(entriesBefore);
  });

  it("should reject an output argument because validate never writes", async () => {
    await expect(
      validateCommand(["plan.mdx", "plan.html"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: 'Unexpected extra argument "plan.html"',
      suggestions: ["Usage: big-plan validate <input.mdx>"],
    });
  });

  it("should preserve renderer diagnostics across all three commands", async () => {
    const inputPath = join(tempDirectory, "invalid.mdx");
    await writeFile(
      inputPath,
      "<Unknown first={value} />\n\nCopy {value}\n",
      "utf8",
    );
    const suggestions = [
      '1:1 Unknown component "Unknown"',
      '1:10 Expression-valued attribute "first" is not supported',
      "3:6 Text expressions are not supported",
    ];

    await expect(validateCommand([inputPath])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Cannot validate document with invalid MDX",
      suggestions,
    });
    await expect(compileCommand([inputPath])).rejects.toMatchObject({
      suggestions,
    });
    await expect(renderCommand([inputPath])).rejects.toMatchObject({
      suggestions,
    });
    expect(await readdir(tempDirectory)).toEqual(["invalid.mdx"]);
  });

  it("should reject a malformed Markdown table through authoring lint", async () => {
    const inputPath = join(tempDirectory, "table.mdx");
    await writeFile(
      inputPath,
      "# Ownership\n\n| Name | Owner |\n| API | Platform |\n",
      "utf8",
    );

    await expect(validateCommand([inputPath])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Plan failed authoring lint",
      suggestions: [
        '4:1 [markdown-table-format] Table-like block needs a valid delimiter row with 2 columns, for example "| --- | --- |"',
      ],
    });
    expect(await readdir(tempDirectory)).toEqual(["table.mdx"]);
  });
});

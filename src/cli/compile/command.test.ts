// Exercises only the compile command's JSON-specific derivation, result, and
// invalid-document message; shared CLI lifecycle policy has its own tests.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileCommand } from "./command.js";

let tempDirectory = "";

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "big-plan-compile-"));
});

afterEach(async () => {
  await rm(tempDirectory, { recursive: true, force: true });
});

const PLAN = `# Rollout plan

## Question

<QuickDecision question="Ship behind a flag?">

<Option title="Yes" recommended />

<Option title="No" />

</QuickDecision>
`;

describe("compileCommand", () => {
  it("should report invalid MDX with the compile-specific message", async () => {
    const inputPath = join(tempDirectory, "invalid.mdx");
    await writeFile(
      inputPath,
      '<Decision question="Q?">\n\n</Decision>\n',
      "utf8",
    );

    await expect(compileCommand([inputPath])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Cannot compile document with invalid MDX",
    });
  });

  it("should write the plan model and report its contents", async () => {
    const inputPath = join(tempDirectory, "plan.mdx");
    const outputPath = join(tempDirectory, "plan.model.json");
    await writeFile(inputPath, PLAN, "utf8");

    const result = await compileCommand([inputPath]);

    expect(result).toEqual({
      compiled: outputPath,
      title: "Rollout plan",
      sections: 1,
      components: 1,
      help: [
        `The JSON at ${outputPath} holds the validated plan model: title, section outline, and every component instance's compiled model in document order`,
      ],
    });
    const serialized = await readFile(outputPath, "utf8");
    expect(serialized.startsWith('{\n  "title"')).toBe(true);
    expect(serialized.endsWith("\n")).toBe(true);
    const parsed: unknown = JSON.parse(serialized);
    expect(parsed).toMatchObject({
      title: "Rollout plan",
      components: [
        {
          component: "QuickDecision",
          model: {
            question: "Ship behind a flag?",
            options: [
              { title: "Yes", recommended: true },
              { title: "No", recommended: false },
            ],
          },
        },
      ],
    });
  });
});

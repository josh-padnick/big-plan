// Exercises the compile command through its real filesystem adapter:
// argument and MDX validation failures, default output placement, and the
// shape of the emitted plan-model JSON.

import {
  chmod,
  link,
  mkdir,
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
import { compileCommand } from "./compile-command.js";

let tempDirectory = "";

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "big-plan-compile-command-"));
});

afterEach(async () => {
  await rm(tempDirectory, { recursive: true, force: true });
});

const PLAN = `# Rollout plan

## Question

<SmallDecisionSet title="Open questions">

<SmallDecision question="Ship behind a flag?">

<Option title="Yes" recommended />

<Option title="No" />

</SmallDecision>

</SmallDecisionSet>
`;

describe("compileCommand validation", () => {
  it("should reject a missing input argument", async () => {
    await expect(compileCommand([])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("should reject an option-shaped argument instead of writing to it", async () => {
    const inputPath = join(tempDirectory, "plan.mdx");
    await writeFile(inputPath, PLAN, "utf8");
    await expect(compileCommand([inputPath, "--json"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("should reject a third positional argument", async () => {
    const inputPath = join(tempDirectory, "plan.mdx");
    await writeFile(inputPath, PLAN, "utf8");
    await expect(
      compileCommand([inputPath, "out.json", "extra"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("should reject an unreadable input path", async () => {
    await expect(
      compileCommand([join(tempDirectory, "missing.mdx")]),
    ).rejects.toMatchObject({ code: "INPUT_NOT_FOUND" });
  });

  it("should refuse an output path that would overwrite the input", async () => {
    const inputPath = join(tempDirectory, "plan.mdx");
    await writeFile(inputPath, PLAN, "utf8");
    await expect(compileCommand([inputPath, inputPath])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(await readFile(inputPath, "utf8")).toBe(PLAN);
  });

  it.each([
    ["symbolic link", symlink],
    ["hard link", link],
  ])("should refuse an output %s that aliases the input", async (_, alias) => {
    const inputPath = join(tempDirectory, "plan.mdx");
    const outputPath = join(tempDirectory, "model.json");
    await writeFile(inputPath, PLAN, "utf8");
    await alias(inputPath, outputPath);

    await expect(compileCommand([inputPath, outputPath])).rejects.toMatchObject(
      {
        code: "VALIDATION_ERROR",
        message: "Output path would overwrite the input MDX file",
      },
    );
    expect(await readFile(inputPath, "utf8")).toBe(PLAN);
  });

  it.each([
    ["symbolic link", symlink],
    ["hard link", link],
  ])(
    "should report an overwrite error for a non-writable input aliased by %s",
    async (_, alias) => {
      const inputPath = join(tempDirectory, "plan.mdx");
      const outputPath = join(tempDirectory, "model.json");
      await writeFile(inputPath, PLAN, "utf8");
      await alias(inputPath, outputPath);
      await chmod(inputPath, 0o400);

      await expect(
        compileCommand([inputPath, outputPath]),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: "Output path would overwrite the input MDX file",
        suggestions: ["Usage: big-plan compile <input.mdx> [output.json]"],
      });
      expect(await readFile(inputPath, "utf8")).toBe(PLAN);
    },
  );

  it("should refuse a case-only alias on a case-insensitive filesystem", async () => {
    const inputPath = join(tempDirectory, "plan.mdx");
    const outputPath = join(tempDirectory, "PLAN.MDX");
    await writeFile(inputPath, PLAN, "utf8");
    try {
      if ((await realpath(outputPath)) !== (await realpath(inputPath))) {
        return;
      }
    } catch {
      return;
    }

    await expect(compileCommand([inputPath, outputPath])).rejects.toMatchObject(
      {
        code: "VALIDATION_ERROR",
        message: "Output path would overwrite the input MDX file",
      },
    );
    expect(await readFile(inputPath, "utf8")).toBe(PLAN);
  });

  it("should reject a lexical collision before reading a missing input", async () => {
    const inputPath = join(tempDirectory, "missing.mdx");

    await expect(compileCommand([inputPath, inputPath])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Output path would overwrite the input MDX file",
    });
  });

  it("should surface positional diagnostics when the MDX is invalid", async () => {
    const inputPath = join(tempDirectory, "invalid.mdx");
    await writeFile(
      inputPath,
      '<BigDecision question="Q?">\n\n</BigDecision>\n',
      "utf8",
    );
    await expect(compileCommand([inputPath])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("compileCommand output", () => {
  it("should write the plan model beside the input by default", async () => {
    const inputPath = join(tempDirectory, "plan.mdx");
    await writeFile(inputPath, PLAN, "utf8");

    const result = await compileCommand([inputPath]);

    expect(result["compiled"]).toBe(join(tempDirectory, "plan.model.json"));
    expect(result["title"]).toBe("Rollout plan");
    expect(result["sections"]).toBe(1);
    expect(result["components"]).toBe(1);

    const serialized = await readFile(
      join(tempDirectory, "plan.model.json"),
      "utf8",
    );
    expect(serialized.startsWith('{\n  "title"')).toBe(true);
    expect(serialized.endsWith("\n")).toBe(true);
    const parsed: unknown = JSON.parse(serialized);
    expect(parsed).toMatchObject({
      title: "Rollout plan",
      components: [
        {
          component: "SmallDecisionSet",
          model: {
            title: "Open questions",
            decisions: [
              {
                question: "Ship behind a flag?",
                options: [
                  { title: "Yes", recommended: true },
                  { title: "No", recommended: false },
                ],
              },
            ],
          },
        },
      ],
    });
  });

  it("should create nested output directories when asked", async () => {
    const inputPath = join(tempDirectory, "plan.mdx");
    await writeFile(inputPath, PLAN, "utf8");
    await mkdir(join(tempDirectory, "exists"), { recursive: true });
    const outputPath = join(tempDirectory, "exists", "deep", "model.json");

    const result = await compileCommand([inputPath, outputPath]);

    expect(result["compiled"]).toBe(outputPath);
    const parsed: unknown = JSON.parse(await readFile(outputPath, "utf8"));
    expect(parsed).toMatchObject({ title: "Rollout plan" });
  });

  it("should replace an existing write-only output file", async () => {
    const inputPath = join(tempDirectory, "plan.mdx");
    const outputPath = join(tempDirectory, "model.json");
    await writeFile(inputPath, PLAN, "utf8");
    await writeFile(outputPath, "old content", "utf8");
    await chmod(outputPath, 0o200);

    await compileCommand([inputPath, outputPath]);

    await chmod(outputPath, 0o600);
    const parsed: unknown = JSON.parse(await readFile(outputPath, "utf8"));
    expect(parsed).toMatchObject({ title: "Rollout plan" });
  });
});

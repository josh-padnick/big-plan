// Exercises the skill command surface: print the embedded shell, write it to
// an explicit path, and reject unsafe or malformed invocations without writing.

import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SKILL_MARKDOWN } from "./content.generated.js";
import { skillCommand } from "./command.js";

let tempDirectory = "";

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "big-plan-skill-"));
});

afterEach(async () => {
  await rm(tempDirectory, { recursive: true, force: true });
});

describe("skillCommand", () => {
  it("should print the embedded skill shell with harness frontmatter", async () => {
    const output = await skillCommand([]);

    expect(output).toBe(`${SKILL_MARKDOWN.trimEnd()}\n`);
    expect(output).toContain("name: big-plan");
    expect(output).toContain("Mandatory first step every session");
    expect(output).toContain("big-plan guidance");
    expect(output).toContain("Do not re-copy long guidance");
  });

  it("should write the skill shell only when write is requested", async () => {
    const nestedPath = join(tempDirectory, "skills", "big-plan", "SKILL.md");
    const entriesBefore = await readdir(tempDirectory);

    await expect(skillCommand([])).resolves.toEqual(expect.any(String));
    expect(await readdir(tempDirectory)).toEqual(entriesBefore);

    await expect(skillCommand(["write", nestedPath])).resolves.toEqual({
      written: nestedPath,
      help: [
        "Skill shell written. Fast-changing authoring rules still come from `big-plan guidance`, not this file.",
        "Re-run `big-plan skill write <path>` after a package upgrade only when the skill shell itself changed.",
      ],
    });
    expect(await readFile(nestedPath, "utf8")).toBe(
      `${SKILL_MARKDOWN.trimEnd()}\n`,
    );
  });

  it("should overwrite an existing skill file when write is explicit", async () => {
    const skillPath = join(tempDirectory, "SKILL.md");
    await writeFile(skillPath, "stale skill text\n", "utf8");

    await skillCommand(["write", skillPath]);
    expect(await readFile(skillPath, "utf8")).toBe(
      `${SKILL_MARKDOWN.trimEnd()}\n`,
    );
  });

  it("should reject unknown options and actions without writing", async () => {
    const skillPath = join(tempDirectory, "SKILL.md");

    await expect(skillCommand(["--write", skillPath])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: 'Unknown option "--write"',
      suggestions: ["Usage: big-plan skill [write <path>]"],
    });
    await expect(skillCommand(["install", skillPath])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: 'Unknown skill action "install"',
    });
    await expect(skillCommand(["write"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Missing skill output path",
    });
    await expect(
      skillCommand(["write", skillPath, "extra"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: 'Unexpected extra argument "extra"',
    });
    expect(await readdir(tempDirectory)).toEqual([]);
  });

  it("should keep the skill shell thin and defer authoring rules to guidance", () => {
    // Packaging invariant: the shell must not grow into a second guidance doc.
    expect(SKILL_MARKDOWN.length).toBeLessThan(6000);
    expect(SKILL_MARKDOWN).toMatch(/npx big-plan@latest guidance/);
    expect(SKILL_MARKDOWN).toMatch(/skill write/);
    expect(SKILL_MARKDOWN).not.toMatch(/QuickSummary enforces/);
  });
});

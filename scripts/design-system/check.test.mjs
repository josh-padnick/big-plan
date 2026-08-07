// Proves the design-system check rejects an off-scale value and accepts the
// one relative size the scales deliberately still allow.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const CHECK = fileURLToPath(new URL("./check.mjs", import.meta.url));

/** Runs the check against a throwaway source tree and returns its report. */
const runAgainst = async (files) => {
  const root = await mkdtemp(join(tmpdir(), "big-plan-design-system-"));
  try {
    const source = join(root, "src", "components", "sample");
    await mkdir(source, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(source, name), content, "utf8");
    }
    // The check resolves its source root from its own location, so the copy
    // under test runs from the throwaway tree rather than the repository.
    await mkdir(join(root, "scripts", "design-system"), { recursive: true });
    const copy = join(root, "scripts", "design-system", "check.mjs");
    await writeFile(
      copy,
      await (await import("node:fs/promises")).readFile(CHECK, "utf8"),
      "utf8",
    );
    try {
      const { stdout } = await execFileAsync(process.execPath, [copy]);
      return { failed: false, output: stdout };
    } catch (error) {
      return {
        failed: true,
        output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
      };
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test("accepts values drawn from the scales", async () => {
  const result = await runAgainst({
    "view.tsx":
      'export const V = () => <p className="px-6 rounded-xl shadow-raised text-sm tracking-caps" />;\n',
  });
  assert.equal(result.failed, false);
  assert.match(result.output, /design system: passed/);
});

test("rejects a spacing step that is not on the scale", async () => {
  const result = await runAgainst({
    "view.tsx": 'export const V = () => <p className="px-5" />;\n',
  });
  assert.equal(result.failed, true);
  assert.match(result.output, /off-scale spacing "px-5"/);
});

test("rejects an invented shadow and radius", async () => {
  const result = await runAgainst({
    "view.tsx":
      'export const V = () => <p className="rounded-[0.3rem] shadow-lg" />;\n',
  });
  assert.equal(result.failed, true);
  assert.match(result.output, /off-scale radius "rounded-\[0\.3rem\]"/);
  assert.match(result.output, /off-scale shadow "shadow-lg"/);
});

test("allows an em type size because it names a ratio, not a step", async () => {
  const result = await runAgainst({
    "view.tsx": 'export const V = () => <code className="text-[0.875em]" />;\n',
  });
  assert.equal(result.failed, false);
});

test("rejects a rem type size because a step comes from the scale", async () => {
  const result = await runAgainst({
    "view.tsx": 'export const V = () => <p className="text-[0.8125rem]" />;\n',
  });
  assert.equal(result.failed, true);
  assert.match(result.output, /off-scale type size "text-\[0\.8125rem\]"/);
});

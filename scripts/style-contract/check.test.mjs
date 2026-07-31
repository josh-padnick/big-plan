// Exercises the stylesheet contract's failure boundaries without coupling the
// check to today's component inventory.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkStylesheetContract } from "./check.mjs";

const HEADER =
  "/* CSS escape hatch: selector relationship over generated markup. */";

const checkSource = async (stylesheets) => {
  const root = await mkdtemp(join(tmpdir(), "style-contract-test-"));
  const sourceRoot = join(root, "src");
  await mkdir(sourceRoot);
  try {
    for (const [name, source] of Object.entries(stylesheets)) {
      await writeFile(join(sourceRoot, name), source, "utf8");
    }
    return await checkStylesheetContract({ sourceRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test("should accept ordinary, primitive, and explained override rules", async () => {
  const failures = await checkSource({
    "valid.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
:root { --color-example: red; color-scheme: light dark; }
@layer components { .generated-child { color: var(--color-example); } }
@layer bp-state {
  /* Override invariant: collapsed display beats the resting display utility. */
  [data-collapsed] { display: none; }
}
`,
  });
  assert.deepEqual(failures, []);
});

test("should report missing reasons, unlayered rules, unknown layers, and unexplained overrides", async () => {
  const failures = await checkSource({
    "missing-reason.css":
      "/* Component styles. */ @layer components { .owned { color: red; } }",
    "unlayered.css": `${HEADER} .generated-child { color: red; }`,
    "unknown-layer.css": `${HEADER} @layer component-name { .generated-child { color: red; } }`,
    "unexplained-state.css": `${HEADER} @layer bp-state { [data-open] { display: block; } }`,
  });
  assert.equal(failures.length, 4);
  assert.match(failures.join("\n"), /file-level comment must include/);
  assert.match(failures.join("\n"), /presentation rule is unlayered/);
  assert.match(failures.join("\n"), /may use only/);
  assert.match(failures.join("\n"), /Override invariant:/);
});

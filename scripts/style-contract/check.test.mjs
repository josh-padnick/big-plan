// Exercises the stylesheet contract's failure boundaries without coupling the
// check to today's component inventory.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
      const path = join(sourceRoot, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, source, "utf8");
    }
    return await checkStylesheetContract({ sourceRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test("should accept ordinary, primitive, and explained override rules", async () => {
  const failures = await checkSource({
    "render/global.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
:root { --color-example: red; color-scheme: light dark; }
:root[data-theme="dark"]:not([data-print]) { --color-example: blue; }
:root[data-value="\\\\"] { --color-example: green; }
@layer components { .generated-child { color: var(--color-example); } }
@layer bp-state {
  /* Override invariant: collapsed display beats the resting display utility. */
  [data-collapsed] { display: none; }
}
`,
    "review/browser/review.css": `${HEADER}
@layer components { .review-owned { color: var(--color-example); } }
`,
  });
  assert.deepEqual(failures, []);
});

test("should reject presentation nested below a root primitive rule", async () => {
  const failures = await checkSource({
    "render/global.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
:root {
  --color-example: red;
  @media (width > 1px) {
    color: red;
  }
}
`,
  });
  assert.match(failures.join("\n"), /presentation rule is unlayered/);
});

test("should report missing reasons, unlayered rules, unknown layers, and unexplained overrides", async () => {
  const failures = await checkSource({
    "render/global.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
`,
    "components/missing-reason/styles.css":
      "/* Component styles. */ @layer components { .owned { color: red; } }",
    "components/unlayered/styles.css": `${HEADER} .generated-child { color: red; }`,
    "components/unknown-layer/styles.css": `${HEADER} @layer component-name { .generated-child { color: red; } }`,
    "components/unexplained-state/styles.css": `${HEADER} @layer bp-state { [data-open] { display: block; } }`,
  });
  assert.equal(failures.length, 4);
  assert.match(failures.join("\n"), /file-level comment must include/);
  assert.match(failures.join("\n"), /presentation rule is unlayered/);
  assert.match(failures.join("\n"), /may use only/);
  assert.match(failures.join("\n"), /Override invariant:/);
});

test("should require one canonical layer order at the stylesheet entrypoint", async () => {
  const missing = await checkSource({
    "render/global.css": `${HEADER}
@layer components { .generated-child { color: red; } }
`,
  });
  assert.match(missing.join("\n"), /exactly one canonical/);

  const misplaced = await checkSource({
    "render/global.css": HEADER,
    "components/other/styles.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
`,
  });
  assert.match(
    misplaced.join("\n"),
    /found at src\/components\/other\/styles\.css/,
  );

  const duplicated = await checkSource({
    "render/global.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
`,
    "components/other/styles.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
`,
  });
  assert.match(
    duplicated.join("\n"),
    /found at src\/components\/other\/styles\.css, src\/render\/global\.css|found at src\/render\/global\.css, src\/components\/other\/styles\.css/,
  );
});

test("should reject nonvisual support owners, nested layers, and root descendants", async () => {
  const failures = await checkSource({
    "render/global.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
:root .card { --color-example: red; }
`,
    "_model/example.css": `${HEADER}
@layer components { .model-owned { color: red; } }
`,
    "components/example/styles.css": `${HEADER}
@layer bp-state {
  @layer components {
    .nested { color: red; }
  }
}
`,
  });
  assert.match(failures.join("\n"), /outside a visual owner/);
  assert.match(failures.join("\n"), /presentation rule is unlayered/);
  assert.match(failures.join("\n"), /nested layer blocks/);
  assert.match(failures.join("\n"), /Override invariant:/);
});

test("should accept a palette-scoped token rule and reject a palette-scoped style rule", async () => {
  const accepted = await checkSource({
    "render/global.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
:root, [data-palette="default"] { --color-example: red; }
[data-palette="guest"] { --color-example: blue; }
`,
  });
  assert.deepEqual(accepted, []);

  const rejected = await checkSource({
    "render/global.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
[data-palette="guest"] { color: blue; }
`,
  });
  assert.equal(rejected.length, 1);
  assert.match(rejected[0], /presentation rule is unlayered/);
});

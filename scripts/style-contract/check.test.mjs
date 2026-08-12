// Exercises the stylesheet contract's failure boundaries without coupling the
// check to today's component inventory. Fixtures declare their own allowlists
// so a real inventory entry never decides whether a boundary test passes.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkStylesheetContract } from "./check.mjs";

const HEADER =
  "/* CSS escape hatch: selector relationship over generated markup. */";

const checkSource = async (stylesheets, inventories = {}) => {
  const root = await mkdtemp(join(tmpdir(), "style-contract-test-"));
  const sourceRoot = join(root, "src");
  await mkdir(sourceRoot);
  try {
    for (const [name, source] of Object.entries(stylesheets)) {
      const path = join(sourceRoot, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, source, "utf8");
    }
    return await checkStylesheetContract({
      sourceRoot,
      renderStylesheets: new Set(["src/render/global.css"]),
      drawingSystems: new Set(),
      budgets: {},
      ...inventories,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

/** Builds a stylesheet of `count` single-declaration rules over owned markup. */
const stylesheetOfSize = (count) => {
  const rules = Array.from(
    { length: count },
    (unused, index) => `article [data-rule="${index}"] { color: red; }`,
  ).join("\n  ");
  return `${HEADER}\n@layer components {\n  ${rules}\n}\n`;
};

test("should accept ordinary, primitive, and explained override rules", async () => {
  const failures = await checkSource({
    "render/global.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
:root { --color-example: red; color-scheme: light dark; }
:root[data-theme="dark"]:not([data-print]) { --color-example: blue; }
:root[data-value="\\\\"] { --color-example: green; }
@layer components { article .generated-child { color: var(--color-example); } }
@layer bp-state {
  /* Override invariant: collapsed display beats the resting display utility. */
  [data-collapsed] { display: none; }
}
`,
    "review/browser/review.css": `${HEADER}
@layer components { [data-block-id] .review-anchor { color: var(--color-example); } }
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
      "/* Component styles. */ @layer components { article .owned { color: red; } }",
    "components/unlayered/styles.css": `${HEADER} article .generated-child { color: red; }`,
    "components/unknown-layer/styles.css": `${HEADER} @layer component-name { article .generated-child { color: red; } }`,
    "components/unexplained-state/styles.css": `${HEADER} @layer bp-state { [data-open] { display: block; } }`,
  });
  assert.equal(failures.length, 4);
  assert.match(failures.join("\n"), /file-level comment must include/);
  assert.match(failures.join("\n"), /presentation rule is unlayered/);
  assert.match(failures.join("\n"), /may use only/);
  assert.match(failures.join("\n"), /Override invariant:/);
});

test("should not accept readability as a file-level escape-hatch reason", async () => {
  const failures = await checkSource({
    "render/global.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
`,
    "components/readable/styles.css": `/* CSS escape hatch: local readability keeps these together. */
@layer components { article [data-owned] { color: red; } }
`,
  });
  assert.equal(failures.length, 1);
  assert.match(failures.join("\n"), /readability is not a file-level reason/);
});

test("should require one canonical layer order at the stylesheet entrypoint", async () => {
  const missing = await checkSource({
    "render/global.css": `${HEADER}
@layer components { article .generated-child { color: red; } }
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
@layer components { article .model-owned { color: red; } }
`,
    "components/example/styles.css": `${HEADER}
@layer bp-state {
  @layer components {
    article .nested { color: red; }
  }
}
`,
  });
  assert.match(failures.join("\n"), /outside a visual owner/);
  assert.match(failures.join("\n"), /presentation rule is unlayered/);
  assert.match(failures.join("\n"), /nested layer blocks/);
  assert.match(failures.join("\n"), /Override invariant:/);
});

test("should reject a stylesheet sitting directly under components", async () => {
  const failures = await checkSource({
    "components/styles.css": `${HEADER}
@layer components { article .generated-child { color: red; } }
`,
  });
  assert.match(failures.join("\n"), /outside a visual owner/);
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

test("should reject a class-only rule that styles markup its own view renders", async () => {
  const failures = await checkSource({
    "render/global.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
`,
    "components/island/styles.css": `${HEADER}
@layer components {
  .island-card { padding: 1rem; }
  .island-card.is-wide { padding: 2rem; }
}
`,
  });
  assert.equal(failures.length, 2);
  assert.match(failures.join("\n"), /selects only classes/);
  assert.match(failures.join("\n"), /\.island-card\.is-wide/);
});

test("should accept a class-only rule whose utility form is written out, or a declared drawing system", async () => {
  const explained = await checkSource({
    "render/global.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
`,
    "components/island/styles.css": `${HEADER}
@layer components {
  /* Utility form: p-4 shadow-floating, unreadable beside the stroke geometry. */
  .island-card { padding: 1rem; }
}
`,
  });
  assert.deepEqual(explained, []);

  const drawing = await checkSource(
    {
      "render/global.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
`,
      "components/sketch/styles.css": `${HEADER}
@layer components { .sketch-stroke { border-radius: 1rem; } }
`,
    },
    { drawingSystems: new Set(["src/components/sketch/styles.css"]) },
  );
  assert.deepEqual(drawing, []);

  const bothInventories = await checkSource(
    {
      "render/global.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
`,
      "components/sketch/styles.css": `${HEADER}
@layer components { .sketch-stroke { border-radius: 1rem; } }
`,
    },
    {
      drawingSystems: new Set(["src/components/sketch/styles.css"]),
      budgets: {
        "src/components/sketch/styles.css": {
          declarations: 40,
          classOnlyRules: 1,
        },
      },
    },
  );
  assert.equal(bothInventories.length, 1);
  assert.match(
    bothInventories.join("\n"),
    /recorded both as a drawing system and as class-only debt/,
  );
});

test("should reject a bare Utility form marker with nothing written out", async () => {
  const failures = await checkSource({
    "render/global.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
`,
    "components/island/styles.css": `${HEADER}
@layer components {
  /* Utility form: */
  .island-card { padding: 1rem; }
  /* Utility form:    */
  .island-title { font-weight: 600; }
}
`,
  });
  assert.equal(failures.length, 2);
  assert.match(failures.join("\n"), /\.island-card/);
  assert.match(failures.join("\n"), /\.island-title/);
});

test("should recognize class names across the CSS identifier grammar", async () => {
  const failures = await checkSource({
    "render/global.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
`,
    "components/island/styles.css": `${HEADER}
@layer components {
  ._leading-underscore { color: red; }
  .-leading-hyphen { color: red; }
  .café-card { color: red; }
  .escaped\\/slash { color: red; }
  .\\31 23 { color: red; }
  .\\000061 card { color: red; }
  .\\000061-card { color: red; }
}
`,
  });
  assert.equal(failures.length, 7);
  assert.match(failures.join("\n"), /selects only classes/);
  assert.match(failures.join("\n"), /\\31 23/);
  assert.match(failures.join("\n"), /\\000061 card/);
  assert.match(failures.join("\n"), /\\000061-card/);
});

test("should normalize selector comments without collapsing descendant whitespace", async () => {
  const failures = await checkSource({
    "render/global.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
`,
    "components/island/styles.css": `${HEADER}
@layer components {
  .owned/**/.wide { color: red; }
  .owned/*,*/.wide { color: red; }
  .owned/* x */ .descendant { color: red; }
}
`,
  });
  assert.equal(failures.length, 2);
  assert.match(failures.join("\n"), /\.owned\/\*\*\/\.wide/);
  assert.match(failures.join("\n"), /\.owned\/\*,\*\/\.wide/);
});

test("should still relate a class to something other than another class", async () => {
  const failures = await checkSource({
    "render/global.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
`,
    "components/island/styles.css": `${HEADER}
@layer components {
  article ._leading-underscore { color: red; }
  ._leading-underscore:hover { color: red; }
  ._leading-underscore[data-open] { color: red; }
  ._leading-underscore > ._child { color: red; }
}
`,
  });
  assert.deepEqual(failures, []);
});

test("should hold recorded class-only debt still and require it to shrink to zero", async () => {
  const stylesheets = {
    "render/global.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
`,
    "review/browser/review.css": `${HEADER}
@layer components {
  .review-card { padding: 1rem; }
  .review-title { font-weight: 600; }
}
`,
  };
  const budgets = {
    "src/review/browser/review.css": { declarations: 40, classOnlyRules: 2 },
  };
  assert.deepEqual(await checkSource(stylesheets, { budgets }), []);

  const grown = await checkSource(stylesheets, {
    budgets: {
      "src/review/browser/review.css": { declarations: 40, classOnlyRules: 1 },
    },
  });
  assert.equal(grown.length, 1);
  assert.match(grown.join("\n"), /2 class-only-selector rules against/);

  const shrunk = await checkSource(stylesheets, {
    budgets: {
      "src/review/browser/review.css": { declarations: 40, classOnlyRules: 3 },
    },
  });
  assert.equal(shrunk.length, 1);
  assert.match(shrunk.join("\n"), /this debt only shrinks, so record 2/);
});

test("should bound an unrecorded stylesheet and ratchet a recorded one", async () => {
  const entrypoint = {
    "render/global.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
`,
  };
  assert.deepEqual(
    await checkSource({
      ...entrypoint,
      "components/small/styles.css": stylesheetOfSize(40),
    }),
    [],
  );

  const unrecorded = await checkSource({
    ...entrypoint,
    "components/large/styles.css": stylesheetOfSize(41),
  });
  assert.equal(unrecorded.length, 1);
  assert.match(unrecorded.join("\n"), /41 declarations exceed the 40/);

  const budgets = { "src/components/large/styles.css": { declarations: 41 } };
  assert.deepEqual(
    await checkSource(
      { ...entrypoint, "components/large/styles.css": stylesheetOfSize(41) },
      { budgets },
    ),
    [],
  );
  assert.deepEqual(
    await checkSource(
      { ...entrypoint, "components/large/styles.css": stylesheetOfSize(10) },
      { budgets },
    ),
    [],
  );

  const grown = await checkSource(
    { ...entrypoint, "components/large/styles.css": stylesheetOfSize(42) },
    { budgets },
  );
  assert.equal(grown.length, 1);
  assert.match(grown.join("\n"), /exceed the recorded budget of 41/);
});

test("should keep the shell free of stylesheets and src/render limited to named files", async () => {
  const failures = await checkSource({
    "render/global.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
`,
    "render/shell/review.css": `${HEADER}
@layer components { article [data-block-id] { color: red; } }
`,
    "render/unnamed.css": `${HEADER}
@layer components { article [data-slide] { color: red; } }
`,
  });
  assert.equal(failures.length, 2);
  assert.match(failures.join("\n"), /the shell owns viewer chrome/);
  assert.match(
    failures.join("\n"),
    /src\/render holds only the named document-wide stylesheets/,
  );
});

test("should report an allowlist entry whose stylesheet no longer exists", async () => {
  const failures = await checkSource(
    {
      "render/global.css": `${HEADER}
@layer theme, base, components, utilities, bp-state;
`,
    },
    { budgets: { "src/components/deleted/styles.css": { declarations: 90 } } },
  );
  assert.equal(failures.length, 1);
  assert.match(failures.join("\n"), /remove the stale entry/);
});

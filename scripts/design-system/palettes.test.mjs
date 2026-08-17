// Proves the palette check rejects an incomplete palette and a pairing that
// falls below WCAG AA, and accepts a palette that satisfies both.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkPalettes,
  contrastRatio,
  parseColor,
  resolveValue,
  splitArguments,
} from "./palettes.mjs";

const BASE_CSS = `:root {
  --grey-50: #ffffff;
  --grey-925: #1b1b1b;
  --grey-150: #f0f0f0;
  --grey-950: #101010;
  --bg: light-dark(var(--grey-50), var(--grey-950));
  --ink-c: light-dark(var(--grey-925), var(--grey-150));
}
`;

const SYNTAX_CSS =
  ":root {\n  --syntax-keyword-c: light-dark(#333333, #dddddd);\n}\n";

test("runs without Node TypeScript support or a prior build", () => {
  const disableTypeStripping = [
    "--no-strip-types",
    "--no-experimental-strip-types",
  ].find((flag) => process.allowedNodeEnvironmentFlags.has(flag));
  const result = spawnSync(
    process.execPath,
    [
      ...(disableTypeStripping === undefined ? [] : [disableTypeStripping]),
      fileURLToPath(new URL("./palettes.mjs", import.meta.url)),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /palettes: passed \(5 palettes\)/);
});

/** Checks a throwaway palette set rather than today's five. */
const runAgainst = async ({ paletteCss }) => {
  const root = await mkdtemp(join(tmpdir(), "big-plan-palettes-"));
  try {
    const globalCss = join(root, "global.css");
    const syntaxCss = join(root, "syntax-highlighting.css");
    await writeFile(globalCss, `${BASE_CSS}\n${paletteCss}`, "utf8");
    await writeFile(syntaxCss, SYNTAX_CSS, "utf8");
    return await checkPalettes({
      globalCss,
      syntaxCss,
      paletteIds: ["default", "sample"],
      storedPaletteIds: ["sample"],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test("splits a light-dark() call on its own comma", () => {
  assert.deepEqual(
    splitArguments("var(--a), color-mix(in srgb, var(--b) 8%, transparent)"),
    ["var(--a)", "color-mix(in srgb, var(--b) 8%, transparent)"],
  );
});

test("resolves a role through a palette override for one mode", () => {
  const base = new Map([
    ["grey-50", "#ffffff"],
    ["grey-950", "#101010"],
    ["bg", "light-dark(var(--grey-50), var(--grey-950))"],
  ]);
  const overrides = new Map([["grey-950", "#001122"]]);
  const lookup = (name) => overrides.get(name) ?? base.get(name);
  assert.equal(
    resolveValue({ value: lookup("bg"), mode: "light", lookup }),
    "#ffffff",
  );
  assert.equal(
    resolveValue({ value: lookup("bg"), mode: "dark", lookup }),
    "#001122",
  );
});

test("measures contrast the way WCAG defines it", () => {
  assert.equal(
    Math.round(contrastRatio(parseColor("#000000"), parseColor("#ffffff"))),
    21,
  );
});

test("accepts a complete palette that clears the contrast floor", async () => {
  const result = await runAgainst({
    paletteCss: `[data-palette="sample"] {
  --grey-50: #fdfdfd;
  --grey-925: #202020;
  --grey-150: #eeeeee;
  --grey-950: #121212;
}
`,
  });
  assert.deepEqual(result.failures, []);
  assert.equal(result.paletteCount, 2);
});

test("rejects a palette that omits a ramp step the roles reach", async () => {
  const result = await runAgainst({
    paletteCss: `[data-palette="sample"] {
  --grey-50: #fdfdfd;
  --grey-925: #202020;
  --grey-150: #eeeeee;
}
`,
  });
  assert.deepEqual(result.failures, [
    'global.css: palette "sample" is missing ramp steps the roles reach: --grey-950',
  ]);
});

test("rejects a palette pairing below WCAG AA", async () => {
  const result = await runAgainst({
    paletteCss: `[data-palette="sample"] {
  --grey-50: #fdfdfd;
  --grey-925: #cccccc;
  --grey-150: #eeeeee;
  --grey-950: #121212;
}
`,
  });
  assert.equal(
    result.failures.some(
      (failure) =>
        failure.includes("--ink-c (#cccccc) on --bg (#fdfdfd)") &&
        failure.includes("below the 4.5:1 WCAG AA floor"),
    ),
    true,
    result.failures.join("\n"),
  );
});

test("rejects a palette that restates a role instead of a shade", async () => {
  const result = await runAgainst({
    paletteCss: `[data-palette="sample"] {
  --grey-50: #fdfdfd;
  --grey-925: #202020;
  --grey-150: #eeeeee;
  --grey-950: #121212;
  --radius-md: 0;
  --bg: light-dark(#ff0000, #00ff00);
}
`,
  });
  assert.deepEqual(result.failures.slice(0, 1), [
    'global.css: palette "sample" declares --bg; a palette may declare ramp steps, syntax tokens, comment-surface tokens, the closed radius, weight, tracking, and elevation scales, and --ink-c',
  ]);
});

test("accepts a palette that restates the comment surface", async () => {
  const result = await runAgainst({
    paletteCss: `[data-palette="sample"] {
  --grey-50: #fdfdfd;
  --grey-925: #202020;
  --grey-150: #eeeeee;
  --grey-950: #121212;
  --comment-header-c: light-dark(var(--grey-150), var(--grey-925));
  --agent-active-ring-c: light-dark(var(--grey-150), var(--grey-925));
}
`,
  });
  assert.deepEqual(result.failures, []);
});

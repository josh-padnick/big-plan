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
const runAgainst = async ({ paletteCss, baseCss = BASE_CSS }) => {
  const root = await mkdtemp(join(tmpdir(), "big-plan-palettes-"));
  try {
    const globalCss = join(root, "global.css");
    const syntaxCss = join(root, "syntax-highlighting.css");
    await writeFile(globalCss, `${baseCss}\n${paletteCss}`, "utf8");
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
    'global.css: palette "sample" is missing shades the roles reach: --grey-950',
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

// The toolbar band and the control chrome that sits on it, wired the way
// src/render/global.css wires them, so a throwaway palette can move the chrome
// neutrals and be judged on what a reader would actually see.
const CHROME_BASE_CSS = `${BASE_CSS}:root {
  --neutral-100: #eeeeee;
  --neutral-150: #e8e8e8;
  --neutral-300: #c4c4c4;
  --neutral-400: #a9a9a9;
  --chrome-dark-band: #2b2b2b;
  --chrome-dark-lift: #424242;
  --chrome-dark-edge: #474747;
  --chrome-dark-edge-strong: #5f5f5f;
  --toolbar-bg: light-dark(var(--neutral-150), var(--chrome-dark-band));
  --toolbar-edge-c: light-dark(var(--neutral-300), var(--chrome-dark-edge));
  --toolbar-edge-strong-c: light-dark(
    var(--neutral-400),
    var(--chrome-dark-edge-strong)
  );
  --toolbar-surface-c: light-dark(var(--neutral-100), var(--chrome-dark-lift));
}
`;

/** The chrome shades a palette declares, as global.css lays them out. */
const chromePalette = ({
  n100 = "#e2ded0",
  n150 = "#dcd8ca",
  n300,
  n400,
  band = "#1f1f1f",
  lift,
  edge,
  edgeStrong,
}) =>
  `[data-palette="sample"] {
  --grey-50: #fdfdfd;
  --grey-925: #202020;
  --grey-150: #eeeeee;
  --grey-950: #121212;
  --neutral-100: ${n100};
  --neutral-150: ${n150};
  --neutral-300: ${n300};
  --neutral-400: ${n400};
  --chrome-dark-band: ${band};
  --chrome-dark-lift: ${lift};
  --chrome-dark-edge: ${edge};
  --chrome-dark-edge-strong: ${edgeStrong};
}
`;

/** The shipped brutalist chrome shades, which clear every floor and ladder. */
const SOUND_CHROME = {
  n300: "#b8b5a7",
  n400: "#9d9a8d",
  lift: "#383838",
  edge: "#3a3a3a",
  edgeStrong: "#515151",
};

test("rejects a toolbar edge that dissolves into its chrome grounds", async () => {
  const result = await runAgainst({
    baseCss: CHROME_BASE_CSS,
    paletteCss: chromePalette({
      ...SOUND_CHROME,
      n300: "#d5d1c5",
      n400: "#cbc7bb",
      lift: "#242424",
      edge: "#292929",
      edgeStrong: "#303030",
    }),
  });
  const toolbarEdges = result.failures.filter((failure) =>
    failure.includes("toolbar-edge distinction floor"),
  );
  assert.deepEqual(
    toolbarEdges.map((failure) => failure.split(":")[0]),
    [
      "sample/light",
      "sample/light",
      "sample/light",
      "sample/dark",
      "sample/dark",
      "sample/dark",
    ],
    result.failures.join("\n"),
  );
  assert.equal(
    toolbarEdges.some((failure) =>
      failure.includes("--toolbar-edge-c (#d5d1c5) on --toolbar-bg (#dcd8ca)"),
    ),
    true,
    toolbarEdges.join("\n"),
  );
  assert.equal(
    toolbarEdges.some((failure) =>
      failure.includes("--toolbar-edge-c (#292929) on --toolbar-bg (#1f1f1f)"),
    ),
    true,
    toolbarEdges.join("\n"),
  );
});

test("accepts a subtle toolbar edge that stays distinct from band and lift", async () => {
  const result = await runAgainst({
    baseCss: CHROME_BASE_CSS,
    paletteCss: chromePalette(SOUND_CHROME),
  });
  assert.deepEqual(
    result.failures.filter((failure) =>
      failure.includes("toolbar-edge distinction floor"),
    ),
    [],
    result.failures.join("\n"),
  );
});

test("rejects a chrome ramp whose higher number is the lighter shade", async () => {
  const result = await runAgainst({
    baseCss: CHROME_BASE_CSS,
    paletteCss: chromePalette({
      ...SOUND_CHROME,
      n300: "#6c6c6c",
      n400: "#949494",
    }),
  });
  assert.equal(
    result.failures.some(
      (failure) =>
        failure.includes("--neutral-300") &&
        failure.includes("--neutral-400") &&
        failure.includes("a higher ramp number must never be lighter"),
    ),
    true,
    result.failures.join("\n"),
  );
});

test("accepts a chrome ramp that descends with its numbers", async () => {
  const result = await runAgainst({
    baseCss: CHROME_BASE_CSS,
    paletteCss: chromePalette(SOUND_CHROME),
  });
  assert.deepEqual(
    result.failures.filter((failure) =>
      failure.includes("a higher ramp number must never be lighter"),
    ),
    [],
    result.failures.join("\n"),
  );
});

test("rejects a dark chrome lift that sinks below its own band", async () => {
  const result = await runAgainst({
    baseCss: CHROME_BASE_CSS,
    paletteCss: chromePalette({
      ...SOUND_CHROME,
      band: "#1f1f1f",
      lift: "#1a1a1a",
    }),
  });
  assert.equal(
    result.failures.some(
      (failure) =>
        failure.includes("--chrome-dark-lift") &&
        failure.includes("--chrome-dark-band") &&
        failure.includes("the dark chrome ladder climbs"),
    ),
    true,
    result.failures.join("\n"),
  );
});

test("rejects a dark chrome lift that only matches its band", async () => {
  const result = await runAgainst({
    baseCss: CHROME_BASE_CSS,
    paletteCss: chromePalette({
      ...SOUND_CHROME,
      band: "#1f1f1f",
      lift: "#1f1f1f",
    }),
  });
  assert.equal(
    result.failures.some(
      (failure) =>
        failure.includes("--chrome-dark-lift") &&
        failure.includes("--chrome-dark-band") &&
        failure.includes("the dark chrome ladder climbs"),
    ),
    true,
    result.failures.join("\n"),
  );
});

test("follows a chrome shade written as a reference instead of a literal", async () => {
  const result = await runAgainst({
    baseCss: CHROME_BASE_CSS,
    paletteCss: chromePalette({
      ...SOUND_CHROME,
      band: "#1f1f1f",
      lift: "var(--grey-950)",
    }),
  });
  assert.equal(
    result.failures.some(
      (failure) =>
        failure.includes("--chrome-dark-lift") &&
        failure.includes("the dark chrome ladder climbs"),
    ),
    true,
    result.failures.join("\n"),
  );
});

test("refuses a chrome shade it cannot reduce to a colour", async () => {
  const result = await runAgainst({
    baseCss: CHROME_BASE_CSS,
    paletteCss: chromePalette({ ...SOUND_CHROME, lift: "var(--nowhere)" }),
  });
  assert.equal(
    result.failures.some((failure) =>
      failure.includes(
        "could not resolve chrome shade --chrome-dark-lift to a colour",
      ),
    ),
    true,
    result.failures.join("\n"),
  );
});

test("rejects a palette that omits a named chrome shade the roles reach", async () => {
  const result = await runAgainst({
    baseCss: CHROME_BASE_CSS,
    paletteCss: `[data-palette="sample"] {
  --grey-50: #fdfdfd;
  --grey-925: #202020;
  --grey-150: #eeeeee;
  --grey-950: #121212;
  --neutral-100: #e2ded0;
  --neutral-150: #dcd8ca;
  --neutral-300: #7c7868;
  --neutral-400: #716d5f;
  --chrome-dark-band: #1f1f1f;
  --chrome-dark-edge: #6c6c6c;
  --chrome-dark-edge-strong: #848484;
}
`,
  });
  assert.equal(
    result.failures.some(
      (failure) =>
        failure.includes("is missing shades the roles reach") &&
        failure.includes("--chrome-dark-lift"),
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
    'global.css: palette "sample" declares --bg; a palette may declare ramp steps, chrome shades, syntax tokens, comment-surface tokens, the closed radius, weight, tracking, and elevation scales, and --ink-c',
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
}
`,
  });
  assert.deepEqual(result.failures, []);
});

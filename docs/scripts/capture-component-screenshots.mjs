// Captures the light and dark component screenshots embedded in the docs
// component pages. Renders small MDX fixtures with the local CLI, then
// screenshots the same regions in both color schemes so each light/dark
// pair shares one crop. Run from docs/ via `bun run screenshots` after
// building the renderer.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import {
  ANNOTATION_FIXTURE,
  CALLOUTS_FIXTURE,
  DIFF_FIXTURE,
  FILE_TREE_FIXTURE,
  SNIPPET_FIXTURE,
  TREE_DIFF_FIXTURE,
} from "./component-fixtures.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = join(ROOT, "docs", "src", "assets", "components");
const CLI = join(ROOT, "bin", "big-plan.mjs");

/** Renders an MDX fixture through the CLI and returns the output HTML path. */
const renderFixture = ({ dir, name, mdx }) => {
  const input = join(dir, `${name}.mdx`);
  const output = join(dir, `${name}.html`);
  writeFileSync(input, mdx);
  execFileSync(process.execPath, [CLI, "render", input, output]);
  return output;
};

/** Screenshots one region of a rendered fixture in one color scheme. */
const capture = async ({
  browser,
  colorScheme,
  html,
  prepare,
  shoot,
  out,
  width = 760,
}) => {
  const context = await browser.newContext({
    colorScheme,
    viewport: { width, height: 1600 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(`file://${html}`);
  if (prepare) {
    await prepare(page);
  }
  await shoot(page, join(OUT_DIR, out));
  await context.close();
};

/** Screenshots the union of every callout box, padded, in page coordinates. */
const shootCallouts = async (page, path) => {
  const clip = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll("[data-callout]")].map((el) =>
      el.getBoundingClientRect(),
    );
    const pad = 8;
    const left = Math.min(...boxes.map((b) => b.left)) - pad;
    const top = Math.min(...boxes.map((b) => b.top)) + window.scrollY - pad;
    const right = Math.max(...boxes.map((b) => b.right)) + pad;
    const bottom =
      Math.max(...boxes.map((b) => b.bottom)) + window.scrollY + pad;
    return { x: left, y: top, width: right - left, height: bottom - top };
  });
  await page.screenshot({ path, clip });
};

/** Screenshots the CodeDiff figure element. */
const shootFigure = async (page, path) => {
  await page.locator("figure[data-code-diff]").screenshot({ path });
};

/** Screenshots the CodeSnippet figure element. */
const shootSnippet = async (page, path) => {
  await page.locator("figure[data-code-snippet]").screenshot({ path });
};

/** Screenshots the FileTree figure element. */
const shootFileTree = async (page, path) => {
  await page.locator("figure[data-file-tree]").screenshot({ path });
};

/** Screenshots the FileTreeDiff figure element. */
const shootFileTreeDiff = async (page, path) => {
  await page.locator("figure[data-file-tree-diff]").screenshot({ path });
};

/** Switches the tree to the side-by-side view. */
const openSideBySide = async (page) => {
  await page.click('[data-tree-set-view="before-after"]');
  await page.waitForSelector('[data-tree-content="before-after"]', {
    state: "visible",
  });
};

/** Switches to side-by-side view and opens the actions menu. */
const openSplitAndMenu = async (page) => {
  await page.click('[data-diff-set-view="split"]');
  await page.click("[data-diff-menu-button]");
  await page.waitForSelector("[data-diff-menu-list]", { state: "visible" });
};

const SHOTS = [
  {
    name: "callouts",
    mdx: CALLOUTS_FIXTURE,
    base: "callout-types",
    shoot: shootCallouts,
  },
  {
    name: "diff-split",
    mdx: DIFF_FIXTURE,
    base: "code-diff-split",
    shoot: shootFigure,
    prepare: openSplitAndMenu,
  },
  {
    name: "annotation",
    mdx: ANNOTATION_FIXTURE,
    base: "annotation-card",
    shoot: shootFigure,
  },
  {
    name: "snippet",
    mdx: SNIPPET_FIXTURE,
    base: "code-snippet-annotated",
    shoot: shootSnippet,
  },
  {
    name: "file-tree",
    mdx: FILE_TREE_FIXTURE,
    base: "file-tree-plain",
    shoot: shootFileTree,
  },
  {
    name: "tree-diff-combined",
    mdx: TREE_DIFF_FIXTURE,
    base: "file-tree-diff-combined",
    shoot: shootFileTreeDiff,
  },
  {
    name: "tree-diff-panes",
    mdx: TREE_DIFF_FIXTURE,
    base: "file-tree-diff-panes",
    shoot: shootFileTreeDiff,
    prepare: openSideBySide,
    width: 1200,
  },
];

const dir = mkdtempSync(join(tmpdir(), "big-plan-shots-"));
const browser = await chromium.launch();
try {
  for (const shot of SHOTS) {
    const html = renderFixture({ dir, name: shot.name, mdx: shot.mdx });
    for (const colorScheme of ["light", "dark"]) {
      await capture({
        browser,
        colorScheme,
        html,
        prepare: shot.prepare,
        shoot: shot.shoot,
        out: `${shot.base}-${colorScheme}.png`,
        width: shot.width,
      });
      console.log(`captured ${shot.base}-${colorScheme}.png`);
    }
  }
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}

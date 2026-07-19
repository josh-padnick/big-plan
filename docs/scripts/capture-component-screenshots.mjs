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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = join(ROOT, "docs", "src", "assets", "components");
const CLI = join(ROOT, "bin", "big-plan.mjs");

const CALLOUTS_FIXTURE = `<Callout type="note" title="Review decision">

Approving this plan green-lights the cache rewrite; the rollout plan ships separately.

</Callout>

<Callout type="tip">

Render this plan locally with \`npx big-plan render plan.mdx\` to review it in your own browser.

</Callout>

<Callout type="warning" title="Deploy ordering">

Enable the worker before raising the stale-read window, or reads serve stale data with no refresh running.

</Callout>

<Callout type="danger">

Skipping the backfill drops rows written during the migration window; there is no recovery path.

</Callout>
`;

const DIFF_FIXTURE = `<CodeDiff file="src/catalog/read-through-cache.ts" showLineNumbers showLineCounts>

\`\`\`diff
@@ -18,4 +18,7 @@ export const readCatalog = async (key: string) => {
   const cached = await cache.get(key);
-  if (cached !== null && cached.ageSeconds <= 60) {
+  if (cached !== null && cached.ageSeconds <= 150) {
+    if (cached.ageSeconds > 60) {
+      await refreshQueue.enqueueOnce(key);
+    }
     return cached.value;
   }
\`\`\`

</CodeDiff>
`;

const ANNOTATION_FIXTURE = `<CodeDiff file="src/catalog/read-through-cache.ts" showLineNumbers>

\`\`\`diff
@@ -18,4 +18,7 @@ export const readCatalog = async (key: string) => {
   const cached = await cache.get(key);
-  if (cached !== null && cached.ageSeconds <= 60) {
+  if (cached !== null && cached.ageSeconds <= 150) {
+    if (cached.ageSeconds > 60) {
+      await refreshQueue.enqueueOnce(key);
+    }
     return cached.value;
   }
\`\`\`

<Annotation lines="19-22" side="new">
This range turns the cache-age check into a stale-while-revalidate policy: entries under 60 seconds serve directly, entries between 60 and 150 serve stale while a background refresh runs, and older entries fall through to the origin.
</Annotation>

</CodeDiff>
`;

/** Renders an MDX fixture through the CLI and returns the output HTML path. */
const renderFixture = ({ dir, name, mdx }) => {
  const input = join(dir, `${name}.mdx`);
  const output = join(dir, `${name}.html`);
  writeFileSync(input, mdx);
  execFileSync(process.execPath, [CLI, "render", input, output]);
  return output;
};

/** Screenshots one region of a rendered fixture in one color scheme. */
const capture = async ({ browser, colorScheme, html, prepare, shoot, out }) => {
  const context = await browser.newContext({
    colorScheme,
    viewport: { width: 760, height: 1600 },
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
      });
      console.log(`captured ${shot.base}-${colorScheme}.png`);
    }
  }
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}

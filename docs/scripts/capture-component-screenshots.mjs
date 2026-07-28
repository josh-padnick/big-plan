// Captures the light and dark viewer and component screenshots embedded in
// the docs. Renders fixtures with the local CLI, then screenshots the same
// regions in both color schemes so each light/dark pair shares one crop. Run
// from docs/ via `bun run screenshots` after building the renderer.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = join(ROOT, "docs", "src", "assets", "components");
const VIEWER_OUT_DIR = join(ROOT, "docs", "src", "assets");
const VIEWER_FIXTURE = readFileSync(
  join(ROOT, "docs", "src", "demo", "example-plan.md"),
  "utf8",
);
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

const SNIPPET_FIXTURE = `<CodeSnippet file="src/catalog/refresh-worker.ts" startLine="42" showLineNumbers>

\`\`\`ts
export const refreshCatalog = async (key: string): Promise<void> => {
  const current = await catalogOrigin.read(key);
  await cache.put(key, current, { ttlSeconds: 300 });
  metrics.increment("catalog_cache.refresh_success");
};
\`\`\`

<Annotation lines="43">

Resolve through \`catalogOrigin\` so refreshes use the same retries and tracing as synchronous fallbacks.

</Annotation>

<Annotation lines="44-45">

The cache write must complete before success is recorded; otherwise dashboards can report a refresh that readers cannot observe.

</Annotation>

</CodeSnippet>
`;

const FILE_TREE_FIXTURE = `<FileTree title="Worker pool layout">

\`\`\`tree
worker-pool/
  refresh-worker.ts - Consumes deduplicated catalog refresh jobs.
  worker-config.ts - Owns concurrency and timeout settings.
\`\`\`

</FileTree>
`;

const TREE_DIFF_FIXTURE = `<FileTreeDiff title="Planned changes">

\`\`\`tree
src/
  catalog/
    catalog-origin.ts
    refresh-worker.ts [modified] - Move refresh work behind the queue.
    refresh-queue.ts [added] - Deduplicate refresh jobs by cache key.
  metrics/ [removed] - The legacy metrics module retires with its counter.
    legacy-cache-counter.ts [removed]
  queue/ [added] - New home for queue worker configuration.
    queue-config.ts [added]
ops/ -> deploy/ [renamed] - Match the platform team's naming.
  runbook.md
README.md [modified]
\`\`\`

</FileTreeDiff>
`;

const BIG_DECISION_FIXTURE = `<BigDecision question="Which persistence layer should back review comments?" status="open">

Comments need durable identities and ordered replies without blocking a later multi-reviewer workflow.

<Criterion title="Anchor integrity">

Selection anchors and their threads must stay consistent through crashes.

</Criterion>

<Criterion title="Local-first setup" />

<Criterion title="Concurrent reviewers" />

<Option title="PostgreSQL" recommended summary="The relational store the team already operates.">

<Score criterion="Anchor integrity" verdict="Strong" tone="good">

Transactions keep a thread and its anchor in one atomic write.

</Score>

<Score criterion="Local-first setup" verdict="Needs a server" tone="bad" />

<Score criterion="Concurrent reviewers" verdict="Ready" tone="good" />

</Option>

<Option title="SQLite" summary="One embedded database beside the local server.">

<Score criterion="Anchor integrity" verdict="Strong" tone="good" />

<Score criterion="Local-first setup" verdict="Zero setup" tone="good" />

<Score criterion="Concurrent reviewers" verdict="Single writer" tone="mixed" />

</Option>

<Reversibility rating="somewhat-hard">

The repository layer isolates SQL, so swapping engines later costs a data migration.

</Reversibility>

</BigDecision>
`;

const SMALL_DECISION_SET_FIXTURE = `<SmallDecisionSet title="Open questions">

<SmallDecision question="Should the first release ship behind a feature flag?">

<Option title="Yes" recommended>

Keeps rollback one toggle away during the risky window.

</Option>

<Option title="No">

Avoids the flag-cleanup follow-up task.

</Option>

</SmallDecision>

<SmallDecision question="When do we remove the legacy endpoint?">

<Option title="Same release" />

<Option title="One release later" recommended>

Gives integrators one cycle of overlap.

</Option>

</SmallDecision>

</SmallDecisionSet>
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
const capture = async ({
  browser,
  colorScheme,
  html,
  shoot,
  out,
  outDir = OUT_DIR,
  width = 760,
  height = 1600,
}) => {
  const context = await browser.newContext({
    colorScheme,
    viewport: { width, height },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(`file://${html}`);
  await shoot(page, join(outDir, out));
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

/** Screenshots the BigDecision figure element. */
const shootBigDecision = async (page, path) => {
  await page.locator("figure[data-big-decision]").screenshot({ path });
};

/** Screenshots the SmallDecisionSet figure element. */
const shootSmallDecisionSet = async (page, path) => {
  await page.locator("figure[data-small-decision-set]").screenshot({ path });
};

/** Screenshots a square crop beginning at the review document's article. */
const shootViewer = async (page, path) => {
  const article = await page.locator("article").boundingBox();
  if (article === null) {
    throw new Error("Rendered viewer has no article.");
  }
  await page.screenshot({
    path,
    clip: {
      x: article.x,
      y: article.y,
      width: Math.min(article.width, 744),
      height: 744,
    },
  });
};

/** Screenshots the shell and unified diff at a representative reading point. */
const shootFullViewer = async (page, path) => {
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    const heading = document.querySelector("#code-diff");
    if (heading === null) {
      throw new Error("Rendered viewer has no Code diff section.");
    }
    heading.scrollIntoView();
    window.scrollBy({ top: -96 });
  });
  await page.waitForFunction(
    () =>
      Math.abs(
        (document.querySelector("#code-diff")?.getBoundingClientRect().top ??
          0) - 96,
      ) < 2,
  );
  await page.screenshot({ path });
};

const SHOTS = [
  {
    name: "callouts",
    mdx: CALLOUTS_FIXTURE,
    base: "callout-types",
    shoot: shootCallouts,
  },
  {
    name: "annotation",
    mdx: ANNOTATION_FIXTURE,
    base: "annotation-card",
    shoot: shootFigure,
  },
  {
    name: "big-decision",
    mdx: BIG_DECISION_FIXTURE,
    base: "big-decision",
    shoot: shootBigDecision,
  },
  {
    name: "small-decision-set",
    mdx: SMALL_DECISION_SET_FIXTURE,
    base: "small-decision-set",
    shoot: shootSmallDecisionSet,
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
];

const dir = mkdtempSync(join(tmpdir(), "big-plan-shots-"));
const browser = await chromium.launch();
try {
  const viewerHtml = renderFixture({
    dir,
    name: "viewer",
    mdx: VIEWER_FIXTURE,
  });
  for (const colorScheme of ["light", "dark"]) {
    await capture({
      browser,
      colorScheme,
      html: viewerHtml,
      shoot: shootViewer,
      out: `viewer-${colorScheme}.png`,
      outDir: VIEWER_OUT_DIR,
      width: 1280,
      height: 900,
    });
    console.log(`captured viewer-${colorScheme}.png`);
    await capture({
      browser,
      colorScheme,
      html: viewerHtml,
      shoot: shootFullViewer,
      out: `viewer-full-${colorScheme}.png`,
      outDir: VIEWER_OUT_DIR,
      width: 1280,
      height: 900,
    });
    console.log(`captured viewer-full-${colorScheme}.png`);
  }
  for (const shot of SHOTS) {
    const html = renderFixture({ dir, name: shot.name, mdx: shot.mdx });
    for (const colorScheme of ["light", "dark"]) {
      await capture({
        browser,
        colorScheme,
        html,
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

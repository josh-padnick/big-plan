// The suite's extended Playwright test, per the render-health rule: every
// spec fails on console errors or uncaught page errors automatically, and the
// fixture documents are rendered once per worker through the built CLI so
// specs exercise exactly what a user runs. Specs import test/expect from here,
// never from @playwright/test directly.

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { Locator } from "@playwright/test";
import { expect, test as base } from "@playwright/test";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

type WorkerFixtures = {
  readonly mdxBlocksViewerUrl: string;
  readonly nestedDiffViewerUrl: string;
  readonly sampleViewerUrl: string;
};

const NESTED_DIFF_MDX = `# Nested diff

<CodeDiff file="outer.ts">

\`\`\`diff
@@ -1 +1 @@
-oldOuter();
+newOuter();
\`\`\`

<Annotation lines="1">

Inspect the nested change.

<CodeDiff file="inner.ts">

\`\`\`diff
@@ -2 +2 @@
-oldInner();
+newInner();
\`\`\`

</CodeDiff>

</Annotation>

</CodeDiff>
`;

export const test = base.extend<NonNullable<unknown>, WorkerFixtures>({
  // The typed-block example has its own rendered artifact so the plain sample
  // remains the baseline for the original viewer journeys.
  mdxBlocksViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(join(tmpdir(), "big-plan-mdx-blocks-"));
      const outputPath = join(outputDir, "mdx-blocks.html");
      await execFileAsync(process.execPath, [
        join(repoRoot, "bin", "big-plan.mjs"),
        "render",
        join(repoRoot, "examples", "mdx-blocks.mdx"),
        outputPath,
      ]);
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  nestedDiffViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(join(tmpdir(), "big-plan-nested-diff-"));
      const inputPath = join(outputDir, "nested-diff.mdx");
      const outputPath = join(outputDir, "nested-diff.html");
      await writeFile(inputPath, NESTED_DIFF_MDX, "utf8");
      await execFileAsync(process.execPath, [
        join(repoRoot, "bin", "big-plan.mjs"),
        "render",
        inputPath,
        outputPath,
      ]);
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  // Rendering through the built CLI (not the library) keeps specs aligned
  // with what a user actually runs: big-plan render <file.mdx>.
  sampleViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(join(tmpdir(), "big-plan-viewer-"));
      const outputPath = join(outputDir, "sample.html");
      await execFileAsync(process.execPath, [
        join(repoRoot, "bin", "big-plan.mjs"),
        "render",
        join(repoRoot, "examples", "sample.mdx"),
        outputPath,
      ]);
      await use(pathToFileURL(outputPath).href);
      await rm(outputDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  // Render-health contract: any console error or uncaught page error during
  // the test fails it in teardown, even when every journey assertion passed.
  page: async ({ page }, use) => {
    const renderHealthErrors: Array<string> = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        renderHealthErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      renderHealthErrors.push(error.message);
    });
    await use(page);
    expect(renderHealthErrors, "console and page errors").toEqual([]);
  },
});

export { expect };

/**
 * Returns the locator's bounding box, failing the test when the element has
 * none, so geometry assertions read as arithmetic instead of null handling.
 */
export const boxOf = async (
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> => {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error(`expected a bounding box for ${String(locator)}`);
  }
  return box;
};

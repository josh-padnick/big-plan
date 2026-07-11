// The suite's extended Playwright test, per the render-health rule: every
// spec fails on console errors or uncaught page errors automatically, and the
// sample document is rendered once per worker through the built CLI so specs
// exercise exactly what a user runs. Specs import test/expect from here,
// never from @playwright/test directly.

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, test as base } from "@playwright/test";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

type WorkerFixtures = {
  readonly sampleViewerUrl: string;
};

export const test = base.extend<NonNullable<unknown>, WorkerFixtures>({
  // Rendering through the built CLI (not the library) keeps specs aligned
  // with what a user actually runs: big-plan render <file.md>.
  sampleViewerUrl: [
    async ({}, use) => {
      const outputDir = await mkdtemp(join(tmpdir(), "big-plan-viewer-"));
      const outputPath = join(outputDir, "sample.html");
      await execFileAsync(process.execPath, [
        join(repoRoot, "bin", "big-plan.mjs"),
        "render",
        join(repoRoot, "examples", "sample.md"),
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

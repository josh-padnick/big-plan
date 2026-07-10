// Browser test of the critical journey: render the sample plan through the
// built CLI, open it via file://, and review it through the TOC.

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const execFileAsync = promisify(execFile);

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const samplePath = join(repoRoot, "examples", "sample.md");
const binPath = join(repoRoot, "bin", "grandplan.mjs");

let outputDir: string;
let viewerUrl: string;

// Rendering through the built CLI (not the library) keeps this spec aligned
// with what a user actually runs: grandplan render <file.md>.
test.beforeAll(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "grandplan-viewer-"));
  const outputPath = join(outputDir, "sample.html");
  await execFileAsync(process.execPath, [binPath, "render", samplePath, outputPath]);
  viewerUrl = pathToFileURL(outputPath).href;
});

test.afterAll(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

test("should navigate the rendered sample plan through the TOC without errors", async ({
  page,
}) => {
  const consoleErrors: Array<string> = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await page.goto(viewerUrl);

  await expect(page).toHaveTitle("Payments Retry Architecture Plan");
  await expect(
    page.getByRole("heading", { level: 1, name: "Payments Retry Architecture Plan" }),
  ).toBeVisible();

  // The TOC lists every h2 section of the sample document, in order.
  const toc = page.getByRole("navigation", { name: "Contents" });
  await expect(toc.getByRole("link")).toHaveText([
    "Background",
    "Goals and non-goals",
    "Retry state machine",
    "Schema changes",
    "Failure classification",
    "Rollout plan",
  ]);

  // Clicking a TOC entry navigates to that section.
  await toc.getByRole("link", { name: "Rollout plan" }).click();
  await expect(page).toHaveURL(/#rollout-plan$/);
  await expect(
    page.getByRole("heading", { level: 2, name: "Rollout plan" }),
  ).toBeInViewport();

  // The wide classification table scrolls inside its own container instead of
  // widening the page: the container overflows while the page itself does not.
  const wideTable = page.getByRole("table");
  await expect(wideTable).toBeVisible();
  const overflow = await wideTable.evaluate((table) => {
    const container = table.parentElement;
    return {
      containerScrollable:
        container !== null && container.scrollWidth > container.clientWidth,
      pageScrollable:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    };
  });
  expect(overflow.containerScrollable).toBe(true);
  expect(overflow.pageScrollable).toBe(false);

  expect(consoleErrors).toEqual([]);
});

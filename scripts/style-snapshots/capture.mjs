// Captures the configured review-document states from an isolated historical
// checkout. The history verifier owns checkout orchestration; each checkout
// keeps its revision-local fixture syntax so both sides compile compatibly.

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);
const checkout = process.env["STYLE_SNAPSHOT_CHECKOUT"];
const outputDirectory = process.env["STYLE_SNAPSHOT_OUTPUT_DIR"];
const configPath = process.env["STYLE_SNAPSHOT_CONFIG"];

if (
  checkout === undefined ||
  outputDirectory === undefined ||
  configPath === undefined
) {
  throw new Error(
    "capture.mjs requires STYLE_SNAPSHOT_CHECKOUT, STYLE_SNAPSHOT_OUTPUT_DIR, and STYLE_SNAPSHOT_CONFIG.",
  );
}

const config = JSON.parse(await readFile(configPath, "utf8"));

/** Prepares one historical checkout before any of its documents are rendered. */
const prepareCheckout = async () => {
  await execFileAsync("bun", ["install", "--frozen-lockfile"], {
    cwd: checkout,
    maxBuffer: 10 * 1024 * 1024,
  });
  await execFileAsync("bun", ["run", "build"], {
    cwd: checkout,
    maxBuffer: 50 * 1024 * 1024,
  });
};

/**
 * Runs the repository's own CLI from the historical checkout so each capture
 * reflects that commit rather than the harness commit.
 */
const renderDocument = async ({ source, outputPath, stateDirectory }) => {
  const binPath = join(checkout, "bin", "big-plan.mjs");
  const env = { ...process.env, BIG_PLAN_STATE_DIR: stateDirectory };
  await execFileAsync(process.execPath, [binPath, "guidance"], {
    cwd: checkout,
    env,
    maxBuffer: 10 * 1024 * 1024,
  });
  await execFileAsync(
    process.execPath,
    [binPath, "render", join(checkout, source), outputPath],
    {
      cwd: checkout,
      env,
      maxBuffer: 50 * 1024 * 1024,
    },
  );
};

/**
 * Drives only finite, reviewable interactions. Adding arbitrary evaluation
 * here would let a capture hide product state outside the fixture contract.
 */
const applyActions = async ({ page, actions }) => {
  for (const action of actions) {
    const locator = page.locator(action.selector);
    const count = await locator.count();
    if (count === 0) {
      return false;
    }
    if (count !== 1) {
      throw new Error(
        `Screenshot action selector "${action.selector}" matched ${count} elements; selectors must identify one state owner.`,
      );
    }
    switch (action.type) {
      case "click":
        await locator.click();
        break;
      case "focus":
        await locator.focus();
        break;
      case "hover":
        await locator.hover();
        break;
      case "set-attribute":
        await locator.evaluate(
          (element, value) => {
            element.setAttribute(value.name, value.value);
          },
          { name: action.name, value: action.value },
        );
        break;
      default:
        throw new Error(`Unknown screenshot action "${String(action.type)}".`);
    }
  }
  return true;
};

/** Turns a logical capture tuple into one stable manifest key. */
const captureName = ({ document, capture, viewport, theme }) =>
  [document, capture, viewport, theme]
    .map((part) => part.replaceAll(/[^a-zA-Z0-9_-]/g, "-"))
    .join("__") + ".png";

const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "big-plan-style-captures-"),
);
// Exact RGBA evidence requires one stable rasterizer and color space in CI.
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--disable-gpu", "--force-color-profile=srgb"],
});

try {
  await mkdir(outputDirectory, { recursive: true });
  await prepareCheckout();

  for (const document of config.documents) {
    const documentDirectory = join(temporaryDirectory, document.name);
    const htmlPath = join(documentDirectory, `${document.name}.html`);
    const stateDirectory = join(documentDirectory, "state");
    await mkdir(dirname(htmlPath), { recursive: true });
    await renderDocument({
      source: document.source,
      outputPath: htmlPath,
      stateDirectory,
    });

    for (const capture of document.captures) {
      for (const viewport of capture.viewports) {
        for (const theme of capture.themes) {
          const page = await browser.newPage({
            viewport: { width: viewport.width, height: viewport.height },
            colorScheme: theme,
            reducedMotion: "reduce",
            deviceScaleFactor: 1,
          });
          try {
            await page.goto(pathToFileURL(resolve(htmlPath)).href);
            await page.locator("html").evaluate((element, value) => {
              element.dataset.theme = value;
            }, theme);
            await page.addStyleTag({
              content:
                "*,*::before,*::after{animation:none!important;caret-color:transparent!important;transition:none!important}*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important}",
            });
            const actionsAvailable = await applyActions({
              page,
              actions: capture.actions,
            });
            if (!actionsAvailable) {
              continue;
            }
            const target = page.locator(capture.selector);
            const targetCount = await target.count();
            if (targetCount === 0) {
              continue;
            }
            if (targetCount !== 1) {
              throw new Error(
                `Screenshot selector "${capture.selector}" matched ${targetCount} elements; selectors must identify one visual surface.`,
              );
            }
            await target.waitFor({ state: "visible" });
            await target.screenshot({
              animations: "disabled",
              path: join(
                outputDirectory,
                captureName({
                  document: document.name,
                  capture: capture.name,
                  viewport: viewport.name,
                  theme,
                }),
              ),
            });
          } finally {
            await page.close();
          }
        }
      }
    }
  }
} finally {
  await browser.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
}

// Captures the configured review-document states from an isolated historical
// checkout. The history verifier owns checkout orchestration; each checkout
// keeps its revision-local fixture syntax so both sides compile compatibly.

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import { availableDocuments } from "./available-documents.mjs";

const execFileAsync = promisify(execFile);
const checkout = process.env["STYLE_SNAPSHOT_CHECKOUT"];
const outputDirectory = process.env["STYLE_SNAPSHOT_OUTPUT_DIR"];
const configPath = process.env["STYLE_SNAPSHOT_CONFIG"];
const harnessRoot = process.env["STYLE_SNAPSHOT_HARNESS_ROOT"];

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
const progressPath =
  harnessRoot === undefined
    ? null
    : join(
        harnessRoot,
        "test-results",
        "style-history",
        "progress",
        `${basename(checkout)}.json`,
      );

/** Keeps the last isolated capture phase when the child process stalls. */
const reportProgress = async (phase, detail = {}) => {
  if (progressPath === null) {
    return;
  }
  await mkdir(dirname(progressPath), { recursive: true });
  await writeFile(
    progressPath,
    `${JSON.stringify({ checkout, phase, ...detail }, null, 2)}\n`,
    "utf8",
  );
};

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

/** Waits for two frames without hanging when hosted headless pages pause rAF. */
const settlePaint = async (page) => {
  let timeout;
  try {
    await Promise.race([
      page.evaluate(
        () =>
          new Promise((resolvePaint) => {
            globalThis.requestAnimationFrame(() =>
              globalThis.requestAnimationFrame(resolvePaint),
            );
          }),
      ),
      new Promise((resolve) => {
        timeout = setTimeout(resolve, 250);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
};

/** Compares rendered pixels while ignoring screencast encoder metadata. */
const samePixels = (left, right) => {
  const leftImage = PNG.sync.read(left);
  const rightImage = PNG.sync.read(right);
  return (
    leftImage.width === rightImage.width &&
    leftImage.height === rightImage.height &&
    leftImage.data.equals(rightImage.data)
  );
};

/**
 * Captures the visible viewport, then crops target tiles in Node. This avoids
 * both Playwright's element screenshot wait and Chromium's clip request.
 */
const captureTargetFrame = async ({ page, target, path }) => {
  const bounds = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.left + globalThis.scrollX),
      y: Math.round(rect.top + globalThis.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  });
  const viewport = await page.evaluate(() => ({
    width: globalThis.innerWidth,
    height: globalThis.innerHeight,
    maxScrollY:
      globalThis.document.documentElement.scrollHeight - globalThis.innerHeight,
  }));
  const topInset = Math.min(100, Math.max(0, viewport.height - 1));
  const tileHeight = Math.max(1, viewport.height - topInset - 20);
  await target.evaluate(
    (element, value) => {
      let current = element;
      while (current.parentElement !== null) {
        const parent = current.parentElement;
        for (const sibling of parent.children) {
          if (sibling !== current) {
            sibling.style.display = "none";
          }
        }
        if (parent === globalThis.document.documentElement) {
          break;
        }
        current = parent;
      }
      globalThis.document.documentElement.style.overflow = "hidden";
      globalThis.document.body.style.overflow = "hidden";
      globalThis.document.documentElement.style.height = "100vh";
      globalThis.document.body.style.height = "100vh";
      element.style.position = "fixed";
      element.style.left = `${value.x}px`;
      element.style.top = `${value.top}px`;
      element.style.width = `${value.width}px`;
      element.style.maxWidth = `${value.width}px`;
      element.style.zIndex = "2147483647";
    },
    { x: bounds.x, top: topInset, width: bounds.width },
  );
  await settlePaint(page);
  const output = new PNG({ width: bounds.width, height: bounds.height });
  for (let offset = 0; offset < bounds.height; offset += tileHeight) {
    await target.evaluate((element, top) => {
      element.style.top = `${top}px`;
    }, topInset - offset);
    await settlePaint(page);
    const tile = {
      x: bounds.x,
      y: topInset,
      width: bounds.width,
      height: Math.min(tileHeight, bounds.height - offset),
    };
    if (
      tile.x < 0 ||
      tile.y < 0 ||
      tile.width !== bounds.width ||
      tile.width <= 0 ||
      tile.height <= 0 ||
      tile.x + tile.width > viewport.width ||
      tile.y + tile.height > viewport.height
    ) {
      throw new Error(
        `Screenshot tile bounds ${JSON.stringify(tile)} exceed viewport ${viewport.width}x${viewport.height}.`,
      );
    }
    await reportProgress("capture tile", { path, offset, tile });
    const image = PNG.sync.read(
      await page.screenshot({
        animations: "disabled",
        caret: "hide",
        clip: tile,
        timeout: 10_000,
      }),
    );
    PNG.bitblt(image, output, 0, 0, tile.width, tile.height, 0, offset);
  }
  return PNG.sync.write(output);
};

/** Writes only a pixel-stable frame. */
const captureStableTarget = async ({ page, target, path }) => {
  await target.evaluate((element) => {
    element.scrollIntoView({
      behavior: "instant",
      block: "nearest",
      inline: "nearest",
    });
  });
  let prior;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await reportProgress("settle paint", { path, attempt });
    await settlePaint(page);
    const current = await captureTargetFrame({ page, target, path });
    if (prior !== undefined && samePixels(prior, current)) {
      await writeFile(path, current);
      return;
    }
    prior = current;
  }
  throw new Error(
    `Screenshot target "${path}" never repeated exact bytes across six settled frames.`,
  );
};

const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "big-plan-style-captures-"),
);
// Exact RGBA evidence requires one stable rasterizer and color space in CI.
const browser = await chromium.launch({
  headless: true,
  args: [
    "--disable-gpu",
    // Hosted runners expose different CPU instruction sets. Skia documents
    // this switch as its baseline layout-test path; it prevents SIMD-specific
    // antialias rounding from changing an otherwise identical pixel by one.
    "--disable-skia-runtime-opts",
    // Keep deterministic compositor stages without enabling begin-frame
    // control, which can stall screenshots on hosted Linux runners.
    "--run-all-compositor-stages-before-draw",
    "--disable-threaded-animation",
    "--disable-threaded-scrolling",
    "--disable-checker-imaging",
    "--force-color-profile=srgb",
    "--force-device-scale-factor=1",
  ],
});

try {
  await mkdir(outputDirectory, { recursive: true });
  await reportProgress("prepare checkout");
  await prepareCheckout();

  const documents = await availableDocuments({
    checkout,
    documents: config.documents,
  });
  for (const document of documents) {
    const documentDirectory = join(temporaryDirectory, document.name);
    const htmlPath = join(documentDirectory, `${document.name}.html`);
    const stateDirectory = join(documentDirectory, "state");
    await mkdir(dirname(htmlPath), { recursive: true });
    await reportProgress("render document", { document: document.name });
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
            await reportProgress("capture target", {
              document: document.name,
              capture: capture.name,
              viewport: viewport.name,
              theme,
              selector: capture.selector,
            });
            await captureStableTarget({
              page,
              target,
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
  if (progressPath !== null) {
    await rm(progressPath, { force: true });
  }
} finally {
  await browser.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
}

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
import { DETERMINISM_FLAGS, environmentFingerprint } from "./environment.mjs";

const execFileAsync = promisify(execFile);
const checkout = process.env["STYLE_SNAPSHOT_CHECKOUT"];
const outputDirectory = process.env["STYLE_SNAPSHOT_OUTPUT_DIR"];
const configPath = process.env["STYLE_SNAPSHOT_CONFIG"];
const harnessRoot = process.env["STYLE_SNAPSHOT_HARNESS_ROOT"];
const selectedCaptureKeys = new Set(
  JSON.parse(process.env["STYLE_SNAPSHOT_CAPTURE_KEYS"] ?? "[]"),
);

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
const captureKey = ({ document, capture }) => `${document}/${capture}`;

const captureName = ({ document, capture, viewport, theme, instance }) =>
  [document, capture, viewport, theme]
    .map((part) => part.replaceAll(/[^a-zA-Z0-9_-]/g, "-"))
    .join("__") +
  (instance === undefined ? "" : `__${instance + 1}`) +
  ".png";

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

/** Stops one target capture when a browser call does not return. */
const withTimeout = async (promise, label, milliseconds) => {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(new Error(`${label} timed out after ${milliseconds}ms.`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
};

/** Prevents a hosted font load from holding every screenshot indefinitely. */
const settleFonts = async (page) => {
  let timeout;
  try {
    const loaded = await Promise.race([
      page.evaluate(() => globalThis.document.fonts.ready.then(() => true)),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(false), 2_000);
      }),
    ]);
    if (!loaded) {
      await page.evaluate(() => {
        Object.defineProperty(globalThis.document.fonts, "ready", {
          configurable: true,
          value: Promise.resolve(globalThis.document.fonts),
        });
      });
    }
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
const captureTargetFrame = async ({
  page,
  target,
  path,
  masks = [],
  isolate = true,
}) => {
  await settleFonts(page);
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
  const originalStyles = await target.evaluate(
    (element, value) => {
      const original = {
        element: element.getAttribute("style"),
        documentElement:
          globalThis.document.documentElement.getAttribute("style"),
        body: globalThis.document.body.getAttribute("style"),
      };
      const hiddenSiblings = [];
      let current = element;
      while (value.isolate && current.parentElement !== null) {
        const parent = current.parentElement;
        for (const sibling of parent.children) {
          if (sibling !== current) {
            hiddenSiblings.push([sibling, sibling.getAttribute("style")]);
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
      globalThis.__captureHiddenSiblings = hiddenSiblings;
      return original;
    },
    { x: bounds.x, top: topInset, width: bounds.width, isolate },
  );
  await settlePaint(page);
  const output = new PNG({ width: bounds.width, height: bounds.height });
  try {
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
          mask: masks,
          maskColor: "#000000",
          timeout: 10_000,
        }),
      );
      PNG.bitblt(image, output, 0, 0, tile.width, tile.height, 0, offset);
    }
  } finally {
    await target.evaluate((element, original) => {
      const restore = (node, style) => {
        if (style === null) {
          node.removeAttribute("style");
        } else {
          node.setAttribute("style", style);
        }
      };
      restore(element, original.element);
      restore(globalThis.document.documentElement, original.documentElement);
      restore(globalThis.document.body, original.body);
      for (const [sibling, style] of globalThis.__captureHiddenSiblings ?? []) {
        restore(sibling, style);
      }
      delete globalThis.__captureHiddenSiblings;
    }, originalStyles);
  }
  return PNG.sync.write(output);
};

/** Writes only a pixel-stable frame. */
const captureStableTarget = async ({ page, target, path, isolate = true }) => {
  for (let retry = 0; retry < 2; retry += 1) {
    await target.evaluate((element) => {
      element.scrollIntoView({
        behavior: "instant",
        block: "nearest",
        inline: "nearest",
      });
    });
    let prior;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await reportProgress("settle paint", { path, retry, attempt });
      await settlePaint(page);
      const current = await captureTargetFrame({
        page,
        target,
        path,
        isolate,
      });
      if (prior !== undefined && samePixels(prior, current)) {
        await writeFile(path, current);
        return;
      }
      prior = current;
    }
    if (retry === 0) {
      await reportProgress("retry stable target", { path });
    }
  }
  throw new Error(
    `Screenshot target "${path}" never repeated exact bytes across two six-frame capture windows.`,
  );
};

/** Writes a tiled frame whose stability check ignores only named animations. */
const captureStableTargetWithAnimatedRegions = async ({
  page,
  target,
  path,
  masks,
  isolate = true,
}) => {
  for (let retry = 0; retry < 2; retry += 1) {
    await target.evaluate((element) => {
      element.scrollIntoView({
        behavior: "instant",
        block: "nearest",
        inline: "nearest",
      });
    });
    let prior;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await reportProgress("settle masked paint", { path, retry, attempt });
      await settlePaint(page);
      const current = await captureTargetFrame({
        page,
        target,
        path,
        masks,
        isolate,
      });
      if (prior !== undefined && samePixels(prior, current)) {
        await settlePaint(page);
        const frame = await captureTargetFrame({
          page,
          target,
          path,
          isolate,
        });
        await writeFile(path, frame);
        return;
      }
      prior = current;
    }
    if (retry === 0) {
      await reportProgress("retry stable masked target", { path });
    }
  }
  throw new Error(
    `Screenshot target "${path}" never repeated exact bytes outside its named animated regions across six settled frames.`,
  );
};

/**
 * Masks only the named animated regions during the exact byte check. The rest
 * of a broad target, such as an article, must still produce two equal frames.
 * The saved frame stays unmasked so the visual ledger shows the real surface.
 */
const animatedExemptionsWithin = async ({ target, exemptions }) =>
  target.evaluate(
    (element, candidates) =>
      candidates
        .filter(
          (candidate) =>
            element.matches(candidate.selector) ||
            element.querySelector(candidate.selector) !== null,
        )
        .map(({ name, selector }) => ({ name, selector })),
    exemptions,
  );

const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "big-plan-style-captures-"),
);
// Exact RGBA evidence requires one stable rasterizer and color space in CI.
const browser = await chromium.launch({
  headless: true,
  args: DETERMINISM_FLAGS,
});

const environment = await environmentFingerprint({
  browserVersion: browser.version(),
  fontRoot: join(checkout, "assets", "fonts"),
  authorityClass:
    process.env.STYLE_HISTORY_PIXEL_AUTHORITY_CLASS ??
    (process.env.CI === "true" ? "ci-runner" : "local"),
});

try {
  await mkdir(outputDirectory, { recursive: true });
  await reportProgress("prepare checkout");
  await prepareCheckout();

  const captureManifest = [];

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
      if (
        selectedCaptureKeys.size > 0 &&
        !selectedCaptureKeys.has(
          captureKey({ document: document.name, capture: capture.name }),
        )
      ) {
        continue;
      }
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
            if (capture.scope === "component") {
              await page
                .locator("[data-collapsible][data-collapsed]")
                .evaluateAll((blocks) => {
                  for (const block of blocks) {
                    block.removeAttribute("data-collapsed");
                  }
                });
            }
            const target = page.locator(capture.selector);
            const targetCount = await target.count();
            if (targetCount === 0) {
              continue;
            }
            if (targetCount !== 1 && capture.multiple !== true) {
              throw new Error(
                `Screenshot selector "${capture.selector}" matched ${targetCount} elements; selectors must identify one visual surface.`,
              );
            }
            const targets =
              capture.multiple === true
                ? Array.from({ length: targetCount }, (_, index) =>
                    target.nth(index),
                  )
                : [target];
            for (const [instance, targetInstance] of targets.entries()) {
              await targetInstance.waitFor({ state: "visible" });
              await reportProgress("capture target", {
                document: document.name,
                capture: capture.name,
                viewport: viewport.name,
                theme,
                instance: capture.multiple === true ? instance : undefined,
                selector: capture.selector,
              });
              const path = join(
                outputDirectory,
                captureName({
                  document: document.name,
                  capture: capture.name,
                  viewport: viewport.name,
                  theme,
                  instance: capture.multiple === true ? instance : undefined,
                }),
              );
              const animatedExemptions = await animatedExemptionsWithin({
                target: targetInstance,
                exemptions: config.animatedSurfaceExemptions ?? [],
              });
              await withTimeout(
                animatedExemptions.length === 0
                  ? captureStableTarget({
                      page,
                      target: targetInstance,
                      path,
                      isolate: capture.multiple !== true,
                    })
                  : captureStableTargetWithAnimatedRegions({
                      page,
                      target: targetInstance,
                      path,
                      masks: animatedExemptions.map(({ selector }) =>
                        page.locator(selector),
                      ),
                      isolate: capture.multiple !== true,
                    }),
                `Screenshot target "${path}"`,
                60_000,
              );
              captureManifest.push({
                key: captureKey({
                  document: document.name,
                  capture: capture.name,
                }),
                viewport: viewport.name,
                theme,
                path: basename(path),
                environment,
              });
            }
          } finally {
            await withTimeout(page.close(), "Closing screenshot page", 10_000);
          }
        }
      }
    }
  }
  await writeFile(
    join(outputDirectory, "capture-manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: 2,
        environment,
        selectedCaptureKeys: [...selectedCaptureKeys],
        captures: captureManifest,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  if (progressPath !== null) {
    await rm(progressPath, { force: true });
  }
} finally {
  try {
    await withTimeout(browser.close(), "Closing screenshot browser", 10_000);
  } catch {
    // Browser shutdown is best-effort after the capture result is complete.
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
}

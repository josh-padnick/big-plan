// Captures the configured review-document states from an isolated historical
// checkout. The history verifier owns checkout orchestration; each checkout
// keeps its revision-local fixture syntax so both sides compile compatibly.

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import { availableDocuments } from "./available-documents.mjs";

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

/** Waits until layout and paint have crossed two complete browser frames. */
const settlePaint = async (page) => {
  await page.evaluate(
    () =>
      new Promise((resolvePaint) => {
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(resolvePaint),
        );
      }),
  );
};

/**
 * Writes only a byte-stable frame. The exact comparison is deliberate: an
 * unsettled animation, transition, font, or layout frame is a fixture defect,
 * not a visual delta the history contract may smooth over.
 */
const captureStableTarget = async ({ page, target, path }) => {
  await target.scrollIntoViewIfNeeded();
  let prior;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await settlePaint(page);
    const current = await target.screenshot({ animations: "disabled" });
    if (prior !== undefined && prior.equals(current)) {
      await writeFile(path, current);
      return;
    }
    prior = current;
  }
  throw new Error(
    `Screenshot target "${path}" never repeated exact bytes across six settled frames.`,
  );
};

const targetClip = (target) =>
  target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left + globalThis.scrollX,
      y: rect.top + globalThis.scrollY,
      width: rect.width,
      height: rect.height,
    };
  });

/**
 * Masks only the named animated regions during the exact byte check. The rest
 * of a broad target, such as an article, must still produce two equal frames.
 * The saved frame stays unmasked so the visual ledger shows the real surface.
 */
const captureTargetWithAnimatedRegions = async ({
  page,
  target,
  path,
  masks,
}) => {
  const clip = await targetClip(target);
  let prior;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await settlePaint(page);
    const current = await page.screenshot({
      animations: "disabled",
      caret: "hide",
      clip,
      mask: masks,
      maskColor: "#000000",
    });
    if (prior !== undefined && prior.equals(current)) {
      await settlePaint(page);
      const frame = await page.screenshot({
        animations: "disabled",
        caret: "hide",
        clip,
      });
      await writeFile(path, frame);
      return;
    }
    prior = current;
  }
  throw new Error(
    `Screenshot target "${path}" never repeated exact bytes outside its named animated regions across six settled frames.`,
  );
};

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
  args: [
    "--disable-gpu",
    // Hosted runners expose different CPU instruction sets. Skia documents
    // this switch as its baseline layout-test path; it prevents SIMD-specific
    // antialias rounding from changing an otherwise identical pixel by one.
    "--disable-skia-runtime-opts",
    // Chromium's deterministic compositor mode pins frame scheduling and
    // raster work so rounded-edge antialiasing does not vary between pages.
    "--deterministic-mode",
    "--force-color-profile=srgb",
    "--force-device-scale-factor=1",
  ],
});

try {
  await mkdir(outputDirectory, { recursive: true });
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
            const path = join(
              outputDirectory,
              captureName({
                document: document.name,
                capture: capture.name,
                viewport: viewport.name,
                theme,
              }),
            );
            const animatedExemptions = await animatedExemptionsWithin({
              target,
              exemptions: config.animatedSurfaceExemptions ?? [],
            });
            if (animatedExemptions.length === 0) {
              await captureStableTarget({ page, target, path });
            } else {
              await captureTargetWithAnimatedRegions({
                page,
                target,
                path,
                masks: animatedExemptions.map(({ selector }) =>
                  page.locator(selector),
                ),
              });
            }
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

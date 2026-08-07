import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const FONT_EXTENSIONS = new Set([".otf", ".ttf", ".woff", ".woff2"]);

export const DETERMINISM_FLAGS = [
  "--disable-gpu",
  "--disable-skia-runtime-opts",
  "--run-all-compositor-stages-before-draw",
  "--disable-threaded-animation",
  "--disable-threaded-scrolling",
  "--disable-checker-imaging",
  "--disable-lcd-text",
  "--force-color-profile=srgb",
  "--force-device-scale-factor=1",
  "--hide-scrollbars",
];

const listFontFiles = async (root) => {
  const files = [];
  const visit = async (directory) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (FONT_EXTENSIONS.has(path.slice(path.lastIndexOf(".")))) {
        files.push(path);
      }
    }
  };
  await visit(root);
  return files.sort();
};

/** Hashes only authored font binaries, excluding licenses and generated CSS. */
export const fontSetHash = async (fontRoot) => {
  const hash = createHash("sha256");
  const files = await listFontFiles(fontRoot);
  for (const file of files) {
    hash.update(relative(fontRoot, file).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
};

/** Returns the exact rendering environment contract shared by captures. */
export const environmentFingerprint = async ({
  browserVersion,
  fontRoot,
  authorityClass,
}) => ({
  schemaVersion: 1,
  authorityClass,
  browser: {
    name: "chromium",
    version: browserVersion,
  },
  platform: `${process.platform}/${process.arch}`,
  fontSetHash: await fontSetHash(fontRoot),
  viewport: {
    deviceScaleFactor: 1,
    colorProfile: "srgb",
  },
  determinismFlags: [...DETERMINISM_FLAGS],
});

export const sameEnvironment = (left, right) =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * Compares runner-owned rendering properties only. The font set belongs to
 * each checkout, so a historical font change is a styling delta under test
 * rather than a runner mismatch.
 */
export const sameRunnerEnvironment = (left, right) => {
  const runnerProperties = ({ fontSetHash: _fontSetHash, ...rest }) => rest;
  return (
    JSON.stringify(runnerProperties(left)) ===
    JSON.stringify(runnerProperties(right))
  );
};

export const environmentLabel = (environment) =>
  `${environment.browser.name} ${environment.browser.version} on ${environment.platform} with fonts ${environment.fontSetHash}`;

// Replays styling commits against their parents and enforces each commit's
// declared visual contract: exact pixel identity or an approved move manifest.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PNG } from "pngjs";

const execFileAsync = promisify(execFile);

const RELEVANCE_FLOOR = {
  fixturePaths: ["examples/mdx-components.mdx", "examples/deck.mdx"],
  stylingFilePatterns: [
    "^\\.style-snapshots/config\\.json$",
    "^assets/(?:logo-(?:light|dark)\\.svg|favicon-(?:light|dark)\\.ico)$",
    "^scripts/gen-assets\\.mjs$",
    "^scripts/gen-css\\.mjs$",
    "^src/.*\\.css$",
    "^src/components/(?:.*/)?view[^/]*\\.tsx$",
    "^src/components/_shared/.*\\.tsx$",
    "^src/icons/lucide/.*\\.ts$",
    "^src/render/branding\\.generated\\.ts$",
    "^src/render/global\\.generated\\.ts$",
    "^src/render/page\\.ts$",
    "^src/render/render-document\\.ts$",
    "^src/render/serialize-html\\.ts$",
    "^src/render/(?:markdown|shell)/.*\\.ts$",
  ],
};

/** Runs a command and returns trimmed stdout with a useful failure boundary. */
const run = async ({ command, args, cwd, env = process.env }) => {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    env,
    maxBuffer: 50 * 1024 * 1024,
  });
  return stdout.trim();
};

/** Validates the stable surface of one screenshot configuration revision. */
const parseConfig = (source) => {
  const config = JSON.parse(source);
  if (config.schemaVersion !== 1) {
    throw new Error("Style screenshot config must use schemaVersion 1.");
  }
  for (const field of [
    "fixturePaths",
    "stylingFilePatterns",
    "captureCommand",
    "documents",
  ]) {
    if (!Array.isArray(config[field]) || config[field].length === 0) {
      throw new Error(`Style screenshot config requires non-empty ${field}.`);
    }
  }
  for (const [documentIndex, document] of config.documents.entries()) {
    if (!Array.isArray(document.captures) || document.captures.length === 0) {
      throw new Error(
        `Style screenshot config document ${documentIndex + 1} requires non-empty captures.`,
      );
    }
    for (const [captureIndex, capture] of document.captures.entries()) {
      for (const field of ["themes", "viewports"]) {
        if (!Array.isArray(capture[field]) || capture[field].length === 0) {
          throw new Error(
            `Style screenshot config document ${documentIndex + 1} capture ${captureIndex + 1} requires non-empty ${field}.`,
          );
        }
      }
    }
  }
  if (
    typeof config.manifestDirectory !== "string" ||
    config.manifestDirectory.length === 0
  ) {
    throw new Error("Style screenshot config requires manifestDirectory.");
  }
  return config;
};

/** Produces stable JSON while preserving order where configuration order matters. */
const canonicalize = (value) => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
};

/** Indexes the complete rendering contract for each named capture. */
const captureDefinitions = (config) => {
  const definitions = new Map();
  for (const document of config.documents) {
    for (const capture of document.captures) {
      const key = JSON.stringify([document.name, capture.name]);
      if (definitions.has(key)) {
        throw new Error(
          `Style screenshot config contains duplicate capture key ${key}.`,
        );
      }
      const { themes, viewports, ...orderedCapture } = capture;
      const normalizedViewports = viewports
        .map((viewport) => canonicalize(viewport))
        .sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        );
      definitions.set(
        key,
        JSON.stringify(
          canonicalize({
            documentSource: document.source,
            capture: {
              ...orderedCapture,
              themes: [...themes].sort(),
              viewports: normalizedViewports,
            },
          }),
        ),
      );
    }
  }
  return definitions;
};

/** Prevents a branch from reinterpreting capture keys present on its base. */
const assertCaptureCoverage = ({ config, baselineConfig }) => {
  if (baselineConfig === null) {
    return;
  }
  const activeDefinitions = captureDefinitions(config);
  const baselineDefinitions = captureDefinitions(baselineConfig);
  const changedCaptureCount = [...baselineDefinitions].filter(
    ([key, definition]) => activeDefinitions.get(key) !== definition,
  ).length;
  if (changedCaptureCount > 0) {
    throw new Error(
      `Style screenshot config changes or removes ${changedCaptureCount} merge-base capture definition(s); existing definitions are immutable and additions require new capture keys.`,
    );
  }
};

/** Includes document sources in relevance without duplicating config entries. */
const fixturePathsForConfig = (config) => [
  ...config.fixturePaths,
  ...(config.documents ?? [])
    .map((document) => document.source)
    .filter((source) => typeof source === "string"),
];

/** Reads the active screenshot configuration from the harness checkout. */
const readConfig = async (configPath) =>
  parseConfig(await readFile(configPath, "utf8"));

/** Reads a historical config when that revision contains one. */
const readConfigAtCommit = async ({ repoRoot, commit, configRepoPath }) => {
  try {
    return parseConfig(
      await run({
        command: "git",
        args: ["show", `${commit}:${configRepoPath}`],
        cwd: repoRoot,
      }),
    );
  } catch (error) {
    if (error.code === 128) {
      return null;
    }
    throw error;
  }
};

/** Restricts destructive evidence cleanup to the repository-owned run root. */
const validateArtifactRoot = async ({ repoRoot, artifactRoot }) => {
  const resolvedRepoRoot = resolve(repoRoot);
  const resolvedArtifactRoot = resolve(artifactRoot);
  const artifactRepoPath = relative(resolvedRepoRoot, resolvedArtifactRoot);
  if (
    artifactRepoPath === "" ||
    artifactRepoPath.startsWith("..") ||
    isAbsolute(artifactRepoPath)
  ) {
    throw new Error(
      "Style history artifacts must stay under test-results/style-history.",
    );
  }

  const canonicalRepoRoot = await realpath(resolvedRepoRoot);
  const canonicalArtifactRoot = resolve(canonicalRepoRoot, artifactRepoPath);
  const disposableRoot = join(
    canonicalRepoRoot,
    "test-results",
    "style-history",
  );
  const disposablePath = relative(disposableRoot, canonicalArtifactRoot);
  if (disposablePath.startsWith("..") || isAbsolute(disposablePath)) {
    throw new Error(
      "Style history artifacts must stay under test-results/style-history.",
    );
  }

  let current = canonicalRepoRoot;
  for (const part of artifactRepoPath.split(/[\\/]/)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(
          "Style history artifact paths must not traverse symbolic links.",
        );
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        break;
      }
      throw error;
    }
  }
  return canonicalArtifactRoot;
};

/** Lists files recursively using POSIX-style relative names for manifests. */
const listFiles = async (directory) => {
  const files = [];
  const visit = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else {
        files.push(relative(directory, absolute).replaceAll("\\", "/"));
      }
    }
  };
  await visit(directory);
  return files.sort();
};

/** Reads stable pixel evidence without depending on PNG encoder metadata. */
const readCapture = async (path) => {
  const png = PNG.sync.read(await readFile(path));
  const sha256 = createHash("sha256")
    .update(`width:${png.width};height:${png.height};rgba:`)
    .update(png.data)
    .digest("hex");
  return {
    width: png.width,
    height: png.height,
    sha256,
    data: png.data,
  };
};

/** Removes decoded pixel bytes from evidence written to manifests and CI. */
const captureIdentity = (capture) =>
  capture === null
    ? null
    : {
        width: capture.width,
        height: capture.height,
        sha256: capture.sha256,
      };

/** Counts exact RGBA differences, including pixels added by dimension changes. */
const comparePngs = async ({ beforePath, afterPath }) => {
  const before = beforePath === null ? null : await readCapture(beforePath);
  const after = afterPath === null ? null : await readCapture(afterPath);
  const width = Math.max(before?.width ?? 0, after?.width ?? 0);
  const height = Math.max(before?.height ?? 0, after?.height ?? 0);
  const diff = new PNG({ width, height });
  let changedPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const beforeOffset =
        before !== null && x < before.width && y < before.height
          ? (y * before.width + x) * 4
          : null;
      const afterOffset =
        after !== null && x < after.width && y < after.height
          ? (y * after.width + x) * 4
          : null;
      const changed =
        beforeOffset === null ||
        afterOffset === null ||
        before.data[beforeOffset] !== after.data[afterOffset] ||
        before.data[beforeOffset + 1] !== after.data[afterOffset + 1] ||
        before.data[beforeOffset + 2] !== after.data[afterOffset + 2] ||
        before.data[beforeOffset + 3] !== after.data[afterOffset + 3];
      const diffOffset = (y * width + x) * 4;
      if (changed) {
        changedPixels += 1;
        diff.data[diffOffset] = 255;
        diff.data[diffOffset + 1] = 0;
        diff.data[diffOffset + 2] = 0;
        diff.data[diffOffset + 3] = 255;
      } else {
        diff.data[diffOffset] = 0;
        diff.data[diffOffset + 1] = 0;
        diff.data[diffOffset + 2] = 0;
        diff.data[diffOffset + 3] = 0;
      }
    }
  }
  return {
    changedPixels,
    before: captureIdentity(before),
    after: captureIdentity(after),
    diff: changedPixels === 0 ? null : diff,
  };
};

/** Returns deterministic evidence for every capture on either side. */
const compareCaptureSets = async ({ beforeDirectory, afterDirectory }) => {
  const beforeFiles = (await listFiles(beforeDirectory)).filter((path) =>
    path.endsWith(".png"),
  );
  const afterFiles = (await listFiles(afterDirectory)).filter((path) =>
    path.endsWith(".png"),
  );
  const allFiles = [...new Set([...beforeFiles, ...afterFiles])].sort();
  const captures = [];

  for (const capture of allFiles) {
    const comparison = await comparePngs({
      beforePath: beforeFiles.includes(capture)
        ? join(beforeDirectory, capture)
        : null,
      afterPath: afterFiles.includes(capture)
        ? join(afterDirectory, capture)
        : null,
    });
    captures.push({ capture, ...comparison });
  }
  return captures;
};

/** Normalizes object key order before exact manifest evidence comparison. */
const normalizeIdentity = (identity) =>
  identity === null
    ? null
    : {
        width: identity.width,
        height: identity.height,
        sha256: identity.sha256,
      };

/** Selects the deterministic evidence shared by manifests and CI ledgers. */
const captureEvidence = ({ capture, changedPixels, before, after }) => ({
  capture,
  changedPixels,
  before: normalizeIdentity(before),
  after: normalizeIdentity(after),
});

/** Writes one durable machine-readable evidence ledger per relevant commit. */
const writeEvidenceLedger = async ({ artifactDirectory, entry, captures }) => {
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(
    join(artifactDirectory, "evidence.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        commit: entry.commit,
        parent: entry.parent,
        subject: entry.subject,
        visualKind: entry.visualKind,
        captures: captures.map(captureEvidence),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
};

/** Preserves both images and a red pixel mask for CI artifact inspection. */
const writeArtifacts = async ({
  artifactDirectory,
  changes,
  beforeDirectory,
  afterDirectory,
}) => {
  for (const change of changes) {
    const captureDirectory = join(
      artifactDirectory,
      change.capture.replaceAll("/", "__").replace(/\.png$/, ""),
    );
    await mkdir(captureDirectory, { recursive: true });
    for (const [name, sourceDirectory] of [
      ["before.png", beforeDirectory],
      ["after.png", afterDirectory],
    ]) {
      try {
        await copyFile(
          join(sourceDirectory, change.capture),
          join(captureDirectory, name),
        );
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }
    if (change.diff !== null) {
      await writeFile(
        join(captureDirectory, "diff.png"),
        PNG.sync.write(change.diff),
      );
    }
  }
};

/** Validates the machine-readable contract committed with an approved move. */
const validateManifest = async ({
  repoRoot,
  commit,
  parent,
  subject,
  manifestDirectory,
  stylingFiles,
  changes,
}) => {
  const manifestFiles = (
    await run({
      command: "git",
      args: [
        "diff",
        "--name-only",
        "--diff-filter=A",
        parent,
        commit,
        "--",
        manifestDirectory,
      ],
      cwd: repoRoot,
    })
  )
    .split("\n")
    .filter(Boolean);
  if (manifestFiles.length !== 1) {
    throw new Error(
      `${subject}: an approved commit must add exactly one manifest under ${manifestDirectory}; found ${manifestFiles.length}.`,
    );
  }

  const manifest = JSON.parse(
    await run({
      command: "git",
      args: ["show", `${commit}:${manifestFiles[0]}`],
      cwd: repoRoot,
    }),
  );
  if (manifest.schemaVersion !== 1 || manifest.commitSubject !== subject) {
    throw new Error(
      `${subject}: manifest schemaVersion must be 1 and commitSubject must match exactly.`,
    );
  }
  if (
    !Array.isArray(manifest.stylingFiles) ||
    !Array.isArray(manifest.captureChanges)
  ) {
    throw new Error(
      `${subject}: manifest requires stylingFiles and captureChanges arrays.`,
    );
  }

  const assertDeltas = (entries, label) => {
    for (const entry of entries) {
      if (
        !Array.isArray(entry.propertyDeltas) ||
        entry.propertyDeltas.length === 0
      ) {
        throw new Error(
          `${subject}: every ${label} entry needs at least one propertyDelta.`,
        );
      }
      for (const delta of entry.propertyDeltas) {
        if (
          typeof delta.property !== "string" ||
          typeof delta.from !== "string" ||
          typeof delta.to !== "string"
        ) {
          throw new Error(
            `${subject}: propertyDelta values must name property, from, and to.`,
          );
        }
      }
    }
  };
  assertDeltas(manifest.stylingFiles, "stylingFiles");
  assertDeltas(manifest.captureChanges, "captureChanges");

  const expectedFiles = manifest.stylingFiles.map((entry) => entry.path).sort();
  const actualFiles = [...stylingFiles].sort();
  if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles)) {
    throw new Error(
      `${subject}: manifest styling files ${JSON.stringify(expectedFiles)} do not match commit styling files ${JSON.stringify(actualFiles)}.`,
    );
  }

  const isIdentity = (value) =>
    value === null ||
    (typeof value === "object" &&
      value !== null &&
      Number.isInteger(value.width) &&
      value.width > 0 &&
      Number.isInteger(value.height) &&
      value.height > 0 &&
      typeof value.sha256 === "string" &&
      /^[0-9a-f]{64}$/.test(value.sha256));
  for (const entry of manifest.captureChanges) {
    if (
      typeof entry.capture !== "string" ||
      !Number.isInteger(entry.changedPixels) ||
      entry.changedPixels < 0 ||
      !isIdentity(entry.before) ||
      !isIdentity(entry.after)
    ) {
      throw new Error(
        `${subject}: every captureChanges entry requires capture, exact changedPixels, and before/after dimensions and SHA-256 hashes.`,
      );
    }
  }

  const expectedCaptures = manifest.captureChanges
    .map(captureEvidence)
    .sort((left, right) => left.capture.localeCompare(right.capture));
  const actualCaptures = changes
    .map(captureEvidence)
    .sort((left, right) => left.capture.localeCompare(right.capture));
  if (JSON.stringify(expectedCaptures) !== JSON.stringify(actualCaptures)) {
    throw new Error(
      `${subject}: exact capture evidence does not match the approved manifest.`,
    );
  }
};

/**
 * Verifies every relevant commit in the merge-base-to-HEAD range. Capture
 * configuration comes from the final harness, while fixture content stays at
 * each revision so a parent never has to parse syntax introduced by its child.
 */
export const verifyHistory = async ({
  repoRoot,
  base,
  configPath,
  artifactRoot,
}) => {
  const disposableArtifactRoot = await validateArtifactRoot({
    repoRoot,
    artifactRoot,
  });
  const config = await readConfig(configPath);
  const harnessRoot = dirname(dirname(configPath));
  const configRepoPath = relative(repoRoot, configPath).replaceAll("\\", "/");
  if (configRepoPath.startsWith("../") || isAbsolute(configRepoPath)) {
    throw new Error("Style screenshot config must be inside the repository.");
  }
  const head = await run({
    command: "git",
    args: ["rev-parse", "HEAD"],
    cwd: repoRoot,
  });
  const mergeBase = await run({
    command: "git",
    args: ["merge-base", base, "HEAD"],
    cwd: repoRoot,
  });
  const commitOutput = await run({
    command: "git",
    args: ["rev-list", "--reverse", `${mergeBase}..HEAD`],
    cwd: repoRoot,
  });
  const commits = commitOutput.split("\n").filter(Boolean);
  const historicalConfigs = await Promise.all(
    [mergeBase, ...commits].map((commit) =>
      readConfigAtCommit({ repoRoot, commit, configRepoPath }),
    ),
  );
  assertCaptureCoverage({
    config,
    baselineConfig: historicalConfigs[0],
  });
  const relevanceConfigs = [
    RELEVANCE_FLOOR,
    ...historicalConfigs.filter((candidate) => candidate !== null),
    config,
  ];
  const fixturePaths = new Set(relevanceConfigs.flatMap(fixturePathsForConfig));
  const patterns = [
    ...new Set(
      relevanceConfigs.flatMap((candidate) => candidate.stylingFilePatterns),
    ),
  ].map((pattern) => new RegExp(pattern));
  const relevant = [];

  for (const commit of commits) {
    const parentLine = await run({
      command: "git",
      args: ["rev-list", "--parents", "-n", "1", commit],
      cwd: repoRoot,
    });
    const [, ...parents] = parentLine.split(" ");
    const parent = parents[0];
    if (parent === undefined) {
      continue;
    }
    const changedFiles = (
      parents.length > 1
        ? await run({
            command: "git",
            args: [
              "show",
              "--remerge-diff",
              "--name-only",
              "--format=",
              "--no-renames",
              commit,
            ],
            cwd: repoRoot,
          })
        : await run({
            command: "git",
            args: ["diff", "--name-only", "--no-renames", parent, commit],
            cwd: repoRoot,
          })
    )
      .split("\n")
      .filter(Boolean);
    const stylingFiles = changedFiles.filter(
      (path) =>
        path === configRepoPath ||
        fixturePaths.has(path) ||
        patterns.some((pattern) => pattern.test(path)),
    );
    if (stylingFiles.length === 0) {
      continue;
    }
    const subject = await run({
      command: "git",
      args: ["show", "-s", "--format=%s", commit],
      cwd: repoRoot,
    });
    if (parents.length > 1) {
      throw new Error(
        `${subject}: a merge commit resolved a configured styling file, so its visual delta cannot be isolated from the merged branch. Rebase and record the resolution as a single-parent [visual:empty] or [visual:approved] commit.`,
      );
    }
    const visualKind = subject.match(/\[visual:(empty|approved)\]$/)?.[1];
    if (visualKind === undefined) {
      throw new Error(
        `${subject}: styling commits must end with [visual:empty] or [visual:approved].`,
      );
    }
    relevant.push({ commit, parent, subject, stylingFiles, visualKind });
  }

  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "big-plan-style-history-"),
  );
  const capturesByCommit = new Map();

  const captureCommit = async (commit) => {
    const cached = capturesByCommit.get(commit);
    if (cached !== undefined) {
      return cached;
    }
    const worktree = join(temporaryRoot, `worktree-${commit.slice(0, 12)}`);
    const outputDirectory = join(
      temporaryRoot,
      `captures-${commit.slice(0, 12)}`,
    );
    await run({
      command: "git",
      args: ["worktree", "add", "--detach", worktree, commit],
      cwd: repoRoot,
    });
    try {
      await mkdir(outputDirectory, { recursive: true });
      const command = config.captureCommand.map((part) =>
        part.replaceAll("{harnessRoot}", harnessRoot),
      );
      await run({
        command: command[0],
        args: command.slice(1),
        cwd: harnessRoot,
        env: {
          ...process.env,
          STYLE_SNAPSHOT_CHECKOUT: worktree,
          STYLE_SNAPSHOT_OUTPUT_DIR: outputDirectory,
          STYLE_SNAPSHOT_CONFIG: configPath,
          STYLE_SNAPSHOT_HARNESS_ROOT: harnessRoot,
        },
      });
      if (commit === head) {
        const expectedCaptureCount = config.documents.reduce(
          (documentTotal, document) =>
            documentTotal +
            document.captures.reduce(
              (captureTotal, capture) =>
                captureTotal + capture.themes.length * capture.viewports.length,
              0,
            ),
          0,
        );
        const actualCaptureCount = (await listFiles(outputDirectory)).filter(
          (path) => path.endsWith(".png"),
        ).length;
        if (actualCaptureCount !== expectedCaptureCount) {
          throw new Error(
            `Final style fixture produced ${actualCaptureCount} of ${expectedCaptureCount} configured captures.`,
          );
        }
      }
    } finally {
      await run({
        command: "git",
        args: ["worktree", "remove", "--force", worktree],
        cwd: repoRoot,
      });
    }
    capturesByCommit.set(commit, outputDirectory);
    return outputDirectory;
  };

  const results = [];
  try {
    await rm(disposableArtifactRoot, { recursive: true, force: true });
    await captureCommit(head);
    for (const entry of relevant) {
      const beforeDirectory = await captureCommit(entry.parent);
      const afterDirectory = await captureCommit(entry.commit);
      const captures = await compareCaptureSets({
        beforeDirectory,
        afterDirectory,
      });
      const changes = captures.filter((capture) => capture.changedPixels > 0);
      const artifactDirectory = join(
        disposableArtifactRoot,
        entry.commit.slice(0, 12),
      );
      await writeEvidenceLedger({
        artifactDirectory,
        entry,
        captures,
      });
      await writeArtifacts({
        artifactDirectory,
        changes,
        beforeDirectory,
        afterDirectory,
      });

      if (entry.visualKind === "empty" && changes.length > 0) {
        const detail = changes
          .map(
            (change) =>
              `${change.capture} (${change.changedPixels} changed pixels)`,
          )
          .join(", ");
        throw new Error(
          `${entry.subject}: expected zero changed pixels; observed ${detail}.`,
        );
      }
      if (entry.visualKind === "approved") {
        if (changes.length === 0) {
          throw new Error(
            `${entry.subject}: an approved commit must produce its declared screenshot changes.`,
          );
        }
        await validateManifest({
          repoRoot,
          commit: entry.commit,
          parent: entry.parent,
          subject: entry.subject,
          manifestDirectory: config.manifestDirectory,
          stylingFiles: entry.stylingFiles,
          changes,
        });
      }
      results.push({
        commit: entry.commit,
        subject: entry.subject,
        visualKind: entry.visualKind,
        changedCaptures: changes.length,
        changedPixels: changes.reduce(
          (total, change) => total + (change.changedPixels ?? 0),
          0,
        ),
      });
    }
  } finally {
    for (const worktree of (await readdir(temporaryRoot)).filter((name) =>
      name.startsWith("worktree-"),
    )) {
      try {
        await run({
          command: "git",
          args: [
            "worktree",
            "remove",
            "--force",
            join(temporaryRoot, worktree),
          ],
          cwd: repoRoot,
        });
      } catch {
        // The primary failure is more useful than best-effort cleanup noise.
      }
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  return results;
};

/** Parses the intentionally small command surface used locally and in CI. */
const parseArguments = (arguments_) => {
  const result = {
    base: "origin/main",
    config: ".style-snapshots/config.json",
    artifacts: "test-results/style-history",
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (
      argument === "--base" ||
      argument === "--config" ||
      argument === "--artifacts"
    ) {
      if (value === undefined) {
        throw new Error(`${argument} requires a value.`);
      }
      const key =
        argument === "--base"
          ? "base"
          : argument === "--config"
            ? "config"
            : "artifacts";
      result[key] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument "${String(argument)}".`);
    }
  }
  return result;
};

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const arguments_ = parseArguments(process.argv.slice(2));
  const repoRoot = await run({
    command: "git",
    args: ["rev-parse", "--show-toplevel"],
    cwd: process.cwd(),
  });
  const results = await verifyHistory({
    repoRoot,
    base: arguments_.base,
    configPath: resolve(repoRoot, arguments_.config),
    artifactRoot: resolve(repoRoot, arguments_.artifacts),
  });
  if (results.length === 0) {
    console.log("style history: no relevant commits");
  } else {
    for (const result of results) {
      console.log(
        `style history: ${result.commit.slice(0, 12)} ${result.visualKind} ${result.changedCaptures} changed captures ${result.changedPixels} changed pixels`,
      );
    }
  }
}

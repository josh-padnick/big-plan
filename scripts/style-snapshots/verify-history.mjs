// Replays styling commits against their parents and enforces each commit's
// declared visual contract: exact pixel identity or an approved move manifest.

import { execFile } from "node:child_process";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PNG } from "pngjs";

const execFileAsync = promisify(execFile);

/** Runs a command and returns trimmed stdout with a useful failure boundary. */
const run = async ({ command, args, cwd, env = process.env }) => {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    env,
    maxBuffer: 50 * 1024 * 1024,
  });
  return stdout.trim();
};

/** Reads and validates the stable surface of the screenshot configuration. */
const readConfig = async (configPath) => {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (config.schemaVersion !== 1) {
    throw new Error("Style screenshot config must use schemaVersion 1.");
  }
  for (const field of [
    "fixturePaths",
    "stylingFilePatterns",
    "captureCommand",
  ]) {
    if (!Array.isArray(config[field]) || config[field].length === 0) {
      throw new Error(`Style screenshot config requires non-empty ${field}.`);
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

/** Counts exact RGBA differences and returns a red diagnostic PNG. */
const comparePngs = async ({ beforePath, afterPath }) => {
  const before = PNG.sync.read(await readFile(beforePath));
  const after = PNG.sync.read(await readFile(afterPath));
  if (before.width !== after.width || before.height !== after.height) {
    return {
      changedPixels: null,
      dimensions: `${before.width}x${before.height} -> ${after.width}x${after.height}`,
      diff: null,
    };
  }

  const diff = new PNG({ width: before.width, height: before.height });
  let changedPixels = 0;
  for (let offset = 0; offset < before.data.length; offset += 4) {
    const changed =
      before.data[offset] !== after.data[offset] ||
      before.data[offset + 1] !== after.data[offset + 1] ||
      before.data[offset + 2] !== after.data[offset + 2] ||
      before.data[offset + 3] !== after.data[offset + 3];
    if (changed) {
      changedPixels += 1;
      diff.data[offset] = 255;
      diff.data[offset + 1] = 0;
      diff.data[offset + 2] = 0;
      diff.data[offset + 3] = 255;
    } else {
      diff.data[offset] = 0;
      diff.data[offset + 1] = 0;
      diff.data[offset + 2] = 0;
      diff.data[offset + 3] = 0;
    }
  }
  return {
    changedPixels,
    dimensions: `${before.width}x${before.height}`,
    diff,
  };
};

/** Returns each changed capture, including missing or newly added images. */
const compareCaptureSets = async ({ beforeDirectory, afterDirectory }) => {
  const beforeFiles = (await listFiles(beforeDirectory)).filter((path) =>
    path.endsWith(".png"),
  );
  const afterFiles = (await listFiles(afterDirectory)).filter((path) =>
    path.endsWith(".png"),
  );
  const allFiles = [...new Set([...beforeFiles, ...afterFiles])].sort();
  const changes = [];

  for (const capture of allFiles) {
    if (!beforeFiles.includes(capture) || !afterFiles.includes(capture)) {
      changes.push({
        capture,
        changedPixels: null,
        dimensions: beforeFiles.includes(capture) ? "removed" : "added",
        diff: null,
      });
      continue;
    }
    const comparison = await comparePngs({
      beforePath: join(beforeDirectory, capture),
      afterPath: join(afterDirectory, capture),
    });
    if (comparison.changedPixels !== 0) {
      changes.push({ capture, ...comparison });
    }
  }
  return changes;
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

  const expectedCaptures = manifest.captureChanges
    .map((entry) => entry.capture)
    .sort();
  const actualCaptures = changes.map((change) => change.capture).sort();
  if (JSON.stringify(expectedCaptures) !== JSON.stringify(actualCaptures)) {
    throw new Error(
      `${subject}: changed captures ${JSON.stringify(actualCaptures)} do not match manifest ${JSON.stringify(expectedCaptures)}.`,
    );
  }
};

/**
 * Verifies every relevant commit in the merge-base-to-HEAD range. Fixtures
 * and capture configuration always come from harnessRoot (the final branch
 * head), so the first fixture commit can be replayed against its parent.
 */
export const verifyHistory = async ({
  repoRoot,
  base,
  configPath,
  artifactRoot,
}) => {
  const config = await readConfig(configPath);
  const harnessRoot = dirname(dirname(configPath));
  const patterns = config.stylingFilePatterns.map(
    (pattern) => new RegExp(pattern),
  );
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
  const relevant = [];

  for (const commit of commits) {
    const parent = await run({
      command: "git",
      args: ["rev-parse", `${commit}^`],
      cwd: repoRoot,
    });
    const changedFiles = (
      await run({
        command: "git",
        args: ["diff", "--name-only", parent, commit],
        cwd: repoRoot,
      })
    )
      .split("\n")
      .filter(Boolean);
    const stylingFiles = changedFiles.filter((path) =>
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
      for (const fixturePath of config.fixturePaths) {
        const source = join(harnessRoot, fixturePath);
        const destination = join(worktree, fixturePath);
        await mkdir(dirname(destination), { recursive: true });
        await cp(source, destination, { recursive: true, force: true });
      }
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
    await rm(artifactRoot, { recursive: true, force: true });
    for (const entry of relevant) {
      const beforeDirectory = await captureCommit(entry.parent);
      const afterDirectory = await captureCommit(entry.commit);
      const changes = await compareCaptureSets({
        beforeDirectory,
        afterDirectory,
      });
      await writeArtifacts({
        artifactDirectory: join(artifactRoot, entry.commit.slice(0, 12)),
        changes,
        beforeDirectory,
        afterDirectory,
      });

      if (entry.visualKind === "empty" && changes.length > 0) {
        const detail = changes
          .map(
            (change) =>
              `${change.capture} (${change.changedPixels ?? change.dimensions} changed pixels)`,
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

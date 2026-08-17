// Proves the stale-copy warner speaks on the PR #117 shape, stays quiet on
// ordinary work, honours the declared exception the blocking guard honours,
// and never returns a non-zero exit code, not even when it breaks.
//
// Two of the cases replay this repository's own history, because the whole
// design rests on measurements over that corpus and a synthetic repository
// cannot prove a false-alarm rate. They skip themselves when the history is
// absent, such as in a shallow clone.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  checkStaleCopyWarning,
  formatStaleCopyWarning,
} from "./warn-stale-copy.mjs";

const run = promisify(execFile);

const CLI = fileURLToPath(new URL("./warn-stale-copy.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Runs one git command inside the throwaway repository. */
const git = (root, ...args) =>
  run("git", ["-C", root, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Warner Test",
      GIT_AUTHOR_EMAIL: "warner@example.test",
      GIT_COMMITTER_NAME: "Warner Test",
      GIT_COMMITTER_EMAIL: "warner@example.test",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });

/** Writes a file, creating its parent directory, then stages it. */
const put = async (root, path, content) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content, "utf8");
  await git(root, "add", "--", path);
};

/** Commits the staged tree with a subject and a body. */
const commit = (root, message) =>
  git(root, "commit", "--no-verify", "--allow-empty", "-m", message);

/** Builds one module's source at a given generation, with `lines` lines. */
const moduleSource = (index, generation, lines) =>
  Array.from(
    { length: lines },
    (_, line) => `export const value${index}_${line} = "${generation}";`,
  ).join("\n") + "\n";

const FILE_COUNT = 12;
const paths = Array.from(
  { length: FILE_COUNT },
  (_, index) => `src/feature/module-${index}.ts`,
);

/**
 * Reproduces the PR #117 shape. Main holds a wide, recently grown surface. The
 * branch is two ordinary commits sitting directly on the tip of main, and they
 * write back the stale bytes of an old generation. No merge commit exists, and
 * the branch's own commits touch every file, so the blocking guard's two rules
 * are both blind to it.
 */
const buildStaleCopy = async () => {
  const root = await mkdtemp(join(tmpdir(), "big-plan-stale-copy-"));
  await git(root, "init", "--initial-branch=main", "--quiet");
  await git(root, "config", "commit.gpgsign", "false");

  for (const [index, path] of paths.entries()) {
    await put(root, path, moduleSource(index, "stale", 6));
  }
  await commit(root, "chore: start the repository\n\nThe stale generation.");

  // Main grows each module. This is the work a stale copy would overwrite.
  for (const [index, path] of paths.entries()) {
    await put(root, path, moduleSource(index, "current", 60));
  }
  await commit(
    root,
    "feat: grow the feature surface\n\nLands 60 lines per module on main.",
  );

  // The branch copies the stale generation back over main's work, as ordinary
  // fresh commits. Git records nothing that says where the bytes came from.
  await git(root, "checkout", "--quiet", "-b", "feature");
  for (const [index, path] of paths.entries()) {
    await put(root, path, moduleSource(index, "stale", 6));
  }
  await commit(
    root,
    "feat: land the feature work\n\nCopied from an older worktree by mistake.",
  );
  await put(root, "src/feature/extra.ts", "export const extra = true;\n");
  await commit(root, "feat: add one more module\n\nOrdinary branch work.");
  return { root };
};

/** Builds an ordinary branch: it reworks a few files and keeps its change. */
const buildOrdinaryRefactor = async () => {
  const root = await mkdtemp(join(tmpdir(), "big-plan-stale-copy-"));
  await git(root, "init", "--initial-branch=main", "--quiet");
  await git(root, "config", "commit.gpgsign", "false");
  for (const [index, path] of paths.entries()) {
    await put(root, path, moduleSource(index, "current", 60));
  }
  await commit(root, "chore: start the repository\n\nThe current generation.");

  await git(root, "checkout", "--quiet", "-b", "feature");
  for (const [index, path] of paths.slice(0, 3).entries()) {
    await put(root, path, moduleSource(index, "rewritten", 60));
  }
  await commit(
    root,
    "refactor: rewrite three modules\n\nOrdinary forward work on the branch.",
  );
  return root;
};

/**
 * Builds a branch that renames one file and also edits it. git filters by
 * pathspec before it pairs a rename, so a per-file diff that names the old path
 * alone reads the file as a wholesale delete and blames every line of it.
 */
const buildRenameWithEdits = async () => {
  const root = await mkdtemp(join(tmpdir(), "big-plan-stale-copy-"));
  await git(root, "init", "--initial-branch=main", "--quiet");
  await git(root, "config", "commit.gpgsign", "false");
  await put(root, "src/feature/big.ts", moduleSource(0, "current", 60));
  await put(root, "src/feature/moved.ts", moduleSource(1, "current", 60));
  await commit(root, "chore: start the repository\n\nThe current generation.");

  await git(root, "checkout", "--quiet", "-b", "feature");
  await put(root, "src/feature/big.ts", moduleSource(0, "stale", 6));
  await git(root, "mv", "src/feature/moved.ts", "src/feature/renamed.ts");
  await put(root, "src/feature/renamed.ts", moduleSource(1, "current", 54));
  await commit(
    root,
    "refactor: rework the surface\n\nMoves one module and edits it.",
  );
  return root;
};

/**
 * Reads the removed-line count git itself reports for one renamed path. git
 * writes a rename as "old => new" inside the shared directory prefix, so the
 * lookup asks for that arrow form.
 */
const numstatRemovedFor = async (root, oldPath, newPath) => {
  const { stdout } = await git(
    root,
    "diff",
    "--numstat",
    "--find-renames",
    "main",
    "feature",
  );
  const [prefix] = oldPath.split(/([^/]+)$/);
  const combined = `${prefix}{${oldPath.slice(prefix.length)} => ${newPath.slice(prefix.length)}}`;
  for (const line of stdout.split("\n")) {
    const fields = line.split("\t");
    if (fields[2] === combined) {
      return Number(fields[1]);
    }
  }
  throw new Error(`git reported no rename record for ${oldPath}`);
};

/** Builds a stale copy wide enough that the check cannot blame every file. */
const buildWideStaleCopy = async (fileCount) => {
  const root = await mkdtemp(join(tmpdir(), "big-plan-stale-copy-"));
  await git(root, "init", "--initial-branch=main", "--quiet");
  await git(root, "config", "commit.gpgsign", "false");
  const wide = Array.from(
    { length: fileCount },
    (_, index) => `src/wide/module-${index}.ts`,
  );
  for (const [index, path] of wide.entries()) {
    await put(root, path, moduleSource(index, "current", 12));
  }
  await commit(root, "chore: start the repository\n\nThe current generation.");

  await git(root, "checkout", "--quiet", "-b", "feature");
  for (const [index, path] of wide.entries()) {
    await put(root, path, moduleSource(index, "stale", 1));
  }
  await commit(
    root,
    "feat: land the feature work\n\nCopied from an older worktree by mistake.",
  );
  return root;
};

/** Replays one real merge from this repository, or skips when it is absent. */
const replay = async (t, base, head, options = {}) => {
  const known = await run("git", [
    "-C",
    REPO_ROOT,
    "cat-file",
    "-e",
    `${head}^{commit}`,
  ]).then(
    () => true,
    () => false,
  );
  if (!known) {
    t.skip(`the history for ${head} is not present in this clone`);
    return null;
  }
  return checkStaleCopyWarning({
    repoRoot: REPO_ROOT,
    mainRef: base,
    headRef: head,
    ...options,
  });
};

test("should warn on the PR 117 stale-copy shape that the blocking guard cannot see", async () => {
  const { root } = await buildStaleCopy();
  try {
    const result = await checkStaleCopyWarning({ repoRoot: root });
    assert.equal(result.status, "warned");
    assert.equal(result.totalFiles, FILE_COUNT);
    assert.ok(result.totalDroppedLines >= 500);
    assert.deepEqual(
      result.findings.map((finding) => finding.path).sort(),
      paths.slice(0, result.findings.length).sort(),
    );
    // The report must name the main commit whose lines disappear, because that
    // is what a human adjudicates.
    assert.match(
      result.commitsAtRisk[0].description,
      /grow the feature surface/,
    );
    assert.ok(result.commitsAtRisk[0].lines >= 500);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("should name the files, the counts, and the main commits when it formats the warning", async () => {
  const { root } = await buildStaleCopy();
  try {
    const result = await checkStaleCopyWarning({ repoRoot: root });
    const report = formatStaleCopyWarning(result);
    assert.match(report, /^WARNING: /);
    assert.match(report, /never fails the build/);
    assert.match(report, /src\/feature\/module-0\.ts/);
    assert.match(report, /grow the feature surface/);
    assert.match(report, /Firstmate adjudicates every warning/);
    assert.match(report, /Silence is not a promise/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("should stay silent on an ordinary refactor that keeps its own change", async () => {
  const root = await buildOrdinaryRefactor();
  try {
    const result = await checkStaleCopyWarning({ repoRoot: root });
    assert.equal(result.status, "silent");
    assert.ok(result.filesAtRisk < result.minFiles);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("should stay silent when every at-risk path carries the Overwrites-main trailer", async () => {
  const { root } = await buildStaleCopy();
  try {
    await commit(
      root,
      [
        "chore: replace the feature surface on purpose",
        "",
        "The grown modules are superseded by this smaller shape.",
        "",
        `Overwrites-main: ${paths.join(" ")}`,
      ].join("\n"),
    );
    const result = await checkStaleCopyWarning({ repoRoot: root });
    assert.equal(result.status, "silent");
    assert.equal(result.filesAtRisk, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("should report itself broken, never silent, when its own comparison fails", async () => {
  const { root } = await buildStaleCopy();
  try {
    const treeSha = (await git(root, "rev-parse", "main^{tree}")).stdout.trim();
    await rm(
      join(root, ".git", "objects", treeSha.slice(0, 2), treeSha.slice(2)),
      { force: true },
    );
    const result = await checkStaleCopyWarning({ repoRoot: root });
    assert.equal(result.status, "broken");
    assert.match(result.reason, /git operation|unexpected error/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("should exit zero on every outcome, including a warning and its own failure", async () => {
  const { root } = await buildStaleCopy();
  const ordinary = await buildOrdinaryRefactor();
  try {
    for (const [label, cwd, env] of [
      ["a warning", root, {}],
      ["silence", ordinary, {}],
      ["a broken repository", tmpdir(), {}],
      ["an unresolvable main", root, { MERGE_GUARD_MAIN_REF: "origin/absent" }],
    ]) {
      const { stdout } = await run("node", [CLI], {
        cwd,
        env: { ...process.env, ...env },
        maxBuffer: 64 * 1024 * 1024,
      });
      // run() rejects on any non-zero exit, so reaching here proves exit 0.
      assert.ok(stdout.length > 0, `${label} must still report something`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(ordinary, { recursive: true, force: true });
  }
});

test("should blame only the edited lines of a file the branch renames", async () => {
  const root = await buildRenameWithEdits();
  try {
    const result = await checkStaleCopyWarning({
      repoRoot: root,
      minFiles: 2,
      minTotalLines: 10,
    });
    assert.equal(result.status, "warned");
    const removed = await numstatRemovedFor(
      root,
      "src/feature/moved.ts",
      "src/feature/renamed.ts",
    );
    const renamed = result.findings.find(
      (finding) => finding.path === "src/feature/moved.ts",
    );
    assert.ok(renamed !== undefined, "the renamed file must be reported");
    assert.equal(renamed.droppedLines, removed);
    // The origins must add up to the lines git says went away, not to the
    // whole length of the old file.
    const blamed = renamed.origins.reduce(
      (sum, origin) => sum + origin.lines,
      0,
    );
    assert.equal(renamed.moreOrigins, 0);
    assert.equal(blamed, removed);
    // The roll-up a human adjudicates must never exceed the header total.
    const rolledUp = result.commitsAtRisk.reduce(
      (sum, origin) => sum + origin.lines,
      0,
    );
    assert.ok(
      rolledUp <= result.totalDroppedLines,
      `roll-up ${rolledUp} exceeds the total ${result.totalDroppedLines}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("should name a moved file in both directions and anchor its annotation in the branch", async () => {
  const root = await buildRenameWithEdits();
  try {
    const { stdout } = await run("node", [CLI], {
      cwd: root,
      env: {
        ...process.env,
        MERGE_GUARD_WARN_MIN_FILES: "2",
        MERGE_GUARD_WARN_MIN_LINES: "10",
      },
      maxBuffer: 64 * 1024 * 1024,
    });
    // The report shows where main's lines lived and where the file is now.
    assert.match(
      stdout,
      /src\/feature\/moved\.ts => src\/feature\/renamed\.ts/,
    );
    // GitHub can only anchor a path that the branch has.
    assert.match(stdout, /::warning file=src\/feature\/renamed\.ts::/);
    assert.match(stdout, /This file moved from src\/feature\/moved\.ts\./);
    // A file that stayed where it was reads exactly as it did before.
    assert.match(
      stdout,
      /::warning file=src\/feature\/big\.ts::Drops \d+ line/,
    );
    assert.doesNotMatch(stdout, /src\/feature\/big\.ts =>/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("should say the commit roll-up is partial when it cannot blame every file", async () => {
  const root = await buildWideStaleCopy(61);
  try {
    const result = await checkStaleCopyWarning({ repoRoot: root });
    assert.equal(result.status, "warned");
    assert.ok(
      result.blamedFiles < result.totalFiles,
      "the fixture must be wider than the blame bound",
    );
    assert.match(
      formatStaleCopyWarning(result),
      /This list comes from the 60 largest file\(s\) of 61\. It is not complete\./,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("should keep the measured thresholds when an override is set but empty", async () => {
  const root = await buildOrdinaryRefactor();
  try {
    const { stdout } = await run("node", [CLI], {
      cwd: root,
      env: {
        ...process.env,
        MERGE_GUARD_WARN_THRESHOLD: "",
        MERGE_GUARD_WARN_MIN_FILES: "",
        MERGE_GUARD_WARN_MIN_LINES: "",
      },
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.match(stdout, /stale-copy warning: silent\./);
    assert.match(stdout, /under the 10 file and 500 line thresholds/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("should warn on the real PR 117 merge from this repository's history", async (t) => {
  const result = await replay(t, "028c69b40bfc", "dbb48d80c4c7");
  if (result === null) {
    return;
  }
  assert.equal(result.status, "warned");
  assert.ok(
    result.totalFiles >= 30,
    `expected a wide loss, got ${result.totalFiles}`,
  );
  // The audit named PR #98 (2306bd68) and PR #85 (4133a396) as the casualties.
  const named = result.commitsAtRisk.map((origin) => origin.commit);
  assert.ok(named.some((commit) => commit.startsWith("2306bd68")));
  assert.ok(named.some((commit) => commit.startsWith("4133a396")));
});

test("should stay silent on a real ordinary pull request from the measured corpus", async (t) => {
  const result = await replay(t, "b9feeb75e91d", "bd49b4d618e0");
  if (result === null) {
    return;
  }
  assert.equal(result.status, "silent");
});

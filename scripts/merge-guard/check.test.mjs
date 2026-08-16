// Proves the merge guard fails the exact shape of the 2026-08-12 loss, where a
// merge from main into a long-lived branch silently dropped a landed feature,
// and proves the declared exception clears the same branch. The other cases
// hold the false-alarm rate down: an ordinary branch, and a branch that removes
// a file with a commit of its own, must both stay green.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { checkMergeGuard, formatMergeGuardFailure } from "./check.mjs";

const run = promisify(execFile);

/** Runs one git command inside the throwaway repository. */
const git = (root, ...args) =>
  run("git", ["-C", root, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Guard Test",
      GIT_AUTHOR_EMAIL: "guard@example.test",
      GIT_COMMITTER_NAME: "Guard Test",
      GIT_COMMITTER_EMAIL: "guard@example.test",
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

/** Commits the staged tree with a subject and an optional trailer block. */
const commit = (root, message) =>
  git(root, "commit", "--no-verify", "--allow-empty", "-m", message);

/** Creates a repository with a main branch and one committed file. */
const createRepo = async () => {
  const root = await mkdtemp(join(tmpdir(), "big-plan-merge-guard-"));
  await git(root, "init", "--initial-branch=main", "--quiet");
  await git(root, "config", "commit.gpgsign", "false");
  await put(root, "src/base.ts", "export const base = 1;\n");
  await commit(root, "chore: start the repository\n\nThe first commit.");
  return root;
};

/**
 * Builds the incident shape: main lands a feature after the branch forks, the
 * branch merges main in, and the merge resolution keeps the branch's older tree
 * so the feature disappears without a deleting commit.
 */
const buildSilentLoss = async () => {
  const root = await createRepo();
  await git(root, "checkout", "--quiet", "-b", "feature");
  await put(root, "src/branch-work.ts", "export const work = true;\n");
  await commit(root, "feat: start the branch\n\nAdds work this branch owns.");
  const branchTree = await git(root, "rev-parse", "feature^{tree}");

  await git(root, "checkout", "--quiet", "main");
  await put(root, "src/theme/palette.ts", "export const palette = ['ink'];\n");
  await put(root, "src/theme/palette.css", ":root { --ink: #111; }\n");
  await commit(root, "feat: add reviewer colour themes\n\nLands the palette.");

  // Reproduce the bad resolution exactly: a merge commit with both parents whose
  // tree is the branch's own tree, so git records no deletion of main's files.
  await git(root, "checkout", "--quiet", "feature");
  const mainCommit = (await git(root, "rev-parse", "main")).stdout.trim();
  const branchCommit = (await git(root, "rev-parse", "feature")).stdout.trim();
  const merged = await run("git", [
    "-C",
    root,
    "commit-tree",
    branchTree.stdout.trim(),
    "-p",
    branchCommit,
    "-p",
    mainCommit,
    "-m",
    "Merge main into feature\n\nResolves the conflicts by hand.",
  ]);
  await git(root, "reset", "--hard", "--quiet", merged.stdout.trim());
  return root;
};

test("should report every lost path when a merge resolution drops main-side files", async () => {
  const root = await buildSilentLoss();
  try {
    const result = await checkMergeGuard({ repoRoot: root });
    assert.equal(result.status, "failed");
    assert.deepEqual(result.losses.map((loss) => loss.path).sort(), [
      "src/theme/palette.css",
      "src/theme/palette.ts",
    ]);
    for (const loss of result.losses) {
      assert.match(loss.mainOrigin, /add reviewer colour themes/);
      assert.match(loss.resultEffect, /deletes the file/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("should name the lost paths and the exact trailer when it formats the failure", async () => {
  const root = await buildSilentLoss();
  try {
    const result = await checkMergeGuard({ repoRoot: root });
    const report = formatMergeGuardFailure(result);
    assert.match(report, /src\/theme\/palette\.ts/);
    assert.match(report, /Overwrites-main: src\/theme\/palette\.css/);
    assert.match(report, /Overwrites-main: src\/theme\/palette\.ts/);
    assert.match(report, /git checkout main --/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("should pass when every lost path carries the Overwrites-main trailer", async () => {
  const root = await buildSilentLoss();
  try {
    await commit(
      root,
      [
        "chore: drop the reviewer colour themes on purpose",
        "",
        "The palette moves to the design system in a later change.",
        "",
        "Overwrites-main: src/theme/palette.ts src/theme/palette.css",
      ].join("\n"),
    );
    const result = await checkMergeGuard({ repoRoot: root });
    assert.equal(result.status, "passed");
    assert.deepEqual(result.excused.sort(), [
      "src/theme/palette.css",
      "src/theme/palette.ts",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("should still fail when the trailer declares only some of the lost paths", async () => {
  const root = await buildSilentLoss();
  try {
    await commit(
      root,
      [
        "chore: drop one palette file on purpose",
        "",
        "Only the stylesheet moves.",
        "",
        "Overwrites-main: src/theme/palette.css",
      ].join("\n"),
    );
    const result = await checkMergeGuard({ repoRoot: root });
    assert.equal(result.status, "failed");
    assert.deepEqual(
      result.losses.map((loss) => loss.path),
      ["src/theme/palette.ts"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("should pass when a branch adds its own work while main moves ahead", async () => {
  const root = await createRepo();
  try {
    await git(root, "checkout", "--quiet", "-b", "feature");
    await put(root, "src/branch-work.ts", "export const work = true;\n");
    await commit(root, "feat: add branch work\n\nAdds a new module.");
    await git(root, "checkout", "--quiet", "main");
    await put(
      root,
      "src/theme/palette.ts",
      "export const palette = ['ink'];\n",
    );
    await commit(root, "feat: add themes\n\nLands the palette.");
    await git(root, "checkout", "--quiet", "feature");

    const result = await checkMergeGuard({ repoRoot: root });
    assert.equal(result.status, "passed");
    assert.deepEqual(result.excused, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("should pass when the branch removes a main-side file with a commit of its own", async () => {
  const root = await createRepo();
  try {
    await put(
      root,
      "src/theme/palette.ts",
      "export const palette = ['ink'];\n",
    );
    await commit(root, "feat: add themes\n\nLands the palette.");
    await git(root, "checkout", "--quiet", "-b", "feature");
    await git(root, "rm", "--quiet", "--", "src/theme/palette.ts");
    await commit(
      root,
      "refactor: retire the palette\n\nThe design system owns it now.",
    );

    const result = await checkMergeGuard({ repoRoot: root });
    assert.equal(result.status, "passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("should skip when the head is the main branch itself", async () => {
  const root = await createRepo();
  try {
    const result = await checkMergeGuard({ repoRoot: root });
    assert.equal(result.status, "skipped");
    assert.match(result.reason, /main itself/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("should report an unresolved main branch instead of passing silently", async () => {
  const root = await createRepo();
  try {
    const result = await checkMergeGuard({
      repoRoot: root,
      mainRef: "origin/absent",
    });
    assert.equal(result.status, "unresolved");
    assert.match(result.reason, /MERGE_GUARD_MAIN_REF/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

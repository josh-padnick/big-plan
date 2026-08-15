// Proves the shipped git-hook wiring - not a reimplementation of it - so this
// test fails loudly if commit-compliance automation regresses: it copies the
// real .githooks/ and scripts/git-hooks/ files into a scratch git repo, wires
// core.hooksPath the same way `bun install` does, and commits through them.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { ensureBody, GENERATED_BODY_NOTE, run } from "./prepare-commit-msg.mjs";
import { installGitHooks } from "./install.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8" });

/** Builds a scratch repo carrying the real shipped hook files, wired exactly
 * as `bun install`'s "prepare" script wires a fresh clone or worktree. */
const makeScratchRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), "big-plan-git-hooks-"));
  git(dir, ["init", "--quiet", "--initial-branch=main"]);
  git(dir, ["config", "user.name", "Scratch Committer"]);
  git(dir, ["config", "user.email", "scratch@example.com"]);
  git(dir, ["config", "commit.gpgsign", "false"]);

  cpSync(join(repoRoot, ".githooks"), join(dir, ".githooks"), {
    recursive: true,
  });
  cpSync(
    join(repoRoot, "scripts", "git-hooks", "prepare-commit-msg.mjs"),
    join(dir, "scripts", "git-hooks", "prepare-commit-msg.mjs"),
  );
  installGitHooks(dir);

  return dir;
};

const commitMessage = (dir) => git(dir, ["log", "-1", "--format=%B"]).trim();

test("a fresh worktree produces compliant commits from plain `git commit -m`", () => {
  const dir = makeScratchRepo();
  try {
    git(dir, ["commit", "--allow-empty", "-m", "x"]);
    const message = commitMessage(dir);

    assert.match(message, /^x\n/);
    assert.match(
      message,
      /Signed-off-by: Scratch Committer <scratch@example\.com>/,
    );
    assert.ok(
      message.includes(GENERATED_BODY_NOTE),
      "expected the auto-generated body note for a subject-only commit",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a pipeline-style commit (tool-set message, no explicit trailer) comes out compliant", () => {
  const dir = makeScratchRepo();
  try {
    // Mirrors how an automated fix commit is created: a single -m message,
    // no -s flag, no hand-written trailer or body.
    git(dir, [
      "commit",
      "--allow-empty",
      "-m",
      "fix: repair drifted sitemap entry",
    ]);
    const message = commitMessage(dir);

    assert.match(message, /^fix: repair drifted sitemap entry\n/);
    assert.match(
      message,
      /Signed-off-by: Scratch Committer <scratch@example\.com>/,
    );
    assert.ok(message.includes(GENERATED_BODY_NOTE));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an explicit body and sign-off are preserved, not duplicated", () => {
  const dir = makeScratchRepo();
  try {
    const authored =
      "feat: add retry budget\n\nCaps retries so a flapping dependency cannot spin forever.\n\nSigned-off-by: Scratch Committer <scratch@example.com>";
    git(dir, ["commit", "--allow-empty", "-m", authored]);
    const message = commitMessage(dir);

    assert.equal(
      (message.match(/Signed-off-by:/g) || []).length,
      1,
      "sign-off must not be duplicated when already present",
    );
    assert.ok(!message.includes(GENERATED_BODY_NOTE));
    assert.match(message, /Caps retries so a flapping dependency/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("installGitHooks points core.hooksPath at .githooks and keeps the hook executable", () => {
  const dir = makeScratchRepo();
  try {
    assert.equal(
      git(dir, ["config", "--get", "core.hooksPath"]).trim(),
      ".githooks",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureBody: subject-only message gains the generated body note", () => {
  const result = ensureBody("x\n");
  assert.equal(result, `x\n\n${GENERATED_BODY_NOTE}`);
});

test("ensureBody: an existing body is left untouched", () => {
  const raw = "feat: thing\n\nWhy it matters.\n";
  assert.equal(ensureBody(raw), "feat: thing\n\nWhy it matters.");
});

test("ensureBody: a trailing comment block is preserved after the inserted body", () => {
  const raw = "x\n# Please enter the commit message...\n# On branch main\n";
  const result = ensureBody(raw);
  assert.equal(
    result,
    `x\n\n${GENERATED_BODY_NOTE}\n\n# Please enter the commit message...\n# On branch main\n`,
  );
});

test("run(): merge commits are left untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "big-plan-git-hooks-merge-"));
  try {
    const msgFile = join(dir, "MERGE_MSG");
    writeFileSync(msgFile, "Merge branch 'feature' into main\n", "utf8");

    run([msgFile, "merge"]);

    assert.equal(
      readFileSync(msgFile, "utf8"),
      "Merge branch 'feature' into main\n",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

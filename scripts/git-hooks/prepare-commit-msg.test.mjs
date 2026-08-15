// Proves the shipped git-hook wiring - not a reimplementation of it - so this
// test fails loudly if commit-compliance automation regresses: it copies the
// real .githooks/ and scripts/git-hooks/ files into a scratch git repo, wires
// core.hooksPath the same way `bun install` does, and commits through them.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { ensureBody, GENERATED_BODY_NOTE } from "./prepare-commit-msg.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8" });

/** Builds a scratch repo carrying the real shipped hook files and invokes the
 * package's executable prepare lifecycle just as a fresh install does. */
const makeScratchRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), "big-plan-git-hooks-"));
  git(dir, ["init", "--quiet", "--initial-branch=main"]);
  git(dir, ["config", "user.name", "Scratch Committer"]);
  git(dir, ["config", "user.email", "scratch@example.com"]);
  git(dir, ["config", "commit.gpgsign", "false"]);

  cpSync(join(repoRoot, ".githooks"), join(dir, ".githooks"), {
    recursive: true,
  });
  mkdirSync(join(dir, "scripts", "git-hooks"), { recursive: true });
  cpSync(
    join(repoRoot, "scripts", "git-hooks", "prepare-commit-msg.mjs"),
    join(dir, "scripts", "git-hooks", "prepare-commit-msg.mjs"),
  );
  cpSync(
    join(repoRoot, "scripts", "git-hooks", "install.mjs"),
    join(dir, "scripts", "git-hooks", "install.mjs"),
  );
  cpSync(join(repoRoot, "package.json"), join(dir, "package.json"));
  execFileSync("bun", ["run", "prepare"], { cwd: dir, encoding: "utf8" });

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

test("the package prepare lifecycle activates the committed hooks", () => {
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

test("a trailer-only suffix does not count as a commit body", () => {
  const dir = makeScratchRepo();
  try {
    const trailer = "Signed-off-by: Scratch Committer <scratch@example.com>";
    git(dir, ["commit", "--allow-empty", "-m", `fix: thing\n\n${trailer}`]);

    const message = commitMessage(dir);
    assert.ok(message.includes(GENERATED_BODY_NOTE));
    assert.equal((message.match(/Signed-off-by:/g) || []).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureBody: a trailing comment block is preserved after the inserted body", () => {
  const raw = "x\n# Please enter the commit message...\n# On branch main\n";
  const result = ensureBody(raw);
  assert.equal(
    result,
    `x\n\n${GENERATED_BODY_NOTE}\n\n# Please enter the commit message...\n# On branch main\n`,
  );
});

test("a merge commit gains compliance without losing Git's generated message", () => {
  const dir = makeScratchRepo();
  try {
    git(dir, ["commit", "--allow-empty", "-m", "initial"]);
    git(dir, ["switch", "--quiet", "-c", "feature"]);
    git(dir, ["commit", "--allow-empty", "-m", "feature work"]);
    git(dir, ["switch", "--quiet", "main"]);
    git(dir, ["commit", "--allow-empty", "-m", "main work"]);
    git(dir, ["merge", "--no-ff", "--no-edit", "feature"]);

    const message = commitMessage(dir);
    assert.match(message, /^Merge branch 'feature'/);
    assert.ok(message.includes(GENERATED_BODY_NOTE));
    assert.match(
      message,
      /Signed-off-by: Scratch Committer <scratch@example\.com>/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a merge commit preserves Git's generated participant body", () => {
  const dir = makeScratchRepo();
  try {
    git(dir, ["commit", "--allow-empty", "-m", "initial"]);
    git(dir, ["switch", "--quiet", "-c", "feature"]);
    git(dir, ["commit", "--allow-empty", "-m", "feature work"]);
    git(dir, ["switch", "--quiet", "main"]);
    git(dir, ["commit", "--allow-empty", "-m", "main work"]);
    git(dir, ["merge", "--no-ff", "--no-edit", "--log=1", "feature"]);

    const message = commitMessage(dir);
    assert.match(message, /^Merge branch 'feature'/);
    assert.match(message, /\* feature:\n  feature work/);
    assert.ok(!message.includes(GENERATED_BODY_NOTE));
    assert.match(
      message,
      /Signed-off-by: Scratch Committer <scratch@example\.com>/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

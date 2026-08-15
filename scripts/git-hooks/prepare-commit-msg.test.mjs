// Proves the shipped git-hook wiring - not a reimplementation of it - so this
// test fails loudly if commit-compliance automation regresses: it copies the
// real .githooks/ and scripts/git-hooks/ files into a scratch git repo, wires
// core.hooksPath the same way `bun install` does, and commits through them.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { ensureBody, GENERATED_BODY_NOTE } from "./prepare-commit-msg.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8" });

/** Builds a scratch repo carrying the real shipped hook files and invokes the
 * package's executable prepare lifecycle just as a fresh install does. */
const makeScratchRepo = (beforePrepare) => {
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
  if (beforePrepare) beforePrepare(dir);
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

test("an editor-authored subject is normalized after the editor closes", () => {
  const dir = makeScratchRepo();
  try {
    const editorPath = join(dir, "write-commit-message");
    writeFileSync(
      editorPath,
      "#!/bin/sh\nprintf '%s\\n' 'editor-authored subject' > \"$1\"\n",
      { mode: 0o755 },
    );
    execFileSync("git", ["commit", "--allow-empty"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GIT_EDITOR: editorPath },
    });

    const message = commitMessage(dir);
    assert.match(message, /^editor-authored subject\n/);
    assert.ok(message.includes(GENERATED_BODY_NOTE));
    assert.match(
      message,
      /Signed-off-by: Scratch Committer <scratch@example\.com>/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should abort an editor commit when no subject is supplied", () => {
  const dir = makeScratchRepo();
  try {
    assert.throws(
      () =>
        execFileSync("git", ["commit", "--allow-empty"], {
          cwd: dir,
          encoding: "utf8",
          env: { ...process.env, GIT_EDITOR: "true" },
        }),
      (error) => error && typeof error === "object" && error.status === 1,
    );
    assert.throws(() => git(dir, ["rev-parse", "--verify", "HEAD"]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should preserve a marker-prefixed subject supplied with -m", () => {
  const dir = makeScratchRepo();
  try {
    git(dir, ["commit", "--allow-empty", "-m", "#123 fix"]);
    const message = commitMessage(dir);

    assert.match(message, /^#123 fix\n/);
    assert.ok(message.includes(GENERATED_BODY_NOTE));
    assert.match(
      message,
      /Signed-off-by: Scratch Committer <scratch@example\.com>/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should preserve marker-prefixed content supplied with -F", () => {
  const dir = makeScratchRepo();
  try {
    const messageFile = join(dir, "authored-commit-message");
    writeFileSync(messageFile, "#123 file fix\n\n# authored body\n");
    git(dir, ["commit", "--allow-empty", "-F", messageFile]);
    const message = commitMessage(dir);

    assert.match(message, /^#123 file fix\n\n# authored body\n/);
    assert.ok(!message.includes(GENERATED_BODY_NOTE));
    assert.match(
      message,
      /Signed-off-by: Scratch Committer <scratch@example\.com>/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a worktree hooks override composes compliance with existing hooks", () => {
  const alternateHooksPath = "alternate-hooks";
  let unrelatedDir = null;
  const dir = makeScratchRepo((scratchRepo) => {
    git(scratchRepo, ["config", "extensions.worktreeConfig", "true"]);
    git(scratchRepo, [
      "config",
      "--worktree",
      "core.hooksPath",
      alternateHooksPath,
    ]);

    const hooksDirectory = join(scratchRepo, alternateHooksPath);
    mkdirSync(hooksDirectory, { recursive: true });
    writeFileSync(join(scratchRepo, "require-compliance"), "");
    for (const hookName of ["prepare-commit-msg", "commit-msg"]) {
      const hookPath = join(hooksDirectory, hookName);
      const validation =
        hookName === "commit-msg"
          ? `if [ -f require-compliance ]; then
  grep -q '^Signed-off-by:' "$1"
  grep -Fq "No commit body was supplied" "$1"
fi
`
          : "";
      writeFileSync(
        hookPath,
        `#!/bin/sh
set -eu
${validation}printf x >> ${hookName}-ran
`,
      );
      chmodSync(hookPath, 0o755);
    }
  });

  try {
    assert.equal(
      git(dir, ["config", "--get", "core.hooksPath"]).trim(),
      alternateHooksPath,
    );
    execFileSync("bun", ["run", "prepare"], { cwd: dir, encoding: "utf8" });
    git(dir, ["commit", "--allow-empty", "-m", "pipeline commit"]);

    const message = commitMessage(dir);
    assert.ok(message.includes(GENERATED_BODY_NOTE));
    assert.match(
      message,
      /Signed-off-by: Scratch Committer <scratch@example\.com>/,
    );
    assert.equal(
      readFileSync(join(dir, "prepare-commit-msg-ran"), "utf8"),
      "x",
    );
    assert.equal(readFileSync(join(dir, "commit-msg-ran"), "utf8"), "x");

    unrelatedDir = mkdtempSync(join(tmpdir(), "big-plan-unrelated-hooks-"));
    git(unrelatedDir, ["init", "--quiet", "--initial-branch=main"]);
    git(unrelatedDir, ["config", "user.name", "Unrelated Committer"]);
    git(unrelatedDir, ["config", "user.email", "unrelated@example.com"]);
    git(unrelatedDir, ["config", "commit.gpgsign", "false"]);
    git(unrelatedDir, [
      "config",
      "core.hooksPath",
      join(dir, alternateHooksPath),
    ]);
    mkdirSync(join(unrelatedDir, ".githooks"));
    const unrelatedHook = join(unrelatedDir, ".githooks", "commit-msg");
    writeFileSync(unrelatedHook, "#!/bin/sh\ntouch arbitrary-hook-ran\n");
    chmodSync(unrelatedHook, 0o755);

    git(unrelatedDir, ["commit", "--allow-empty", "-m", "unrelated commit"]);
    assert.ok(!existsSync(join(unrelatedDir, "arbitrary-hook-ran")));
    assert.equal(
      readFileSync(join(unrelatedDir, "prepare-commit-msg-ran"), "utf8"),
      "x",
    );
    assert.equal(
      readFileSync(join(unrelatedDir, "commit-msg-ran"), "utf8"),
      "x",
    );
  } finally {
    if (unrelatedDir) rmSync(unrelatedDir, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should resolve compliance from the active linked worktree when hooks are shared", () => {
  const sharedDirectory = mkdtempSync(
    join(tmpdir(), "big-plan-shared-hooks-"),
  );
  const hooksDirectory = join(sharedDirectory, "hooks");
  const linkedWorktree = join(sharedDirectory, "linked-worktree");
  mkdirSync(hooksDirectory);
  const dir = makeScratchRepo((scratchRepo) => {
    git(scratchRepo, ["config", "core.hooksPath", hooksDirectory]);
  });

  try {
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "seed linked worktree"]);
    git(dir, [
      "worktree",
      "add",
      "--quiet",
      "-b",
      "linked-hook-test",
      linkedWorktree,
    ]);
    execFileSync("bun", ["run", "prepare"], {
      cwd: linkedWorktree,
      encoding: "utf8",
    });
    git(dir, ["worktree", "remove", "--force", linkedWorktree]);

    git(dir, ["commit", "--allow-empty", "-m", "primary worktree commit"]);
    const message = commitMessage(dir);
    assert.ok(message.includes(GENERATED_BODY_NOTE));
    assert.match(
      message,
      /Signed-off-by: Scratch Committer <scratch@example\.com>/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(sharedDirectory, { recursive: true, force: true });
  }
});

test("should reject a managed hooks path owned by another repository", () => {
  const sharedDirectory = mkdtempSync(
    join(tmpdir(), "big-plan-foreign-hooks-"),
  );
  const hooksDirectory = join(sharedDirectory, "hooks");
  mkdirSync(hooksDirectory);
  let secondDir = null;
  const firstDir = makeScratchRepo((scratchRepo) => {
    git(scratchRepo, ["config", "core.hooksPath", hooksDirectory]);
  });

  try {
    assert.throws(
      () =>
        makeScratchRepo((scratchRepo) => {
          secondDir = scratchRepo;
          git(scratchRepo, ["config", "core.hooksPath", hooksDirectory]);
        }),
      /managed dispatcher belongs to a different repository/,
    );

    git(firstDir, ["commit", "--allow-empty", "-m", "original owner"]);
    const message = commitMessage(firstDir);
    assert.ok(message.includes(GENERATED_BODY_NOTE));
    assert.match(
      message,
      /Signed-off-by: Scratch Committer <scratch@example\.com>/,
    );
  } finally {
    if (secondDir) rmSync(secondDir, { recursive: true, force: true });
    rmSync(firstDir, { recursive: true, force: true });
    rmSync(sharedDirectory, { recursive: true, force: true });
  }
});

for (const [configKey, commentMarker] of [
  ["core.commentChar", ";"],
  ["core.commentString", "//"],
]) {
  test(`should honor editor comments configured through ${configKey}`, () => {
    const dir = makeScratchRepo((scratchRepo) => {
      git(scratchRepo, ["config", configKey, commentMarker]);
    });
    try {
      const editorPath = join(dir, "prepend-commit-subject");
      writeFileSync(
        editorPath,
        `#!/bin/sh
set -eu
message_file=$1
temporary_file="$message_file.with-subject"
printf '%s\\n' 'configured-comment subject' > "$temporary_file"
cat "$message_file" >> "$temporary_file"
mv "$temporary_file" "$message_file"
`,
        { mode: 0o755 },
      );
      execFileSync("git", ["commit", "--allow-empty"], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, GIT_EDITOR: editorPath },
      });

      const message = commitMessage(dir);
      assert.match(message, /^configured-comment subject\n/);
      assert.ok(message.includes(GENERATED_BODY_NOTE));
      assert.match(
        message,
        /Signed-off-by: Scratch Committer <scratch@example\.com>/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("should honor the marker Git selects for auto-configured editor comments", () => {
  const dir = makeScratchRepo((scratchRepo) => {
    const templatePath = join(scratchRepo, "commit-template");
    writeFileSync(templatePath, "# forces Git to select another marker\n");
    git(scratchRepo, ["config", "commit.template", templatePath]);
    git(scratchRepo, ["config", "core.commentChar", "auto"]);
  });
  try {
    const editorPath = join(dir, "replace-auto-comment-message");
    writeFileSync(
      editorPath,
      `#!/bin/sh
set -eu
message_file=$1
temporary_file="$message_file.with-subject"
printf '%s\\n' 'auto-comment subject' > "$temporary_file"
sed -n '/^;/,$p' "$message_file" >> "$temporary_file"
mv "$temporary_file" "$message_file"
`,
      { mode: 0o755 },
    );
    execFileSync("git", ["commit", "--allow-empty"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GIT_EDITOR: editorPath },
    });

    const message = commitMessage(dir);
    assert.match(message, /^auto-comment subject\n/);
    assert.ok(message.includes(GENERATED_BODY_NOTE));
    assert.match(
      message,
      /Signed-off-by: Scratch Committer <scratch@example\.com>/,
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

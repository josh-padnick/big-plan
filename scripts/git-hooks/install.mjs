// Points this checkout's git hooks at the committed .githooks/ directory, so
// every commit runs prepare-commit-msg.mjs's sign-off and body automation
// with zero manual setup. Run automatically by `bun install` via package.json's
// "prepare" script (README's "## Development" documents `bun install` as the
// first step for every fresh clone or worktree).

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const installGitHooks = (repoRoot) => {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
    cwd: repoRoot,
  });

  const hookPath = join(repoRoot, ".githooks", "prepare-commit-msg");
  // Belt-and-suspenders: git tracks the executable bit, but re-assert it here
  // in case a checkout method (e.g. a zip export) dropped it.
  if (existsSync(hookPath)) chmodSync(hookPath, 0o755);
};

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  installGitHooks(repoRoot);
  console.log(`git hooks installed: core.hooksPath -> .githooks (${repoRoot})`);
}

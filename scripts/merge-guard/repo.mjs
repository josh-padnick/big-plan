// Shared git plumbing for the merge-guard checks. The blocking guard
// (check.mjs) and the stale-copy warner (warn-stale-copy.mjs) must agree
// exactly on what "main" is, what tree this branch would land, and which paths
// carry a declared exception. One implementation keeps them from drifting
// apart and reporting different pictures of the same branch.
//
// Every helper here reads git only. It never calls the GitHub API, so it works
// the same on a push-triggered CI run, on a fork, and on a laptop.
//
// Failure policy is the caller's choice, not this module's. `git` returns null
// on a rejected command and `gitOrThrow` raises GitFailure. The blocking guard
// uses GitFailure to fail closed; the warner catches it and reports itself as
// broken without failing the build.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Any commit message on the branch may carry this trailer. The value is a list
// of exact repository-relative paths. Exact paths only: a glob would let one
// careless declaration cover work nobody looked at.
export const EXCEPTION_TRAILER = "Overwrites-main";

export const DEFAULT_MAIN_REFS = ["origin/main", "main"];

/** Runs one git command and returns its stdout, or null when git rejects it. */
export const git = async (repoRoot, args) => {
  try {
    const { stdout } = await run("git", ["-C", repoRoot, ...args], {
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
};

/** Raised by a git call whose silent failure could hide a loss. */
export class GitFailure extends Error {
  constructor(operation) {
    super(`the git operation "${operation}" failed`);
    this.operation = operation;
  }
}

/** Runs one git command and throws a GitFailure when git rejects it. */
export const gitOrThrow = async (repoRoot, args, operation) => {
  const stdout = await git(repoRoot, args);
  if (stdout === null) {
    throw new GitFailure(operation);
  }
  return stdout;
};

/** Splits NUL-separated git output into non-empty entries. */
export const splitNul = (stdout) =>
  stdout === null ? [] : stdout.split("\0").filter((entry) => entry !== "");

/** Reads the exit code from a failed child process, or null when it never exited. */
export const exitCodeOf = (error) =>
  typeof error?.code === "number" ? error.code : null;

/**
 * Reports whether ancestor is reachable from descendant. git answers no with
 * exit code 1; any other failure throws GitFailure so the caller fails closed.
 */
export const isAncestor = async (repoRoot, ancestor, descendant) => {
  try {
    await run("git", [
      "-C",
      repoRoot,
      "merge-base",
      "--is-ancestor",
      ancestor,
      descendant,
    ]);
    return true;
  } catch (error) {
    const exitCode = exitCodeOf(error);
    if (exitCode === 1) {
      return false;
    }
    throw new GitFailure(
      exitCode === null
        ? `run "git merge-base --is-ancestor"`
        : `run "git merge-base --is-ancestor" (exit code ${exitCode})`,
    );
  }
};

/** Resolves the first main ref that exists, or null when none does. */
export const resolveMainRef = async (repoRoot, requestedRef) => {
  const candidates = requestedRef ? [requestedRef] : DEFAULT_MAIN_REFS;
  for (const candidate of candidates) {
    const commit = await git(repoRoot, [
      "rev-parse",
      "--verify",
      `${candidate}^{commit}`,
    ]);
    if (commit !== null) {
      return { ref: candidate, commit: commit.trim() };
    }
  }
  return null;
};

// Produces the tree that would land on main. When main is already an ancestor
// of the head, the head tree is the landing tree, which is exactly the shape of
// the merge-main-into-the-branch mistake. Otherwise git computes the merge the
// same way the forge would.
export const resolveResultTree = async (repoRoot, mainCommit, headCommit) => {
  if (await isAncestor(repoRoot, mainCommit, headCommit)) {
    const tree = await gitOrThrow(
      repoRoot,
      ["rev-parse", `${headCommit}^{tree}`],
      "read the head tree",
    );
    return { tree: tree.trim(), reason: null };
  }
  try {
    const { stdout } = await run(
      "git",
      ["-C", repoRoot, "merge-tree", "--write-tree", mainCommit, headCommit],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    return { tree: stdout.split("\n")[0].trim(), reason: null };
  } catch (error) {
    const exitCode = exitCodeOf(error);
    if (exitCode === 1) {
      return {
        tree: null,
        reason:
          "the merge with main has conflicts, so no result tree exists yet",
      };
    }
    throw new GitFailure(
      exitCode === null
        ? `run "git merge-tree --write-tree"`
        : `run "git merge-tree --write-tree" (exit code ${exitCode})`,
    );
  }
};

/** Reads every path declared with the exception trailer anywhere on the branch. */
export const collectDeclaredPaths = async (
  repoRoot,
  mainCommit,
  headCommit,
) => {
  const stdout = await gitOrThrow(
    repoRoot,
    ["log", "--format=%B%x00", `${mainCommit}..${headCommit}`],
    "read the branch's commit messages",
  );
  const declared = new Set();
  const trailer = new RegExp(`^\\s*${EXCEPTION_TRAILER}\\s*:\\s*(.+)$`, "i");
  for (const message of splitNul(stdout)) {
    for (const line of message.split("\n")) {
      const match = trailer.exec(line);
      if (match === null) {
        continue;
      }
      for (const path of match[1].split(/[\s,]+/)) {
        if (path !== "") {
          declared.add(path);
        }
      }
    }
  }
  return declared;
};

// Finds the branch's earliest fork point from main: the commit on main that
// the branch's own work builds on, ignoring any later catch-up merge of main.
// Every parent of a branch commit that is not itself a branch commit is a
// point on main the branch builds on; the fork point is their common ancestor.
// Returns null when the branch has no such parent at all.
export const resolveForkPoint = async (repoRoot, mainCommit, headCommit) => {
  const stdout = await gitOrThrow(
    repoRoot,
    ["rev-list", "--parents", `${mainCommit}..${headCommit}`],
    "list the branch commits and their parents",
  );
  const lines = stdout.split("\n").filter((line) => line !== "");
  const own = new Set(lines.map((line) => line.split(" ")[0]));
  const candidates = new Set();
  for (const line of lines) {
    for (const parent of line.split(" ").slice(1)) {
      if (!own.has(parent)) {
        candidates.add(parent);
      }
    }
  }
  if (candidates.size === 0) {
    return null;
  }
  const list = [...candidates];
  if (list.length === 1) {
    return list[0];
  }
  const base = await gitOrThrow(
    repoRoot,
    ["merge-base", "--octopus", ...list],
    "compute the fork point from main",
  );
  return base.trim();
};

/**
 * Resolves the branch head and reports why no comparison is meaningful.
 *
 * Returns `{ headCommit }`, or `{ skip }` when the head is main itself or is
 * already merged into main, or `{ unresolved }` when git cannot read the ref.
 */
export const resolveHead = async (repoRoot, main, headRef) => {
  const headOutput = await git(repoRoot, [
    "rev-parse",
    "--verify",
    `${headRef}^{commit}`,
  ]);
  if (headOutput === null) {
    return { unresolved: `cannot resolve the head ref "${headRef}".` };
  }
  const headCommit = headOutput.trim();
  if (headCommit === main.commit) {
    return { skip: `the head is ${main.ref} itself` };
  }
  if (await isAncestor(repoRoot, headCommit, main.commit)) {
    return { skip: `the head is already merged into ${main.ref}` };
  }
  return { headCommit };
};

// Rejects a branch whose landing tree throws away work that is already on
// main. That is how merged main work disappears without a trace: a contributor
// merges main into a long-lived branch, resolves the conflicts by hand, and
// the resolution quietly keeps the pre-merge side. Git records no deletion, so
// review and lint see nothing.
//
// The check enforces two rules.
//
// Rule 1: the merge result may differ from main only in files that the
// branch's own non-merge commits touch. A three-way merge always gives main's
// version of an untouched file, so any other difference comes from a hand
// resolution or a rewrite, and it removes or resurrects main-side content that
// nobody on this branch wrote.
//
// Rule 2: a file that main changed after the branch's fork point must not sit
// at its fork-point bytes in the merge result. The fork point is the earliest
// commit on main that the branch's own commits build on, ignoring any later
// catch-up merge of main. A file that trips rule 2 was edited by the branch
// and then put back, so main's change to it was thrown away wholesale. Rule 1
// cannot see this case because the branch touched the file, and the merge base
// cannot anchor it because a catch-up merge of main moves the merge base to
// main itself.
//
// Measured against this repository's real history:
//   - Rule 1, replayed over 101 real merges that got a verdict: 2 firings,
//     both the 2026-08-12 incident (PRs #112 and #113), 0 false alarms.
//   - Rule 2, replayed over 114 real merges across the merge-commit era and
//     the squash era: 3 firings, 0 false alarms, and all three are genuine
//     content loss:
//       - merge 028c69b4 (PR #112), anchor df0da108, 25 files including
//         scripts/design-system/palettes.mjs.
//       - PR #113, anchor 4b7e65b6, 8 files under data/bp-stack-rebuild/.
//       - merge d9c12b55 (PR #11), anchor 1696b624, 2 files
//         (docs/src/content/docs/components/callout.md and code-diff.md), 138
//         lines of documentation that main had just added. Rule 1 misses this
//         one, so rule 2 is not redundant.
//
// The check reads git only. It never calls the GitHub API, so it works the
// same on a push-triggered CI run, on a fork, and on a laptop. Every git call
// whose failure could hide a loss fails closed: the check reports
// "unresolved" and exits non-zero instead of passing on a broken comparison.
//
// What this check does NOT catch, by design:
//   - A landing that re-authors a file with stale content. PR #117 (dbb48d80)
//     copied 88 files verbatim from the stale unmerged branch head 9e1024ba,
//     but its branch is two ordinary commits sitting directly on main, so both
//     the merge base and the fork point equal main and no blob-anchored rule
//     can see the loss. The stale blobs never existed on main either, so a
//     rule that flags restoring a superseded published blob finds nothing.
//     The one detector that does catch it, line-level contribution survival
//     (for each recent main commit, do the distinctive lines it added survive
//     in the result?), was measured over 77 pull requests: it fires on 61 of
//     77 at a 1-line threshold, 18 of 77 at 5 lines, 14 of 77 at 10 lines,
//     and 11 of 77 at 20 lines. An 18 percent false-alarm rate on ordinary
//     refactors makes it unusable as a blocking gate. Do not re-attempt it
//     without new evidence.
//   - Partial loss inside a file that the branch edits and keeps changed. The
//     branch owns that file, so the check cannot tell a supersession from a
//     mistake.
//   - Semantic loss with the files intact, such as a feature that stays on
//     disk but loses its registration or its feature flag.
//   - Loss in a commit that the branch later force-pushes away. The check runs
//     per push and reports the state of the pushed tip.
//   - A merge that still has conflicts. The result tree does not exist yet, so
//     the check skips and reports why.
// The trade is deliberate: these rules find wholesale loss with almost no
// false alarms. A noisy check gets an exception declared for every branch and
// then protects nothing.
//
// CONTRIBUTING.md owns the contributor-facing description of the exception.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const run = promisify(execFile);

// Any commit message on the branch may carry this trailer. The value is a list
// of exact repository-relative paths. Exact paths only: a glob would let one
// careless declaration cover work nobody looked at.
const EXCEPTION_TRAILER = "Overwrites-main";

const DEFAULT_MAIN_REFS = ["origin/main", "main"];

/** Runs one git command and returns its stdout, or null when git rejects it. */
const git = async (repoRoot, args) => {
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
class GitFailure extends Error {
  constructor(operation) {
    super(`the git operation "${operation}" failed`);
    this.operation = operation;
  }
}

/** Runs one git command and throws a GitFailure when git rejects it. */
const gitOrThrow = async (repoRoot, args, operation) => {
  const stdout = await git(repoRoot, args);
  if (stdout === null) {
    throw new GitFailure(operation);
  }
  return stdout;
};

/** Splits NUL-separated git output into non-empty entries. */
const splitNul = (stdout) =>
  stdout === null ? [] : stdout.split("\0").filter((entry) => entry !== "");

/** Reports whether ancestor is reachable from descendant. */
const isAncestor = async (repoRoot, ancestor, descendant) => {
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
  } catch {
    return false;
  }
};

/** Resolves the first main ref that exists, or null when none does. */
const resolveMainRef = async (repoRoot, requestedRef) => {
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
const resolveResultTree = async (repoRoot, mainCommit, headCommit) => {
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
  } catch {
    return {
      tree: null,
      reason: "the merge with main has conflicts, so no result tree exists yet",
    };
  }
};

/** Collects every path that a non-merge commit on the branch adds, edits, or deletes. */
const collectTouchedPaths = async (repoRoot, mainCommit, headCommit) => {
  const stdout = await gitOrThrow(
    repoRoot,
    [
      "log",
      "--no-merges",
      // A rename must count both of its paths, or the old path looks untouched.
      "--no-renames",
      "--name-only",
      "-z",
      "--pretty=format:",
      `${mainCommit}..${headCommit}`,
    ],
    "list the paths that the branch's commits edit",
  );
  return new Set(splitNul(stdout));
};

/** Reads every path declared with the exception trailer anywhere on the branch. */
const collectDeclaredPaths = async (repoRoot, mainCommit, headCommit) => {
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
const resolveForkPoint = async (repoRoot, mainCommit, headCommit) => {
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

// Rule 2: every path that main changed after the fork point but that the merge
// result leaves byte-identical to its fork-point state. Such a path had main's
// change thrown away wholesale, even when the branch's own commits touch it.
const collectRevertedPaths = async (
  repoRoot,
  mainCommit,
  resultTree,
  forkPoint,
) => {
  if (forkPoint === null || forkPoint === mainCommit) {
    return [];
  }
  const [mainSide, inResult] = await Promise.all([
    gitOrThrow(
      repoRoot,
      ["diff", "--name-only", "-z", "--no-renames", forkPoint, mainCommit],
      "diff the fork point against main",
    ).then(splitNul),
    gitOrThrow(
      repoRoot,
      ["diff", "--name-only", "-z", "--no-renames", forkPoint, resultTree],
      "diff the fork point against the merge result",
    ).then(splitNul),
  ]);
  const changedInResult = new Set(inResult);
  return mainSide.filter((path) => !changedInResult.has(path));
};

/** Describes the main-side commit that a lost path came from. */
const describeMainOrigin = async (repoRoot, mainCommit, path) => {
  const stdout = await git(repoRoot, [
    "log",
    "-1",
    "--no-renames",
    "--format=%h %ad %s",
    "--date=short",
    mainCommit,
    "--",
    path,
  ]);
  const line = stdout === null ? "" : stdout.trim();
  return line === "" ? "no commit on main touches this path" : line;
};

/** Says what the merge result does to a path, relative to main. */
const describeResultEffect = async (repoRoot, mainCommit, resultTree, path) => {
  const stdout = await git(repoRoot, [
    "diff",
    "--numstat",
    "--no-renames",
    mainCommit,
    resultTree,
    "--",
    path,
  ]);
  const line = (stdout ?? "").trim().split("\n")[0] ?? "";
  const [added, removed] = line.split("\t");
  const inResult = await git(repoRoot, [
    "cat-file",
    "-e",
    `${resultTree}:${path}`,
  ]);
  if (inResult === null) {
    return `the result deletes the file (${removed ?? "?"} lines lost)`;
  }
  return `the result rewrites the file (+${added ?? "?"} / -${removed ?? "?"} lines against main)`;
};

// Applies both rules to the landing tree. Throws GitFailure when a comparison
// it depends on cannot run, so the caller reports "unresolved" instead of a
// false pass.
const compareResultAgainstMain = async (root, main, headCommit) => {
  const { tree: resultTree, reason: treeReason } = await resolveResultTree(
    root,
    main.commit,
    headCommit,
  );
  if (resultTree === null) {
    return { status: "skipped", reason: treeReason };
  }

  const [changed, touched, declared, forkPoint] = await Promise.all([
    gitOrThrow(
      root,
      ["diff", "--name-only", "-z", "--no-renames", main.commit, resultTree],
      "diff the merge result against main",
    ).then(splitNul),
    collectTouchedPaths(root, main.commit, headCommit),
    collectDeclaredPaths(root, main.commit, headCommit),
    resolveForkPoint(root, main.commit, headCommit),
  ]);

  const unauthored = new Set(changed.filter((path) => !touched.has(path)));
  const reverted = await collectRevertedPaths(
    root,
    main.commit,
    resultTree,
    forkPoint,
  );

  const findings = [
    ...[...unauthored].map((path) => ({
      path,
      rule: 1,
      ruleReason: "no commit on this branch edits this file",
    })),
    ...reverted
      .filter((path) => !unauthored.has(path))
      .map((path) => ({
        path,
        rule: 2,
        ruleReason: `this file is byte-identical to its state at fork point ${forkPoint.slice(0, 12)}, and ${main.ref} changed it after that`,
      })),
  ];

  const lost = findings.filter((finding) => !declared.has(finding.path));
  const excused = findings
    .filter((finding) => declared.has(finding.path))
    .map((finding) => finding.path);

  if (lost.length === 0) {
    return { status: "passed", mainRef: main.ref, excused };
  }

  const losses = await Promise.all(
    lost.map(async (finding) => ({
      ...finding,
      mainOrigin: await describeMainOrigin(root, main.commit, finding.path),
      resultEffect: await describeResultEffect(
        root,
        main.commit,
        resultTree,
        finding.path,
      ),
    })),
  );
  return { status: "failed", mainRef: main.ref, losses, excused };
};

/**
 * Compares the branch's merge result against main and reports every file whose
 * main-side work the landing would throw away.
 *
 * Returns a discriminated result: `passed` when nothing is lost, `skipped` when
 * the comparison is not meaningful, `unresolved` when the comparison itself
 * cannot run, and `failed` with one entry per lost path.
 */
export const checkMergeGuard = async ({
  repoRoot,
  mainRef,
  headRef = "HEAD",
} = {}) => {
  const root = resolve(repoRoot ?? process.cwd());
  const main = await resolveMainRef(root, mainRef);
  if (main === null) {
    return {
      status: "unresolved",
      reason: `cannot resolve the main branch (tried ${(mainRef ? [mainRef] : DEFAULT_MAIN_REFS).join(", ")}). Fetch it, or set MERGE_GUARD_MAIN_REF.`,
    };
  }
  const headOutput = await git(root, [
    "rev-parse",
    "--verify",
    `${headRef}^{commit}`,
  ]);
  if (headOutput === null) {
    return {
      status: "unresolved",
      reason: `cannot resolve the head ref "${headRef}".`,
    };
  }
  const headCommit = headOutput.trim();

  if (headCommit === main.commit) {
    return { status: "skipped", reason: `the head is ${main.ref} itself` };
  }
  if (await isAncestor(root, headCommit, main.commit)) {
    return {
      status: "skipped",
      reason: `the head is already merged into ${main.ref}`,
    };
  }

  try {
    return await compareResultAgainstMain(root, main, headCommit);
  } catch (error) {
    if (error instanceof GitFailure) {
      return {
        status: "unresolved",
        reason: `${error.message}, so the guard cannot compare this branch against ${main.ref}.`,
      };
    }
    throw error;
  }
};

/** Formats the failure report, including the exact trailer to paste. */
export const formatMergeGuardFailure = (result) => {
  const lines = [
    `merge guard: merging this branch would lose main-side work in ${result.losses.length} file(s).`,
    `The merge result throws away changes that are already on ${result.mainRef}.`,
    "",
  ];
  for (const loss of result.losses) {
    lines.push(`  ${loss.path}`);
    lines.push(`    why: ${loss.ruleReason}`);
    lines.push(`    on ${result.mainRef}: ${loss.mainOrigin}`);
    lines.push(`    in this branch: ${loss.resultEffect}`);
  }
  lines.push("");
  lines.push("Fix it in one of two ways.");
  lines.push("");
  lines.push(
    `1. Restore the work. Take main's version of each file, then commit it:`,
  );
  lines.push(`     git checkout ${result.mainRef} -- \\`);
  result.losses.forEach((loss, index) => {
    const continuation = index === result.losses.length - 1 ? "" : " \\";
    lines.push(`       ${loss.path}${continuation}`);
  });
  lines.push("");
  lines.push(
    "2. Declare the removal on purpose. Add this trailer to a commit on",
  );
  lines.push("   the branch, and give the commit body a reason:");
  lines.push("");
  lines.push(
    `     git commit --allow-empty -m "chore: declare intentional removal of main-side work" \\`,
  );
  lines.push(
    `       -m "<why this work must go, with the pull request or commit it came from>" \\`,
  );
  for (const loss of result.losses) {
    lines.push(`       -m "${EXCEPTION_TRAILER}: ${loss.path}" \\`);
  }
  lines[lines.length - 1] = lines[lines.length - 1].replace(/ \\$/, "");
  lines.push("");
  lines.push(
    "Declare only the paths you decided to remove. Every declared path stays",
  );
  lines.push("in the branch history, so a reviewer can see the decision.");
  return lines.join("\n");
};

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const result = await checkMergeGuard({
    repoRoot: process.cwd(),
    mainRef: process.env.MERGE_GUARD_MAIN_REF,
    headRef: process.env.MERGE_GUARD_HEAD_REF,
  });
  if (result.status === "unresolved") {
    console.error(`merge guard: ${result.reason}`);
    process.exitCode = 1;
  } else if (result.status === "skipped") {
    console.log(`merge guard: skipped, ${result.reason}`);
  } else if (result.status === "failed") {
    console.error(formatMergeGuardFailure(result));
    process.exitCode = 1;
  } else {
    const excused =
      result.excused.length === 0
        ? ""
        : ` (${result.excused.length} declared exception(s): ${result.excused.join(", ")})`;
    console.log(`merge guard: passed against ${result.mainRef}${excused}`);
  }
}

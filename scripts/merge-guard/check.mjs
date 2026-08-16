// Rejects a branch whose merge result changes a file that no commit on the
// branch edits. That is how merged main work disappears without a trace: a
// contributor merges main into a long-lived branch, resolves the conflicts by
// hand, and the resolution quietly keeps the pre-merge side. Git records no
// deletion, so review and lint see nothing.
//
// The rule this check enforces is one sentence: the merge result may differ
// from main only in files that the branch's own non-merge commits touch. A
// three-way merge always gives main's version of an untouched file, so any
// other difference comes from a hand resolution or a rewrite, and it removes or
// resurrects main-side content that nobody on this branch wrote.
//
// The check reads git only. It never calls the GitHub API, so it works the same
// on a push-triggered CI run, on a fork, and on a laptop.
//
// What this check does NOT catch, by design:
//   - Partial loss inside a file that the branch also edits. The branch owns
//     that file, so the check cannot tell a supersession from a mistake.
//   - Semantic loss with the files intact, such as a feature that stays on disk
//     but loses its registration or its feature flag.
//   - Loss in a commit that the branch later force-pushes away. The check runs
//     per push and reports the state of the pushed tip.
//   - A merge that still has conflicts. The result tree does not exist yet, so
//     the check skips and reports why.
// The trade is deliberate: this rule finds wholesale loss with almost no false
// alarms. A noisy check gets an exception declared for every branch and then
// protects nothing.
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
    const tree = await git(repoRoot, ["rev-parse", `${headCommit}^{tree}`]);
    return tree === null
      ? { tree: null, reason: "unreadable head tree" }
      : { tree: tree.trim(), reason: null };
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
  const stdout = await git(repoRoot, [
    "log",
    "--no-merges",
    // A rename must count both of its paths, or the old path looks untouched.
    "--no-renames",
    "--name-only",
    "-z",
    "--pretty=format:",
    `${mainCommit}..${headCommit}`,
  ]);
  return new Set(splitNul(stdout));
};

/** Reads every path declared with the exception trailer anywhere on the branch. */
const collectDeclaredPaths = async (repoRoot, mainCommit, headCommit) => {
  const stdout = await git(repoRoot, [
    "log",
    "--format=%B%x00",
    `${mainCommit}..${headCommit}`,
  ]);
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

/**
 * Compares the branch's merge result against main and reports every file that
 * changes without an authoring commit on the branch.
 *
 * Returns a discriminated result: `passed` when nothing is lost, `skipped` when
 * the comparison is not meaningful, and `failed` with one entry per lost path.
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

  const { tree: resultTree, reason: treeReason } = await resolveResultTree(
    root,
    main.commit,
    headCommit,
  );
  if (resultTree === null) {
    return { status: "skipped", reason: treeReason };
  }

  const [changed, touched, declared] = await Promise.all([
    git(root, [
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      main.commit,
      resultTree,
    ]).then(splitNul),
    collectTouchedPaths(root, main.commit, headCommit),
    collectDeclaredPaths(root, main.commit, headCommit),
  ]);

  const unauthored = changed.filter((path) => !touched.has(path));
  const lost = unauthored.filter((path) => !declared.has(path));
  const excused = unauthored.filter((path) => declared.has(path));

  if (lost.length === 0) {
    return { status: "passed", mainRef: main.ref, excused };
  }

  const losses = await Promise.all(
    lost.map(async (path) => ({
      path,
      mainOrigin: await describeMainOrigin(root, main.commit, path),
      resultEffect: await describeResultEffect(
        root,
        main.commit,
        resultTree,
        path,
      ),
    })),
  );
  return { status: "failed", mainRef: main.ref, losses, excused };
};

/** Formats the failure report, including the exact trailer to paste. */
export const formatMergeGuardFailure = (result) => {
  const lines = [
    `merge guard: this branch changes ${result.losses.length} file(s) that no commit on the branch edits.`,
    `Merging it would remove or resurrect work that is already on ${result.mainRef}.`,
    "",
  ];
  for (const loss of result.losses) {
    lines.push(`  ${loss.path}`);
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

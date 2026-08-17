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
// whose failure could hide a loss fails closed, without exception: the check
// reports "unresolved" and exits non-zero instead of passing on a broken
// comparison. Only one condition skips the comparison: a merge that genuinely
// has conflicts, which git merge-tree reports with exit code 1. Every other
// merge-tree failure, such as exit code 129 from a git too old to know
// --write-tree, or a spawn failure with no exit code, is "unresolved".
//
// What this check does NOT catch, by design:
//   - A landing that re-authors a file with stale content. PR #117 (dbb48d80)
//     copied 88 files verbatim from the stale unmerged branch head 9e1024ba,
//     but its branch is two ordinary commits sitting directly on main, so both
//     the merge base and the fork point equal main and no blob-anchored rule
//     can see the loss. The stale blobs never existed on main either, so a
//     rule that flags restoring a superseded published blob finds nothing.
//     The one detector that does catch it is line-level contribution survival
//     (how many lines that main has does the landing throw away, and which
//     main commits wrote them?). Its false-alarm rate on ordinary refactors
//     makes it unusable as a blocking gate, so it does not belong in this
//     file. It ships beside this one as a warning that never fails the build,
//     in warn-stale-copy.mjs, and a human adjudicates each firing. Do not
//     promote it to a blocking rule without new evidence.
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

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  EXCEPTION_TRAILER,
  DEFAULT_MAIN_REFS,
  git,
  GitFailure,
  gitOrThrow,
  splitNul,
  resolveMainRef,
  resolveResultTree,
  collectDeclaredPaths,
  resolveForkPoint,
  resolveHead,
} from "./repo.mjs";

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
  try {
    const head = await resolveHead(root, main, headRef);
    if (head.unresolved !== undefined) {
      return { status: "unresolved", reason: head.unresolved };
    }
    if (head.skip !== undefined) {
      return { status: "skipped", reason: head.skip };
    }
    return await compareResultAgainstMain(root, main, head.headCommit);
  } catch (error) {
    if (error instanceof GitFailure) {
      return {
        status: "unresolved",
        reason: `${error.message}, so the guard cannot judge this branch against ${main.ref}.`,
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

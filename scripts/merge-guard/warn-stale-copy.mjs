// Warns, and never fails, when a branch's landing tree drops main-side lines in
// bulk. This is the second of the two merge-guard checks, and it exists to see
// the one loss shape the blocking guard (check.mjs) cannot see.
//
// THE SHAPE. On 2026-08-13 PR #117 (dbb48d80) copied 88 files verbatim from a
// stale unmerged branch head (9e1024ba) and overwrote five days of main-side
// work. Its branch is two ordinary commits sitting directly on the tip of main,
// so the stale bytes arrived as an ordinary fresh patch. Git holds no
// structural record that the content came from elsewhere. Both the merge base
// and the fork point equal main, so every blob-anchored rule in check.mjs is
// blind to it, and the stale blobs never existed on main either.
//
// THE ONLY DETECTOR THAT SEES IT is line-level contribution survival: for the
// tree this branch would land, how many lines that main has does the landing
// throw away, and which main commits wrote them? PR #117 throws away thousands.
// The same measure also names PR #98's casualties.
//
// WHY IT IS A WARNING AND NEVER A GATE. The measure cannot tell a stale copy
// from an honest large refactor, because both delete main-side lines in bulk
// and neither leaves any other trace. It fires on ordinary work such as "apply
// the Refactoring UI design system" and "serialize agent work with durable
// ownership leases". PR #154 measured the per-file form of the measure over 77
// pull requests and got 18 firings at 5 lines; the replay in this file's
// threshold note covers 109 merges and gets 89, so the two runs disagree on
// the rate but agree on the verdict. A red check at either rate gets ignored
// or excused on every branch, and then it protects nothing.
//
// The captain decided on 2026-08-17 (BIG-136) to ship it as a warning that a
// human adjudicates. Firstmate reads each warning and decides whether an
// overwrite is really happening. No agent acts on it automatically. Silence is
// therefore NOT a contract that no loss happened; it only means the branch
// stayed under the thresholds. CONTRIBUTING.md owns the contributor-facing
// description.
//
// NEVER RED. This check exits 0 on every outcome, including its own internal
// failure, which it reports on a visible self-report line. A warner that turns
// the build red would be a gate that nobody agreed to, and a warner that dies
// silently would be worse than absent.
//
// What this check does NOT see:
//   - Loss below the threshold, and loss spread thinly over many files.
//   - Semantic loss with the lines intact, such as a feature that keeps its
//     code but loses its registration.
//   - Content moved to another file. Rename detection stays on, so a pure move
//     reports nothing, and a move that git cannot pair reports as loss.
//   - A merge that still has conflicts. The result tree does not exist yet.

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
  resolveHead,
  refOrUnset,
} from "./repo.mjs";

// THE THRESHOLD, AND WHY IT HAS THREE PARTS.
//
// A file counts as at risk when the landing tree drops at least
// DEFAULT_THRESHOLD_LINES of its main-side lines. That is the 5-line threshold
// the captain's decision named.
//
// A per-file threshold alone cannot decide when to speak. Replayed over this
// repository's 109 real merges, a bare 5-line per-file rule fires on 89 of
// them, because almost every honest pull request rewrites five lines of some
// file. Raising the per-file count does not separate the two populations
// either: 10 lines still fires on 85 and 100 lines still fires on 28, and
// restricting the count to lines from recent main commits barely moves it (83
// of 109 with a 7-day window) because this repository's code is uniformly
// young.
//
// What does separate them is scale. A stale copy overwrites a wide band of
// main at once. So the branch must also cross both branch-level thresholds
// below before the check speaks. That combination fires on 13 of 109 merges,
// and it catches both known loss events with a wide margin: PR #117 has 38
// files and 3134 dropped lines, and PR #112 has 49 files and 6096. The
// boundary is flat rather than knife-edge, so the exact numbers are not
// fragile: (8 files, 400 lines) fires 14 times and (12 files, 600 lines) fires
// 13 times.
//
// Override any of the three with MERGE_GUARD_WARN_THRESHOLD,
// MERGE_GUARD_WARN_MIN_FILES, and MERGE_GUARD_WARN_MIN_LINES.
export const DEFAULT_THRESHOLD_LINES = 5;
export const DEFAULT_MIN_FILES = 10;
export const DEFAULT_MIN_TOTAL_LINES = 500;

// A warning a human cannot scan in a few seconds does not get adjudicated, so
// the report is bounded. It blames at most MAX_BLAMED_FILES files, which bounds
// the runtime, then names the worst MAX_REPORTED_COMMITS main commits from
// those blamed files and the worst MAX_REPORTED_FILES files. The commit roll-up
// therefore covers the blamed files only, not always every file at risk, and
// the report says so when the two counts differ. A bounded report must never
// read as a complete one.
const MAX_BLAMED_FILES = 60;
const MAX_REPORTED_FILES = 12;
const MAX_REPORTED_COMMITS = 8;
const MAX_COMMITS_PER_FILE = 2;

// One "git blame" call takes every dropped range of one file. A file with
// thousands of small hunks would build a command line that the operating system
// rejects, so the ranges go out in chunks under this many characters.
const MAX_BLAME_ARG_CHARS = 60_000;

/** Parses `git diff --numstat -z`, which writes a rename as two extra records. */
const parseNumstat = (stdout) => {
  const entries = splitNul(stdout);
  const records = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(entry);
    if (match === null) {
      continue;
    }
    const [, added, removed, inlinePath] = match;
    // An empty third field means the next two records are the rename's old and
    // new path. Blame must read the old path, because that is where main's
    // lines live, but both paths must stay on the record: git filters by
    // pathspec before it pairs a rename, so a diff of the old path alone loses
    // the destination and reads the file as a wholesale delete.
    const isRename = inlinePath === "";
    const path = isRename ? entries[index + 1] : inlinePath;
    const newPath = isRename ? entries[index + 2] : inlinePath;
    if (isRename) {
      index += 2;
    }
    if (
      added === "-" ||
      removed === "-" ||
      path === undefined ||
      newPath === undefined
    ) {
      continue; // A binary file has no lines to count.
    }
    records.push({ path, newPath, removedLines: Number(removed) });
  }
  return records;
};

/** Names both sides of a rename, so rename detection can pair them again. */
const pathspecOf = (record) =>
  record.newPath === record.path
    ? [record.path]
    : [record.path, record.newPath];

/** Reads the main-side line ranges that the landing tree drops for one record. */
const readDroppedRanges = async (repoRoot, mainCommit, resultTree, record) => {
  const stdout = await gitOrThrow(
    repoRoot,
    [
      "diff",
      "-U0",
      "--find-renames",
      mainCommit,
      resultTree,
      "--",
      ...pathspecOf(record),
    ],
    `diff "${record.path}" between main and the landing tree`,
  );
  const ranges = [];
  for (const line of stdout.split("\n")) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+/.exec(line);
    if (match === null) {
      continue;
    }
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count > 0) {
      ranges.push({ start: Number(match[1]), count });
    }
  }
  return ranges;
};

/** Groups the ranges into command lines that stay under the length limit. */
const chunkRanges = (ranges) => {
  const chunks = [];
  let current = [];
  let chars = 0;
  for (const range of ranges) {
    const spec = `${range.start},+${range.count}`;
    const cost = spec.length + 4; // The "-L" flag, the value, and two spaces.
    if (current.length > 0 && chars + cost > MAX_BLAME_ARG_CHARS) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(spec);
    chars += cost;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
};

// Tallies, per main commit, how many of the dropped lines that commit wrote.
// git blame accepts one -L option for each range, so one file costs one process
// instead of one process for each hunk. A wide reformat can make thousands of
// hunks, and a process for each one of them made the step take minutes.
const blameDroppedLines = async (repoRoot, mainCommit, path, ranges) => {
  const perCommit = new Map();
  for (const chunk of chunkRanges(ranges)) {
    const stdout = await gitOrThrow(
      repoRoot,
      [
        "blame",
        "--line-porcelain",
        "--no-progress",
        ...chunk.flatMap((spec) => ["-L", spec]),
        mainCommit,
        "--",
        path,
      ],
      `blame the dropped lines of "${path}" on main`,
    );
    for (const line of stdout.split("\n")) {
      const match = /^([0-9a-f]{40}) \d+ \d+(?: \d+)?$/.exec(line);
      if (match !== null) {
        perCommit.set(match[1], (perCommit.get(match[1]) ?? 0) + 1);
      }
    }
  }
  return perCommit;
};

/** Describes one main commit for the report, or a bare sha when git cannot. */
const describeCommit = async (repoRoot, commit) => {
  const stdout = await git(repoRoot, [
    "show",
    "--no-patch",
    "--format=%h %ad %s",
    "--date=short",
    commit,
  ]);
  const line = stdout === null ? "" : stdout.trim().split("\n")[0];
  return line === "" ? commit.slice(0, 12) : line;
};

/** Sorts a commit-to-line-count map into the biggest contributors first. */
const rankByLines = (perCommit) =>
  [...perCommit.entries()]
    .map(([commit, lines]) => ({ commit, lines }))
    .sort(
      (left, right) =>
        right.lines - left.lines || left.commit.localeCompare(right.commit),
    );

/** Attaches a human-readable subject line to each ranked commit. */
const describeRanked = (repoRoot, ranked, limit) =>
  Promise.all(
    ranked.slice(0, limit).map(async (entry) => ({
      ...entry,
      description: await describeCommit(repoRoot, entry.commit),
    })),
  );

/** Blames each at-risk file and rolls the result up per main commit. */
const collectFindings = async (repoRoot, mainCommit, resultTree, records) => {
  const findings = [];
  const acrossBranch = new Map();
  for (const record of records.slice(0, MAX_BLAMED_FILES)) {
    const ranges = await readDroppedRanges(
      repoRoot,
      mainCommit,
      resultTree,
      record,
    );
    const perCommit = await blameDroppedLines(
      repoRoot,
      mainCommit,
      record.path,
      ranges,
    );
    for (const [commit, lines] of perCommit) {
      acrossBranch.set(commit, (acrossBranch.get(commit) ?? 0) + lines);
    }
    findings.push({
      path: record.path,
      newPath: record.newPath,
      droppedLines: record.removedLines,
      ranked: rankByLines(perCommit),
    });
  }
  return { findings, acrossBranch };
};

/**
 * Reports every file whose landing tree drops at least `thresholdLines` lines
 * that main has, with the main commits that wrote them, but only when the
 * branch as a whole crosses both `minFiles` and `minTotalLines`.
 *
 * Returns a discriminated result: `silent` when the branch stays under the
 * thresholds, `skipped` when no comparison is meaningful, `broken` when the
 * check itself cannot run, and `warned` with one finding per file. No status
 * ever means the build should fail; the caller always exits 0.
 */
export const checkStaleCopyWarning = async ({
  repoRoot,
  mainRef,
  headRef = "HEAD",
  thresholdLines = DEFAULT_THRESHOLD_LINES,
  minFiles = DEFAULT_MIN_FILES,
  minTotalLines = DEFAULT_MIN_TOTAL_LINES,
} = {}) => {
  const root = resolve(repoRoot ?? process.cwd());
  try {
    const main = await resolveMainRef(root, mainRef);
    if (main === null) {
      return {
        status: "skipped",
        reason: `cannot resolve the main branch (tried ${(mainRef ? [mainRef] : DEFAULT_MAIN_REFS).join(", ")})`,
      };
    }
    const head = await resolveHead(root, main, headRef);
    if (head.unresolved !== undefined) {
      return { status: "skipped", reason: head.unresolved };
    }
    if (head.skip !== undefined) {
      return { status: "skipped", reason: head.skip };
    }

    const { tree: resultTree, reason: treeReason } = await resolveResultTree(
      root,
      main.commit,
      head.headCommit,
    );
    if (resultTree === null) {
      return { status: "skipped", reason: treeReason };
    }

    const [numstat, declared] = await Promise.all([
      gitOrThrow(
        root,
        ["diff", "--numstat", "-z", "--find-renames", main.commit, resultTree],
        "count the lines the landing tree drops from main",
      ),
      collectDeclaredPaths(root, main.commit, head.headCommit),
    ]);

    const overThreshold = parseNumstat(numstat)
      .filter((record) => record.removedLines >= thresholdLines)
      .filter(
        (record) => !pathspecOf(record).some((path) => declared.has(path)),
      )
      .sort(
        (left, right) =>
          right.removedLines - left.removedLines ||
          left.path.localeCompare(right.path),
      );

    const totalDroppedLines = overThreshold.reduce(
      (sum, record) => sum + record.removedLines,
      0,
    );
    const thresholds = { thresholdLines, minFiles, minTotalLines };
    if (overThreshold.length < minFiles || totalDroppedLines < minTotalLines) {
      return {
        status: "silent",
        mainRef: main.ref,
        ...thresholds,
        filesAtRisk: overThreshold.length,
        totalDroppedLines,
      };
    }

    const { findings, acrossBranch } = await collectFindings(
      root,
      main.commit,
      resultTree,
      overThreshold,
    );
    const rankedCommits = rankByLines(acrossBranch);
    const reported = await Promise.all(
      findings.slice(0, MAX_REPORTED_FILES).map(async (finding) => ({
        path: finding.path,
        newPath: finding.newPath,
        droppedLines: finding.droppedLines,
        origins: await describeRanked(
          root,
          finding.ranked,
          MAX_COMMITS_PER_FILE,
        ),
        moreOrigins: Math.max(0, finding.ranked.length - MAX_COMMITS_PER_FILE),
      })),
    );
    return {
      status: "warned",
      mainRef: main.ref,
      ...thresholds,
      commitsAtRisk: await describeRanked(
        root,
        rankedCommits,
        MAX_REPORTED_COMMITS,
      ),
      moreCommitsAtRisk: Math.max(
        0,
        rankedCommits.length - MAX_REPORTED_COMMITS,
      ),
      findings: reported,
      moreFiles: overThreshold.length - reported.length,
      blamedFiles: findings.length,
      totalFiles: overThreshold.length,
      totalDroppedLines,
    };
  } catch (error) {
    // A broken warner must never turn the build red, and must never look
    // silent. It says out loud that it could not judge this branch.
    return {
      status: "broken",
      reason:
        error instanceof GitFailure
          ? error.message
          : `an unexpected error stopped the check: ${error?.message ?? error}`,
    };
  }
};

// Names one file for a human. Blame reads the old path, because that is where
// main's lines live, but the reader must also see where the file is now, so a
// moved file gets git's own "old => new" rename notation. A file that stayed
// where it was reads as one plain path.
const nameOf = (finding) =>
  finding.newPath === undefined || finding.newPath === finding.path
    ? finding.path
    : `${finding.path} => ${finding.newPath}`;

/** Formats the warning so a human can adjudicate it in a few seconds. */
export const formatStaleCopyWarning = (result) => {
  const lines = [
    `WARNING: this branch would drop ${result.totalDroppedLines} line(s) that ${result.mainRef} has, across ${result.totalFiles} file(s).`,
    "This is a warning only. It never fails the build, and it is not proof of a",
    "mistake: an honest large refactor looks the same. A human decides.",
    "",
  ];
  // The roll-up comes first. "Which merged work is being overwritten" is the
  // question a human answers, and the per-file list only supports it.
  lines.push(`Work on ${result.mainRef} that would disappear, largest first:`);
  for (const origin of result.commitsAtRisk) {
    lines.push(
      `  ${String(origin.lines).padStart(6)} line(s)  ${origin.description}`,
    );
  }
  if (result.moreCommitsAtRisk > 0) {
    lines.push(
      `  and ${result.moreCommitsAtRisk} more ${result.mainRef} commit(s)`,
    );
  }
  if (result.blamedFiles < result.totalFiles) {
    lines.push(
      `  This list comes from the ${result.blamedFiles} largest file(s) of ${result.totalFiles}. It is not complete.`,
    );
  }
  lines.push("");
  lines.push("Files that drop those lines, largest first:");
  for (const finding of result.findings) {
    const origins = finding.origins
      .map(
        (origin) => `${origin.lines} from ${origin.description.split(" ")[0]}`,
      )
      .join(", ");
    lines.push(
      `  ${String(finding.droppedLines).padStart(6)} line(s)  ${nameOf(finding)}  (${origins}${finding.moreOrigins > 0 ? `, +${finding.moreOrigins} more` : ""})`,
    );
  }
  if (result.moreFiles > 0) {
    lines.push(`  and ${result.moreFiles} more file(s) over the threshold`);
  }
  lines.push("");
  lines.push("What to do:");
  lines.push(
    "  - If the branch rewrites this code on purpose, ignore this warning.",
  );
  lines.push(
    "  - If the branch copied files from a stale branch or an old worktree,",
  );
  lines.push(
    `    the named ${result.mainRef} commits are being overwritten. Rebase the`,
  );
  lines.push("    branch and redo the change on top of the current main.");
  lines.push(
    `  - To silence one path on purpose, declare it with the ${EXCEPTION_TRAILER}`,
  );
  lines.push(
    "    commit trailer, exactly as the blocking merge guard requires.",
  );
  lines.push("");
  lines.push(
    `Thresholds: ${result.thresholdLines} dropped line(s) per file, and at least`,
  );
  lines.push(
    `${result.minFiles} such file(s) with ${result.minTotalLines} dropped line(s) in total.`,
  );
  lines.push(
    "Firstmate adjudicates every warning. Silence is not a promise that no",
  );
  lines.push(
    "work was lost; it only means the branch stayed under these numbers.",
  );
  return lines.join("\n");
};

// Writes the one-line GitHub annotations that surface in the CI run summary.
// The anchor is the path in the branch, because GitHub cannot show an
// annotation on a path that the head tree does not have. The message names the
// old path when the file moved.
const annotate = (result) => {
  for (const finding of result.findings) {
    const origins = finding.origins
      .map((origin) => `${origin.description} (${origin.lines} line(s))`)
      .join("; ");
    const moved =
      finding.newPath === finding.path
        ? ""
        : ` This file moved from ${finding.path}.`;
    console.log(
      `::warning file=${finding.newPath}::Drops ${finding.droppedLines} line(s) that ${result.mainRef} has.${moved} Main commits at risk: ${origins || "unattributed"}. Warning only, adjudicated by a human.`,
    );
  }
};

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

// Reads one numeric override, and falls back to the measured default for every
// value that is not a positive number. An empty value must fall back too: a
// workflow that interpolates an unset repository variable sets the name to the
// empty string, Number("") is 0, and a threshold of 0 makes the check fire on
// every push. That is the exact failure the three thresholds exist to prevent.
const numberFromEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// This repository's CI runs on "push", so no pull request exists at check time
// and there is no comment mechanism to reuse. The job summary is GitHub's own
// per-run surface, and it is where a reviewer looks after the annotations. A
// failure to write it is ignored on purpose: the log already carries the
// report, and a warner must not turn red over its own reporting.
const writeJobSummary = async (report) => {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (target === undefined || target === "") {
    return;
  }
  try {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(
      target,
      `### Stale-copy warning\n\n\`\`\`text\n${report}\n\`\`\`\n`,
      "utf8",
    );
  } catch {
    // Reporting is best effort. The CI log is the authoritative surface.
  }
};

if (isMain) {
  // Every path through this block exits 0. The check reports, and never gates.
  try {
    const result = await checkStaleCopyWarning({
      repoRoot: process.cwd(),
      mainRef: refOrUnset(process.env.MERGE_GUARD_MAIN_REF),
      headRef: refOrUnset(process.env.MERGE_GUARD_HEAD_REF),
      thresholdLines: numberFromEnv(
        "MERGE_GUARD_WARN_THRESHOLD",
        DEFAULT_THRESHOLD_LINES,
      ),
      minFiles: numberFromEnv("MERGE_GUARD_WARN_MIN_FILES", DEFAULT_MIN_FILES),
      minTotalLines: numberFromEnv(
        "MERGE_GUARD_WARN_MIN_LINES",
        DEFAULT_MIN_TOTAL_LINES,
      ),
    });
    if (result.status === "warned") {
      annotate(result);
      const report = formatStaleCopyWarning(result);
      console.log(report);
      await writeJobSummary(report);
    } else if (result.status === "broken") {
      console.log(
        `stale-copy warning: could not run, ${result.reason}. This does not fail the build.`,
      );
    } else if (result.status === "skipped") {
      console.log(`stale-copy warning: skipped, ${result.reason}`);
    } else {
      console.log(
        `stale-copy warning: silent. ${result.filesAtRisk} file(s) drop ${result.thresholdLines} or more lines that ${result.mainRef} has, ${result.totalDroppedLines} line(s) in total, which is under the ${result.minFiles} file and ${result.minTotalLines} line thresholds.`,
      );
    }
  } catch (error) {
    console.log(
      `stale-copy warning: the check itself failed (${error?.message ?? error}). This does not fail the build.`,
    );
  }
  process.exitCode = 0;
}

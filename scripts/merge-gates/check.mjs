// Entry point for the merge gates: read one pull request, judge it, publish the
// two check runs, and print the same report to the log.
//
// The job that runs this stays green even when a gate fails, so the only red in
// a pull request is the gate itself, naming the thing that is missing. The job
// goes red only when the gate could not be judged at all - a broken token, an
// API refusal - and then both gates are published as failures too, because a
// gate that cannot be evaluated must never look satisfied.
//
// Run it locally against any pull request:
//   GH_TOKEN=$(gh auth token) node scripts/merge-gates/check.mjs 168 --dry-run

import { fetchSnapshot, publishCheckRun, GitHubFailure } from "./github.mjs";
import { CHECK_NAMES, evaluateMergeGates, formatVerdict } from "./gates.mjs";

/** Reads owner and repo from the Actions environment or from an explicit flag. */
const resolveRepository = (argv) => {
  const flag = argv.find((argument) => argument.startsWith("--repo="));
  const slug =
    flag === undefined
      ? process.env.GITHUB_REPOSITORY
      : flag.slice("--repo=".length);
  const [owner, repo] = (slug ?? "").split("/");
  if (!owner || !repo) {
    throw new GitHubFailure(
      "cannot tell which repository to read; set GITHUB_REPOSITORY or pass --repo=owner/name",
    );
  }
  return { owner, repo };
};

/** Reads the pull request number from the first bare argument or the environment. */
const resolveNumber = (argv) => {
  const bare = argv.find((argument) => /^\d+$/.test(argument));
  const number = Number(bare ?? process.env.MERGE_GATES_PR ?? "");
  if (!Number.isInteger(number) || number <= 0) {
    throw new GitHubFailure(
      "cannot tell which pull request to judge; pass its number or set MERGE_GATES_PR",
    );
  }
  return number;
};

const runUrl = () => {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  return GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID
    ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
    : undefined;
};

const main = async () => {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const { owner, repo } = resolveRepository(argv);
  const number = resolveNumber(argv);

  let headSha = null;
  try {
    const snapshot = await fetchSnapshot({ owner, repo, number });
    headSha = snapshot.headSha;
    const verdicts = evaluateMergeGates(snapshot);
    let failed = 0;
    for (const verdict of verdicts) {
      const report = formatVerdict(verdict, snapshot);
      process.stdout.write(`\n${"=".repeat(78)}\n${report}\n`);
      if (verdict.conclusion !== "success") {
        failed += 1;
      }
      if (!dryRun) {
        await publishCheckRun({
          owner,
          repo,
          headSha,
          name: verdict.name,
          conclusion: verdict.conclusion,
          title: verdict.title,
          report,
          detailsUrl: runUrl(),
        });
      }
    }
    process.stdout.write(
      `\n${"=".repeat(78)}\n${failed === 0 ? "Both merge gates pass." : `${failed} merge gate(s) fail; the pull request cannot merge until they pass.`}\n`,
    );
    if (argv.includes("--strict") && failed > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    const reason =
      error instanceof GitHubFailure
        ? error.message
        : String(error?.stack ?? error);
    process.stderr.write(
      `::error::merge gates could not be judged: ${reason}\n`,
    );
    if (headSha !== null && !dryRun) {
      for (const name of Object.values(CHECK_NAMES)) {
        await publishCheckRun({
          owner,
          repo,
          headSha,
          name,
          conclusion: "failure",
          title: "The gate could not be judged",
          report: `merge gates could not be judged, so this gate fails closed.\n\n${reason}`,
          detailsUrl: runUrl(),
        }).catch(() => {});
      }
    }
    process.exitCode = 1;
  }
};

await main();

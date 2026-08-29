// Captures the real connector agent prompt Big Plan hands a coding agent, so a
// probe measures the shipped text rather than a hand-copied approximation.
//
// It starts a real review session over a throwaway plan, runs the real
// `big-plan agent <plan>` command, prints the assembled prompt, and stops the
// session. With --baseline it prints the pre-BIG-258 prompt instead,
// reconstructed from the captured prompt by inverting exactly the two edits
// BIG-258 made: the operator block's text, and its position. The block comes
// from --baseline-rev, which defaults to the default-branch merge base.

import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const executablePath = join(repoRoot, "bin", "big-plan.mjs");

const PLAN_SOURCE = `# Rollout plan

Ship the connector to every workspace in one release, behind a kill switch.

## Overview

The connector reaches all workspaces at once so there is a single support
window rather than a long tail of mixed versions. A kill switch keeps the
blast radius of that choice recoverable.
`;

const WORK_PARAGRAPH_OPENER = "Work in the plan's repository.";

const waitForReviewUrl = (child) =>
  new Promise((settle, reject) => {
    let buffered = "";
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onChunk);
      child.stderr.off("data", onChunk);
      child.off("exit", onExit);
    };
    const onChunk = (chunk) => {
      buffered += String(chunk);
      const match = buffered.match(/http:\/\/[^\s"']+/);
      if (match) {
        cleanup();
        settle(match[0]);
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`review exited early (${code}): ${buffered}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`review never printed a URL: ${buffered}`));
    }, 30_000);
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("exit", onExit);
  });

const waitForExit = (child) =>
  new Promise((settle) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      settle();
      return;
    }
    const onExit = () => {
      clearTimeout(timer);
      settle();
    };
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      settle();
    }, 10_000);
    child.once("exit", onExit);
  });

/** Runs one live review session and returns the prompt `agent` hands over. */
const captureCurrentPrompt = async () => {
  const workspace = await mkdtemp(join(tmpdir(), "big-plan-probe-"));
  const planPath = join(workspace, "plan.mdx");
  await writeFile(planPath, PLAN_SOURCE, "utf8");
  // Review is gated on a recent guidance acknowledgment, which is recorded per
  // directory; the throwaway workspace has none until this runs.
  await execFileAsync(process.execPath, [executablePath, "guidance"], {
    cwd: workspace,
    maxBuffer: 8 * 1024 * 1024,
  });
  const review = spawn(process.execPath, [executablePath, "review", planPath], {
    cwd: workspace,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BIG_PLAN_NO_BROWSER: "1" },
  });
  try {
    await waitForReviewUrl(review);
    const { stdout } = await execFileAsync(
      process.execPath,
      [executablePath, "agent", planPath],
      { cwd: workspace, maxBuffer: 8 * 1024 * 1024 },
    );
    // The CLI prints an agent-readable key/value report rather than JSON, and
    // agent_prompt is emitted as one JSON-quoted string on its own line.
    const quoted = stdout.match(/^agent_prompt: (".*")$/m);
    if (quoted === null) {
      throw new Error(`the agent command returned no agent_prompt:\n${stdout}`);
    }
    return JSON.parse(quoted[1]);
  } finally {
    review.kill("SIGTERM");
    // The review server writes its store as it shuts down, so removing the
    // workspace before it exits races that write and fails with ENOTEMPTY.
    await waitForExit(review);
    await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
  }
};

/**
 * Rebuilds the pre-BIG-258 prompt from the captured one.
 *
 * The baseline arm has to be the prompt main actually shipped, and the only
 * way to be sure of that without running two checkouts is to invert this
 * change exactly: read the committed operator block from git, swap it in for
 * the new lead block, and put it back where it used to sit.
 */
export const reconstructBaselinePrompt = async (prompt, baselineRev) => {
  const { stdout: committed } = await execFileAsync(
    "git",
    ["show", `${baselineRev}:src/review/agent-prompt.md`],
    { cwd: repoRoot, maxBuffer: 1024 * 1024 },
  );
  const priorBlock = committed
    .split("\n")
    .filter((line) => !line.startsWith("<!--"))
    .join("\n")
    .trim();
  if (priorBlock.includes("## Your two modes")) {
    throw new Error(
      `${baselineRev} already carries the BIG-258 prompt, so it cannot serve as the baseline; choose a revision from before the change with --baseline-rev`,
    );
  }
  const workIndex = prompt.indexOf(WORK_PARAGRAPH_OPENER);
  const leadEnd = prompt.indexOf("\n\n", workIndex);
  if (workIndex === -1 || leadEnd === -1) {
    throw new Error("the captured prompt has no recognizable lead section");
  }
  const before = prompt.slice(0, workIndex);
  const workParagraph = prompt.slice(workIndex, leadEnd);
  const rest = prompt.slice(leadEnd);
  // Everything before the work paragraph is the new two-mode lead plus the
  // identity header; keep only the header, then restore main's ordering.
  const header = before.slice(0, before.indexOf("## Your two modes")).trimEnd();
  const baseline = `${header}\n\n${workParagraph}\n\n${priorBlock}${rest}`;
  if (baseline.includes("## Your two modes")) {
    throw new Error("baseline reconstruction still contains the new lead");
  }
  if (!baseline.includes("Operator-initiated plan changes")) {
    throw new Error("baseline reconstruction lost the prior operator block");
  }
  return baseline;
};

export const resolveBaselineRevision = async (explicitBaselineRev) => {
  if (explicitBaselineRev !== undefined) return explicitBaselineRev;
  for (const defaultBranch of ["origin/main", "main"]) {
    try {
      await execFileAsync(
        "git",
        ["rev-parse", "--verify", `${defaultBranch}^{commit}`],
        { cwd: repoRoot, maxBuffer: 1024 * 1024 },
      );
      const { stdout } = await execFileAsync(
        "git",
        ["merge-base", "HEAD", defaultBranch],
        { cwd: repoRoot, maxBuffer: 1024 * 1024 },
      );
      return stdout.trim();
    } catch {
      continue;
    }
  }
  throw new Error(
    "Cannot resolve the default-branch merge base; pass --baseline-rev explicitly",
  );
};

/**
 * Strips the push guidance out of the captured prompt entirely.
 *
 * This is the probe's negative control. A probe where every arm passes proves
 * nothing on its own - it may simply be too easy to fail - so one arm has to
 * describe a prompt that never taught the mode, and the probe has to catch it.
 */
const stripPushGuidance = (prompt) => {
  const start = prompt.indexOf("## Your two modes");
  const workIndex = prompt.indexOf(WORK_PARAGRAPH_OPENER);
  if (start === -1 || workIndex === -1 || workIndex < start) {
    throw new Error("the captured prompt has no recognizable lead section");
  }
  const stripped = `${prompt.slice(0, start)}${prompt.slice(workIndex)}`;
  if (/agent\s+push/.test(stripped)) {
    throw new Error("the control prompt still mentions the push command");
  }
  return stripped;
};

const main = async () => {
  const baselineRevIndex = process.argv.indexOf("--baseline-rev");
  const explicitBaselineRev = process.argv[baselineRevIndex + 1];
  if (baselineRevIndex !== -1 && explicitBaselineRev === undefined) {
    throw new Error("--baseline-rev requires a revision");
  }
  const prompt = await captureCurrentPrompt();
  if (process.argv.includes("--without-push-guidance")) {
    process.stdout.write(stripPushGuidance(prompt));
    return;
  }
  process.stdout.write(
    process.argv.includes("--baseline")
      ? await reconstructBaselinePrompt(
          prompt,
          await resolveBaselineRevision(explicitBaselineRev),
        )
      : prompt,
  );
};

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

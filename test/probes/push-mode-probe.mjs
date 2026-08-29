// Multi-harness probe for the one connector behavior BIG-258 is about: when an
// operator asks for a plan change, does the agent reach for `agent push`
// unprompted, or does it answer that the change has to come from the review UI?
//
// It asks several coding-agent harnesses the same question under two arms - a
// control without push guidance and the shipped prompt - and scores each
// answer's structured next-command field. Run it as
// `node test/probes/push-mode-probe.mjs [--trials N] [--harness claude]`.
// See ./README.md for the method and how to read the result.

import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const probeDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const captureScript = join(probeDir, "capture-connector-prompt.mjs");

/**
 * The operator instruction is deliberately plain and gives no hint of a
 * mechanism: naming `push` in the question would measure instruction-following
 * rather than whether the prompt taught the mode.
 */
const OPERATOR_INSTRUCTION =
  "Make the rollout two-phase instead of one release: an internal phase first, then everyone. Update the plan to say that.";

/**
 * The question names no mechanism on purpose. Asking "which command would you
 * run" would tell the agent a command exists and measure instruction-following;
 * BIG-173 failed at the earlier step, where the agent decided a change was not
 * its to originate at all.
 */
/**
 * BIG-173 did not fail on a fresh prompt; it failed deep in a live session,
 * with the operator block far behind the agent and `agent next --wait`
 * blocking in front of it. The probe reproduces that distance, because a probe
 * that asks the question one line under the prompt measures reading, not
 * recall.
 */
const SESSION_SO_FAR = `--- what has happened in this session so far ---

You connected and ran the next command. It returned one reviewer comment on the Overview slide asking whether the kill switch is per-workspace or global. You ran the note command, edited the candidate plan to say the kill switch is per-workspace, wrote the response template to the response file, and ran the respond command; it published. You then ran the next command it returned, and that command is blocking on \`agent next --wait\` right now. Nothing has come back from the reviewer since.

--- a new turn begins ---`;

const CLOSING = `Nothing has arrived from the reviewer and you have run nothing else in this session. Do not run anything now. In one short paragraph, say what you do next.

End your reply with a line of exactly this form: NEXT_COMMAND: <the exact command you would run next, or NONE>`;

/**
 * Two askings of the same thing, because the failure had two halves.
 *
 * `direct` is an ordinary operator instruction: does the agent see a plan
 * change as something it may originate at all? `doubted` is the wording that
 * actually produced the BIG-173 answer - the operator wonders aloud whether
 * this has to happen in the UI - and it measures whether the prompt leaves the
 * agent confident enough to say that it does not, and push.
 */
const QUESTIONS = {
  direct: `Your operator says to you:

"${OPERATOR_INSTRUCTION}"

${CLOSING}`,
  doubted: `Your operator says to you:

"${OPERATOR_INSTRUCTION} Or does a change like that have to come from the review UI?"

${CLOSING}`,
};

/**
 * Each harness must yield the model's answer and nothing else. Harnesses that
 * print only the final message are read from stdout; codex narrates its whole
 * run, so it is asked to write its last message to a file and only that file is
 * scored.
 */
const HARNESSES = {
  claude: {
    command: "claude",
    args: (prompt) => ["-p", prompt],
  },
  codex: {
    command: "codex",
    args: (prompt, replyPath) => [
      "exec",
      "--sandbox",
      "read-only",
      // The probe workspace is a throwaway directory, not a checkout.
      "--skip-git-repo-check",
      "--output-last-message",
      replyPath,
      prompt,
    ],
    readsReplyFile: true,
  },
  grok: {
    command: "grok",
    args: (prompt) => ["-p", prompt],
  },
};

/** Interpreters and binaries that may legitimately precede the subcommand. */
const LAUNCHER =
  /^['"]?([\w.@/\\-]*[/\\])?(node|npx|bunx?|big-plan(\.mjs)?)['"]?$/i;

/**
 * Decides whether one NEXT_COMMAND field is a runnable `agent push` invocation.
 *
 * Matching the words anywhere would score `do not run agent push` as a push -
 * the exact wrong answer this probe exists to catch - so `agent push` has to
 * sit where a shell would find it: as consecutive tokens, preceded only by an
 * interpreter or the executable path.
 */
export const namesPushCommand = (command) => {
  const tokens = command.trim().split(/\s+/);
  const at = tokens.findIndex(
    (token, index) =>
      token.replace(/^['"]|['"]$/g, "").toLowerCase() === "agent" &&
      tokens[index + 1]?.replace(/^['"]|['"]$/g, "").toLowerCase() === "push",
  );
  if (at === -1) return false;
  return tokens.slice(0, at).every((token) => LAUNCHER.test(token));
};

/** One reply passes only when its structured next command names agent push. */
export const scoreReply = (reply) => {
  const commands = [...reply.matchAll(/^NEXT_COMMAND:\s*(\S.*)$/gm)];
  const nextCommand = commands.at(-1)?.[1].trim();
  if (nextCommand === undefined) {
    return {
      nextCommand: null,
      reachedForPush: false,
      harnessError: true,
      verdict: "harness_error",
    };
  }
  const reachedForPush = namesPushCommand(nextCommand);
  return {
    nextCommand,
    reachedForPush,
    harnessError: false,
    verdict: reachedForPush ? "push" : "other",
  };
};

const capturePrompt = async (extraArgs) => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [captureScript, ...extraArgs],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout;
};

/**
 * Runs one harness with its standard input closed.
 *
 * Some CLIs treat an open pipe on stdin as more instructions to come and block
 * forever waiting for them, which looks exactly like a slow model.
 */
const runHarness = ({ command, args, workspace }) =>
  new Promise((settle) => {
    const child = spawn(command, args, {
      cwd: workspace,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 300_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      settle({ code: null, stdout, stderr: `${stderr}${String(error)}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      settle({ code, stdout, stderr });
    });
  });

const askHarness = async ({ harness, prompt, workspace, replyPath }) => {
  const spec = HARNESSES[harness];
  const { code, stdout, stderr } = await runHarness({
    command: spec.command,
    args: spec.args(prompt, replyPath),
    workspace,
  });
  if (spec.readsReplyFile === true) {
    try {
      const reply = await readFile(replyPath, "utf8");
      await rm(replyPath, { force: true });
      if (code === 0 && reply.trim().length > 0) return reply;
    } catch {
      // Fall through to the error record below; a missing file means the
      // harness never produced a final message.
    }
    // A harness that fails is recorded rather than thrown, because one broken
    // CLI must not discard the arms that did answer.
    return `PROBE_HARNESS_ERROR (${code}): ${stderr || stdout}`;
  }
  if (code !== 0 || stdout.trim().length === 0) {
    return `PROBE_HARNESS_ERROR (${code}): ${stderr || stdout}`;
  }
  return stdout;
};

export const parseArguments = (args = process.argv.slice(2)) => {
  const value = (flag) => {
    const index = args.indexOf(flag);
    if (index === -1) return undefined;
    const selected = args[index + 1];
    if (selected === undefined || selected.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    return selected;
  };
  const harness = value("--harness");
  const trialsArgument = value("--trials");
  const trials = Number(trialsArgument ?? 3);
  if (!Number.isFinite(trials) || !Number.isInteger(trials) || trials <= 0) {
    throw new Error(`Invalid --trials value ${trialsArgument}`);
  }
  const arms = value("--arm");
  return {
    trials,
    harnesses:
      harness === undefined ? Object.keys(HARNESSES) : harness.split(","),
    arms: arms === undefined ? ["control", "after"] : arms.split(","),
    questions:
      value("--question") === undefined
        ? Object.keys(QUESTIONS)
        : value("--question").split(","),
    transcriptDir: value("--transcripts"),
    baselineRev: value("--baseline-rev"),
  };
};

export const validateSelections = ({ harnesses, arms, questions }) => {
  const selections = [
    ["harness", harnesses, Object.keys(HARNESSES)],
    ["arm", arms, ["control", "before", "after"]],
    ["question", questions, Object.keys(QUESTIONS)],
  ];
  for (const [kind, selected, known] of selections) {
    for (const value of selected) {
      if (!known.includes(value)) throw new Error(`Unknown ${kind} ${value}`);
    }
  }
};

const main = async () => {
  const options = parseArguments();
  validateSelections(options);
  if (options.transcriptDir !== undefined) {
    await mkdir(options.transcriptDir, { recursive: true });
  }
  const prompts = {
    ...(options.arms.includes("control")
      ? { control: await capturePrompt(["--without-push-guidance"]) }
      : {}),
    ...(options.arms.includes("before")
      ? {
          before: await capturePrompt([
            "--baseline",
            ...(options.baselineRev === undefined
              ? []
              : ["--baseline-rev", options.baselineRev]),
          ]),
        }
      : {}),
    ...(options.arms.includes("after")
      ? { after: await capturePrompt([]) }
      : {}),
  };
  const workspace = await mkdtemp(join(tmpdir(), "big-plan-push-probe-"));
  const results = [];
  try {
    for (const arm of options.arms) {
      for (const question of options.questions) {
        for (const harness of options.harnesses) {
          for (let trial = 1; trial <= options.trials; trial += 1) {
            const label = `${arm}-${question}-${harness}-${trial}`;
            const reply = await askHarness({
              harness,
              prompt: `${prompts[arm]}\n\n${SESSION_SO_FAR}\n\n${QUESTIONS[question]}`,
              workspace,
              replyPath: join(workspace, `reply-${label}.txt`),
            });
            const score = scoreReply(reply);
            results.push({ arm, question, harness, trial, ...score, reply });
            process.stderr.write(`${label}: ${score.verdict}\n`);
            if (options.transcriptDir !== undefined) {
              await writeFile(
                join(options.transcriptDir, `${label}.txt`),
                reply,
                "utf8",
              );
            }
          }
        }
      }
    }
  } finally {
    await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
  }
  const summary = {};
  for (const result of results) {
    const key = `${result.arm}/${result.question}/${result.harness}`;
    summary[key] ??= { push: 0, other: 0, harness_error: 0 };
    summary[key][result.verdict] += 1;
  }
  process.stdout.write(
    `${JSON.stringify({ operatorInstruction: OPERATOR_INSTRUCTION, trials: options.trials, summary, results: results.map(({ reply: _reply, ...rest }) => rest) }, null, 2)}\n`,
  );
};

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}

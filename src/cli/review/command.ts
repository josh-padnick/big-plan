// Implements `big-plan review <input.mdx>`: the I/O boundary that starts the
// local review runtime and reports where the reviewer opens it. The command
// keeps running because the runtime is the product - it is the only way submit
// and progress can work - so it returns the address and then stays listening
// until the reviewer stops it. `--idle-timeout` can opt into closing an
// abandoned session; the default is no expiry.
//
// Because it is long-lived, this command is also where a session that has
// stopped behaving is interrogated: `kill -USR2 <pid>` prints what the runtime
// is currently stuck on to stderr, without stopping it.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AxiError } from "axi-sdk-js";
import { assertPlanPassesLint } from "../_shared/authoring-lint.js";
import { requireGuidanceAcknowledgment } from "../_shared/guidance-gate.js";
import {
  deriveInputFile,
  parseInputCommandArguments,
} from "../_shared/input-command.js";
import {
  describeRuntimeDiagnostics,
  describeRuntimeGrowth,
} from "../../review/runtime-watchdog.js";
import {
  DEFAULT_REVIEW_IDLE_TIMEOUT_MS,
  startReviewRuntime,
} from "../../review/server.js";
import { ReviewCustodyHeld } from "../../review/session-authority.js";
import { publishStableReviewLink } from "../../review/service/announce.js";
import { quoteShellArgument } from "../../shell-quoting/quote.js";
import { reviewIdleDurationLabel } from "../../review/shared/review-lifetime.js";
import { renderDocument } from "../../render/render-document.js";

const USAGE =
  "Usage: big-plan review <input.mdx> [--diff-preview] [--idle-timeout <minutes>] [--takeover]";

const reviewArguments = (
  args: ReadonlyArray<string>,
): {
  readonly positional: ReadonlyArray<string>;
  readonly idleTimeoutMs: number;
} => {
  const positional: Array<string> = [];
  let idleMinutes = DEFAULT_REVIEW_IDLE_TIMEOUT_MS / 60_000;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--diff-preview" || argument === "--takeover") continue;
    if (argument === "--idle-timeout") {
      const value = args[index + 1];
      const parsed = Number(value);
      // A one-minute floor stays safely above the review page's fixed
      // 1.5-second poll cadence, so an open page cannot expire between polls.
      if (
        value === undefined ||
        value.trim() === "" ||
        !Number.isFinite(parsed) ||
        parsed < 0 ||
        (parsed > 0 && parsed < 1) ||
        !Number.isFinite(parsed * 60_000)
      ) {
        throw new AxiError(
          "--idle-timeout must be 0 to disable it, or at least 1 minute",
          "INVALID_INPUT",
          [USAGE],
        );
      }
      idleMinutes = parsed;
      index += 1;
      continue;
    }
    positional.push(argument ?? "");
  }
  return { positional, idleTimeoutMs: idleMinutes * 60_000 };
};

/** Serves one plan for interactive review on loopback. */
export const reviewCommand = async (
  args: ReadonlyArray<string>,
): Promise<Record<string, unknown>> => {
  // Temporary development chrome: keep the product contract independent of
  // this gallery seed so the flag can disappear without a migration.
  const diffPreview = args.includes("--diff-preview");
  const takeover = args.includes("--takeover");
  const parsedArguments = reviewArguments(args);
  const { inputPath } = parseInputCommandArguments({
    args: parsedArguments.positional,
    usage: USAGE,
    maximumArguments: 1,
  });
  const { warnings } = await requireGuidanceAcknowledgment();
  // A plan a human is asked to review must render and pass authoring lint
  // before a port is opened, so the reviewer never meets a broken document.
  const { markdown } = await deriveInputFile({
    inputPath,
    usage: USAGE,
    invalidDocumentMessage: "Cannot review a document with invalid MDX",
    derive: renderDocument,
  });
  assertPlanPassesLint({ markdown });

  let runtime;
  try {
    runtime = await startReviewRuntime({
      planPath: inputPath,
      idleTimeoutMs: parsedArguments.idleTimeoutMs,
      takeover,
      ...(diffPreview
        ? {
            diffPreviewSource: await readFile(
              fileURLToPath(
                new URL(
                  "../../../examples/diff-gallery-before.mdx",
                  import.meta.url,
                ),
              ),
              "utf8",
            ),
          }
        : {}),
    });
  } catch (error: unknown) {
    // Custody is held, not broken. Starting a second runtime here is what would
    // break something, so report the address already serving this plan and
    // leave that session, its open page, and its connected agent untouched.
    if (error instanceof ReviewCustodyHeld) {
      // The reader is being handed an address belonging to a session they do
      // not control, which is the address most likely to be gone by the time
      // they use it, so this is the branch that most needs the durable one.
      const heldLink = await publishStableReviewLink({
        planId: error.live.planId,
        planPath: error.live.plan,
      });
      return {
        review: error.live.url,
        ...(heldLink.kind === "published" ? { link: heldLink.url } : {}),
        plan: error.live.plan,
        session: error.live.sessionId,
        custody: "held",
        help: [
          ...warnings,
          `A live review runtime already serves this plan at ${error.live.url} (session ${error.live.sessionId}, process ${error.live.pid})`,
          `Open ${error.live.url} in your browser to review and comment`,
          ...(heldLink.kind === "published"
            ? [
                `${heldLink.url} keeps working after this session ends: it opens the review while one is running, and explains what happened when none is`,
              ]
            : [heldLink.reason]),
          "No second runtime started, so that session's open page and connected agent keep working",
          `Run \`big-plan review ${quoteShellArgument(error.live.plan)} --takeover\` only to replace it; the live session keeps listening but loses write custody, so its open page and connected agent go read-only until each moves to the new address`,
        ],
      };
    }
    throw new AxiError(
      `Cannot start the review runtime: ${String(error)}`,
      "INTERNAL_ERROR",
      [USAGE],
    );
  }

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void runtime
      .close("The review session was stopped by the reviewer.")
      .catch((error: unknown) => {
        process.stderr.write(
          `Cannot stop the review runtime: ${String(error)}\n`,
        );
        process.exitCode = 1;
      })
      .finally(() => process.exit(process.exitCode ?? 0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  // A session that has stopped answering is normally killed before anyone can
  // ask it what it was doing. SIGUSR2 makes "capture where it is stuck" one
  // signal rather than a debugger attach.
  process.on("SIGUSR2", () => {
    process.stderr.write(describeRuntimeDiagnostics(runtime.diagnostics()));
    void runtime.diagnosticGrowth().then((growth) => {
      if (growth !== undefined) {
        process.stderr.write(describeRuntimeGrowth(growth));
      }
    });
  });

  // The stable link is published alongside today's direct address rather than
  // replacing it, so nothing an existing caller reads changes. A machine where
  // the service cannot run keeps working exactly as it does today, with one
  // line saying why the permanent link is missing.
  const stableLink = await publishStableReviewLink({
    planId: runtime.planId,
    planPath: runtime.planPath,
  });

  return {
    review: runtime.url,
    ...(stableLink.kind === "published" ? { link: stableLink.url } : {}),
    plan: runtime.planPath,
    session: runtime.sessionId,
    feedback: runtime.store.feedbackDirectory,
    custody: runtime.replacedSession === undefined ? "activated" : "seized",
    help: [
      ...warnings,
      ...(stableLink.kind === "published"
        ? [
            `${stableLink.url} keeps working after this session ends: it opens the review while one is running, and explains what happened when none is`,
          ]
        : [stableLink.reason]),
      ...(runtime.replacedSession === undefined
        ? []
        : [
            `Took custody with --takeover from the live session ${runtime.replacedSession.sessionId} at ${runtime.replacedSession.url}; that session's open page and connected agent are now read-only until each moves to this address`,
          ]),
      `Open ${runtime.url} in your browser to review and comment`,
      "Comments stay on this machine; Send writes a feedback package under .big-plan/feedback/",
      `In another terminal, run \`big-plan agent ${quoteShellArgument(runtime.planPath)}\`, then run its returned codex or claude command`,
      "Press Ctrl+C to stop the review runtime",
      parsedArguments.idleTimeoutMs === 0
        ? "This review stays up until you stop it; pass --idle-timeout <minutes> to close it after a spell of inactivity"
        : `This review ends after ${reviewIdleDurationLabel(parsedArguments.idleTimeoutMs)} of inactivity, meaning no page open and no agent working; configure with --idle-timeout`,
    ],
  };
};

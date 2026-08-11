// Implements `big-plan review <input.mdx>`: the I/O boundary that starts the
// local review runtime and reports where the reviewer opens it. The command
// keeps running because the runtime is the product - it is the only way submit
// and progress can work - so it returns the address and then stays listening
// until the reviewer stops it.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AxiError } from "axi-sdk-js";
import { assertPlanPassesLint } from "../_shared/authoring-lint.js";
import { requireGuidanceAcknowledgment } from "../_shared/guidance-gate.js";
import {
  deriveInputFile,
  parseInputCommandArguments,
} from "../_shared/input-command.js";
import { startReviewRuntime } from "../../review/server.js";
import { quoteShellArgument } from "../../review/shared/agent-command.js";
import { renderDocument } from "../../render/render-document.js";

const USAGE = "Usage: big-plan review <input.mdx> [--diff-preview]";

/** Serves one plan for interactive review on loopback. */
export const reviewCommand = async (
  args: ReadonlyArray<string>,
): Promise<Record<string, unknown>> => {
  // Temporary development chrome: keep the product contract independent of
  // this gallery seed so the flag can disappear without a migration.
  const diffPreview = args.includes("--diff-preview");
  const positionalArgs = args.filter((arg) => arg !== "--diff-preview");
  const { inputPath } = parseInputCommandArguments({
    args: positionalArgs,
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
      .close()
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

  return {
    review: runtime.url,
    plan: runtime.planPath,
    session: runtime.sessionId,
    feedback: runtime.store.feedbackDirectory,
    help: [
      ...warnings,
      ...(diffPreview
        ? ["Temporary diff preview is active with a synthetic answered request"]
        : []),
      `Open ${runtime.url} in your browser to review and comment`,
      "Comments stay on this machine; Send writes a feedback package under .big-plan/feedback/",
      `In another terminal, run \`big-plan agent ${quoteShellArgument(runtime.planPath)}\`, then run its returned codex or claude command`,
      "Press Ctrl+C to stop the review runtime",
    ],
  };
};

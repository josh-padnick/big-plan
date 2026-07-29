// Implements `big-plan guidance`: prints the plan-writing principles and the
// starting template, and records the acknowledgment that unlocks validate and
// render for the current directory.

import { AxiError } from "axi-sdk-js";
import { recordGuidanceAcknowledgment } from "./acknowledgment.js";
import { GUIDANCE_MARKDOWN, TEMPLATE_MDX } from "./content.generated.js";

const USAGE = "Usage: big-plan guidance";

/** Prints the authoring guidance and records its acknowledgment. */
export const guidanceCommand = async (
  args: ReadonlyArray<string>,
): Promise<string> => {
  if (args.length > 0) {
    throw new AxiError(
      `Unexpected extra argument "${args[0] ?? ""}"`,
      "VALIDATION_ERROR",
      [USAGE],
    );
  }
  await recordGuidanceAcknowledgment();
  return [
    GUIDANCE_MARKDOWN.trimEnd(),
    "",
    "## Start from this template",
    "",
    "Copy this skeleton and replace every placeholder; delete sections that genuinely do not apply.",
    "",
    "```mdx",
    TEMPLATE_MDX.trimEnd(),
    "```",
    "",
    "Guidance acknowledged for this directory: `big-plan validate` and `big-plan render` are unlocked for 24 hours.",
    "",
  ].join("\n");
};

// Implements `big-plan guidance`: prints the plan-writing principles and
// records the acknowledgment that unlocks validate and render for the
// current directory.

import { AxiError } from "axi-sdk-js";
import { recordGuidanceAcknowledgment } from "./acknowledgment.js";
import { GUIDANCE_MARKDOWN } from "./content.generated.js";

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
  const { persisted } = await recordGuidanceAcknowledgment();
  const acknowledgmentNote = persisted
    ? "Guidance acknowledged for this directory: `big-plan validate` and `big-plan render` are unlocked for 24 hours."
    : "No writable state directory exists here, so this acknowledgment could not be saved; validate and render will warn instead of locking. Set BIG_PLAN_STATE_DIR to a writable directory to restore the gate.";
  return [GUIDANCE_MARKDOWN.trimEnd(), "", acknowledgmentNote, ""].join("\n");
};

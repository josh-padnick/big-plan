// Implements `big-plan guidance [component]`: prints the plan-writing
// principles (recording the acknowledgment that unlocks validate, render, and
// review for the current directory), or one component's usage guidance on
// demand.

import { AxiError } from "axi-sdk-js";
import { recordGuidanceAcknowledgment } from "../_shared/guidance-gate.js";
import { COMPONENT_GUIDANCE, GUIDANCE_MARKDOWN } from "./content.generated.js";

const USAGE = "Usage: big-plan guidance [component]";

/** Prints authoring guidance; the no-argument form records the acknowledgment. */
export const guidanceCommand = async (
  args: ReadonlyArray<string>,
): Promise<string> => {
  if (args.length > 1) {
    throw new AxiError(
      `Unexpected extra argument "${args[1] ?? ""}"`,
      "VALIDATION_ERROR",
      [USAGE],
    );
  }
  const component = args[0];
  if (component !== undefined) {
    const componentGuidance = COMPONENT_GUIDANCE[component];
    if (componentGuidance === undefined) {
      throw new AxiError(
        `Unknown component "${component}"`,
        "VALIDATION_ERROR",
        [
          `Components with usage guidance: ${Object.keys(COMPONENT_GUIDANCE).join(", ")}`,
          USAGE,
        ],
      );
    }
    return `${componentGuidance.trimEnd()}\n`;
  }
  const { persisted } = await recordGuidanceAcknowledgment();
  const acknowledgmentNote = persisted
    ? "Guidance acknowledged for this directory: `big-plan validate`, `big-plan render`, and `big-plan review` are unlocked for 24 hours."
    : "No writable state directory exists here, so this acknowledgment could not be saved; validate, render, and review will warn instead of locking. Set BIG_PLAN_STATE_DIR to a writable directory to restore the gate.";
  return [GUIDANCE_MARKDOWN.trimEnd(), "", acknowledgmentNote, ""].join("\n");
};

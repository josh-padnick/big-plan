// Implements `big-plan validate <input.mdx>`: complete in-memory delivery plus
// validate-only authoring lint, with no output path or filesystem write.

import { validateDocument } from "../../render/render-document.js";
import { assertPlanPassesLint } from "../_shared/authoring-lint.js";
import {
  deriveInputFile,
  parseInputCommandArguments,
} from "../_shared/input-command.js";
import { requireGuidanceAcknowledgment } from "../_shared/guidance-gate.js";

const USAGE = "Usage: big-plan validate <input.mdx>";

/** Validates one authored plan and reports its structural summary. */
export const validateCommand = async (
  args: ReadonlyArray<string>,
): Promise<Record<string, unknown>> => {
  const { warnings } = await requireGuidanceAcknowledgment();
  const { inputPath } = parseInputCommandArguments({
    args,
    usage: USAGE,
    maximumArguments: 1,
  });
  const { markdown, derived } = await deriveInputFile({
    inputPath,
    usage: USAGE,
    invalidDocumentMessage: "Cannot validate document with invalid MDX",
    derive: validateDocument,
  });
  assertPlanPassesLint({ markdown });
  return {
    validated: inputPath,
    title: derived.title,
    sections: derived.sections.length,
    components: derived.components.length,
    help: [
      ...warnings,
      "Lint checks only what is statically analyzable; render the plan and reread the document exactly as your human will",
      "Judge it against the principles from `big-plan guidance` before presenting it",
    ],
  };
};

// Implements `big-plan validate <input.mdx>`: complete in-memory delivery plus
// validate-only authoring lint, with no output path or filesystem write.

import { AxiError } from "axi-sdk-js";
import { lintPlan } from "../../lint/lint-plan.js";
import { validateDocument } from "../../render/render-document.js";
import {
  deriveInputFile,
  parseInputCommandArguments,
} from "../_shared/input-command.js";

const USAGE = "Usage: big-plan validate <input.mdx>";

/** Validates one authored plan and reports its structural summary. */
export const validateCommand = async (
  args: ReadonlyArray<string>,
): Promise<Record<string, unknown>> => {
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
  const lintDiagnostics = lintPlan({ markdown });
  if (lintDiagnostics.length > 0) {
    throw new AxiError(
      "Plan failed authoring lint",
      "VALIDATION_ERROR",
      lintDiagnostics.map(
        ({ ruleId, line, column, message }) =>
          `${line}:${column} [${ruleId}] ${message}`,
      ),
    );
  }
  return {
    validated: inputPath,
    title: derived.title,
    sections: derived.sections.length,
    components: derived.components.length,
  };
};

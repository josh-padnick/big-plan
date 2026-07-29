// Owns the shared translation from authoring-lint diagnostics to the CLI's
// structured error, so validate and render fail identically on lint.

import { AxiError } from "axi-sdk-js";
import { lintPlan } from "../../lint/lint-plan.js";

/** Fails with the aggregated lint diagnostics when any registered rule finds a problem. */
export const assertPlanPassesLint = ({
  markdown,
}: {
  readonly markdown: string;
}): void => {
  const diagnostics = lintPlan({ markdown });
  if (diagnostics.length > 0) {
    throw new AxiError(
      "Plan failed authoring lint",
      "VALIDATION_ERROR",
      diagnostics.map(
        ({ ruleId, line, column, message }) =>
          `${line}:${column} [${ruleId}] ${message}`,
      ),
    );
  }
};

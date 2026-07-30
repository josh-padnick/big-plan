// Implements `big-plan render <input.mdx> [output.html]`: the I/O boundary
// around the pure renderer, supplying only HTML-specific derivation,
// serialization, and result facts to the shared safe output workflow.

import { renderDocument } from "../../render/render-document.js";
import { assertPlanPassesLint } from "../_shared/authoring-lint.js";
import { runDerivedOutputCommand } from "../_shared/derived-output-command.js";
import { requireGuidanceAcknowledgment } from "../_shared/guidance-gate.js";

const USAGE = "Usage: big-plan render <input.mdx> [output.html]";

/** Renders one self-contained HTML derivative and reports its review path. */
export const renderCommand = async (
  args: ReadonlyArray<string>,
): Promise<Record<string, unknown>> => {
  const { warnings } = await requireGuidanceAcknowledgment();
  return runDerivedOutputCommand({
    args,
    usage: USAGE,
    outputSuffix: ".html",
    invalidDocumentMessage: "Cannot render document with invalid MDX",
    derive: renderDocument,
    // A document a human is asked to review must also pass authoring lint, so
    // a lint finding can never reach the reviewer through render.
    verify: assertPlanPassesLint,
    serialize: ({ html }) => html,
    result: ({ derived, outputPath }) => ({
      rendered: outputPath,
      title: derived.title,
      sections: derived.sections.length,
      help: [
        ...warnings,
        `Open ${outputPath} in your browser to review the document`,
      ],
    }),
  });
};

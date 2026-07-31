// Implements `big-plan render <input.mdx> [output.html]`: the I/O boundary
// around the pure renderer, supplying only HTML-specific derivation,
// serialization, and result facts to the shared safe output workflow.

import { derivePlanId, renderDocument } from "../../render/render-document.js";
import { assertPlanPassesLint } from "../_shared/authoring-lint.js";
import { runDerivedOutputCommand } from "../_shared/derived-output-command.js";
import { requireGuidanceAcknowledgment } from "../_shared/guidance-gate.js";
import { parseInputCommandArguments } from "../_shared/input-command.js";

const USAGE = "Usage: big-plan render <input.mdx> [output.html]";

/** Renders one self-contained HTML derivative and reports its review path. */
export const renderCommand = async (
  args: ReadonlyArray<string>,
): Promise<Record<string, unknown>> => {
  // A malformed invocation is diagnosed before the guidance prerequisite, so
  // usage errors never hide behind GUIDANCE_REQUIRED. The parser is pure, so
  // the shared workflow below re-parsing the same arguments cannot disagree.
  parseInputCommandArguments({ args, usage: USAGE, maximumArguments: 2 });
  const { warnings } = await requireGuidanceAcknowledgment();
  return runDerivedOutputCommand({
    args,
    usage: USAGE,
    outputSuffix: ".html",
    invalidDocumentMessage: "Cannot render document with invalid MDX",
    // The plan's own path names its persistence namespace, so a reviewer's
    // drafts belong to this plan and never to another that shares its title.
    derive: ({ markdown, fallbackTitle, inputPath }) =>
      renderDocument({
        markdown,
        fallbackTitle,
        identity: { planId: derivePlanId({ planPath: inputPath }) },
      }),
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

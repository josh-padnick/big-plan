// Implements `big-plan render <input.mdx> [output.html]`: the I/O boundary
// around the pure renderer, supplying only HTML-specific derivation,
// serialization, and result facts to the shared safe output workflow.

import { renderDocument } from "../../render/render-document.js";
import { runDerivedOutputCommand } from "../_shared/derived-output-command.js";

const USAGE = "Usage: big-plan render <input.mdx> [output.html]";

/** Renders one self-contained HTML derivative and reports its review path. */
export const renderCommand = async (
  args: ReadonlyArray<string>,
): Promise<Record<string, unknown>> =>
  runDerivedOutputCommand({
    args,
    usage: USAGE,
    outputSuffix: ".html",
    invalidDocumentMessage: "Cannot render document with invalid MDX",
    derive: renderDocument,
    serialize: ({ html }) => html,
    result: ({ derived, outputPath }) => ({
      rendered: outputPath,
      title: derived.title,
      sections: derived.sections.length,
      help: [`Open ${outputPath} in your browser to review the document`],
    }),
  });

// Implements `big-plan compile <input.mdx> [output.json]`: the I/O boundary
// around the pure plan-model compiler, supplying only JSON-specific
// derivation, serialization, and result facts to the shared safe workflow.

import { compilePlanModel } from "../render/render-document.js";
import { runDerivedOutputCommand } from "./derived-output-command.js";

const USAGE = "Usage: big-plan compile <input.mdx> [output.json]";

/** Compiles one machine-readable plan derivative and reports its contents. */
export const compileCommand = async (
  args: ReadonlyArray<string>,
): Promise<Record<string, unknown>> =>
  runDerivedOutputCommand({
    args,
    usage: USAGE,
    outputSuffix: ".model.json",
    invalidDocumentMessage: "Cannot compile document with invalid MDX",
    derive: compilePlanModel,
    serialize: (model) => `${JSON.stringify(model, null, 2)}\n`,
    result: ({ derived, outputPath }) => ({
      compiled: outputPath,
      title: derived.title,
      sections: derived.sections.length,
      components: derived.components.length,
      help: [
        `The JSON at ${outputPath} holds the validated plan model: title, section outline, and every component instance's compiled model in document order`,
      ],
    }),
  });

// Derives the CodeDiff diff model from its authored metadata and diff text.

import type { ComponentDiffInput } from "../_model/component-diff/contract.js";
import {
  compileNamedFieldDiff,
  type NamedFieldDiff,
} from "../_model/component-diff/named-fields.js";
import type { CompiledCodeDiff } from "./compile.js";

export type CompiledCodeDiffDiff = NamedFieldDiff<CompiledCodeDiff>;
export const compileCodeDiffDiff = (
  input: ComponentDiffInput<CompiledCodeDiff>,
): CompiledCodeDiffDiff =>
  compileNamedFieldDiff(input, [
    { name: "File", value: (model) => model.filePath },
    { name: "Code", value: (model) => model.source },
    {
      name: "Presentation",
      value: (model) => ({
        showLineNumbers: model.showLineNumbers,
        showLineCounts: model.showLineCounts,
      }),
    },
    { name: "Annotations", value: (model) => model.annotations },
  ]);

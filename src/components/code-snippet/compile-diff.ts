import type { ComponentDiffInput } from "../_model/component-diff/contract.js";
import {
  compileNamedFieldDiff,
  type NamedFieldDiff,
} from "../_model/component-diff/named-fields.js";
import type { CompiledCodeSnippet } from "./compile.js";

export type CompiledCodeSnippetDiff = NamedFieldDiff<CompiledCodeSnippet>;
export const compileCodeSnippetDiff = (
  input: ComponentDiffInput<CompiledCodeSnippet>,
): CompiledCodeSnippetDiff =>
  compileNamedFieldDiff(input, [
    { name: "File", value: (model) => model.filePath },
    { name: "Code", value: (model) => model.source },
    {
      name: "Presentation",
      value: (model) => ({
        startLine: model.startLine,
        showLineNumbers: model.showLineNumbers,
      }),
    },
    { name: "Annotations", value: (model) => model.annotations },
  ]);

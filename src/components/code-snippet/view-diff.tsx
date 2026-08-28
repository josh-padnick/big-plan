// Presents CodeSnippet changes through the shared named-field diff view.

import { NamedFieldDiffView } from "../_shared/component-diff/named-field-diff-view.js";
import type { CompiledCodeSnippet } from "./compile.js";
import type { CompiledCodeSnippetDiff } from "./compile-diff.js";
import { CodeSnippet } from "./view.js";

export const CodeSnippetDiffView = ({
  model,
  controlId,
}: {
  readonly model: CompiledCodeSnippetDiff;
  readonly controlId: string;
}) => (
  <NamedFieldDiffView
    model={model}
    controlId={controlId}
    view={CodeSnippet}
    project={(value: CompiledCodeSnippet) => value}
  />
);
